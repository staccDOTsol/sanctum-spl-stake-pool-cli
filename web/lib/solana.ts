/**
 * Lightweight Solana RPC helpers used server-side.
 * Reads Meteora DBC pool vault balances to compute the decryption ratio.
 * Uses raw fetch (no @solana/web3.js in the edge runtime).
 */

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";

// Meteora DBC VirtualPool account layout (from the SDK's Anchor IDL):
//   offset   0 — discriminator (8)
//   offset   8 — volatility_tracker (64)
//   offset  72 — config (32)
//   offset 104 — creator (32)
//   offset 136 — base_mint (32)
//   offset 168 — base_vault (32)
//   offset 200 — quote_vault (32)
//
// The "market vote" lives in the QUOTE vaults: buying Leak deposits LEAK
// into the L1 pool's quote vault; buying DontLeak deposits the quote token
// into the L2 pool's quote vault. (The base vaults move the opposite way —
// they drain as tokens are bought — so they'd invert the ratio.)
const QUOTE_VAULT_OFFSET = 200;

// Platform L1 pool (LEAK base / rfstacc quote — pool1Address in
// mainnet-deployment.json). Entries registered before their L1 pool existed
// have leakPoolAddress = "" — fall back to global LEAK sentiment from this
// pool so the leak side isn't permanently stuck at zero.
const DEFAULT_LEAK_L1_POOL = "ze1HvkHogbWPRiR6W5DYp82YrtJTAum1WEDLrUJNjwX";

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    next: { revalidate: 15 }, // Next.js fetch cache — 15 s
  });
  const json = await res.json();
  if (json.error) throw new Error(`Solana RPC ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin);
}

function bytesToBase58(bytes: Uint8Array): string {
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(0);
  for (const b of bytes) n = n * BigInt(256) + BigInt(b);
  let s = "";
  while (n > BigInt(0)) { const r = n % BigInt(58); n = n / BigInt(58); s = ALPHA[Number(r)] + s; }
  for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
  return s;
}

async function getQuoteVaultAddress(poolAddress: string): Promise<string> {
  const result = await rpc("getAccountInfo", [poolAddress, { encoding: "base64" }]);
  if (!result?.value?.data) throw new Error(`Pool not found: ${poolAddress}`);
  const data = base64ToBytes(result.value.data[0]);
  if (data.length < QUOTE_VAULT_OFFSET + 32) throw new Error(`Pool account too small: ${poolAddress}`);
  return bytesToBase58(data.slice(QUOTE_VAULT_OFFSET, QUOTE_VAULT_OFFSET + 32));
}

interface VaultBalance {
  amount:   bigint;
  uiAmount: number;
}

async function getVaultBalance(poolAddress: string): Promise<VaultBalance> {
  // Missing pool (e.g. stable pools launched before the L1 pool existed)
  // counts as zero rather than failing the whole ratio.
  if (!poolAddress) return { amount: BigInt(0), uiAmount: 0 };
  const vault  = await getQuoteVaultAddress(poolAddress);
  const result = await rpc("getTokenAccountBalance", [vault]);
  return {
    amount:   BigInt(result?.value?.amount ?? "0"),
    uiAmount: Number(result?.value?.uiAmountString ?? result?.value?.uiAmount ?? 0),
  };
}

async function getSlot(): Promise<number> {
  return rpc("getSlot", ["confirmed"]);
}

export interface PoolReserves {
  leakReserve: bigint;
  dontLeakReserve: bigint;
  r: number;
  slot: number;
}

/**
 * Fetch live reserves from both pools and return the decryption ratio.
 *
 * L1 pool quote vault = LEAK locked by Leak buyers (pro-decrypt).
 * L2 pool quote vault = quote tokens locked by DontLeak buyers (pro-secrecy).
 * Balances are compared in UI units so mints with different decimals
 * (LEAK = 9, meme quote = 6) weigh comparably.
 */
export async function fetchPoolRatio(
  leakPoolAddress: string,
  dontLeakPoolAddress: string
): Promise<PoolReserves> {
  const [leak, dontLeak, slot] = await Promise.all([
    getVaultBalance(leakPoolAddress || DEFAULT_LEAK_L1_POOL),
    getVaultBalance(dontLeakPoolAddress),
    getSlot(),
  ]);

  const total = leak.uiAmount + dontLeak.uiAmount;
  // Square-root curve: r = sqrt(Leak / total).
  // DontLeak must square their position to halve each decrement — exponential cost to suppress.
  // At parity r≈0.71; to hold r<0.5 DontLeak needs 3× more tokens; r<0.1 needs 99×.
  const p = total === 0 ? 0 : leak.uiAmount / total;
  const r = Math.sqrt(Math.max(0, Math.min(1, p)));

  return { leakReserve: leak.amount, dontLeakReserve: dontLeak.amount, r, slot };
}
