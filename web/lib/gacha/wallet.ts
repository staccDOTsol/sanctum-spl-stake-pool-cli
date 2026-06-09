// Multi-wallet connector via the Solana Wallet Standard. Enumerates every
// wallet the browser has registered (Phantom, Solflare, Backpack, Glow, OKX,
// …) — no per-wallet adapter packages, no React-version peer-dep pain.
import { getWallets } from "@wallet-standard/app";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

export const SOLANA_MAINNET_CHAIN = "solana:mainnet" as const;

const FEAT_CONNECT = "standard:connect";
const FEAT_SIGN_SEND = "solana:signAndSendTransaction";
const FEAT_SIGN_TX = "solana:signTransaction";

// Minimal structural types for the Wallet Standard surface we touch.
interface StdAccount { address: string; publicKey: Uint8Array; chains: readonly string[]; }
interface StdWallet {
  name: string;
  icon: string;
  chains: readonly string[];
  accounts: readonly StdAccount[];
  features: Record<string, unknown>;
}
interface ConnectFeature { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StdAccount[] }>; }
interface SignSendFeature {
  signAndSendTransaction(input: { account: StdAccount; chain: string; transaction: Uint8Array }):
    Promise<readonly { signature: Uint8Array }[]>;
}
interface SignTxFeature {
  signTransaction(input: { account: StdAccount; chain: string; transaction: Uint8Array }):
    Promise<readonly { signedTransaction: Uint8Array }[]>;
}

export interface WalletInfo { name: string; icon: string; }

export interface ConnectedWallet {
  name: string;
  icon: string;
  publicKey: PublicKey;
  /** Sign + send a built transaction; returns the signature (base58). */
  signAndSend(tx: VersionedTransaction, sendRaw: (raw: Uint8Array) => Promise<string>): Promise<string>;
}

function supportsSolana(w: StdWallet): boolean {
  return w.chains.includes(SOLANA_MAINNET_CHAIN) &&
    FEAT_CONNECT in w.features &&
    (FEAT_SIGN_SEND in w.features || FEAT_SIGN_TX in w.features);
}

/** All installed wallets that can transact on Solana mainnet. */
export function listWallets(): WalletInfo[] {
  const { get } = getWallets();
  return (get() as unknown as StdWallet[])
    .filter(supportsSolana)
    .map(w => ({ name: w.name, icon: w.icon }));
}

/** Subscribe to wallet register/unregister so the picker stays live. */
export function onWalletsChange(cb: () => void): () => void {
  const { on } = getWallets();
  const offReg = on("register", cb);
  const offUn = on("unregister", cb);
  return () => { offReg(); offUn(); };
}

export async function connect(name: string): Promise<ConnectedWallet> {
  const { get } = getWallets();
  const w = (get() as unknown as StdWallet[]).find(x => x.name === name && supportsSolana(x));
  if (!w) throw new Error(`Wallet "${name}" not found`);

  const connectFeat = w.features[FEAT_CONNECT] as ConnectFeature;
  const { accounts } = await connectFeat.connect();
  const account = accounts.find(a => a.chains.includes(SOLANA_MAINNET_CHAIN)) ?? accounts[0];
  if (!account) throw new Error(`${name} returned no Solana account`);

  const publicKey = new PublicKey(account.publicKey);

  const signAndSend = async (tx: VersionedTransaction, sendRaw: (raw: Uint8Array) => Promise<string>) => {
    const serialized = tx.serialize();
    if (FEAT_SIGN_SEND in w.features) {
      const feat = w.features[FEAT_SIGN_SEND] as SignSendFeature;
      const [{ signature }] = await feat.signAndSendTransaction({
        account, chain: SOLANA_MAINNET_CHAIN, transaction: serialized,
      });
      return bs58encode(signature);
    }
    // Fallback: sign locally, broadcast through our RPC
    const feat = w.features[FEAT_SIGN_TX] as SignTxFeature;
    const [{ signedTransaction }] = await feat.signTransaction({
      account, chain: SOLANA_MAINNET_CHAIN, transaction: serialized,
    });
    return sendRaw(signedTransaction);
  };

  return { name: w.name, icon: w.icon, publicKey, signAndSend };
}

// tiny base58 (avoid pulling bs58 into the browser bundle for one call)
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}
