/**
 * GET /api/bounty/pot?leak=<pool>&dontleak=<pool>&wallet=<bountyPubkey>
 * The live bounty pot: claimable partner fees across both pools PLUS the
 * secret wallet's own SOL balance (migration leftover + anything sent to it).
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

export const runtime = "nodejs";

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";

export async function GET(req: NextRequest) {
  const leak     = req.nextUrl.searchParams.get("leak");
  const dontleak = req.nextUrl.searchParams.get("dontleak");
  const wallet   = req.nextUrl.searchParams.get("wallet");
  if (!leak || !dontleak) return NextResponse.json({ error: "leak and dontleak required" }, { status: 400 });

  const conn   = new Connection(RPC, "confirmed");
  const client = DynamicBondingCurveClient.create(conn, "confirmed");

  let quote = BigInt(0), base = BigInt(0);
  for (const p of [leak, dontleak]) {
    try {
      const m = await client.state.getPoolFeeMetrics(new PublicKey(p));
      quote += BigInt(m.current.partnerQuoteFee.toString());
      base  += BigInt(m.current.partnerBaseFee.toString());
    } catch { /* pool not live yet */ }
  }

  let sol = 0;
  if (wallet) {
    try { sol = await conn.getBalance(new PublicKey(wallet), "confirmed"); } catch { /* ignore */ }
  }

  return NextResponse.json(
    { quote: quote.toString(), base: base.toString(), solLamports: sol },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } },
  );
}
