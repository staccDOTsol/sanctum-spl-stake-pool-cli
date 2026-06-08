/**
 * GET /api/ratio/[pool]?dontLeak=<address>
 *
 * Returns the live ratio r for the given pair of pool addresses.
 * The [pool] path param is the Leak pool address.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchPoolRatio } from "../../../../lib/solana";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pool: string }> }
) {
  const { pool: leakPool } = await params;
  const dontLeakPool = req.nextUrl.searchParams.get("dontLeak");

  if (!dontLeakPool) {
    return NextResponse.json({ error: "Missing ?dontLeak= query param" }, { status: 400 });
  }

  try {
    const data = await fetchPoolRatio(leakPool, dontLeakPool);
    return NextResponse.json({
      leakPool,
      dontLeakPool,
      leakReserve: data.leakReserve.toString(),
      dontLeakReserve: data.dontLeakReserve.toString(),
      r: data.r,
      slot: data.slot,
      fetchedAt: Date.now(),
    }, {
      headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" },
    });
  } catch (err) {
    console.error("Ratio API error:", err);
    return NextResponse.json({ error: "Failed to fetch pool ratio" }, { status: 500 });
  }
}
