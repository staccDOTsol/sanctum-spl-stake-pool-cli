"use client";

// THE SWITCHEROO — main state machine tying together banner, approval,
// wish animation, reveal, summary, history and receipt.
//
// The pull experience is simulated client-side (the design intent: gacha fun,
// crypto minimal). Live matchmaker stats from /api/gacha/stats overlay the sim
// when the crank is reachable.

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  THEMES, STAKE, PROTOCOL_GENESIS_ROLLS, Pull, LiveStats,
  JACKPOT_SEED_SOL, JACKPOT_RAKE,
  sweepByThreshold, makePull, topRarity, earlinessPct,
  ticketsForStreak, jackpotHit, fmtSol,
} from "@/lib/gacha/data";
import { Starfield, useScreenShake } from "@/components/gacha/Fx";
import { WishOverlay, RevealCard } from "@/components/gacha/Reveal";
import { SummaryGrid, Receipt, HistoryDrawer } from "@/components/gacha/Extras";
import { ApprovalSheet } from "@/components/gacha/Approval";
import { Banner } from "@/components/gacha/Banner";

// Baked-in look & feel (the design's shipped tweak defaults)
const THEME = THEMES.astral;
const INTENSITY = 80;
const SCREEN_SHAKE = true;
const FAST_MODE = false;

type Stage = "banner" | "wishing" | "reveal" | "summary";

