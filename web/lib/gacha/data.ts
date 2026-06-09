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

export interface Holding extends GachaToken {
  usd: number;
  amt: string;
}

// What you STAKED (tossed into the pool). The thing being risked.
export const STAKE: Holding = { tk: "WIF", name: "dogwifhat", mono: "W", c: "#c389ff", usd: 1240, amt: "412.6" };

// Your wallet holdings — the "one fell swoop" approval sweeps everything
// below a value threshold X into the pool with a single delegation.
export const HOLDINGS: Holding[] = [
  { tk: "WIF", name: "dogwifhat", mono: "W", c: "#c389ff", usd: 1240, amt: "412.6" },
  { tk: "BONK", name: "Bonk", mono: "B", c: "#f7a13b", usd: 318, amt: "14.2M" },
  { tk: "MUMU", name: "Mumu the Bull", mono: "M", c: "#8a96ad", usd: 92, amt: "1.1M" },
  { tk: "POPCAT", name: "Popcat", mono: "P", c: "#bd7bff", usd: 540, amt: "880" },
  { tk: "USELESS", name: "Useless Coin", mono: "Ø", c: "#6b7587", usd: 27, amt: "60k" },
  { tk: "PNUT", name: "Peanut", mono: "P", c: "#39c9d4", usd: 156, amt: "420" },
  { tk: "CHILLGUY", name: "Just a Chill Guy", mono: "🙂", c: "#7d8aa0", usd: 14, amt: "9.8k" },
  { tk: "GIGA", name: "Gigachad", mono: "G", c: "#a865ff", usd: 2100, amt: "51k" },
  { tk: "MOODENG", name: "Moo Deng", mono: "🦛", c: "#52dde7", usd: 73, amt: "2.4k" },
  { tk: "FARTCOIN", name: "Fartcoin", mono: "F", c: "#cf9bff", usd: 6800, amt: "9.2k" },
  { tk: "DADDY", name: "Daddy Tate", mono: "D", c: "#94a0b8", usd: 41, amt: "120k" },
  { tk: "HARRYBOLZ", name: "Harry Bolz", mono: "H", c: "#7e8ba3", usd: 8, amt: "330k" },
];

// Which holdings get swept in by a threshold (everything with value < X).
export function sweepByThreshold(x: number): Holding[] {
  return HOLDINGS.filter(h => h.usd < x);
}

// ─── Roll math ───────────────────────────────────────────────────────────────
export const PITY_HARD = 90; // guaranteed legendary+ at this count
export const PITY_SOFT = 74; // odds ramp after this

export function rand(a: number, b: number): number { return a + Math.random() * (b - a); }
export function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// Roll a rarity given current pity. Returns rarity key.
export function rollRarity(pity: number): RarityKey {
  // Hard pity → guaranteed legendary (or jackpot sliver)
  if (pity >= PITY_HARD - 1) {
    return Math.random() < 0.05 ? "jackpot" : "legendary";
  }
  // Soft pity ramp: boost legendary odds after 74
  let legBoost = 0;
  if (pity >= PITY_SOFT) legBoost = (pity - PITY_SOFT) * 0.06;

  const r = Math.random();
  const jp = RARITIES.jackpot.odds;
  const leg = RARITIES.legendary.odds + legBoost;
  const epic = RARITIES.epic.odds;
  const rare = RARITIES.rare.odds;

  if (r < jp) return "jackpot";
  if (r < jp + leg) return "legendary";
  if (r < jp + leg + epic) return "epic";
  if (r < jp + leg + epic + rare) return "rare";
  return "common";
}

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
}

// Build a full pull result object.
let _pullId = 0;
export function makePull(pity: number, stakeUsd: number, globalRollIndex: number): Pull {
  const earlyPts = earlyPointsFor(globalRollIndex);
  const rarityKey = rollRarity(pity);
  const R = RARITIES[rarityKey];
  const token = pick(POOL[rarityKey]);
  const [lo, hi] = R.multRange;
  // bias multiplier toward the low end so big numbers feel earned
  const t = Math.pow(Math.random(), 1.7);
  let mult = lo + t * (hi - lo);
  mult = rarityKey === "jackpot" ? Math.round(mult) : Math.round(mult * 100) / 100;
  const newUsd = Math.round(stakeUsd * mult);
  // edge dividend: the swap's notional churn pays a kickback to earlier rollers
  // (and future rollers pay you). Scaled off the larger of stake/winnings so it
  // never rounds to nothing.
  const dividend = Math.max(1, Math.round(Math.max(stakeUsd, newUsd) * 0.012 * (0.6 + Math.random())));
  return {
    id: ++_pullId,
    rarity: rarityKey,
    token,
    mult,
    fromUsd: stakeUsd,
    toUsd: newUsd,
    isWin: mult >= 1,
    slotHash: randomSlotHash(),
    requestSlot: 287_000_000 + Math.floor(Math.random() * 900_000),
    poolSize: 1200 + Math.floor(Math.random() * 800),
    selectedIndex: Math.floor(Math.random() * 1900),
    earlyPts,
    dividend,
    globalRollIndex,
    ts: Date.now(),
  };
}

// ─── EARLY ROLLER DIVIDENDS ───────────────────────────────────────────────────
// The "house edge" is NOT skimmed — it's paid forward. Every roll mints $EARLY
// points, exponentially more the earlier you are in the protocol's life. Each
// roll's edge also pays a dividend to a previous roller. Play early, play often.
export const PROTOCOL_GENESIS_ROLLS = 142069; // global rolls already minted at launch sim
export const EARLY_BASE = 10000;              // points for roll #1
export const EARLY_HALFLIFE = 50000;          // rolls until mint-rate halves

// Points minted for the Nth global roll (1-indexed). Exponential decay → early = huge.
export function earlyPointsFor(globalRollIndex: number): number {
  const decay = Math.pow(0.5, globalRollIndex / EARLY_HALFLIFE);
  return Math.max(12, Math.round(EARLY_BASE * decay));
}

// What fraction of all-time mint is still ahead of you (your "earliness percentile").
export function earlinessPct(globalRollIndex: number): number {
  const k = Math.LN2 / EARLY_HALFLIFE;
  const total = EARLY_BASE / k; // ∫0..∞
  const remaining = (EARLY_BASE / k) * Math.exp(-k * globalRollIndex);
  return Math.max(0.1, Math.min(99.9, (remaining / total) * 100));
}

export function randomSlotHash(): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 64; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
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

// ─── Live matchmaker stats (optional overlay over the sim) ──────────────────
export interface LiveStats {
  poolSize: number;
  totalSwaps: number;
  totalRolls: number;
  totalRollers: number;
  minRollFeeSol: number;
  rentPerSwapSol: number;
  pityHard: number;
  pitySoft: number;
  matchmaker: string | null;
}
