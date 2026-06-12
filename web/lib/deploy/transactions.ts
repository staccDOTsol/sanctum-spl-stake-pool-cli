/**
 * Browser-side deploy helpers for the leak.markets launch wizard.
 */
import { Connection, Keypair, Transaction, PublicKey } from "@solana/web3.js";
import type { WalletProvider } from "./wallet";

// LEAK = base money layer
export const LEAK_MINT = new PublicKey("GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS");

// L1 quote tokens — content pools quote against these (not LEAK directly)
// stable: rfreestacc/LEAK pool.  Set NEXT_PUBLIC_RFREESTACC_MINT once deployed.
// meme:   GNcibpKH/LEAK pool.   Config created by platform; platform earns partner share.
export const RFREESTACC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_RFREESTACC_MINT ?? "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS" // fallback = LEAK
);
export const MEME_QUOTE_MINT = new PublicKey("GNcibpKH7dyMux4JEYE3dv4sfkXmDCfJU4CpJNM9pump");

// L1 DBC pool addresses (rfreestacc/LEAK and GNcibpKH/LEAK).
// Stable defaults to the deployed platform pool (pool1Address in
// mainnet-deployment.json: base = LEAK, quote = rfstacc) so new launches
// register a real leak-side vote source. Meme stays unset until deployed.
export const STABLE_L1_POOL = process.env.NEXT_PUBLIC_STABLE_L1_POOL ?? "ze1HvkHogbWPRiR6W5DYp82YrtJTAum1WEDLrUJNjwX";
export const MEME_L1_POOL   = process.env.NEXT_PUBLIC_MEME_L1_POOL   ?? "";

export type PoolTypeChoice = "stable" | "meme";

export interface DeployPool2Result {
  dontLeakMint: string;
  pool2Address: string;
  quoteMint:    string;
  sig:          string;
}

export async function deployPool2(
  conn: Connection,
  wallet: WalletProvider,
  opts: { name: string; symbol: string; uri: string; poolType: PoolTypeChoice },
): Promise<DeployPool2Result> {
  const configKp   = Keypair.generate();
  const dontLeakKp = Keypair.generate();

  const res = await fetch("/api/deploy/pool2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payer:          wallet.publicKey.toBase58(),
      configPubkey:   configKp.publicKey.toBase58(),
      dontLeakPubkey: dontLeakKp.publicKey.toBase58(),
      name:           opts.name,
      symbol:         opts.symbol,
      uri:            opts.uri,
      poolType:       opts.poolType,
    }),
  });

  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "API error" }));
    throw new Error(error ?? "Failed to build transaction");
  }

  const { txBase64, pool2Address, quoteMint: returnedQuoteMint, blockhash, lastValidBlockHeight } = await res.json();

  const tx = Transaction.from(Buffer.from(txBase64, "base64"));
  tx.partialSign(configKp);
  tx.partialSign(dontLeakKp);

  const signed = await wallet.signTransaction(tx) as Transaction;
  const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

  return {
    dontLeakMint: dontLeakKp.publicKey.toBase58(),
    pool2Address,
    quoteMint:    (returnedQuoteMint as string) ?? RFREESTACC_MINT.toBase58(),
    sig,
  };
}
