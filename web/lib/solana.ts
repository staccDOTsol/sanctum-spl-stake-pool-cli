/**
 * Lightweight Solana RPC helpers used server-side.
 * Reads Meteora DBC pool vault balances to compute the decryption ratio.
 * Uses raw fetch (no @solana/web3.js in the edge runtime).
 */

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

// Meteora DBC pool account layout — base_vault at offset 136
const BASE_VAULT_OFFSET = 136;

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

async function getBaseVaultAddress(poolAddress: string): Promise<string> {
  const result = await rpc("getAccountInfo", [poolAddress, { encoding: "base64" }]);
  if (!result?.value?.data) throw new Error(`Pool not found: ${poolAddress}`);
  const data = base64ToBytes(result.value.data[0]);
  return bytesToBase58(data.slice(BASE_VAULT_OFFSET, BASE_VAULT_OFFSET + 32));
}

async function getTokenBalance(tokenAccount: string): Promise<bigint> {
  const result = await rpc("getTokenAccountBalance", [tokenAccount]);
  return BigInt(result?.value?.amount ?? "0");
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
 * Pool 1 base vault = Leak tokens locked (pro-decrypt).
 * Pool 2 base vault = DontLeak tokens locked (pro-secrecy).
 * r = Leak / (Leak + DontLeak)
 */
export async function fetchPoolRatio(
  leakPoolAddress: string,
  dontLeakPoolAddress: string
): Promise<PoolReserves> {
  const [pool1Vault, pool2Vault, slot] = await Promise.all([
    getBaseVaultAddress(leakPoolAddress),
    getBaseVaultAddress(dontLeakPoolAddress),
    getSlot(),
  ]);

  const [leakReserve, dontLeakReserve] = await Promise.all([
    getTokenBalance(pool1Vault),
    getTokenBalance(pool2Vault),
  ]);

  const total = leakReserve + dontLeakReserve;
  const r = total === BigInt(0) ? 0 : Math.max(0, Math.min(1, Number(leakReserve) / Number(total)));

  return { leakReserve, dontLeakReserve, r, slot };
}
