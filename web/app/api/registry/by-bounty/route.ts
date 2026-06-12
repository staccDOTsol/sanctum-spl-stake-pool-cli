/**
 * GET /api/registry/by-bounty?pubkey=<bountyPubkey>
 * Returns the two pool addresses for the bounty whose fees route to pubkey,
 * so the /claim page can build the sweep without the user copy-pasting pools.
 */
import { NextRequest, NextResponse } from "next/server";
import { getRegistry } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const pubkey = req.nextUrl.searchParams.get("pubkey");
  if (!pubkey) return NextResponse.json({ error: "pubkey required" }, { status: 400 });

  const registry = await getRegistry(true);
  const entry = registry.find((e) => e.isBounty && e.bountyPubkey === pubkey);
  if (!entry) return NextResponse.json({ pools: [] });

  return NextResponse.json({
    id:    entry.id,
    title: entry.title,
    pools: [entry.leakPoolAddress, entry.dontLeakPoolAddress].filter(Boolean),
  });
}
