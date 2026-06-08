/**
 * GET /api/trending
 *
 * Returns an array of RankedContent sorted by hot score.
 * Query params:
 *   limit  (default 20)
 *   offset (default 0)
 *   sort   "hot" | "new" | "rising" | "contested"
 *   type   "png" | "jpeg" | "text" | "all" (default "all")
 */
import { NextRequest, NextResponse } from "next/server";
import { getRegistry } from "../../../lib/registry";
import { fetchPoolRatio } from "../../../lib/solana";
import { getMockSnapshot } from "../../../lib/mockRatio";
import { rankContent } from "../../../lib/trending";
import type { PoolSnapshot } from "../../../lib/types";
import type { TrendingInput } from "../../../lib/trending";

export const runtime = "nodejs";
export const revalidate = 15;

type SortMode = "hot" | "new" | "rising" | "contested";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(sp.get("limit") ?? "20"), 100);
  const offset = parseInt(sp.get("offset") ?? "0");
  const sort = (sp.get("sort") ?? "hot") as SortMode;
  const typeFilter = sp.get("type") ?? "all";

  try {
    const registry = await getRegistry();

    // Filter by content type
    const filtered = typeFilter === "all"
      ? registry
      : registry.filter((e) => e.contentType === typeFilter);

    // Fetch live pool ratios in parallel (with mock fallback for seed data)
    const snapshots = await Promise.all(
      filtered.map(async (entry): Promise<PoolSnapshot> => {
        const mock = getMockSnapshot(entry.id, entry.leakPoolAddress);
        if (mock) return mock;
        try {
          const data = await fetchPoolRatio(entry.leakPoolAddress, entry.dontLeakPoolAddress);
          return {
            leakReserve: data.leakReserve.toString(),
            dontLeakReserve: data.dontLeakReserve.toString(),
            r: data.r,
            tvl: 0, // extend with price oracle if needed
            slot: data.slot,
            fetchedAt: Date.now(),
          };
        } catch {
          return { leakReserve: "0", dontLeakReserve: "0", r: 0, tvl: 0, slot: 0, fetchedAt: Date.now() };
        }
      })
    );

    const inputs: TrendingInput[] = filtered.map((entry, i) => ({
      entry,
      snapshot: snapshots[i],
      deltaR1h: null,   // extend with time-series store
      deltaR24h: null,
    }));

    let ranked = rankContent(inputs);

    // Apply sort overrides
    if (sort === "new") {
      ranked = ranked.sort((a, b) => b.createdAt - a.createdAt).map((x, i) => ({ ...x, rank: i + 1 }));
    } else if (sort === "rising") {
      ranked = ranked.filter((x) => x.tags.includes("Rising") || (x.deltaR1h ?? 0) > 0);
    } else if (sort === "contested") {
      ranked = ranked.filter((x) => x.snapshot.r > 0.3 && x.snapshot.r < 0.7);
    }

    const page = ranked.slice(offset, offset + limit);

    return NextResponse.json({
      items: page,
      total: ranked.length,
      limit,
      offset,
    });
  } catch (err) {
    console.error("Trending API error:", err);
    return NextResponse.json({ error: "Failed to fetch trending data" }, { status: 500 });
  }
}
