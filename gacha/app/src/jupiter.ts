/**
 * Jupiter integration — current endpoints (2025+).
 *
 * Hosts: with a key we hit api.jup.ag (x-api-key, higher limits); without one,
 * the keyless lite-api.jup.ag. The legacy hosts (tokens.jup.ag, quote-api.jup.ag,
 * price/v2) are dead and were silently returning nothing.
 *
 * Used by the matchmaker to price each delegated ATA in USD before selecting a
 * match. Any Jupiter-quotable token is eligible; unquotable tokens are excluded.
 */

const API_KEY = process.env.JUP_API_KEY ?? "";
export const JUP_BASE = API_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag";
export const JUP_HEADERS: Record<string, string> = API_KEY ? { "x-api-key": API_KEY } : {};

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface PriceResult {
  mint: string;
  usdPrice: number | null;
}

/**
 * Fetch USD prices for up to 100 mints (Price API v3).
 * v3 returns { "<mint>": { usdPrice, … } }. null for unpriceable mints.
 */
export async function getPrices(mints: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (mints.length === 0) return out;
  for (const m of mints) out.set(m, null);

  const url = `${JUP_BASE}/price/v3?ids=${mints.slice(0, 100).join(",")}`;
  const resp = await fetch(url, { headers: JUP_HEADERS });
  if (!resp.ok) throw new Error(`Jupiter price API error: ${resp.status}`);

  const json = (await resp.json()) as Record<string, { usdPrice?: number; price?: string } | null>;
  for (const mint of mints) {
    const e = json[mint];
    if (!e) continue;
    const p = typeof e.usdPrice === "number" ? e.usdPrice : e.price != null ? parseFloat(e.price) : null;
    out.set(mint, p);
  }
  return out;
}

/**
 * Get the USD value of `tokenAmount` raw units of `mint`.
 * Returns null if the token is unpriceable.
 */
export async function getUsdValue(
  mint: string,
  tokenAmount: bigint,
  decimals: number
): Promise<number | null> {
  const price = (await getPrices([mint])).get(mint) ?? null;
  if (price === null) return null;
  return (Number(tokenAmount) / Math.pow(10, decimals)) * price;
}

/**
 * Real swap-based USD valuation: quote `inputMint` → USDC. This is the value
 * the user actually approves. Falls back to the price API on quote failure.
 */
export async function getSwapBasedUsdValue(
  mint: string,
  amountRaw: bigint,
  decimals: number
): Promise<number | null> {
  if (mint === USDC) return Number(amountRaw) / 1e6;

  try {
    const url =
      `${JUP_BASE}/swap/v1/quote?inputMint=${mint}&outputMint=${USDC}` +
      `&amount=${amountRaw.toString()}&slippageBps=100`;
    const resp = await fetch(url, { headers: JUP_HEADERS });
    if (!resp.ok) throw new Error(`${resp.status}`);
    const quote = (await resp.json()) as { outAmount: string };
    return Number(quote.outAmount) / 1e6; // USDC has 6 decimals
  } catch {
    return getUsdValue(mint, amountRaw, decimals);
  }
}
