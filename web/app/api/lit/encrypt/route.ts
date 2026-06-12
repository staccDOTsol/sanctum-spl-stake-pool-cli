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
 * Body: multipart/form-data
 *   file        — the content
 *   l2Pool      — this content's DBC pool address (derivable pre-deploy)
 *   baseMint    — the DontLeak mint (for the L2 base-vault PDA)
 *   quoteMint   — informational
 *   l1Pool      — optional L1 pool override (default: platform LEAK pool)
 *   tiers       — optional tier count (clamped to LIT_MAX_TIERS)
 *
 * Returns the ChipotlePayload (v3) JSON.
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { deriveDbcTokenVaultAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { chunkCountFor, MAX_CONTENT_BYTES, ENCLAVE_BATCH_BUDGET, type ChipotleChunk, type ChipotlePayload } from "@/lib/litConditions";
import { runLadderAction, litEnv } from "@/lib/chipotle";

export const runtime = "nodejs";
export const maxDuration = 120;

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";
// Platform L1 pool (LEAK base / rfstacc quote) — the global leak-side vote.
const DEFAULT_L1_POOL = "ze1HvkHogbWPRiR6W5DYp82YrtJTAum1WEDLrUJNjwX";

/** The L1 pool exists on-chain: read its BASE vault (unsold LEAK). */
async function l1BaseVault(conn: Connection, l1Pool: string): Promise<string> {
  const info = await conn.getAccountInfo(new PublicKey(l1Pool));
  if (!info) throw new Error(`L1 pool not found: ${l1Pool}`);
  return new PublicKey(info.data.subarray(168, 200)).toBase58(); // base_vault
}

export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const file      = formData.get("file") as File | null;
    const l2Pool    = formData.get("l2Pool") as string | null;
    const quoteMint = formData.get("quoteMint") as string | null;
    const baseMint  = formData.get("baseMint") as string | null; // the DontLeak mint
    const l1Pool    = (formData.get("l1Pool") as string | null) || DEFAULT_L1_POOL;
    const tiersReq  = Number(formData.get("tiers") ?? "") || undefined;
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (!l2Pool || !baseMint) {
      return NextResponse.json({ error: "l2Pool and baseMint required (tiered encryption is bound to the content pool)" }, { status: 400 });
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

    const conn = new Connection(RPC, "confirmed");

    // The content curve's BASE vault (unsold DontLeak) is a PDA —
    // derivable even before the pool is deployed.
    const l2BaseVault = deriveDbcTokenVaultAddress(
      new PublicKey(l2Pool), new PublicKey(baseMint),
    ).toBase58();
    void quoteMint;

    const v1 = await l1BaseVault(conn, l1Pool);

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
          const stripH = Math.ceil(h / stripCount);
          parts = await Promise.all(
            Array.from({ length: stripCount }, async (_, i) => {
              const top    = i * stripH;
              const height = Math.min(stripH, h - top);
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
        v2:   l2BaseVault,
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
      l2QuoteVault: l2BaseVault,
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
