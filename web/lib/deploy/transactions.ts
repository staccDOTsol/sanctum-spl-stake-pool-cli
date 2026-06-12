/**
 * Browser-side deploy helpers for the leak.markets launch wizard.
 *
 * EVERY LAUNCH DEPLOYS TWO NET-NEW CURVES:
 *   Pool A — a net-new LEAK token for this content, quoted in the chosen
 *            quote token (rfreestacc | GNcibpKH "memery" | $stacccana)
 *   Pool B — a net-new DONTLEAK token, quoted in THAT content's LEAK token
 *
 * The reveal ratio compares UNSOLD supply across the content's own pair:
 *   r = sqrt( unsoldDontLeak / (unsoldLeak + unsoldDontLeak) )
 * Buy Leak  = SOL → quote → LEAK_content            (drains pool A base, r↑)
 * Buy DontLeak = SOL → quote → LEAK_content → DONTLEAK (drains pool B base, r↓)
 */
import { Connection, Keypair, Transaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { WalletProvider } from "./wallet";

// Global LEAK = base money layer (legacy display only)
export const LEAK_MINT = new PublicKey("GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS");

export const RFREESTACC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_RFREESTACC_MINT ?? "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS" // fallback = LEAK
);
export const MEME_QUOTE_MINT      = new PublicKey("GNcibpKH7dyMux4JEYE3dv4sfkXmDCfJU4CpJNM9pump");
// $stacccana — Token-2022, 6 decimals
export const STACCCANA_QUOTE_MINT = new PublicKey("73edX6xoGY4v5y2hzuKdrUbJXLntqgmo74au1Ki1pump");

export type PoolTypeChoice = "stable" | "meme" | "stacccana" | "bounty";

export const QUOTE_MINT_BY_TYPE: Record<PoolTypeChoice, PublicKey> = {
  stable:    RFREESTACC_MINT,
  meme:      MEME_QUOTE_MINT,
  stacccana: STACCCANA_QUOTE_MINT,
  bounty:    MEME_QUOTE_MINT, // bounty's LEAK pool quotes in memery (meme curve)
};

export interface PreparedDeployment {
  // Pool A: LEAK_content / quote
  leakConfigKp: Keypair;
  leakMintKp:   Keypair;
  leakPool:     string;
  // Pool B: DONTLEAK_content / LEAK_content
  dlConfigKp:   Keypair;
  dontLeakKp:   Keypair;
  dontLeakPool: string;
  quoteMint:    string;
  // Bounty mode: the secret wallet. Both pools' fees route to it; its
  // base58 private key IS the encrypted content. Crack the key → claim
  // the pot. undefined for normal launches.
  bountyKp?:    Keypair;
  bountySecret?: string; // bs58(secretKey) — the content to encrypt
}

/**
 * Generate all four keypairs and derive BOTH pool addresses up front, so
 * encryption can bind to this content's own vault pair BEFORE anything is
 * broadcast (pool + vault addresses are PDAs of config/mints).
 *
 * `bounty` also mints a fresh secret wallet whose base58 private key is the
 * content being progressively revealed, and whose pubkey claims both pools'
 * fees — the self-funding capture-the-flag pot.
 */
export async function prepareDeployment(poolType: PoolTypeChoice, bounty = false): Promise<PreparedDeployment> {
  const { deriveDbcPoolAddress } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const leakConfigKp = Keypair.generate();
  const leakMintKp   = Keypair.generate();
  const dlConfigKp   = Keypair.generate();
  const dontLeakKp   = Keypair.generate();
  const quoteMint    = QUOTE_MINT_BY_TYPE[poolType];

  const leakPool     = deriveDbcPoolAddress(quoteMint,             leakMintKp.publicKey, leakConfigKp.publicKey);
  const dontLeakPool = deriveDbcPoolAddress(leakMintKp.publicKey,  dontLeakKp.publicKey, dlConfigKp.publicKey);

  const bountyKp = bounty ? Keypair.generate() : undefined;

  return {
    leakConfigKp,
    leakMintKp,
    leakPool:     leakPool.toBase58(),
    dlConfigKp,
    dontLeakKp,
    dontLeakPool: dontLeakPool.toBase58(),
    quoteMint:    quoteMint.toBase58(),
    bountyKp,
    bountySecret: bountyKp ? bs58.encode(bountyKp.secretKey) : undefined,
  };
}

/** Live claimable pot (partner fees) across a bounty's two pools, in lamports of each side. */
export async function fetchBountyPot(
  conn: Connection,
  leakPool: string,
  dontLeakPool: string,
): Promise<{ quote: bigint; base: bigint }> {
  const { DynamicBondingCurveClient } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  let quote = BigInt(0), base = BigInt(0);
  for (const p of [leakPool, dontLeakPool]) {
    try {
      const m = await client.state.getPoolFeeMetrics(new PublicKey(p));
      quote += BigInt(m.current.partnerQuoteFee.toString());
      base  += BigInt(m.current.partnerBaseFee.toString());
    } catch { /* pool may not exist yet */ }
  }
  return { quote, base };
}

export interface DeployedPool {
  pool: string;
  mint: string;
  sig:  string;
}

/**
 * Deploy one curve (createConfigAndPool) via the generic API route.
 * curve "stable" = gentler fees; "meme" = anti-snipe fee schedule.
 */
export async function deployCurve(
  conn:   Connection,
  wallet: WalletProvider,
  opts: {
    configKp:  Keypair;
    baseKp:    Keypair;
    quoteMint: string;
    name:      string;
    symbol:    string;
    uri:       string;
    curve:     "stable" | "meme" | "dontleak";
    /** 6 for LEAK_content (precision: see deploy route), 9 for DONTLEAK */
    baseDecimals: number;
    /** bounty mode: route partner fees + leftover to the secret wallet */
    feeClaimer?: string;
  },
): Promise<DeployedPool> {
  const res = await fetch("/api/deploy/pool2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payer:           wallet.publicKey.toBase58(),
      configPubkey:    opts.configKp.publicKey.toBase58(),
      basePubkey:      opts.baseKp.publicKey.toBase58(),
      quoteMintAddress: opts.quoteMint,
      name:            opts.name,
      symbol:          opts.symbol,
      uri:             opts.uri,
      curve:           opts.curve,
      baseDecimals:    opts.baseDecimals,
      feeClaimer:      opts.feeClaimer,
    }),
  });

  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "API error" }));
    throw new Error(error ?? "Failed to build transaction");
  }

  const { txBase64, poolAddress, blockhash, lastValidBlockHeight } = await res.json();

  const tx = Transaction.from(Buffer.from(txBase64, "base64"));
  tx.partialSign(opts.configKp);
  tx.partialSign(opts.baseKp);

  const signed = await wallet.signTransaction(tx) as Transaction;
  const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

  return { pool: poolAddress, mint: opts.baseKp.publicKey.toBase58(), sig };
}
