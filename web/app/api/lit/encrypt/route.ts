/**
 * POST /api/lit/encrypt
 * Server-side tiered Lit Protocol encryption. Splits the file into chunks
 * and encrypts each one under its own threshold-ladder condition set:
 *
 *   chunk 0   — hold LEAK
 *   chunk i≥1 — hold LEAK
 *               AND L1 leak vault ≥ baseline·1.15^i      (leak capital unlocks)
 *               AND L2 dontLeak vault < unit·2^(K-1-i)   (suppression re-locks)
 *
 * The Lit nodes evaluate the vault balances against live chain state at
 * every decrypt — the reveal frontier is enforced by Lit, not the client.
 *
 * Body: multipart/form-data
 *   file        — the content
 *   l2Pool      — this content's DBC pool address (derivable pre-deploy)
 *   quoteMint   — the L2 pool's quote mint
 *   l1Pool      — optional L1 pool override (default: platform LEAK pool)
 *
 * Returns the TieredPayload JSON (see lib/litConditions).
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { deriveDbcTokenVaultAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  tierConditions, chunkCountFor, type EncryptedChunk, type TieredPayload,
} from "@/lib/litConditions";

export const runtime = "nodejs";
export const maxDuration = 120;

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";
// Platform L1 pool (LEAK base / rfstacc quote) — the global leak-side vote.
const DEFAULT_L1_POOL = "ze1HvkHogbWPRiR6W5DYp82YrtJTAum1WEDLrUJNjwX";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;

async function getLitServer() {
  if (_client?.ready) return _client;
  const { LitNodeClient } = await import("@lit-protocol/lit-node-client");
  _client = new LitNodeClient({ litNetwork: "datil", debug: false });
  await _client.connect();
  return _client;
}

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
    const tierParams = {
      l1QuoteVault:   l1.vault,
      l2QuoteVault,
      l1BaselineRaw:  l1.raw,
      l2QuoteUnitRaw: 10n ** BigInt(quoteDecimals),
      chunkCount,
    };

    const client = await getLitServer();
    const chunks: EncryptedChunk[] = await Promise.all(
      Array.from({ length: chunkCount }, async (_, i) => {
        const offset     = i * chunkSize;
        const slice      = rawBytes.subarray(offset, Math.min(offset + chunkSize, rawBytes.length));
        const conditions = tierConditions(i, tierParams);
        const { ciphertext, dataToEncryptHash } = await client.encrypt({
          solRpcConditions: conditions,
          dataToEncrypt:    slice,
        });
        return { index: i, offset, length: slice.length, ciphertext, dataToEncryptHash, conditions };
      }),
    );

    const payload: TieredPayload = {
      version:      2,
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