export default function GachaPage() {
  // FX components randomize at render time — render client-side only.
  const [mounted, setMounted] = useState(false);

  const [stage, setStage] = useState<Stage>("banner");
  const [approved, setApproved] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [threshold, setThreshold] = useState(150);

  const [pity, setPity] = useState(37);
  const [globalRolls, setGlobalRolls] = useState(PROTOCOL_GENESIS_ROLLS);
  const [earlyBank, setEarlyBank] = useState(0);
  const [divBank, setDivBank] = useState(0);
  const [streak, setStreak] = useState(0);
  const [jackpotSol, setJackpotSol] = useState(JACKPOT_SEED_SOL);
  const [jackpotWin, setJackpotWin] = useState(0);
  const [history, setHistory] = useState<Pull[]>([]);

  const [pulls, setPulls] = useState<Pull[]>([]);
  const [isMulti, setIsMulti] = useState(false);
  const [receipt, setReceipt] = useState<Pull | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [shaking, shake] = useScreenShake();
  const [live, setLive] = useState<LiveStats | null>(null);

  // Hydrate persisted state + hide the global scanline overlay while mounted
  useEffect(() => {
    setPity(+(localStorage.getItem("sw_pity") || 37));
    setGlobalRolls(+(localStorage.getItem("sw_global") || PROTOCOL_GENESIS_ROLLS));
    setEarlyBank(+(localStorage.getItem("sw_early") || 0));
    setDivBank(+(localStorage.getItem("sw_div") || 0));
    setStreak(+(localStorage.getItem("sw_streak") || 0));
    setJackpotSol(+(localStorage.getItem("sw_jackpot") || JACKPOT_SEED_SOL));
    try { setHistory(JSON.parse(localStorage.getItem("sw_hist") || "[]")); } catch { /* keep [] */ }
    setMounted(true);
    document.body.classList.add("gacha-mode");
    return () => document.body.classList.remove("gacha-mode");
  }, []);

  useEffect(() => { if (mounted) localStorage.setItem("sw_pity", String(pity)); }, [pity, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("sw_global", String(globalRolls)); }, [globalRolls, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("sw_early", String(earlyBank)); }, [earlyBank, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("sw_div", String(divBank)); }, [divBank, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("sw_streak", String(streak)); }, [streak, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("sw_jackpot", String(jackpotSol)); }, [jackpotSol, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("sw_hist", JSON.stringify(history.slice(0, 60))); }, [history, mounted]);

  // Live matchmaker stats (graceful: stays null when the crank is unreachable)
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/gacha/stats")
        .then(r => (r.ok ? r.json() : null))
        .then(s => { if (!cancelled && s && typeof s.poolSize === "number") setLive(s as LiveStats); })
        .catch(() => { /* sim-only mode */ });
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const sweptUsd = sweepByThreshold(threshold).reduce((s, h) => s + h.usd, 0) || STAKE.usd;
  const earliness = earlinessPct(globalRolls - PROTOCOL_GENESIS_ROLLS + 1);

  const doRoll = useCallback((count: number) => {
    if (!approved) { setShowApproval(true); return; }
    let p = pity;
    const results: Pull[] = [];
    for (let i = 0; i < count; i++) {
      const swept = sweepByThreshold(threshold);
      const stakeUsd = swept[i % Math.max(1, swept.length)]?.usd || STAKE.usd;
      const pull = makePull(p, stakeUsd, globalRolls + i + 1);
      if (pull.rarity === "legendary" || pull.rarity === "jackpot") p = 0; else p += 1;
      results.push(pull);
    }
    setPity(p);
    setGlobalRolls(g => g + count);
    setPulls(results);
    setIsMulti(count > 1);
    setStage("wishing");
  }, [approved, pity, threshold, globalRolls]);

  const onWishDone = useCallback(() => {
    const top = topRarity(pulls);
    if (SCREEN_SHAKE && (top === "legendary" || top === "jackpot")) {
      shake(top === "jackpot" ? 2 : 1);
    }
    setEarlyBank(b => b + pulls.reduce((s, p) => s + p.earlyPts, 0));
    setDivBank(b => b + pulls.reduce((s, p) => s + p.dividend, 0));

    // Streak parlay + progressive jackpot, sequential over the batch.
    // Each roll rakes a slice of the fee into the pot; a win streak buys extra
    // tickets; a provably-fair draw off the slot hash can take the whole pot.
    const rollFee = live?.minRollFeeSol ?? 0.003;
    let s = streak, pot = jackpotSol, won = 0;
    for (const p of pulls) {
      pot += rollFee * JACKPOT_RAKE;
      const tickets = ticketsForStreak(s);
      if (jackpotHit(p.slotHash, tickets)) { won = pot; pot = JACKPOT_SEED_SOL; }
      s = p.isWin ? s + 1 : 0;
    }
    setStreak(s);
    setJackpotSol(pot);
    if (won > 0) { setJackpotWin(won); if (SCREEN_SHAKE) shake(2); }

    setHistory(h => [...pulls].reverse().concat(h));
    setStage(isMulti ? "summary" : "reveal");
  }, [pulls, isMulti, shake, streak, jackpotSol, live]);

  const reset = () => { setStage("banner"); setPulls([]); };

  const shakeStyle: CSSProperties = shaking
    ? { animation: `shake${shaking > 1 ? "Big" : ""} .55s cubic-bezier(.36,.07,.19,.97)` }
    : {};

  if (!mounted) {
    return <div className="gacha-root" style={{ position: "fixed", inset: 0, zIndex: 70, background: THEME.bg2 }} />;
  }

  return (
    <div className="gacha-root" style={{
      position: "fixed", inset: 0, zIndex: 70, overflow: "hidden",
      background: `radial-gradient(ellipse 90% 60% at 50% -5%, ${THEME.glow} 0%, transparent 55%), linear-gradient(180deg, ${THEME.bg1}, ${THEME.bg2})`,
      ...shakeStyle,
    }}>
      <Starfield hue={THEME.hue} density={0.9} />

      {/* ── TOP RIBBON: tired of gambling? ── */}
      <a href="https://stacsol.app" target="_blank" rel="noopener noreferrer" style={{
        position: "relative", zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        padding: "7px 16px", background: "rgba(124,255,178,0.07)", borderBottom: "1px solid rgba(124,255,178,0.15)",
        textDecoration: "none", fontFamily: "var(--mono)", fontSize: 12,
      }}>
        <span style={{ color: "rgba(255,255,255,0.5)" }}>Tired of gambling?</span>
        <span style={{ color: "#7CFFB2", fontWeight: 700 }}>stacsol.app</span>
        <span style={{ color: "rgba(255,255,255,0.25)" }}>·</span>
        <span style={{ color: "#7CFFB2", fontWeight: 700 }}>degensol.app</span>
        <span style={{ color: "rgba(255,255,255,0.4)" }}>↗</span>
      </a>

      {/* ── content layer ── */}
      <div style={{ position: "relative", zIndex: 10, height: "calc(100% - 35px)", overflowY: "auto" }}>
        {stage === "banner" && (
          <Banner
            approved={approved} pity={pity}
            globalRolls={globalRolls} earlyBank={earlyBank} divBank={divBank}
            streak={streak} jackpotSol={live?.jackpotSol || jackpotSol}
            earliness={earliness} sweptUsd={sweptUsd} threshold={threshold} live={live}
            onRoll={doRoll} onApprove={() => setShowApproval(true)} onHistory={() => setShowHistory(true)}
          />
        )}
        {stage === "reveal" && pulls[0] && (
          <Stage>
            <RevealCard pull={pulls[0]} intensity={INTENSITY} big onReceipt={() => setReceipt(pulls[0])} />
            <AfterActions onAgain={() => doRoll(1)} onAgain10={() => doRoll(10)} onHome={reset} />
          </Stage>
        )}
        {stage === "summary" && (
          <Stage>
            <div style={{ marginBottom: 22, textAlign: "center" }}>
              <div style={{ fontSize: 13, letterSpacing: "0.4em", color: THEME.hue, fontFamily: "var(--mono)", fontWeight: 700 }}>10× WISH RESULTS</div>
            </div>
            <SummaryGrid pulls={pulls} onReceipt={setReceipt} />
            <AfterActions onAgain={() => doRoll(1)} onAgain10={() => doRoll(10)} onHome={reset} />
          </Stage>
        )}
      </div>

      {stage === "wishing" && (
        <WishOverlay pulls={pulls} isMulti={isMulti} fast={FAST_MODE} onDone={onWishDone} />
      )}

      {showApproval && (
        <ApprovalSheet threshold={threshold} setThreshold={setThreshold} approved={approved}
          onApprove={() => { setApproved(true); setTimeout(() => setShowApproval(false), 700); }}
          onClose={() => setShowApproval(false)} />
      )}
      {receipt && <Receipt pull={receipt} onClose={() => setReceipt(null)} />}
      {jackpotWin > 0 && <JackpotWin amountSol={jackpotWin} onClose={() => setJackpotWin(0)} />}
      <HistoryDrawer open={showHistory} history={history} onClose={() => setShowHistory(false)}
        onReceipt={(p) => { setShowHistory(false); setReceipt(p); }} />
    </div>
  );
}

