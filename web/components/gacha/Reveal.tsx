"use client";

// Wish animation overlay + single reveal card.

import { useEffect, useState } from "react";
import { RARITIES, Pull, topRarity, fmtMult, fmtUsd, fmtPts } from "@/lib/gacha/data";
import { Starfield, RarityCoin, Stars, ParticleBurst, SparkleRain } from "./Fx";

// ─── Wish animation: star descends, color tells rarity, white flash ───────────
export function WishOverlay({ pulls, isMulti, fast, onDone }: {
  pulls: Pull[]; isMulti: boolean; fast: boolean; onDone: () => void;
}) {
  const top = topRarity(pulls);
  const R = RARITIES[top];
  const [phase, setPhase] = useState<"warp" | "flash" | "done">("warp");
  const speed = fast ? 0.45 : 1;

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("flash"), (isMulti ? 2200 : 1700) * speed);
    const t2 = setTimeout(() => { setPhase("done"); onDone(); }, (isMulti ? 2900 : 2400) * speed);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // star color tell: gold = legendary, rainbow = jackpot, etc.
  const tell = R.accent;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40, overflow: "hidden", background: "#04020c" }}>
      <Starfield warp hue={tell} density={1.4} />
      {/* descending wish star */}
      <div style={{
        position: "absolute", left: "50%", top: "50%",
        transform: "translate(-50%,-50%)",
        animation: `wishstar ${1.6 * speed}s cubic-bezier(.5,0,.4,1) forwards`,
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: "50%", background: "#fff",
          boxShadow: `0 0 40px 14px ${tell}, 0 0 120px 40px ${tell}`,
        }} />
        {/* comet tail */}
        <div style={{
          position: "absolute", left: "50%", bottom: "100%", width: 3, height: 220,
          transform: "translateX(-50%)",
          background: `linear-gradient(to top, ${tell}, transparent)`,
          filter: "blur(1px)", opacity: 0.8,
        }} />
      </div>
      {/* rarity ring pulse just before flash */}
      {(top === "legendary" || top === "jackpot") && (
        <div style={{
          position: "absolute", left: "50%", top: "50%", width: 10, height: 10,
          transform: "translate(-50%,-50%)", borderRadius: "50%",
          border: `2px solid ${tell}`,
          animation: `ringpulse ${0.9 * speed}s ease-out ${1.2 * speed}s 2 forwards`,
        }} />
      )}
      {/* white flash */}
      <div style={{
        position: "absolute", inset: 0,
        background: top === "jackpot"
          ? "radial-gradient(circle, #fff, #ffe27d 40%, #ff7de0 70%, transparent)"
          : "#fff",
        opacity: phase === "flash" ? 1 : 0,
        transition: `opacity ${phase === "flash" ? 0.05 : 0.4}s`,
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: 40, left: 0, right: 0, textAlign: "center",
        color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)", fontSize: 12,
        letterSpacing: "0.3em", animation: "fadepulse 1.4s ease-in-out infinite",
      }}>RESOLVING SLOT HASH…</div>
    </div>
  );
}

// ─── Single reveal card ───────────────────────────────────────────────────────
export function RevealCard({ pull, intensity, big, onReceipt }: {
  pull: Pull; intensity: number; big?: boolean; onReceipt: () => void;
}) {
  const R = RARITIES[pull.rarity];
  const [mult, setMult] = useState(0);
  const [showBurst, setShowBurst] = useState(false);

  useEffect(() => {
    setShowBurst(true);
    const target = pull.mult;
    const dur = 900, start = performance.now();
    let raf = 0;
    function tick(now: number) {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setMult(target * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setMult(target);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const burstCount = pull.rarity === "jackpot" ? 90 : pull.rarity === "legendary" ? 60 : pull.rarity === "epic" ? 36 : 16;

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
      {(pull.rarity === "legendary" || pull.rarity === "jackpot") &&
        <SparkleRain accent={R.accent} count={pull.rarity === "jackpot" ? 50 : 30} />}
      {intensity > 30 && <ParticleBurst rarity={pull.rarity} count={burstCount} run={showBurst} />}

      {/* radiant aura behind coin */}
      <div style={{
        position: "absolute", top: -30, width: big ? 360 : 260, height: big ? 360 : 260,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${R.glow} 0%, transparent 68%)`,
        animation: "aurabreath 3s ease-in-out infinite",
      }} />

      <div style={{ position: "relative", animation: "cardpop .6s cubic-bezier(.2,1.3,.4,1) both" }}>
        <RarityCoin token={pull.token} rarity={pull.rarity} size={big ? 230 : 180} spin />
      </div>

      <div style={{ marginTop: 22, textAlign: "center", position: "relative" }}>
        <Stars rarity={pull.rarity} size={big ? 26 : 22} />
        <div style={{
          marginTop: 10, fontSize: big ? 15 : 13, letterSpacing: "0.35em",
          fontWeight: 800, color: R.accent, fontFamily: "var(--mono)",
          textShadow: `0 0 20px ${R.glow}`,
        }}>{R.label}</div>
        <div style={{ marginTop: 4, fontSize: big ? 30 : 24, fontWeight: 800, color: "#fff" }}>
          {pull.token.name}
        </div>

        {/* multiplier */}
        <div style={{
          marginTop: 14, fontSize: big ? 78 : 58, fontWeight: 900, lineHeight: 1,
          fontFamily: "var(--mono)",
          color: pull.isWin ? R.accent : "#ff6b6b",
          textShadow: `0 0 36px ${pull.isWin ? R.glow : "rgba(255,107,107,0.6)"}`,
        }}>{fmtMult(pull.mult >= 1 ? mult : pull.mult)}</div>

        {/* usd swing */}
        <div style={{ marginTop: 10, fontFamily: "var(--mono)", fontSize: big ? 17 : 15, color: "rgba(255,255,255,0.55)" }}>
          {fmtUsd(pull.fromUsd)} <span style={{ color: R.accent }}>→</span>{" "}
          <span style={{ color: pull.isWin ? "#7CFFB2" : "#ff6b6b", fontWeight: 700 }}>{fmtUsd(pull.toUsd)}</span>
        </div>

        {/* early dividend chip */}
        <div style={{
          marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8,
          padding: "7px 14px", borderRadius: 999,
          background: "rgba(255,203,69,0.1)", border: "1px solid rgba(255,203,69,0.3)",
          fontFamily: "var(--mono)", fontSize: 13,
        }}>
          <span style={{ color: "#ffcb45", fontWeight: 800 }}>+{fmtPts(pull.earlyPts)} $EARLY</span>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>·</span>
          <span style={{ color: "#7CFFB2" }}>+{fmtUsd(pull.dividend)} dividend</span>
        </div>

        <button onClick={onReceipt} style={{
          display: "block", margin: "18px auto 0", padding: "6px 12px",
          background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 8, color: "rgba(255,255,255,0.5)", fontSize: 11,
          fontFamily: "var(--mono)", letterSpacing: "0.1em", cursor: "pointer",
        }}>⛓ PROVABLY FAIR ↗</button>
      </div>
    </div>
  );
}
