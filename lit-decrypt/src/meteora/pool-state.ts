import {
  Connection,
  PublicKey,
  AccountInfo,
} from "@solana/web3.js";
import {
  DBC_POOL_BASE_VAULT_OFFSET,
  DBC_POOL_QUOTE_VAULT_OFFSET,
} from "../constants.js";
import type { PoolReserves, DisparitySnapshot } from "../types.js";

/** Parse the base_vault and quote_vault pubkeys out of a raw DBC Pool account. */
function parseVaultAddresses(data: Buffer): { baseVault: PublicKey; quoteVault: PublicKey } {
  if (data.length < DBC_POOL_QUOTE_VAULT_OFFSET + 32) {
    throw new Error(
      `DBC pool account too small: ${data.length} bytes (expected ≥ ${DBC_POOL_QUOTE_VAULT_OFFSET + 32})`
    );
  }
  const baseVault = new PublicKey(
    data.subarray(DBC_POOL_BASE_VAULT_OFFSET, DBC_POOL_BASE_VAULT_OFFSET + 32)
  );
  const quoteVault = new PublicKey(
    data.subarray(DBC_POOL_QUOTE_VAULT_OFFSET, DBC_POOL_QUOTE_VAULT_OFFSET + 32)
  );
  return { baseVault, quoteVault };
}

/** Read the current token balance of a spl-token / Token-2022 vault account. */
async function getTokenBalance(
  connection: Connection,
  vault: PublicKey
): Promise<bigint> {
  const balance = await connection.getTokenAccountBalance(vault, "confirmed");
  return BigInt(balance.value.amount);
}

/** Fetch full reserve snapshot for a single Meteora DBC pool. */
export async function fetchPoolReserves(
  connection: Connection,
  poolAddress: PublicKey
): Promise<PoolReserves> {
  const info: AccountInfo<Buffer> | null = await connection.getAccountInfo(
    poolAddress,
    "confirmed"
  );
  if (!info) {
    throw new Error(`Meteora DBC pool account not found: ${poolAddress.toBase58()}`);
  }

  const { baseVault, quoteVault } = parseVaultAddresses(info.data);

  const [baseReserve, quoteReserve] = await Promise.all([
    getTokenBalance(connection, baseVault),
    getTokenBalance(connection, quoteVault),
  ]);

  return {
    baseReserve,
    quoteReserve,
    baseVault: baseVault.toBase58(),
    quoteVault: quoteVault.toBase58(),
  };
}

/**
 * Compute the decryption disparity ratio r ∈ [0, 1] from both pool states.
 *
 * Formula:
 *   leakReserve     = Pool1.baseReserve  (Leak tokens locked in Pool 1)
 *   dontLeakReserve = Pool2.baseReserve  (DontLeak tokens locked in Pool 2)
 *   r = leakReserve / (leakReserve + dontLeakReserve)
 *
 * Both are in raw token units.  Because DontLeak is quoted in Leak (Pool 2)
 * a 1:1 unit assumption applies; if decimals differ, normalise before calling.
 */
export async function computeDisparityRatio(
  connection: Connection,
  leakPoolAddress: PublicKey,
  dontLeakPoolAddress: PublicKey
): Promise<DisparitySnapshot> {
  const slot = await connection.getSlot("confirmed");

  const [pool1, pool2] = await Promise.all([
    fetchPoolReserves(connection, leakPoolAddress),
    fetchPoolReserves(connection, dontLeakPoolAddress),
  ]);

  const leakReserve = pool1.baseReserve;
  const dontLeakReserve = pool2.baseReserve;
  const total = leakReserve + dontLeakReserve;
  const r = total === 0n ? 0 : Number(leakReserve) / Number(total);

  return {
    leakReserve,
    dontLeakReserve,
    r: Math.max(0, Math.min(1, r)),
    slotFetched: slot,
  };
}
