// Gacha data layer — rarity tiers, token roster, roll/pity math for THE SWITCHEROO.
// The roll experience is simulated client-side (the real mechanic: delegate a token,
// pay a SOL roll fee, the matchmaker swaps you with a random pool member via
// slot-hash randomness — see gacha/app). Live matchmaker stats overlay the sim
// when the /api/gacha proxy can reach it.

export type RarityKey = "common" | "rare" | "epic" | "legendary" | "jackpot";

export interface Rarity {
  key: RarityKey;
  stars: number;
  label: string;
  short: string;
  accent: string;
  glow: string;
  ring: string[];
  bg: string;
  odds: number;
  multRange: [number, number];
  blurb: string;
}

// Mapped onto the real 0.86×–10000× swap-value swing.
export const RARITIES: Record<RarityKey, Rarity> = {
  common: {
    key: "common", stars: 3, label: "COMMON", short: "3★",
    accent: "#8aa0c4", glow: "rgba(138,160,196,0.55)",
    ring: ["#9fb4d6", "#5d7196"],
    bg: "radial-gradient(circle at 50% 35%, #1d2740 0%, #0c1120 70%)",
    odds: 0.7795, multRange: [0.86, 1.5], blurb: "A lateral move.",
  },
  rare: {
    key: "rare", stars: 4, label: "RARE", short: "4★",
    accent: "#3fd6e0", glow: "rgba(63,214,224,0.6)",
    ring: ["#7df0f7", "#1f9aa6"],
    bg: "radial-gradient(circle at 50% 35%, #0d3340 0%, #07131d 70%)",
    odds: 0.16, multRange: [1.5, 5], blurb: "Up only. Slightly.",
  },
  epic: {
    key: "epic", stars: 5, label: "EPIC", short: "5★",
    accent: "#b06bff", glow: "rgba(176,107,255,0.7)",
    ring: ["#d8a8ff", "#7a32d6"],
    bg: "radial-gradient(circle at 50% 35%, #2a1547 0%, #0e0720 70%)",
    odds: 0.05, multRange: [5, 50], blurb: "Now we're cooking.",
  },
  legendary: {
    key: "legendary", stars: 5, label: "LEGENDARY", short: "SSR",
    accent: "#ffcb45", glow: "rgba(255,203,69,0.85)",
    ring: ["#fff0b0", "#e0a000"],
    bg: "radial-gradient(circle at 50% 35%, #3a2a08 0%, #140d02 70%)",
    odds: 0.0095, multRange: [50, 800], blurb: "Generationally unserious.",
  },
  jackpot: {
    key: "jackpot", stars: 6, label: "SWITCHEROO", short: "UR",
    accent: "#ff8ae6", glow: "rgba(255,255,255,0.95)",
    ring: ["#a0f0ff", "#ff7de0", "#ffe27d"],
    bg: "radial-gradient(circle at 50% 35%, #2a0a3a 0%, #0a0214 70%)",
    odds: 0.0010, multRange: [800, 10000], blurb: "The pool went home broke.",
  },
};

export const RARITY_ORDER: RarityKey[] = ["common", "rare", "epic", "legendary", "jackpot"];

export interface GachaToken {
  tk: string;
  name: string;
  mono: string;
  c: string;
}

// Token pool (memecoin-flavored "characters" you can pull into).
// Each tier has its own roster. A pull picks a tier, then a token from it.
export const POOL: Record<RarityKey, GachaToken[]> = {
  common: [
    { tk: "CHILLGUY", name: "Just a Chill Guy", mono: "🙂", c: "#7d8aa0" },
    { tk: "USELESS", name: "Useless Coin", mono: "Ø", c: "#6b7587" },
    { tk: "MUMU", name: "Mumu the Bull", mono: "M", c: "#8a96ad" },
    { tk: "DADDY", name: "Daddy Tate", mono: "D", c: "#94a0b8" },
    { tk: "HARRYBOLZ", name: "Harry Bolz", mono: "H", c: "#7e8ba3" },
  ],
  rare: [
    { tk: "BONK", name: "Bonk", mono: "B", c: "#f7a13b" },
    { tk: "MEW", name: "cat in a dogs world", mono: "≽^•⩊•^≼", c: "#46d4de" },
    { tk: "PNUT", name: "Peanut the Squirrel", mono: "P", c: "#39c9d4" },
    { tk: "MOODENG", name: "Moo Deng", mono: "🦛", c: "#52dde7" },
  ],
  epic: [
    { tk: "WIF", name: "dogwifhat", mono: "W", c: "#c389ff" },
    { tk: "POPCAT", name: "Popcat", mono: "P", c: "#bd7bff" },
    { tk: "GIGA", name: "Gigachad", mono: "G", c: "#a865ff" },
    { tk: "FARTCOIN", name: "Fartcoin", mono: "F", c: "#cf9bff" },
  ],
  legendary: [
    { tk: "PUMP", name: "Pump", mono: "↑", c: "#ffd45c" },
    { tk: "GOAT", name: "Goatseus Maximus", mono: "G", c: "#ffc93c" },
    { tk: "FWOG", name: "Fwog", mono: "ʚ", c: "#ffdf80" },
    { tk: "TROLL", name: "Troll", mono: "T", c: "#ffce4d" },
  ],
  jackpot: [
    { tk: "SWITCHEROO", name: "The House Token", mono: "⇄", c: "#ff8ae6" },
  ],
};

