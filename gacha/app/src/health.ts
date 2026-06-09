import { createServer, IncomingMessage, ServerResponse } from "http";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { DividendLedger } from "./dividend.js";
import type { SwapHistory } from "./history.js";
import type { GachaPool } from "./pool.js";
import { PITY_HARD, PITY_SOFT } from "./history.js";

let _ledger: DividendLedger | null = null;
let _history: SwapHistory | null = null;
let _pool: GachaPool | null = null;

export function registerLedger(l: DividendLedger): void {
  _ledger = l;
}

export function registerHistory(h: SwapHistory): void {
  _history = h;
}

export function registerPool(p: GachaPool): void {
  _pool = p;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

export function startHealthServer(): void {
  const port = parseInt(process.env.PORT ?? "3000", 10);

  createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    if (url === "/" || url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (url === "/stats") {
      json(res, 200, {
        poolSize: _pool?.size ?? 0,
        totalSwaps: _history?.totalSwaps ?? 0,
        totalRolls: _ledger?.totalRolls ?? 0,
        totalRollers: _ledger?.totalRollers ?? 0,
        minRollFeeSol: parseFloat(process.env.MIN_ROLL_FEE_SOL ?? "0.003"),
        rentPerSwapSol: 0.00408,
        pityHard: PITY_HARD,
        pitySoft: PITY_SOFT,
        matchmaker: process.env.MATCHMAKER_PUBKEY ?? null,
      });
      return;
    }

    const swapsMatch = url.match(/^\/swaps(?:\?limit=(\d+))?$/);
    if (swapsMatch) {
      if (!_history) { json(res, 503, { error: "matchmaker not running" }); return; }
      json(res, 200, { swaps: _history.recent(parseInt(swapsMatch[1] ?? "50", 10)) });
      return;
    }

    const swapsForMatch = url.match(/^\/swaps\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (swapsForMatch) {
      if (!_history) { json(res, 503, { error: "matchmaker not running" }); return; }
      json(res, 200, { swaps: _history.forPubkey(swapsForMatch[1]) });
      return;
    }

    const pityMatch = url.match(/^\/pity\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (pityMatch) {
      if (!_history) { json(res, 503, { error: "matchmaker not running" }); return; }
      json(res, 200, {
        pubkey: pityMatch[1],
        pity: _history.pityOf(pityMatch[1]),
        pityHard: PITY_HARD,
        pitySoft: PITY_SOFT,
        guaranteed: _history.pityActive(pityMatch[1]),
      });
      return;
    }

    if (url === "/leaderboard") {
      if (!_ledger) {
        json(res, 503, { error: "matchmaker not running" });
        return;
      }
      json(res, 200, {
        totalRolls: _ledger.totalRolls,
        totalRollers: _ledger.totalRollers,
        rollers: _ledger.getLeaderboard().map(r => ({
          pubkey: r.pubkey,
          rollNumber: r.rollIndex + 1,
          cumulativePoints: r.cumulativePoints,
          totalEarnedSOL: (r.totalEarnedLamports / LAMPORTS_PER_SOL).toFixed(6),
          pendingSOL: (r.pendingLamports / LAMPORTS_PER_SOL).toFixed(6),
          claimedSOL: (r.claimedLamports / LAMPORTS_PER_SOL).toFixed(6),
        })),
      });
      return;
    }

    const pointsMatch = url.match(/^\/points\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (pointsMatch) {
      if (!_ledger) {
        json(res, 503, { error: "matchmaker not running" });
        return;
      }
      const stats = _ledger.getStats(pointsMatch[1]);
      if (!stats) {
        json(res, 404, { error: "pubkey not in ledger — roll first" });
        return;
      }
      json(res, 200, {
        pubkey: stats.pubkey,
        rollNumber: stats.rollIndex + 1,
        cumulativePoints: stats.cumulativePoints,
        totalEarnedSOL: (stats.totalEarnedLamports / LAMPORTS_PER_SOL).toFixed(6),
        pendingSOL: (stats.pendingLamports / LAMPORTS_PER_SOL).toFixed(6),
        claimedSOL: (stats.claimedLamports / LAMPORTS_PER_SOL).toFixed(6),
        totalRolls: _ledger.totalRolls,
      });
      return;
    }

    res.writeHead(404);
    res.end("not found");
  }).listen(port, () => {
    console.log(`[health] listening on :${port}`);
  });
}
