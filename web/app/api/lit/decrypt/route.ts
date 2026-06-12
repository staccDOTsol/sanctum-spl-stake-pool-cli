/**
 * POST /api/lit/decrypt
 * Permissionless, market-gated decryption on Lit Chipotle (v3).
 *
 * No wallet, no signature: the immutable ladder action reads BOTH curve
 * reserve accounts live inside the TEE, computes
 *     r = sqrt(leak / (leak + dontLeak))
 * and returns only the first floor(r·k) tiers — whoever asks gets exactly
 * what the market currently reveals. Vault addresses and tier layout are
 * sealed inside each chunk's ciphertext, so they cannot be tampered with.
 *
 * Body: { payload: ChipotlePayload (v3) }
 * Response: {
 *   version: 3, mode, contentType, totalBytes, unlockedBytes, r,
 *   chunks: [{ index, unlocked, data? (image-strips) }],
 *   data — base64 of the contiguous unlocked prefix (the reveal frontier)
 * }
 *
 * v1/v2 payloads were encrypted on Lit's datil network (shut down
 * 2026-02-25) — permanently unrecoverable; clear 410.
 */
import { NextRequest, NextResponse } from "next/server";
import { isChipotlePayload, isTieredPayload, ENCLAVE_BATCH_BUDGET } from "@/lib/litConditions";
import { runLadderAction, litEnv } from "@/lib/chipotle";

export const runtime = "nodejs";
export const maxDuration = 120;

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";

interface ActionChunk { index: number; unlocked: boolean; data?: string }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { payload?: unknown; ciphertext?: string };

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
      let r: number | null = null;
      for (const batch of batches) {
        const out = await runLadderAction<{ chunks: ActionChunk[]; r?: number | null }>({
          op:          "decrypt",
          pkpId,
          rpcUrl:      RPC,
          ciphertexts: batch.ciphertexts,
        });
        if (typeof out.r === "number") r = out.r;
        for (const c of out.chunks) merged.push({ ...c, index: c.index + batch.start });
      }

      const byIndex  = new Map(merged.map((c) => [c.index, c]));
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
        r,
        chunks:        payload.chunks.map((c) => {
          const res = byIndex.get(c.index);
          return {
            index:    c.index,
            unlocked: !!res?.unlocked,
            ...(isStrips && res?.unlocked && res.data ? { data: res.data } : {}),
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
    const msg = err instanceof Error ? err.message : "Decryption failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
