/**
 * leak.markets trending / discovery algorithm.
 *
 * Hot Score formula:
 *
 *   hotScore = tvlScore + momentumScore + controversyScore - ageScore
 *
 *   tvlScore       = log10(tvl_usd + 1)               captures raw capital weight
 *   momentumScore  = clamp(deltaR_1h × 8, -4, 4)      rewards fast ratio movement
 *   controversyScore = (1 - |2r - 1|) × 2             peaks at r=0.5; zero at r=0 or r=1
 *   ageScore       = ageHours / 72                     linear decay, full at 72 h
 *
 * Bonus:
 *   +1.0 if r changed direction in last 1 h (flip — narrative shift)
 *   +0.5 if r > 0.85 (almost leaked — high urgency)
 *
 * Tags assigned after scoring:
 *   Hot        — top-10 % hotScore overall
 *   Rising     — deltaR_1h > +0.05 (ratio climbing)
 *   Contested  — r ∈ (0.35, 0.65) (active fight)
 *   Almost Leaked — r > 0.85
 *   Suppressed — r < 0.10
 *   New        — age < 2 h
 */

import type { ContentEntry, PoolSnapshot, RankedContent, ContentTag } from "./types";

export interface TrendingInput {
  entry: ContentEntry;
  snapshot: PoolSnapshot;
  deltaR1h: number | null;
  deltaR24h: number | null;
}

function log10(x: number): number {
  return x <= 0 ? 0 : Math.log10(x);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function computeHotScore(input: TrendingInput): number {
  const { snapshot, deltaR1h, deltaR24h, entry } = input;
  const { r, tvl } = snapshot;

  const ageHours = (Date.now() - entry.createdAt) / 3_600_000;

  const tvlScore = log10(tvl + 1);
  const momentumScore = clamp((deltaR1h ?? 0) * 8, -4, 4);
  const controversyScore = (1 - Math.abs(2 * r - 1)) * 2;
  const ageScore = clamp(ageHours / 72, 0, 1);

  let bonus = 0;
  // Direction flip — bullish narrative reversal
  if (deltaR1h !== null && deltaR24h !== null && deltaR1h * deltaR24h < 0) bonus += 1.0;
  // About to fully leak
  if (r > 0.85) bonus += 0.5;

  return tvlScore + momentumScore + controversyScore - ageScore + bonus;
}

export function assignTags(
  input: TrendingInput,
  allScores: number[],
  myScore: number
): ContentTag[] {
  const { snapshot, deltaR1h, entry } = input;
  const { r } = snapshot;
  const ageHours = (Date.now() - entry.createdAt) / 3_600_000;

  const tags: ContentTag[] = [];

  const sorted = [...allScores].sort((a, b) => b - a);
  const top10pctCutoff = sorted[Math.floor(sorted.length * 0.1)] ?? 0;

  if (myScore >= top10pctCutoff && allScores.length > 5) tags.push("Hot");
  if (ageHours < 2) tags.push("New");
  if (deltaR1h !== null && deltaR1h > 0.05) tags.push("Rising");
  if (r > 0.35 && r < 0.65) tags.push("Contested");
  if (r > 0.85) tags.push("Almost Leaked");
  if (r < 0.10) tags.push("Suppressed");

  return tags;
}

export function rankContent(inputs: TrendingInput[]): RankedContent[] {
  const scored = inputs.map((inp) => ({
    ...inp,
    hotScore: computeHotScore(inp),
  }));

  const allScores = scored.map((s) => s.hotScore);

  return scored
    .map((s, i) => ({
      ...s.entry,
      snapshot: s.snapshot,
      hotScore: s.hotScore,
      deltaR1h: s.deltaR1h,
      deltaR24h: s.deltaR24h,
      tags: assignTags(s, allScores, s.hotScore),
      rank: 0,
    }))
    .sort((a, b) => b.hotScore - a.hotScore)
    .map((item, i) => ({ ...item, rank: i + 1 }));
}
