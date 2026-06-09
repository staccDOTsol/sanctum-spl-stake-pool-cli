"use client";

// The home / gacha banner screen.

import type { CSSProperties } from "react";
import {
  POOL, RARITIES, PITY_HARD, PITY_SOFT, PROTOCOL_GENESIS_ROLLS,
  Theme, LiveStats, sweepByThreshold, earlyPointsFor, fmtUsd, fmtPts,
} from "@/lib/gacha/data";
import { RarityCoin, SparkleRain } from "./Fx";

// pity ramp bar segments
export function OddsBar() {
  const segs = (["common", "rare", "epic", "legendary", "jackpot"] as const)
    .map(k => [k, RARITIES[k].odds] as const);
  return (
    <div>
      <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", gap: 1 }}>
        {segs.map(([k, o]) => (
          <div key={k} title={`${RARITIES[k].label} ${(o * 100).toFixed(2)}%`}
            style={{ flex: Math.max(o, 0.004), background: RARITIES[k].accent, boxShadow: `0 0 8px ${RARITIES[k].glow}` }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, flexWrap: "wrap", gap: 6 }}>
        {segs.map(([k, o]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--mono)", fontSize: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: RARITIES[k].accent }} />
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{RARITIES[k].label}</span>
            <span style={{ color: RARITIES[k].accent, fontWeight: 700 }}>{o < 0.01 ? (o * 100).toFixed(2) : (o * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Banner({ approved, pity, globalRolls, earlyBank, divBank, earliness, sweptUsd, threshold, live, onRoll, onApprove, onHistory }: {
  theme?: Theme;
  approved: boolean;
  pity: number;
  globalRolls: number;
  earlyBank: number;
  divBank: number;
  earliness: number;
  sweptUsd: number;
  threshold: number;
  live: LiveStats | null;
  onRoll: (count: number) => void;
  onApprove: () => void;
  onHistory: () => void;
}) {
  const featured = POOL.legendary[0]; // rate-up character
  const pityLeft = PITY_HARD - pity;
  const pityPct = Math.min(100, (pity / PITY_HARD) * 100);
  const rollIndex = globalRolls - PROTOCOL_GENESIS_ROLLS;
  const nextMint = earlyPointsFor(rollIndex + 1);
  const rollFee = live?.minRollFeeSol ?? 0.003;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 22px 50px" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>⇄</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-0.01em", color: "#fff" }}>SWITCHEROO</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)", letterSpacing: "0.18em" }}>PROVABLY-FAIR TOKEN GACHA</div>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {live && (
            <div style={{ ...pill, gap: 8, cursor: "default" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#7CFFB2", boxShadow: "0 0 8px #7CFFB2", animation: "fadepulse 1.4s infinite" }} />
              <span style={{ color: "rgba(255,255,255,0.55)" }}>pool {live.poolSize} · {live.totalRolls} rolls</span>
            </div>
          )}
          <button onClick={onHistory} style={pill}>
            <span style={{ color: "rgba(255,255,255,0.55)" }}>⊞ Collection</span>
          </button>
          <div style={{ ...pill, gap: 8, cursor: "default" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: approved ? "#7CFFB2" : "#ff8aa6", boxShadow: `0 0 8px ${approved ? "#7CFFB2" : "#ff8aa6"}` }} />
            <span style={{ color: "#fff", fontWeight: 700 }}>9xQp…4z7k</span>
            <span style={{ color: "rgba(255,255,255,0.4)" }}>2.84 ◎</span>
          </div>
        </div>
      </div>

      {/* HERO BANNER */}
      <div style={{
        position: "relative", borderRadius: 22, overflow: "hidden", marginBottom: 18,
        background: RARITIES.legendary.bg, border: "1px solid rgba(255,203,69,0.25)",
        boxShadow: "0 0 50px rgba(255,203,69,0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}>
        <SparkleRain accent="#ffcb45" count={22} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 24, padding: "30px 34px", flexWrap: "wrap" }}>
          <RarityCoin token={featured} rarity="legendary" size={150} spin />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px", borderRadius: 999, background: "rgba(255,203,69,0.14)", border: "1px solid rgba(255,203,69,0.35)", marginBottom: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffcb45", animation: "fadepulse 1.2s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.2em", color: "#ffcb45", fontFamily: "var(--mono)" }}>RATE-UP BANNER · LIVE</span>
            </div>
            <h1 style={{ fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 900, lineHeight: 1.05, color: "#fff", margin: "0 0 8px", letterSpacing: "-0.02em" }}>
              The Switcheroo
            </h1>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, margin: "0 0 4px", maxWidth: 480 }}>
              Delegate your bags, pay a roll fee, get swapped with a random stranger&apos;s. <strong style={{ color: "#ffcb45" }}>0.86× to 10,000×.</strong> Provably fair on Solana slot hashes.
            </p>
            <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "#7CFFB2", marginTop: 6 }}>
              100% gacha · no house edge — the edge pays it forward
            </div>
          </div>
        </div>
      </div>

      {/* stat strip: EARLY ROLLER DIVIDENDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 18 }}>
        <StatCard label="$EARLY MINED" value={fmtPts(earlyBank)} accent="#ffcb45" sub={`next wish mints +${fmtPts(nextMint)}`} />
        <StatCard label="DIVIDENDS EARNED" value={fmtUsd(divBank)} accent="#7CFFB2" sub="paid by rollers after you" />
        <StatCard label="YOUR EARLINESS" value={earliness.toFixed(1) + "%"} accent="#b06bff" sub={`roll #${rollIndex.toLocaleString("en-US")} · earlier = exponentially more`} />
      </div>

      {/* main play card */}
      <div style={{ borderRadius: 20, padding: 24, marginBottom: 18, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}>
        {/* stake / approval row */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)", letterSpacing: "0.14em", marginBottom: 6 }}>POOL STAKE — ONE-SWOOP APPROVAL</div>
            {approved ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: "#fff", fontFamily: "var(--mono)" }}>{fmtUsd(sweptUsd)}</span>
                <span style={{ fontSize: 12, color: "#7CFFB2", fontFamily: "var(--mono)" }}>✓ {sweepByThreshold(threshold).length} tokens delegated (&lt;{fmtUsd(threshold)})</span>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>Not delegated yet — sweep your sub-threshold bags in one signature.</div>
            )}
          </div>
          <button onClick={onApprove} style={{
            padding: "11px 18px", borderRadius: 11, cursor: "pointer",
            background: approved ? "rgba(255,255,255,0.06)" : "linear-gradient(90deg,#b06bff,#7a32d6)",
            border: approved ? "1px solid rgba(255,255,255,0.16)" : "none",
            color: "#fff", fontWeight: 700, fontSize: 13,
            boxShadow: approved ? "none" : "0 6px 20px rgba(176,107,255,0.35)",
          }}>{approved ? "Edit sweep" : "Approve & sweep"}</button>
        </div>

        {/* pity */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7, fontSize: 12, fontFamily: "var(--mono)" }}>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>PITY · guaranteed SSR in {pityLeft}</span>
            <span style={{ color: pity >= PITY_SOFT ? "#ffcb45" : "rgba(255,255,255,0.6)" }}>{pity} / {PITY_HARD} {pity >= PITY_SOFT ? "· SOFT PITY 🔥" : ""}</span>
          </div>
          <div style={{ height: 8, borderRadius: 5, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{
              width: pityPct + "%", height: "100%", borderRadius: 5,
              background: pity >= PITY_SOFT ? "linear-gradient(90deg,#ffcb45,#ff8a3d)" : "linear-gradient(90deg,#b06bff,#7a32d6)",
              boxShadow: "0 0 12px rgba(255,203,69,0.5)", transition: "width .4s",
            }} />
          </div>
        </div>

        {/* odds */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)", letterSpacing: "0.14em", marginBottom: 10 }}>BANNER ODDS (RATE-UP APPLIED)</div>
          <OddsBar />
        </div>

        {/* roll buttons */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <button onClick={() => onRoll(1)} style={{
            flex: 1, minWidth: 160, padding: "18px", borderRadius: 14, cursor: "pointer",
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.16)", color: "#fff",
          }}>
            <div style={{ fontSize: 19, fontWeight: 900 }}>Wish ×1</div>
            <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.5)", marginTop: 3 }}>{rollFee} ◎ roll fee</div>
          </button>
          <button onClick={() => onRoll(10)} style={{
            flex: 1.4, minWidth: 200, padding: "18px", borderRadius: 14, cursor: "pointer", border: "none", position: "relative", overflow: "hidden",
            background: "linear-gradient(90deg,#b06bff,#7a32d6)", color: "#fff",
            boxShadow: "0 10px 34px rgba(176,107,255,0.45)",
          }}>
            <div style={{ position: "absolute", top: 8, right: 12, fontSize: 10, fontFamily: "var(--mono)", fontWeight: 800, color: "#ffe9a8", letterSpacing: "0.1em" }}>1 GUARANTEED 4★+</div>
            <div style={{ fontSize: 19, fontWeight: 900 }}>Wish ×10</div>
            <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.8)", marginTop: 3 }}>{+(rollFee * 10).toFixed(4)} ◎ roll fee</div>
          </button>
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "var(--mono)", lineHeight: 1.6 }}>
        100% custodial. The matchmaker holds delegate + close authority on every swept ATA. That&apos;s the whole trick.<br />
        Rent (~{live?.rentPerSwapSol ?? 0.00408} ◎/swap) is the only skim. Everything else is zero-sum degeneracy.
      </div>
    </div>
  );
}

export function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub: string; accent: string;
}) {
  return (
    <div style={{ borderRadius: 14, padding: "15px 17px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)", letterSpacing: "0.14em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: accent, fontFamily: "var(--mono)", textShadow: `0 0 18px ${accent}66`, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>{sub}</div>
    </div>
  );
}

const pill: CSSProperties = {
  display: "flex", alignItems: "center", padding: "8px 13px", borderRadius: 999,
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
  fontFamily: "var(--mono)", fontSize: 12, cursor: "pointer",
};