// Pity thresholds (mirror gacha/app/src/history.ts; display only here).
export const PITY_HARD = 90; // up-only guaranteed at this many consecutive losses
export const PITY_SOFT = 74; // soft-pity tell

export interface Pull {
  id: number;
  rarity: RarityKey;
  token: GachaToken;
  mult: number;
  fromUsd: number;
  toUsd: number;
  isWin: boolean;
  slotHash: string;
  requestSlot: number;
  poolSize: number;
  selectedIndex: number;
  earlyPts: number;
  dividend: number;
  globalRollIndex: number;
  ts: number;
  /** on-chain swap signature (real pulls only) — powers the OG share link */
  signature?: string;
}

// Highest rarity in a batch (for 10-pull star tell + summary celebration)
export function topRarity(pulls: Pull[]): RarityKey {
  let best: RarityKey = "common";
  for (const p of pulls) {
    if (RARITY_ORDER.indexOf(p.rarity) > RARITY_ORDER.indexOf(best)) best = p.rarity;
  }
  return best;
}

export function fmtUsd(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 10_000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toLocaleString("en-US");
}

export function fmtMult(m: number): string {
  if (m >= 1000) return m.toLocaleString("en-US") + "×";
  if (m >= 100) return m.toFixed(0) + "×";
  if (m >= 10) return m.toFixed(1) + "×";
  return m.toFixed(2) + "×";
}

export function fmtPts(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString("en-US");
}

export function fmtSol(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(2) + "k ◎";
  if (n >= 1) return n.toFixed(3) + " ◎";
  return n.toFixed(4) + " ◎";
}

// Win-streak → jackpot tickets (mirrors gacha/app: 1 + min(streak, cap)).
export const MAX_STREAK_TICKETS = 10;
export function ticketsForStreak(streak: number): number {
  return 1 + Math.min(streak, MAX_STREAK_TICKETS);
}

// ─── Themes ──────────────────────────────────────────────────────────────────
export interface Theme {
  name: string;
  hue: string;
  glow: string;
  bg1: string;
  bg2: string;
}

export const THEMES: Record<string, Theme> = {
  astral:    { name: "Astral Violet", hue: "#b8a6ff", glow: "rgba(176,107,255,0.5)", bg1: "#0b0917", bg2: "#06040f" },
  celestial: { name: "Celestial Gold", hue: "#ffd98a", glow: "rgba(255,203,69,0.45)", bg1: "#12100a", bg2: "#0a0805" },
  abyss:     { name: "Crimson Abyss", hue: "#ff8aa6", glow: "rgba(255,77,109,0.4)", bg1: "#150a10", bg2: "#0a0408" },
};

// lighten/darken a hex color
export function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  let r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}

// ─── Real swap records (from the matchmaker /swaps endpoint) ────────────────
export interface SwapRecord {
  signature: string;
  requester: string;
  counterparty: string;
  requesterMint: string;
  counterpartyMint: string;
  requesterUsd: number | null;
  counterpartyUsd: number | null;
  multiplier: number | null;
  rarity: RarityKey | null;
  tier: string;
  requestSlot: number;
  entropySlot: number;
  slotHash: string;
  randomIndex: number;
  poolSize: number;
  pityTriggered: boolean;
  streak: number;
  jackpotTickets: number;
  jackpotWonLamports: number;
  ts: number;
}

// Map a real USD multiplier onto the rarity bands (matches gacha/app history.ts).
export function rarityForMult(mult: number): RarityKey {
  if (mult >= 800) return "jackpot";
  if (mult >= 50) return "legendary";
  if (mult >= 5) return "epic";
  if (mult >= 1.5) return "rare";
  return "common";
}

