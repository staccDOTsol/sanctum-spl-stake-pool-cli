/**
 * Progressive jackpot — the positive-skew "dream tail" that makes an
 * EV-neutral swap genuinely fun (prospect theory: humans overweight small
 * probabilities of large gains).
 *
 * Funding:  a rake of JACKPOT_BPS (default 5%) of every roll fee accrues into
 *           the pot. No new money is minted — it's a slice of fees that would
 *           otherwise have been pure churn.
 *
 * Trigger:  provably fair, derived from the SAME slot hash that selects the
 *           counterparty but over a disjoint byte range + domain tag, so it's
 *           independent of the swap outcome and equally un-cherry-pickable:
 *
 *             h = sha256(slot_hash || requester || "switcheroo-jackpot")
 *             hit  iff  u64_le(h[0..8]) % JACKPOT_ODDS  <  tickets
 *
 *           `tickets` = 1 + streak bonus, so a hot streak buys more chances at
 *           the pot (see history.ts). p(hit) = tickets / JACKPOT_ODDS.
 *
 * Payout:   the full pot to the winner, in SOL, then reset to the seed. The
 *           award is only booked AFTER the on-chain transfer confirms, so a
 *           failed payout never zeroes the accounting.
 */

import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export const JACKPOT_BPS = parseInt(process.env.JACKPOT_BPS ?? "500");          // 5% of roll fee
export const JACKPOT_ODDS = parseInt(process.env.JACKPOT_ODDS ?? "1000");        // 1 in 1000 per ticket
export const JACKPOT_SEED_LAMPORTS = parseInt(process.env.JACKPOT_SEED_LAMPORTS ?? "0");
export const JACKPOT_PATH = process.env.JACKPOT_PATH ?? "./jackpot.json";

interface JackpotWin {
  winner: string;
  lamports: number;
  signature: string;
  ts: number;
}

interface JackpotState {
  balanceLamports: number;
  totalContributedLamports: number;
  wins: JackpotWin[];
}

export class JackpotPot {
  private state: JackpotState = {
    balanceLamports: JACKPOT_SEED_LAMPORTS,
    totalContributedLamports: 0,
    wins: [],
  };

  constructor(private path = JACKPOT_PATH) {
    this.tryLoad();
  }

  private tryLoad(): void {
    try {
      if (existsSync(this.path)) {
        this.state = JSON.parse(readFileSync(this.path, "utf8")) as JackpotState;
        console.log(`[jackpot] loaded pot: ${(this.state.balanceLamports / 1e9).toFixed(6)} SOL, ${this.state.wins.length} past wins`);
      }
    } catch (e) {
      console.warn("[jackpot] failed to load, starting fresh:", e);
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.warn("[jackpot] failed to save:", e);
    }
  }

  /** Rake a slice of a roll fee into the pot. Returns lamports added. */
  contribute(rollFeeLamports: number): number {
    const cut = Math.floor(rollFeeLamports * JACKPOT_BPS / 10_000);
    if (cut <= 0) return 0;
    this.state.balanceLamports += cut;
    this.state.totalContributedLamports += cut;
    this.save();
    return cut;
  }

  /**
   * Provably-fair hit check. `tickets` (>=1) draws against JACKPOT_ODDS, so
   * p(hit) = tickets / JACKPOT_ODDS. Independent of counterparty selection.
   */
  checkHit(slotHash: Buffer, requester: PublicKey, tickets: number): boolean {
    if (this.state.balanceLamports <= 0) return false;
    const h = createHash("sha256")
      .update(slotHash)
      .update(requester.toBuffer())
      .update("switcheroo-jackpot")
      .digest();
    const draw = h.readBigUInt64LE(0) % BigInt(JACKPOT_ODDS);
    return draw < BigInt(Math.max(1, tickets));
  }

  /** Lamports a win would pay right now (the full pot). */
  get balance(): number {
    return this.state.balanceLamports;
  }

  /** Book a win AFTER the payout tx confirms; resets the pot to the seed. */
  settleWin(winner: string, lamports: number, signature: string): void {
    this.state.wins.unshift({ winner, lamports, signature, ts: Date.now() });
    if (this.state.wins.length > 100) this.state.wins.length = 100;
    this.state.balanceLamports = JACKPOT_SEED_LAMPORTS;
    this.save();
    console.log(`[jackpot] 🎰 WON by ${winner.slice(0, 8)}: ${(lamports / 1e9).toFixed(6)} SOL (${signature})`);
  }

  snapshot() {
    return {
      balanceLamports: this.state.balanceLamports,
      balanceSol: this.state.balanceLamports / 1e9,
      totalContributedSol: this.state.totalContributedLamports / 1e9,
      oddsPerTicket: JACKPOT_ODDS,
      rakeBps: JACKPOT_BPS,
      lastWin: this.state.wins[0] ?? null,
      totalWins: this.state.wins.length,
    };
  }
}
