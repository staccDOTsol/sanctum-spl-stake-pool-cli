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
import type { WalletProvider } from "./wallet";

// Global LEAK = base money layer (legacy display only)
export const LEAK_MINT = new PublicKey("GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS");

export const RFREESTACC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_RFREESTACC_MINT ?? "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS" // fallback = LEAK
);
export const MEME_QUOTE_MINT      = new PublicKey("GNcibpKH7dyMux4JEYE3dv4sfkXmDCfJU4CpJNM9pump");
// $stacccana — Token-2022, 6 decimals
export const STACCCANA_QUOTE_MINT = new PublicKey("73edX6xoGY4v5y2hzuKdrUbJXLntqgmo74au1Ki1pump");

export type PoolTypeChoice = "stable" | "meme" | "stacccana";

export const QUOTE_MINT_BY_TYPE: Record<PoolTypeChoice, PublicKey> = {
  stable:    RFREESTACC_MINT,
  meme:      MEME_QUOTE_MINT,
  stacccana: STACCCANA_QUOTE_MINT,
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
}

/**
 * Generate all four keypairs and derive BOTH pool addresses up front, so
 * encryption can bind to this content's own vault pair BEFORE anything is
 * broadcast (pool + vault addresses are PDAs of config/mints).
 */
export async function prepareDeployment(poolType: PoolTypeChoice): Promise<PreparedDeployment> {
  const { deriveDbcPoolAddress } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const leakConfigKp = Keypair.generate();
  const leakMintKp   = Keypair.generate();
  const dlConfigKp   = Keypair.generate();
  const dontLeakKp   = Keypair.generate();
  const quoteMint    = QUOTE_MINT_BY_TYPE[poolType];

  const leakPool     = deriveDbcPoolAddress(quoteMint,             leakMintKp.publicKey, leakConfigKp.publicKey);
  const dontLeakPool = deriveDbcPoolAddress(leakMintKp.publicKey,  dontLeakKp.publicKey, dlConfigKp.publicKey);

  return {
    leakConfigKp,
    leakMintKp,
    leakPool:     leakPool.toBase58(),
    dlConfigKp,
    dontLeakKp,
    dontLeakPool: dontLeakPool.toBase58(),
    quoteMint:    quoteMint.toBase58(),
  };
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
