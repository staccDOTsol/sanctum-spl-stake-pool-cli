/**
 * POST /api/lit/encrypt
 * Tiered encryption on Lit Chipotle (v3) — datil/naga are sunset.
 *
 * The file is split into chunks; each chunk is wrapped in an envelope that
 * SEALS its ladder thresholds + vault addresses, then encrypted inside the
 * Chipotle TEE with a PKP-derived key. Only the immutable ladder action can
 * decrypt, and it re-checks the thresholds against live Solana state on
 * every decrypt — the reveal frontier is enclave-enforced:
 *
 *   chunk 0   — viewer holds LEAK
 *   chunk i≥1 — viewer holds LEAK
 *               AND L1 leak vault ≥ baseline·1.15^i      (leak capital unlocks)
 *               AND L2 dontLeak vault < unit·2^(K-1-i)   (suppression re-locks)
 *
 * Body: multipart/form-data
 *   file        — the content
 *   l2Pool      — this content's DBC pool address (derivable pre-deploy)
 *   quoteMint   — the L2 pool's quote mint
 *   l1Pool      — optional L1 pool override (default: platform LEAK pool)
 *
 * Returns the ChipotlePayload (v3) JSON.
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { deriveDbcTokenVaultAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { chunkCountFor, tierThresholds, type ChipotleChunk, type ChipotlePayload } from "@/lib/litConditions";
import { runLadderAction, litEnv } from "@/lib/chipotle";

export const runtime = "nodejs";
export const maxDuration = 120;

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";
// Platform L1 pool (LEAK base / rfstacc quote) — the global leak-side vote.
const DEFAULT_L1_POOL = "ze1HvkHogbWPRiR6W5DYp82YrtJTAum1WEDLrUJNjwX";

/** The L1 pool exists on-chain: read its quote vault address + balance. */
async function l1VaultState(conn: Connection, l1Pool: string): Promise<{ vault: string; raw: bigint }> {
  const info = await conn.getAccountInfo(new PublicKey(l1Pool));
  if (!info) throw new Error(`L1 pool not found: ${l1Pool}`);
  const vault = new PublicKey(info.data.subarray(200, 232)); // quote_vault
  const bal   = await conn.getTokenAccountBalance(vault).catch(() => null);
  return { vault: vault.toBase58(), raw: BigInt(bal?.value.amount ?? "0") };
}

export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const file      = formData.get("file") as File | null;
    const l2Pool    = formData.get("l2Pool") as string | null;
    const quoteMint = formData.get("quoteMint") as string | null;
    const l1Pool    = (formData.get("l1Pool") as string | null) || DEFAULT_L1_POOL;
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (!l2Pool || !quoteMint) {
      return NextResponse.json({ error: "l2Pool and quoteMint required (tiered encryption is bound to the content pool)" }, { status: 400 });
    }

    const rawBytes    = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    const conn = new Connection(RPC, "confirmed");

    // L2 quote vault is a PDA — derivable even before the pool is deployed.
    const l2QuoteVault = deriveDbcTokenVaultAddress(
      new PublicKey(l2Pool), new PublicKey(quoteMint),
    ).toBase58();

    const [l1, quoteMintInfo] = await Promise.all([
      l1VaultState(conn, l1Pool),
      conn.getParsedAccountInfo(new PublicKey(quoteMint)),
    ]);
    const qData = quoteMintInfo.value?.data;
    const quoteDecimals: number =
      (qData && "parsed" in qData ? qData.parsed?.info?.decimals : undefined) ?? 9;

    const chunkCount = chunkCountFor(rawBytes.length);
    const chunkSize  = Math.ceil(rawBytes.length / chunkCount);
    const ladder = {
      l1BaselineRaw:  l1.raw,
      l2QuoteUnitRaw: 10n ** BigInt(quoteDecimals),
      chunkCount,
    };

    // Build sealed envelopes: thresholds travel INSIDE the ciphertext.
    const slices: { offset: number; length: number }[] = [];
    const messages: string[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const offset = i * chunkSize;
      const slice  = rawBytes.subarray(offset, Math.min(offset + chunkSize, rawBytes.length));
      const { floor, ceiling } = tierThresholds(i, ladder);
      slices.push({ offset, length: slice.length });
      messages.push(JSON.stringify({
        i,
        ...(floor   ? { fl: floor,   l1v: l1.vault }     : {}),
        ...(ceiling ? { ce: ceiling, l2v: l2QuoteVault } : {}),
        data: Buffer.from(slice).toString("base64"),
      }));
    }

    const { pkpId } = litEnv();
    const { ciphertexts } = await runLadderAction<{ ciphertexts: string[] }>({
      op: "encrypt",
      pkpId,
      messages,
    });
    if (!Array.isArray(ciphertexts) || ciphertexts.length !== chunkCount) {
      throw new Error("Chipotle encrypt returned an unexpected result");
    }

    const chunks: ChipotleChunk[] = ciphertexts.map((ciphertext, i) => ({
      index: i, offset: slices[i].offset, length: slices[i].length, ciphertext,
    }));

    const payload: ChipotlePayload = {
      version:      3,
      contentType,
      filename:     file.name,
      totalBytes:   rawBytes.length,
      l1QuoteVault: l1.vault,
      l2QuoteVault,
      chunks,
    };
    return NextResponse.json(payload);
  } catch (err: unknown) {
    console.error("[/api/lit/encrypt]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Encryption failed" },
      { status: 500 },
    );
  }
}
