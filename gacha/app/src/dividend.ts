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
   * Distribute dividends from this roll to all EXISTING rollers,
   * then register rollerPubkey if they're new.
   * Must be called AFTER the swap confirms.
   */
  allocate(rollerPubkey: string, rollFeeLamports: number): void {
    const dividendPool = Math.floor(rollFeeLamports * DIVIDEND_BPS / 10_000);

    if (dividendPool > 0 && this.state.rollers.length > 0) {
      // totalWeight = sum of (0.5)^rollIndex across all existing rollers
      let totalWeight = 0;
      for (const r of this.state.rollers) totalWeight += Math.pow(0.5, r.rollIndex);

      const POINTS_PER_ROLL = 1_000_000;
      let distributed = 0;

      for (const r of this.state.rollers) {
        const share = Math.pow(0.5, r.rollIndex) / totalWeight;
        const earned = Math.floor(dividendPool * share);
        const pts = Math.floor(POINTS_PER_ROLL * share);
        r.pendingLamports += earned;
        r.totalEarnedLamports += earned;
        r.cumulativePoints += pts;
        distributed += earned;
      }

      console.log(
        `[dividend] roll #${this.state.totalRolls + 1}: distributed ${distributed} lamports ` +
        `(${(distributed / 1e9).toFixed(6)} SOL) across ${this.state.rollers.length} rollers`
      );
    }

    // Register new roller AFTER distributing (they don't earn from their own roll)
    if (!this.byPubkey.has(rollerPubkey)) {
      const record: RollerRecord = {
        pubkey: rollerPubkey,
        rollIndex: this.state.rollers.length,
        pendingLamports: 0,
        claimedLamports: 0,
        totalEarnedLamports: 0,
        cumulativePoints: 0,
      };
      this.state.rollers.push(record);
      this.byPubkey.set(rollerPubkey, record);
      console.log(`[dividend] new roller #${record.rollIndex + 1}: ${rollerPubkey}`);
    }

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
