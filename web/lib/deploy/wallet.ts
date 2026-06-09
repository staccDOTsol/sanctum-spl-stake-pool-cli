/**
 * Minimal wallet connector for Phantom / Solflare / any window.solana wallet.
 * Uses the Wallet Standard rather than the full wallet-adapter package.
 */
import { Connection, Transaction, VersionedTransaction, PublicKey } from "@solana/web3.js";

export type WalletProvider = {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]>;
};

// Local types only — avoid global Window augmentation which conflicts with
// @walletconnect/ethereum-provider (via Lit) declaring window.solana as any.
type SolanaWallet = {
  publicKey: { toBase58(): string } | null;
  isPhantom?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]>;
};
type SolflareWallet = {
  publicKey: { toBase58(): string } | null;
  isSolflare?: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]>;
};
type WalletWindow = { solana?: SolanaWallet; solflare?: SolflareWallet };

function walletWindow(): WalletWindow {
  return window as unknown as WalletWindow;
}

export function detectWallet(): "phantom" | "solflare" | "none" {
  if (typeof window === "undefined") return "none";
  const w = walletWindow();
  if (w.solana?.isPhantom)   return "phantom";
  if (w.solflare?.isSolflare) return "solflare";
  if (w.solana)               return "phantom";
  return "none";
}

export async function connectWallet(): Promise<WalletProvider> {
  const type = detectWallet();
  if (type === "none") {
    throw new Error("No Solana wallet detected. Install Phantom or Solflare.");
  }

  const w = walletWindow();

  if (type === "solflare" && w.solflare) {
    await w.solflare.connect();
    const pkStr = w.solflare.publicKey?.toBase58();
    if (!pkStr) throw new Error("Solflare connection failed");
    return {
      publicKey:          new PublicKey(pkStr),
      signTransaction:    (tx) => w.solflare!.signTransaction(tx),
      signAllTransactions:(txs) => w.solflare!.signAllTransactions(txs),
    };
  }

  const resp  = await w.solana!.connect();
  const pkStr = resp.publicKey.toBase58();
  return {
    publicKey:          new PublicKey(pkStr),
    signTransaction:    (tx) => w.solana!.signTransaction(tx),
    signAllTransactions:(txs) => w.solana!.signAllTransactions(txs),
  };
}

/** Sign the tx with any ephemeral co-signers, then sign+send via wallet. */
export async function signAndSend(
  conn:      Connection,
  wallet:    WalletProvider,
  tx:        Transaction,
  coSigners: { publicKey: PublicKey; secretKey: Uint8Array }[],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  if (coSigners.length > 0) {
    const { Keypair } = await import("@solana/web3.js");
    for (const s of coSigners) {
      const kp = Keypair.fromSecretKey(s.secretKey);
      tx.partialSign(kp);
    }
  }

  const signed = await wallet.signTransaction(tx) as Transaction;
  const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}