// Deterministic color + glyph for a real mint (no fake roster).
function colorForMint(mint: string): string {
  let h = 0;
  for (let i = 0; i < mint.length; i++) h = (h * 31 + mint.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 62%)`;
}

export function tokenFromMint(mint: string, meta?: { symbol?: string; name?: string }): GachaToken {
  const sym = meta?.symbol || (mint.slice(0, 4) + "…");
  return {
    tk: sym.toUpperCase(),
    name: meta?.name || sym,
    mono: (meta?.symbol?.[0] || mint[0] || "?").toUpperCase(),
    c: colorForMint(mint),
  };
}

// Convert a real swap record into the Pull shape the reveal UI renders.
export function pullFromSwap(rec: SwapRecord, meta?: { symbol?: string; name?: string }): Pull {
  const mult = rec.multiplier ?? 1;
  return {
    id: rec.entropySlot * 1000 + rec.randomIndex,
    rarity: rec.rarity ?? rarityForMult(mult),
    token: tokenFromMint(rec.counterpartyMint, meta),
    mult,
    fromUsd: rec.requesterUsd ?? 0,
    toUsd: rec.counterpartyUsd ?? 0,
    isWin: mult >= 1,
    slotHash: rec.slotHash,
    requestSlot: rec.requestSlot,
    poolSize: rec.poolSize,
    selectedIndex: rec.randomIndex,
    earlyPts: 0,
    dividend: 0,
    globalRollIndex: 0,
    ts: rec.ts,
    signature: rec.signature,
  };
}

// Fetch token symbol/name for a mint (Jupiter token API). Cached + best-effort
// so repeated refreshes don't trip rate limits.
const _metaCache = new Map<string, { symbol?: string; name?: string }>();
export async function fetchTokenMeta(mint: string): Promise<{ symbol?: string; name?: string }> {
  const hit = _metaCache.get(mint);
  if (hit) return hit;
  let meta: { symbol?: string; name?: string } = {};
  try {
    const r = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${mint}`, { cache: "force-cache" });
    if (r.ok) {
      const j = await r.json();
      if (j && (j.symbol || j.name)) meta = { symbol: j.symbol, name: j.name };
    }
  } catch { /* best-effort */ }
  _metaCache.set(mint, meta);
  return meta;
}

// ─── PnL stats (for shareable cards) ────────────────────────────────────────
export interface PnlStats {
  count: number;
  fromUsd: number;
  toUsd: number;
  netUsd: number;
  pct: number;        // net % return
  wins: number;
  winRate: number;    // 0..100
  bestMult: number;
  worstMult: number;
}

function statsFrom(rows: { fromUsd: number; toUsd: number; mult: number }[]): PnlStats {
  const count = rows.length;
  const fromUsd = rows.reduce((s, r) => s + r.fromUsd, 0);
  const toUsd = rows.reduce((s, r) => s + r.toUsd, 0);
  const wins = rows.filter(r => r.mult >= 1).length;
  const mults = rows.map(r => r.mult);
  return {
    count, fromUsd, toUsd,
    netUsd: toUsd - fromUsd,
    pct: fromUsd > 0 ? ((toUsd - fromUsd) / fromUsd) * 100 : 0,
    wins,
    winRate: count > 0 ? (wins / count) * 100 : 0,
    bestMult: mults.length ? Math.max(...mults) : 0,
    worstMult: mults.length ? Math.min(...mults) : 0,
  };
}

/** PnL across a batch of just-revealed pulls (per-1 or per-10). */
export function pnlFromPulls(pulls: Pull[]): PnlStats {
  return statsFrom(pulls.map(p => ({ fromUsd: p.fromUsd, toUsd: p.toUsd, mult: p.mult })));
}

/** Career PnL across all swaps this wallet INITIATED (requester == me). */
export function pnlFromSwaps(swaps: SwapRecord[], me: string): PnlStats {
  return statsFrom(
    swaps
      .filter(s => s.requester === me && s.multiplier !== null)
      .map(s => ({ fromUsd: s.requesterUsd ?? 0, toUsd: s.counterpartyUsd ?? 0, mult: s.multiplier ?? 1 }))
  );
}

// ─── Live matchmaker stats ──────────────────────────────────────────────────
export interface LiveStats {
  poolSize: number;
  poolOwners?: number;
  totalSwaps: number;
  totalRolls: number;
  totalRollers: number;
  minRollFeeSol: number;
  rentPerSwapSol: number;
  pityHard: number;
  pitySoft: number;
  jackpotSol: number;
  jackpotOddsPerTicket: number;
  matchmaker: string | null;
  rpc?: string;
}
