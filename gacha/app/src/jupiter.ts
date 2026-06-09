/**
 * Jupiter Price API v2 integration.
 *
 * Used by the matchmaker to price each delegated ATA in USD before
 * selecting a match. Any Jupiter-quotable token is eligible for the
 * gacha pool — illiquid or unquotable tokens are silently excluded.
 */

const JUP_PRICE_URL = "https://api.jup.ag/price/v2";
const JUP_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const API_KEY = process.env.JUP_API_KEY ?? "";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  ...(API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {}),
};

export interface PriceResult {
  mint: string;
  usdPrice: number | null;
}

/**
 * Fetch USD prices for up to 100 mints in one request.
 * Returns null for mints Jupiter can't price.
 */
export async function getPrices(mints: string[]): Promise<Map<string, number | null>> {
  if (mints.length === 0) return new Map();

  const url = `${JUP_PRICE_URL}?ids=${mints.slice(0, 100).join(",")}`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`Jupiter price API error: ${resp.status}`);

  const json = (await resp.json()) as {
    data: Record<string, { id: string; price: string } | null>;
  };

  const out = new Map<string, number | null>();
  for (const mint of mints) {
    const entry = json.data[mint];
    out.set(mint, entry ? parseFloat(entry.price) : null);
  }
  return out;
}

/**
 * Get the USD value of `tokenAmount` units (raw, unscaled) of `mint`.
 * Returns null if the token is unquotable.
 */
export async function getUsdValue(
  mint: string,
  tokenAmount: bigint,
  decimals: number
): Promise<number | null> {
  const prices = await getPrices([mint]);
  const price = prices.get(mint) ?? null;
  if (price === null) return null;
  const humanAmount = Number(tokenAmount) / Math.pow(10, decimals);
  return humanAmount * price;
}

/**
 * Attempt a Jupiter quote for `inputMint` → USDC to get a real swap-based
 * USD valuation. Falls back to price API if quote fails.
 *
 * This is what the user approves: "Jupiter quotable value".
 */
export async function getSwapBasedUsdValue(
  mint: string,
  amountRaw: bigint,
  decimals: number
): Promise<number | null> {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  if (mint === USDC) {
    return Number(amountRaw) / 1e6;
  }

  try {
    const url =
      `${JUP_QUOTE_URL}?inputMint=${mint}&outputMint=${USDC}` +
      `&amount=${amountRaw.toString()}&slippageBps=100`;
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) throw new Error(`${resp.status}`);
    const quote = (await resp.json()) as { outAmount: string };
    return Number(quote.outAmount) / 1e6; // USDC has 6 decimals
  } catch {
    // Fall back to price API
    return getUsdValue(mint, amountRaw, decimals);
  }
}
