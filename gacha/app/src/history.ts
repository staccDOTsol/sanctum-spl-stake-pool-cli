/**
 * Swap history ledger — the provably-fair receipt store + pity tracker.
 *
 * Every executed switcheroo is recorded with the full entropy trail
 * (request slot, entropy slot, slot hash, derived index, pool size) so
 * anyone can re-derive `sha256(slot_hash || requester) % pool_size`
 * and verify the matchmaker didn't cherry-pick their counterparty.
 *
 * Pity: a roller's pity counter increments on every losing roll
 * (multiplier < 1) and resets on a win. When it reaches PITY_HARD the
 * matchmaker restricts the candidate set to counterparties worth at
 * least as much as the requester — a guaranteed up-only roll, still
 * selected by slot-hash randomness within the restricted set.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export const PITY_HARD = parseInt(process.env.GACHA_PITY_HARD ?? "90");
export const PITY_SOFT = parseInt(process.env.GACHA_PITY_SOFT ?? "74");
export const HISTORY_PATH = process.env.SWAP_HISTORY_PATH ?? "./swap-history.json";
const MAX_RECORDS = 500;

export type Rarity = "common" | "rare" | "epic" | "legendary" | "jackpot";

/** Map a swap multiplier onto the gacha rarity bands shown in the UI. */
export function rarityForMult(mult: number): Rarity {
  if (mult >= 800) return "jackpot";
  if (mult >= 50) return "legendary";
  if (mult >= 5) return "epic";
  if (mult >= 1.5) return "rare";
  return "common";
}

export interface SwapRecord {
  signature: string;
  requester: string;
  counterparty: string;
  requesterMint: string;
  counterpartyMint: string;
  requesterAmount: string;
  counterpartyAmount: string;
  requesterUsd: number | null;
  counterpartyUsd: number | null;
  /** counterpartyUsd / requesterUsd — what the requester's bag did */
  multiplier: number | null;
  rarity: Rarity | null;
  tier: string;
  requestSlot: number;
  entropySlot: number;
  slotHash: string;
  randomIndex: number;
  poolSize: number;
  /** true when this roll was executed under hard pity (up-only candidate set) */
  pityTriggered: boolean;
  ts: number;
}

interface HistoryState {
  totalSwaps: number;
  swaps: SwapRecord[];
  /** consecutive losing rolls per requester pubkey */
  pity: Record<string, number>;
}

export class SwapHistory {
  private state: HistoryState = { totalSwaps: 0, swaps: [], pity: {} };

  constructor(private path = HISTORY_PATH) {
    this.tryLoad();
  }

  private tryLoad(): void {
    try {
      if (existsSync(this.path)) {
        this.state = JSON.parse(readFileSync(this.path, "utf8")) as HistoryState;
        this.state.pity ??= {};
        console.log(`[history] loaded ${this.state.swaps.length} swaps (${this.state.totalSwaps} all-time)`);
      }
    } catch (e) {
      console.warn("[history] failed to load, starting fresh:", e);
    }
  }

  save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.warn("[history] failed to save:", e);
    }
  }

  /** Current pity count for a pubkey (consecutive losing rolls). */
  pityOf(pubkey: string): number {
    return this.state.pity[pubkey] ?? 0;
  }

  /** Whether the next roll for this pubkey must be up-only. */
  pityActive(pubkey: string): boolean {
    return this.pityOf(pubkey) >= PITY_HARD;
  }

  record(rec: SwapRecord): void {
    this.state.totalSwaps++;
    this.state.swaps.unshift(rec);
    if (this.state.swaps.length > MAX_RECORDS) this.state.swaps.length = MAX_RECORDS;

    if (rec.multiplier !== null) {
      if (rec.multiplier >= 1) this.state.pity[rec.requester] = 0;
      else this.state.pity[rec.requester] = this.pityOf(rec.requester) + 1;
    }
    this.save();
  }

  recent(limit = 50): SwapRecord[] {
    return this.state.swaps.slice(0, Math.min(limit, MAX_RECORDS));
  }

  forPubkey(pubkey: string, limit = 50): SwapRecord[] {
    return this.state.swaps
      .filter(s => s.requester === pubkey || s.counterparty === pubkey)
      .slice(0, limit);
  }

  get totalSwaps(): number {
    return this.state.totalSwaps;
  }
}
