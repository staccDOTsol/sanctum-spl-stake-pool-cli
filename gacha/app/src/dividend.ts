/**
 * Dividend ledger — exponential rewards for early rollers.
 *
 * Every roll allocates DIVIDEND_BPS (default 40%) of the roll fee
 * to all existing rollers, weighted by (0.5)^rollIndex:
 *   roller #1 → ~50% of each dividend pool
 *   roller #2 → ~25%
 *   roller #3 → ~12.5%
 *   …
 *
 * "Earlier you are, exponentially more you earn."
 *
 * Payouts are batched and sent automatically after each swap
 * whenever a roller's pending balance exceeds MIN_PAYOUT_LAMPORTS.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export const DIVIDEND_BPS = parseInt(process.env.DIVIDEND_BPS ?? "4000"); // 40% of roll fee
export const MIN_PAYOUT_LAMPORTS = parseInt(process.env.MIN_PAYOUT_LAMPORTS ?? "500000"); // 0.0005 SOL
export const LEDGER_PATH = process.env.DIVIDEND_LEDGER_PATH ?? "./dividend-ledger.json";

/**
 * Per-rank decay of dividend weight: roller i earns DIVIDEND_DECAY^i of the
 * weight. The original 0.5 was too steep — roller #10 earned ~1/1000th, so a
 * whale's annuity NPV could never beat their swap-EV loss and they'd never
 * seed the pool (adverse selection → market for lemons → pool dies).
 *
 * At 0.85 the geometric series sum is 1/(1-0.85) ≈ 6.67 "rolls of fees" of
 * lifetime entitlement per unit weight, and roller #N's share decays slowly
 * enough that seeding early is individually rational for high-value holders.
 * Tune via DIVIDEND_DECAY ∈ (0,1): higher = flatter = more late-roller upside.
 */
export const DIVIDEND_DECAY = Math.min(0.999, Math.max(0.01, parseFloat(process.env.DIVIDEND_DECAY ?? "0.85")));

/** Earliness multiplier for a 0-indexed roller rank (1 at rank 0, decaying). */
export function dividendWeight(rollIndex: number): number {
  return Math.pow(DIVIDEND_DECAY, rollIndex);
}

/** Scale so points read as whole numbers (~USD × earliness × this). */
export const POINTS_SCALE = 1000;

export interface RollerRecord {
  pubkey: string;
  rollIndex: number;          // 0-indexed position in join order (lower = earlier)
  pendingLamports: number;    // earned but not yet paid out
  claimedLamports: number;    // total paid out
  totalEarnedLamports: number;
  cumulativePoints: number;   // abstract score (1_000_000 units distributed per roll)
}

interface LedgerState {
  totalRolls: number;
  rollers: RollerRecord[];
}

export class DividendLedger {
  private state: LedgerState = { totalRolls: 0, rollers: [] };
  private byPubkey = new Map<string, RollerRecord>();

  constructor(private path = LEDGER_PATH) {
    this.tryLoad();
  }

  private tryLoad(): void {
    try {
      if (existsSync(this.path)) {
        this.state = JSON.parse(readFileSync(this.path, "utf8")) as LedgerState;
        for (const r of this.state.rollers) this.byPubkey.set(r.pubkey, r);
        console.log(`[dividend] loaded ledger: ${this.state.rollers.length} rollers, ${this.state.totalRolls} total rolls`);
      }
    } catch (e) {
      console.warn("[dividend] failed to load ledger, starting fresh:", e);
    }
  }

  save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.warn("[dividend] failed to save ledger:", e);
    }
  }

  /**
   * Distribute this roll's dividend pool to all EXISTING rollers in proportion
   * to their accumulated POINTS, then accrue points for this roller and register
   * them if new. Must be called AFTER the swap confirms.
   *
   * points accrued per roll = usdNotional × earliness(rollIndex) × POINTS_SCALE.
   * So risk more + roll earlier = a bigger permanent slice of every future
   * roll's dividends. This compensates above-average-bag holders for their
   * negative swap-EV, which is what keeps big bags in the pool (anti-lemons).
   */
  allocate(rollerPubkey: string, rollFeeLamports: number, usdNotional: number): void {
    const dividendPool = Math.floor(rollFeeLamports * DIVIDEND_BPS / 10_000);

    // Distribute to existing rollers (not the current one) by their points.
    const recipients = this.state.rollers.filter(r => r.pubkey !== rollerPubkey);
    let totalPoints = 0;
    for (const r of recipients) totalPoints += r.cumulativePoints;
    if (dividendPool > 0 && totalPoints > 0) {
      let distributed = 0;
      for (const r of recipients) {
        const earned = Math.floor(dividendPool * (r.cumulativePoints / totalPoints));
        r.pendingLamports += earned;
        r.totalEarnedLamports += earned;
        distributed += earned;
      }
      console.log(
        `[dividend] roll #${this.state.totalRolls + 1}: distributed ${(distributed / 1e9).toFixed(6)} SOL ` +
        `across ${recipients.length} rollers (by points)`
      );
    }

    // Register new roller (they don't earn from their own roll).
    let rec = this.byPubkey.get(rollerPubkey);
    if (!rec) {
      rec = {
        pubkey: rollerPubkey,
        rollIndex: this.state.rollers.length,
        pendingLamports: 0,
        claimedLamports: 0,
        totalEarnedLamports: 0,
        cumulativePoints: 0,
      };
      this.state.rollers.push(rec);
      this.byPubkey.set(rollerPubkey, rec);
      console.log(`[dividend] new roller #${rec.rollIndex + 1}: ${rollerPubkey}`);
    }

    // Accrue points = USD risked × earliness × scale.
    const dPoints = Math.round(Math.max(0, usdNotional) * dividendWeight(rec.rollIndex) * POINTS_SCALE);
    rec.cumulativePoints += dPoints;
    if (dPoints > 0) console.log(`[dividend] ${rollerPubkey.slice(0, 8)} +${dPoints} pts (risk $${usdNotional.toFixed(2)} × earliness)`);

    this.state.totalRolls++;
    this.save();
  }

  /** Send pending dividends to all rollers above threshold. Fire-and-forget safe. */
  async payPendingDividends(connection: Connection, payer: Keypair): Promise<void> {
    const due = this.state.rollers.filter(r => r.pendingLamports >= MIN_PAYOUT_LAMPORTS);
    if (due.length === 0) return;

    // Cap at 20 per tx to stay within account limits
    const batch = due.slice(0, 20);
    const tx = new Transaction();
    for (const r of batch) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: new PublicKey(r.pubkey),
          lamports: r.pendingLamports,
        })
      );
    }

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: "confirmed",
      });
      for (const r of batch) {
        r.claimedLamports += r.pendingLamports;
        r.pendingLamports = 0;
      }
      this.save();
      console.log(`[dividend] paid ${batch.length} rollers: ${sig}`);
    } catch (e) {
      console.warn("[dividend] payout tx failed (will retry next roll):", e);
    }
  }

  getStats(pubkey: string): RollerRecord | undefined {
    return this.byPubkey.get(pubkey);
  }

  /** Leaderboard: earliest rollers first (they earn the most) */
  getLeaderboard(): RollerRecord[] {
    return [...this.state.rollers].sort((a, b) => a.rollIndex - b.rollIndex);
  }

  get totalRolls(): number {
    return this.state.totalRolls;
  }

  get totalRollers(): number {
    return this.state.rollers.length;
  }
}
