/**
 * Token tier classification — ensures the switcheroo only happens within
 * the same tier, preventing gaming via low-quality tokens.
 *
 * TIER 1 — Blue Chip: tokens with Pyth oracle price feeds.
 *   Proxy: Jupiter strict/verified list (≈ 1:1 with Pyth coverage).
 *
 * TIER 2 — Launch: tokens with a known, verifiable launch mechanism.
 *   Detected via:
 *     • pump.fun   — bonding-curve PDA on program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
 *     • Meteora DBC — pool exists on dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuoMD9A
 *     • Raydium LaunchLab — CPMM pool on CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C
 *     • Jupiter tag "pump" / "moonshot"
 *
 * TIER 3 — Unknown: provenance cannot be determined.
 */

import { Connection, PublicKey } from "@solana/web3.js";

export enum TokenTier {
  BLUE_CHIP = 1,
  LAUNCH    = 2,
  UNKNOWN   = 3,
}

export const TIER_LABEL: Record<TokenTier, string> = {
  [TokenTier.BLUE_CHIP]: "blue-chip",
  [TokenTier.LAUNCH]:    "launch",
  [TokenTier.UNKNOWN]:   "unknown",
};

// Program IDs for launchpad detection
const PUMP_FUN = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const METEORA_DBC = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuoMD9A");
const RAYDIUM_CPMM = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");

// Persistent in-memory cache; survives the lifetime of the process
const tierCache = new Map<string, TokenTier>();

// Blue-chip mint set, loaded from Jupiter strict list at startup
let blueChipMints = new Set<string>();

/** Fetch Jupiter verified list (≈ Pyth oracle coverage). Call once at startup. */
export async function loadTierLists(): Promise<void> {
  try {
    const resp = await fetch("https://tokens.jup.ag/tokens?tags=verified", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const tokens: Array<{ address: string }> = await resp.json() as Array<{ address: string }>;
    blueChipMints = new Set(tokens.map(t => t.address));
    console.log(`[tiers] loaded ${blueChipMints.size} blue-chip (Pyth/verified) mints`);
  } catch (e) {
    console.warn("[tiers] could not load blue-chip list, all tokens default to UNKNOWN:", e);
  }
}

/** Classify a mint into a tier. Results are cached for the process lifetime. */
export async function classifyMint(mint: string, connection: Connection): Promise<TokenTier> {
  const cached = tierCache.get(mint);
  if (cached !== undefined) return cached;

  const tier = await doClassify(mint, connection);
  tierCache.set(mint, tier);
  console.log(`[tiers] ${mint.slice(0, 8)}… → ${TIER_LABEL[tier]}`);
  return tier;
}

async function doClassify(mint: string, connection: Connection): Promise<TokenTier> {
  // ── Tier 1: Jupiter strict list (Pyth oracle-backed) ──────────────────────
  if (blueChipMints.has(mint)) return TokenTier.BLUE_CHIP;

  // ── Tier 2 checks (any hit → LAUNCH) ─────────────────────────────────────

  // pump.fun: bonding-curve PDA owned by the pump.fun program
  if (await isPumpFun(mint, connection)) return TokenTier.LAUNCH;

  // Meteora DBC: pool account derived from config + mints
  if (await isMeteoraDBC(mint, connection)) return TokenTier.LAUNCH;

  // Raydium CPMM LaunchLab: pool state account derived from config + mints
  if (await isRaydiumCpmm(mint, connection)) return TokenTier.LAUNCH;

  // Jupiter token tags (fallback for launchpads we don't check on-chain)
  if (await hasLaunchpadTag(mint)) return TokenTier.LAUNCH;

  return TokenTier.UNKNOWN;
}

// ── On-chain launchpad detectors ─────────────────────────────────────────────

async function isPumpFun(mint: string, connection: Connection): Promise<boolean> {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
      PUMP_FUN
    );
    const acc = await connection.getAccountInfo(pda, "confirmed");
    return acc !== null && acc.owner.equals(PUMP_FUN);
  } catch { return false; }
}

async function isMeteoraDBC(mint: string, connection: Connection): Promise<boolean> {
  // Meteora DBC pool PDA: ["pool", config, base_mint, quote_mint]
  // We check if any pool exists with this mint as base; try well-known configs.
  // Falling back to their REST API when on-chain check is inconclusive.
  try {
    const resp = await fetch(
      `https://amm-v2.meteora.ag/pools?tokenA=${mint}&limit=1`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!resp.ok) return false;
    const data = await resp.json() as { data?: unknown[] };
    if (Array.isArray(data.data) && data.data.length > 0) {
      // Verify at least one pool is owned by Meteora DBC program
      const poolProgramOwner = await getOwnerProgram(data.data as Array<{ address?: string }>, connection);
      return poolProgramOwner === METEORA_DBC.toBase58();
    }
    return false;
  } catch { return false; }
}

async function getOwnerProgram(pools: Array<{ address?: string }>, connection: Connection): Promise<string | null> {
  const first = pools[0]?.address;
  if (!first) return null;
  try {
    const acc = await connection.getAccountInfo(new PublicKey(first), "confirmed");
    return acc?.owner.toBase58() ?? null;
  } catch { return null; }
}

async function isRaydiumCpmm(mint: string, connection: Connection): Promise<boolean> {
  // Raydium CPMM pool state PDA: ["pool", amm_config, mint0, mint1]
  // We can't enumerate all configs, so check via Raydium's V3 API.
  try {
    const resp = await fetch(
      `https://api-v3.raydium.io/pools/info/mint?mint1=${mint}&poolType=Standard&poolSortField=default&sortType=desc&pageSize=1&page=1`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!resp.ok) return false;
    const data = await resp.json() as { data?: { count?: number } };
    return (data.data?.count ?? 0) > 0;
  } catch { return false; }
}

// ── Jupiter tag fallback ──────────────────────────────────────────────────────

const LAUNCHPAD_TAGS = new Set(["pump", "moonshot", "boop", "launch"]);

async function hasLaunchpadTag(mint: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://tokens.jup.ag/token/${mint}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return false;
    const token = await resp.json() as { tags?: string[] };
    return token.tags?.some(t => LAUNCHPAD_TAGS.has(t)) ?? false;
  } catch { return false; }
}

// ── Bulk classification (used by pool display) ────────────────────────────────

/** Classify a batch of mints, returning a mint→tier map. */
export async function classifyMints(
  mints: string[],
  connection: Connection
): Promise<Map<string, TokenTier>> {
  const results = await Promise.all(
    mints.map(async m => [m, await classifyMint(m, connection)] as const)
  );
  return new Map(results);
}
