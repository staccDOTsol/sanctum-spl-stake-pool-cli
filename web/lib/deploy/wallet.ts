/**
 * Minimal wallet connector for Phantom / Solflare / any window.solana wallet.
 * Uses the Wallet Standard rather than the full wallet-adapter package.
 */
import { Connection, Transaction, VersionedTransaction, PublicKey } from "@solana/web3.js";

export type WalletProvider = {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
};

// Phantom returns { signature }, Solflare (and some others) may return the
// raw bytes — normalize to Uint8Array.
type SignMessageResult = { signature: Uint8Array } | Uint8Array;
function normalizeSignature(res: SignMessageResult): Uint8Array {
  return res instanceof Uint8Array ? res : res.signature;
}

// Local types only — avoid global Window augmentation which conflicts with
// @walletconnect/ethereum-provider (via Lit) declaring window.solana as any.
type SolanaWallet = {
  publicKey: { toBase58(): string } | null;
  isPhantom?: boolean;
  isSolflare?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]>;
  signMessage: (message: Uint8Array, encoding?: string) => Promise<SignMessageResult>;
};
type SolflareWallet = {
  publicKey: { toBase58(): string } | null;
  isSolflare?: boolean;
  connect: () => Promise<void | boolean>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]>;
  signMessage: (message: Uint8Array, encoding?: string) => Promise<SignMessageResult>;
};
type WalletWindow = { solana?: SolanaWallet; solflare?: SolflareWallet };

function walletWindow(): WalletWindow {
  return window as unknown as WalletWindow;
}

export function detectWallet(): "phantom" | "solflare" | "none" {
  if (typeof window === "undefined") return "none";
  const w = walletWindow();
  if (w.solana?.isPhantom)    return "phantom";
  if (w.solflare?.isSolflare) return "solflare";
  // Solflare's "set as default" mode injects window.solana with isSolflare —
  // it mimics the Phantom API, so the generic window.solana path handles it.
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
    const sf = w.solflare;
    await sf.connect();
    // Solflare can resolve connect() before publicKey is populated — wait
    // briefly instead of failing the init.
    let pkStr = sf.publicKey?.toBase58();
    for (let i = 0; !pkStr && i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      pkStr = sf.publicKey?.toBase58();
    }
    if (!pkStr) throw new Error("Solflare connection failed");
    return {
      publicKey:          new PublicKey(pkStr),
      signTransaction:    (tx) => sf.signTransaction(tx),
      signAllTransactions:(txs) => sf.signAllTransactions(txs),
      signMessage:        async (m) => normalizeSignature(await sf.signMessage(m, "utf8")),
    };
  }

  const sol   = w.solana!;
  const resp  = await sol.connect();
  const pkStr = resp.publicKey.toBase58();
  return {
    publicKey:          new PublicKey(pkStr),
    signTransaction:    (tx) => sol.signTransaction(tx),
    signAllTransactions:(txs) => sol.signAllTransactions(txs),
    signMessage:        async (m) => normalizeSignature(await sol.signMessage(m, "utf8")),
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
