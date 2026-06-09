import { createServer, IncomingMessage, ServerResponse } from "http";
import type { DividendLedger } from "./dividend.js";

let _ledger: DividendLedger | null = null;

export function registerLedger(l: DividendLedger): void {
  _ledger = l;
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

    if (url === "/leaderboard") {
      if (!_ledger) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "matchmaker not running" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        totalRolls: _ledger.totalRolls,
        totalRollers: _ledger.totalRollers,
        rollers: _ledger.getLeaderboard().map(r => ({
          pubkey: r.pubkey,
          rollNumber: r.rollIndex + 1,
          cumulativePoints: r.cumulativePoints,
          totalEarnedSOL: (r.totalEarnedLamports / 1e9).toFixed(6),
          pendingSOL: (r.pendingLamports / 1e9).toFixed(6),
          claimedSOL: (r.claimedLamports / 1e9).toFixed(6),
        })),
      }));
      return;
    }

    const pointsMatch = url.match(/^\/points\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (pointsMatch) {
      if (!_ledger) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "matchmaker not running" }));
        return;
      }
      const stats = _ledger.getStats(pointsMatch[1]);
      if (!stats) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "pubkey not in ledger — roll first" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        pubkey: stats.pubkey,
        rollNumber: stats.rollIndex + 1,
        cumulativePoints: stats.cumulativePoints,
        totalEarnedSOL: (stats.totalEarnedLamports / 1e9).toFixed(6),
        pendingSOL: (stats.pendingLamports / 1e9).toFixed(6),
        claimedSOL: (stats.claimedLamports / 1e9).toFixed(6),
        totalRolls: _ledger.totalRolls,
      }));
      return;
    }

    res.writeHead(404);
    res.end("not found");
  }).listen(port, () => {
    console.log(`[health] listening on :${port}`);
  });
}
