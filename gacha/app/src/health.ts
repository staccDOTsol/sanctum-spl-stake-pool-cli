import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { DividendLedger } from "./dividend.js";
import type { SwapHistory } from "./history.js";
import type { GachaPool } from "./pool.js";
import type { JackpotPot } from "./jackpot.js";
import { PITY_HARD, PITY_SOFT } from "./history.js";

let _ledger: DividendLedger | null = null;
let _history: SwapHistory | null = null;
let _pool: GachaPool | null = null;
let _jackpot: JackpotPot | null = null;

export function registerLedger(l: DividendLedger): void {
  _ledger = l;
}

export function registerHistory(h: SwapHistory): void {
  _history = h;
}

export function registerPool(p: GachaPool): void {
  _pool = p;
}

export function registerJackpot(j: JackpotPot): void {
  _jackpot = j;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

// Static gacha UI (bundled by web/gacha-standalone, copied into ./ui at build).
const UI_DIR = resolve(process.env.UI_DIR ?? "./ui");
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/** Serve a file from the UI dir if it exists. Returns true if it handled the response. */
function tryServeStatic(pathname: string, res: ServerResponse): boolean {
  // map "/" → index.html; strip leading slash; block path traversal
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (rel.includes("..")) return false;
  const file = join(UI_DIR, rel);
  if (!file.startsWith(UI_DIR) || !existsSync(file)) return false;
  const ext = file.slice(file.lastIndexOf("."));
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
  res.end(readFileSync(file));
  return true;
}

export function startHealthServer(): void {
  const port = parseInt(process.env.PORT ?? "3000", 10);

  createServer((req: IncomingMessage, res: ServerResponse) => {
    // Alias /api/gacha/* → /* so the same UI build works inside Next or here.
    const url = (req.url ?? "/").replace(/^\/api\/gacha(?=\/|$)/, "") || "/";
    const pathname = url.split("?")[0];

    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (url === "/stats") {
      const jp = _jackpot?.snapshot() ?? null;
      const poolOwners = _pool ? new Set(_pool.getAll().map(e => e.owner.toBase58())).size : 0;
      json(res, 200, {
        poolSize: _pool?.size ?? 0,
        poolOwners,
        totalSwaps: _history?.totalSwaps ?? 0,
        totalRolls: _ledger?.totalRolls ?? 0,
        totalRollers: _ledger?.totalRollers ?? 0,
        minRollFeeSol: parseFloat(process.env.MIN_ROLL_FEE_SOL ?? "0.003"),
        rentPerSwapSol: 0.00408,
        pityHard: PITY_HARD,
        pitySoft: PITY_SOFT,
        jackpotSol: jp?.balanceSol ?? 0,
        jackpotOddsPerTicket: jp?.oddsPerTicket ?? 0,
        matchmaker: process.env.MATCHMAKER_PUBKEY ?? null,
        // Public RPC for the browser dApp (token reads + tx broadcast).
        rpc: process.env.FRONTEND_RPC ?? "https://api.mainnet-beta.solana.com",
      });
      return;
    }

    if (url === "/jackpot") {
      if (!_jackpot) { json(res, 503, { error: "matchmaker not running" }); return; }
      json(res, 200, _jackpot.snapshot());
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
        streak: _history.streakOf(pityMatch[1]),
        jackpotTickets: _history.ticketsFor(pityMatch[1]),
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

    // Static gacha UI (and "/" → index.html). JSON routes above take priority.
    if (req.method === "GET" && tryServeStatic(pathname, res)) return;

    res.writeHead(404);
    res.end("not found");
  }).listen(port, () => {
    console.log(`[health] listening on :${port}  (ui: ${UI_DIR})`);
  });
}
