/**
 * For seed content entries that use placeholder pool addresses, return a
 * deterministic mock ratio so the UI is usable without real pools deployed.
 * Returns null for real pool addresses so the live fetch path is used.
 */
import type { PoolSnapshot } from "./types";

const PLACEHOLDER = "11111111111111111111111111111111";

const MOCK_RATIOS: Record<string, number> = {};

export function getMockSnapshot(id: string, poolAddress: string): PoolSnapshot | null {
  if (poolAddress !== PLACEHOLDER) return null;
  const r = MOCK_RATIOS[id] ?? 0.5;
  // Back-calculate linear pool share p = r² so reserves are consistent with the sqrt curve.
  const p = r * r;
  return {
    leakReserve: String(Math.round(p * 1e12)),
    dontLeakReserve: String(Math.round((1 - p) * 1e12)),
    r,
    tvl: Math.round(r * 8000 + 500),
    slot: 0,
    fetchedAt: Date.now(),
  };
}
