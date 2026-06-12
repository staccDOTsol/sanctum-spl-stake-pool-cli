/**
 * POST /api/lit/encrypt
 * Tiered encryption on Lit Chipotle (v3) — datil/naga are sunset.
 *
 * The file is split into tiers; each tier's envelope SEALS the tier layout
 * plus both curves' BASE vault addresses (UNSOLD token counts), then is
 * encrypted inside the Chipotle TEE with a PKP-derived key. At decrypt the
 * enclave reads both vaults live and computes
 *     r = sqrt( unsoldDontLeak / (unsoldLeak + unsoldDontLeak) )
 * returning the first floor(r·k) tiers — permissionless, market-decided.
 *
 * Body: multipart/form-data — the content's OWN pool pair:
 *   file         — the content
 *   leakPool     — pool A address (LEAK_content / quote), derivable pre-deploy
 *   leakMint     — this content's LEAK mint
 *   dontLeakPool — pool B address (DONTLEAK / LEAK_content)
 *   baseMint     — this content's DONTLEAK mint
 *   tiers        — optional tier count (clamped to LIT_MAX_TIERS)
 *
 * Returns the ChipotlePayload (v3) JSON.
 */
import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { deriveDbcTokenVaultAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { chunkCountFor, MAX_CONTENT_BYTES, ENCLAVE_BATCH_BUDGET, type ChipotleChunk, type ChipotlePayload } from "@/lib/litConditions";
import { runLadderAction, litEnv } from "@/lib/chipotle";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const formData     = await req.formData();
    const file         = formData.get("file") as File | null;
    const leakPool     = formData.get("leakPool") as string | null;
    const leakMint     = formData.get("leakMint") as string | null;
    const dontLeakPool = formData.get("dontLeakPool") as string | null;
    const baseMint     = formData.get("baseMint") as string | null; // DONTLEAK mint
    const tiersReq     = Number(formData.get("tiers") ?? "") || undefined;
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (!leakPool || !leakMint || !dontLeakPool || !baseMint) {
      return NextResponse.json({ error: "leakPool, leakMint, dontLeakPool, baseMint required (encryption binds to the content's own pool pair)" }, { status: 400 });
    }

    const rawBytes    = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";
    if (rawBytes.length > MAX_CONTENT_BYTES) {
      return NextResponse.json({
        error: `File too large for tiered encryption (${Math.round(rawBytes.length / 1024)} KB > ` +
               `${Math.round(MAX_CONTENT_BYTES / 1024)} KB). The Lit enclave caps a single ` +
               "execution's response (~1MB; ciphertext is ~2.7× the input) — compress the file or split it.",
      }, { status: 413 });
    }

    // Both BASE vaults (unsold token counts) are PDAs of the content's own
    // pool pair — derivable before either pool exists on-chain.
    const v1 = deriveDbcTokenVaultAddress(
      new PublicKey(leakPool), new PublicKey(leakMint),
    ).toBase58();
    const v2 = deriveDbcTokenVaultAddress(
      new PublicKey(dontLeakPool), new PublicKey(baseMint),
    ).toBase58();

    // Image content is tiered as horizontal CROPS (top→bottom), one
    // complete renderable image per ladder window — byte-prefixes of
    // PNG/WebP render nothing. Everything else is byte-range chunks.
    let mode: "bytes" | "image-strips" = "bytes";
    let stripError: string | undefined;
    let parts: { offset: number; bytes: Uint8Array }[] = [];
    if (contentType.startsWith("image/") && !contentType.includes("svg")) {
      try {
        const sharp = (await import("sharp")).default;
        const img   = sharp(Buffer.from(rawBytes), { animated: false });
        const meta  = await img.metadata();
        const w = meta.width ?? 0, h = meta.height ?? 0;
        if (w > 0 && h > 1) {
          const stripCount = Math.min(chunkCountFor(rawBytes.length, tiersReq), h);
          const fmt: "png" | "jpeg" | "webp" =
            contentType.includes("jpeg") || contentType.includes("jpg") ? "jpeg"
            : contentType.includes("webp") ? "webp" : "png";
          // Proportional partition: top_i = floor(i·h/K) — never overruns
          // the image height regardless of rounding (each strip ≥ 1px
          // because stripCount ≤ h).
          parts = await Promise.all(
            Array.from({ length: stripCount }, async (_, i) => {
              const top    = Math.floor((i * h) / stripCount);
              const height = Math.floor(((i + 1) * h) / stripCount) - top;
              const bytes  = await sharp(Buffer.from(rawBytes))
                .extract({ left: 0, top, width: w, height })
                .toFormat(fmt)
                .toBuffer();
              return { offset: top, bytes: new Uint8Array(bytes) };
            }),
          );
          mode = "image-strips";
        }
      } catch (e) {
        stripError = e instanceof Error ? `${e.message}\n${e.stack?.slice(0, 400)}` : String(e);
        console.warn("[/api/lit/encrypt] image strip slicing failed, falling back to bytes:", e);
        parts = [];
      }
    }
    if (parts.length === 0) {
      const chunkCount = chunkCountFor(rawBytes.length, tiersReq);
      const chunkSize  = Math.ceil(rawBytes.length / chunkCount);
      for (let i = 0; i < chunkCount; i++) {
        const offset = i * chunkSize;
        parts.push({ offset, bytes: rawBytes.subarray(offset, Math.min(offset + chunkSize, rawBytes.length)) });
      }
    }

    const chunkCount = parts.length;

    // Build sealed envelopes: tier index/count + both BASE vaults (UNSOLD
    // token counts — same units on both sides) travel INSIDE the ciphertext
    // (tamper-proof). The enclave computes r = sqrt(v2/(v1+v2)) from live
    // reserves at every decrypt and returns the first floor(r·k) tiers.
    const messages: string[] = parts.map((part, i) =>
      JSON.stringify({
        i,
        k:    chunkCount,
        v1,
        v2,
        data: Buffer.from(part.bytes).toString("base64"),
      }),
    );

    const { pkpId } = litEnv();

    // The enclave caps request/response around 1MB — encrypt in batches
    // sized so each execution's response (ciphertext ≈ 2× envelope) fits.
    const batches: string[][] = [];
    let current: string[] = [], budget = 0;
    for (const m of messages) {
      const cost = m.length * 2 + 256;
      if (current.length > 0 && budget + cost > ENCLAVE_BATCH_BUDGET) {
        batches.push(current); current = []; budget = 0;
      }
      current.push(m); budget += cost;
    }
    if (current.length) batches.push(current);

    const ciphertexts: string[] = [];
    for (const batch of batches) {
      const out = await runLadderAction<{ ciphertexts: string[] }>({
        op: "encrypt",
        pkpId,
        messages: batch,
      });
      if (!Array.isArray(out.ciphertexts) || out.ciphertexts.length !== batch.length) {
        throw new Error("Chipotle encrypt returned an unexpected result");
      }
      ciphertexts.push(...out.ciphertexts);
    }
    if (ciphertexts.length !== chunkCount) {
      throw new Error("Chipotle encrypt batch mismatch");
    }

    const chunks: ChipotleChunk[] = ciphertexts.map((ciphertext, i) => ({
      index: i, offset: parts[i].offset, length: parts[i].bytes.length, ciphertext,
    }));

    const payload: ChipotlePayload = {
      version:      3,
      contentType,
      filename:     file.name,
      totalBytes:   rawBytes.length,
      mode,
      l1QuoteVault: v1,
      l2QuoteVault: v2,
      chunks,
    };
    // Surface strip-slicing failures for diagnosis (payload consumers ignore it)
    return NextResponse.json(stripError ? { ...payload, stripError } : payload);
  } catch (err: unknown) {
    console.error("[/api/lit/encrypt]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Encryption failed" },
      { status: 500 },
    );
  }
}
