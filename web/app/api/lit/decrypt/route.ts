/**
 * POST /api/lit/decrypt
 * Tiered decryption on Lit Chipotle (v3). The browser signs the auth
 * message; the immutable ladder action verifies it INSIDE the TEE, checks
 * LEAK holding + per-chunk vault thresholds against live Solana state, and
 * returns only the chunks the market currently allows. The server never
 * holds key material and cannot over-reveal.
 *
 * Body: { payload: ChipotlePayload (v3), authSig }
 * Response: {
 *   version: 3, contentType, totalBytes, unlockedBytes,
 *   chunks: [{ index, unlocked }],
 *   data — base64 of the CONTIGUOUS unlocked prefix (the reveal frontier)
 * }
 *
 * v1/v2 payloads were encrypted on Lit's datil network, which was shut down
 * on 2026-02-25 — those ciphertexts are permanently unrecoverable (the
 * network's threshold keys are gone). They get a clear 410 response.
 */
import { NextRequest, NextResponse } from "next/server";
import { isChipotlePayload, isTieredPayload, LEAK_MINT, ENCLAVE_BATCH_BUDGET } from "@/lib/litConditions";
import { runLadderAction, litEnv } from "@/lib/chipotle";

export const runtime = "nodejs";
export const maxDuration = 120;

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";

interface AuthSig { sig: string; derivedVia: string; signedMessage: string; address: string }
interface ActionChunk { index: number; unlocked: boolean; data?: string }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      payload?:    unknown;
      ciphertext?: string;
      authSig?:    AuthSig;
    };

    if (!body.authSig) {
      return NextResponse.json({ error: "authSig required" }, { status: 400 });
    }

    // ── Chipotle tiered payload (v3) ─────────────────────────────────
    if (isChipotlePayload(body.payload)) {
      const payload = body.payload;
      const { pkpId } = litEnv();

      // The enclave caps request/response around 1MB — decrypt in batches
      // (request side carries the ciphertexts; response the plaintexts) and
      // remap each batch's relative indexes back to payload positions.
      const all = payload.chunks.map((c) => c.ciphertext);
      const batches: { start: number; ciphertexts: string[] }[] = [];
      let start = 0, cur: string[] = [], budget = 0;
      for (let i = 0; i < all.length; i++) {
        const cost = all[i].length + Math.ceil(all[i].length / 2) + 256; // request + response
        if (cur.length > 0 && budget + cost > ENCLAVE_BATCH_BUDGET) {
          batches.push({ start, ciphertexts: cur });
          start = i; cur = []; budget = 0;
        }
        cur.push(all[i]); budget += cost;
      }
      if (cur.length) batches.push({ start, ciphertexts: cur });

      const merged: ActionChunk[] = [];
      for (const batch of batches) {
        const out = await runLadderAction<{ chunks: ActionChunk[] }>({
          op:          "decrypt",
          pkpId,
          rpcUrl:      RPC,
          leakMint:    LEAK_MINT,
          authSig:     body.authSig,
          ciphertexts: batch.ciphertexts,
        }).catch((e: Error) => {
          if (/ACCESS_DENIED_NO_LEAK/.test(e.message)) {
            throw Object.assign(new Error("Access denied — you need LEAK tokens to decrypt"), { status: 403 });
          }
          throw e;
        });
        for (const c of out.chunks) merged.push({ ...c, index: c.index + batch.start });
      }
      const result = { chunks: merged };

      const byIndex  = new Map(result.chunks.map((c) => [c.index, c]));
      const isStrips = payload.mode === "image-strips";

      // bytes mode: the reveal frontier is the contiguous prefix up to the
      // first locked chunk. image-strips: every strip is independently
      // renderable, so unlocked strips are returned individually.
      const prefixParts: Buffer[] = [];
      for (let i = 0; i < payload.chunks.length; i++) {
        const c = byIndex.get(i);
        if (!c?.unlocked || !c.data) break;
        prefixParts.push(Buffer.from(c.data, "base64"));
      }
      const prefix = Buffer.concat(prefixParts);

      return NextResponse.json({
        version:       3,
        mode:          payload.mode ?? "bytes",
        contentType:   payload.contentType,
        totalBytes:    payload.totalBytes,
        unlockedBytes: prefix.length,
        chunks:        payload.chunks.map((c) => {
          const r = byIndex.get(c.index);
          return {
            index:    c.index,
            unlocked: !!r?.unlocked,
            ...(isStrips && r?.unlocked && r.data ? { data: r.data } : {}),
          };
        }),
        data:          prefix.toString("base64"),
      });
    }

    // ── Sunset networks (datil v1/v2) ────────────────────────────────
    if (isTieredPayload(body.payload) || body.ciphertext) {
      return NextResponse.json({
        error: "This content was encrypted on Lit's datil network, which was shut down on 2026-02-25. " +
               "The ciphertext is permanently unrecoverable — the creator must re-upload it.",
      }, { status: 410 });
    }

    return NextResponse.json({ error: "payload (v3) required" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[/api/lit/decrypt]", err);
    const msg    = err instanceof Error ? err.message : "Decryption failed";
    const status = (err as { status?: number })?.status
      ?? (/access|denied|unauthori/i.test(msg) ? 403 : 500);
    return NextResponse.json({ error: msg }, { status });
  }
}