function JackpotWin({ amountSol, onClose }: { amountSol: number; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 65, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center",
      background: "radial-gradient(circle at 50% 40%, rgba(255,203,69,0.22), rgba(4,2,12,0.92))",
      backdropFilter: "blur(6px)", animation: "fadein .25s ease",
    }}>
      <div style={{ fontSize: 64, animation: "aurabreath 1.6s ease-in-out infinite" }}>🎰</div>
      <div style={{ fontSize: 13, letterSpacing: "0.4em", color: "#ffcb45", fontFamily: "var(--mono)", fontWeight: 800, marginTop: 8 }}>
        PROGRESSIVE JACKPOT
      </div>
      <div style={{
        fontSize: "clamp(40px, 9vw, 84px)", fontWeight: 900, lineHeight: 1, marginTop: 8,
        color: "#ffe27d", fontFamily: "var(--mono)", textShadow: "0 0 40px rgba(255,203,69,0.8)",
      }}>{fmtSol(amountSol)}</div>
      <div style={{ marginTop: 14, fontSize: 14, color: "rgba(255,255,255,0.6)" }}>
        The whole pot, paid to your wallet. Provably fair off the same slot hash.
      </div>
      <button onClick={onClose} style={{
        marginTop: 26, padding: "12px 28px", borderRadius: 12, border: "none", cursor: "pointer",
        background: "linear-gradient(90deg,#ffcb45,#ff8a3d)", color: "#1a0f02", fontWeight: 800, fontSize: 15,
        boxShadow: "0 10px 34px rgba(255,203,69,0.45)",
      }}>Claim & keep wishing</button>
    </div>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      {children}
    </div>
  );
}

function AfterActions({ onAgain, onAgain10, onHome }: {
  onAgain: () => void; onAgain10: () => void; onHome: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: 34, flexWrap: "wrap", justifyContent: "center" }}>
      <button onClick={onHome} style={ghostBtn}>← Banner</button>
      <button onClick={onAgain} style={ghostBtn}>Wish ×1</button>
      <button onClick={onAgain10} style={primaryBtn}>Wish ×10 again</button>
    </div>
  );
}

const ghostBtn: CSSProperties = {
  padding: "12px 22px", borderRadius: 12, cursor: "pointer",
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)",
  color: "rgba(255,255,255,0.8)", fontWeight: 700, fontSize: 14, fontFamily: "inherit",
};
const primaryBtn: CSSProperties = {
  padding: "12px 24px", borderRadius: 12, cursor: "pointer", border: "none",
  background: "linear-gradient(90deg, #b06bff, #7a32d6)", color: "#fff", fontWeight: 800, fontSize: 14,
  boxShadow: "0 8px 28px rgba(176,107,255,0.4)", fontFamily: "inherit",
};
