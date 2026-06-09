import { NextRequest, NextResponse } from "next/server";

// Proxy to the gacha matchmaker's JSON endpoints (gacha/app health server).
// Set MATCHMAKER_URL to the crank's base URL, e.g. https://gacha-matchmaker.fly.dev
const MATCHMAKER_URL = process.env.MATCHMAKER_URL ?? "";

// Whitelisted endpoint shapes — everything else 404s.
const ALLOWED = [
  /^stats$/,
  /^swaps$/,
  /^swaps\/[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  /^pity\/[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  /^points\/[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  /^leaderboard$/,
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const joined = path.join("/");

  if (!ALLOWED.some(re => re.test(joined))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!MATCHMAKER_URL) {
    return NextResponse.json(
      { error: "MATCHMAKER_URL not configured — gacha UI runs in sim mode" },
      { status: 503 }
    );
  }

  const limit = req.nextUrl.searchParams.get("limit");
  const qs = joined === "swaps" && limit ? `?limit=${encodeURIComponent(limit)}` : "";

  try {
    const resp = await fetch(`${MATCHMAKER_URL.replace(/\/$/, "")}/${joined}${qs}`, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    const body = await resp.json();
    return NextResponse.json(body, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "matchmaker unreachable" }, { status: 502 });
  }
}
