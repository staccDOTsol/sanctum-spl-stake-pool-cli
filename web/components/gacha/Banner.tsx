"use client";

// Gacha banner / home — real wallet state and live matchmaker data.

import type { CSSProperties } from "react";
import {
  POOL, RARITIES, PITY_HARD, PITY_SOFT, Theme, LiveStats, ticketsForStreak, fmtSol,
} from "@/lib/gacha/data";
import { RarityCoin, SparkleRain } from "./Fx";

export interface PointsInfo {
  rollNumber: number;
  totalRollers: number;
  cumulativePoints: number;
  totalEarnedSol: number;
  pendingSol: number;
}

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

export function Banner({
  connected, address, solBalance, holdingsCount, delegatedCount, delegatedUsd,
  pity, streak, jackpotSol, live, points, busyRoll,
  onConnect, onApprove, onRoll, onHistory,
}: {
  theme?: Theme;
  connected: boolean;
  address: string | null;
  solBalance: number;
  holdingsCount: number;
  delegatedCount: number;
  delegatedUsd: number | null;
  pity: number;
  streak: number;
  jackpotSol: number;
  live: LiveStats | null;
  points: PointsInfo | null;
  busyRoll: string | null;
  onConnect: () => void;
  onApprove: () => void;
  onRoll: (count: number) => void;
  onHistory: () => void;
}) {
  const featured = POOL.legendary[0];
  const pityLeft = PITY_HARD - pity;
  const pityPct = Math.min(100, (pity / PITY_HARD) * 100);
  const rollFee = live?.minRollFeeSol ?? 0.003;
  const tickets = ticketsForStreak(streak);
  const jackpotOdds = live?.jackpotOddsPerTicket || 1000;
  const canRoll = connected && delegatedCount > 0 && !busyRoll;
  const short = address ? address.slice(0, 4) + "…" + address.slice(-4) : "";

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 22px 50px" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 26, flexWrap: "wrap" }}>
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
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: (live.poolOwners ?? 0) >= 2 ? "#7CFFB2" : "#ffcb45", boxShadow: `0 0 8px ${(live.poolOwners ?? 0) >= 2 ? "#7CFFB2" : "#ffcb45"}`, animation: "fadepulse 1.4s infinite" }} />
              <span style={{ color: "rgba(255,255,255,0.55)" }}>{live.poolOwners ?? 0} players · {live.poolSize} tokens · {live.totalSwaps} swaps</span>
            </div>
          )}
          {connected && <button onClick={onHistory} style={pill}><span style={{ color: "rgba(255,255,255,0.55)" }}>⊞ Collection</span></button>}
          {connected ? (
            <div style={{ ...pill, gap: 8, cursor: "default" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: delegatedCount > 0 ? "#7CFFB2" : "#ff8aa6", boxShadow: `0 0 8px ${delegatedCount > 0 ? "#7CFFB2" : "#ff8aa6"}` }} />
              <span style={{ color: "#fff", fontWeight: 700 }}>{short}</span>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>{solBalance.toFixed(3)} ◎</span>
            </div>
          ) : (
            <button onClick={onConnect} style={{ ...pill, background: "linear-gradient(90deg,#b06bff,#7a32d6)", border: "none", color: "#fff", fontWeight: 800 }}>
              Connect wallet
            </button>
          )}
        </div>
      </div>

      {/* HERO */}
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
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.2em", color: "#ffcb45", fontFamily: "var(--mono)" }}>MAINNET · LIVE</span>
            </div>
            <h1 style={{ fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 900, lineHeight: 1.05, color: "#fff", margin: "0 0 8px", letterSpacing: "-0.02em" }}>
              The Switcheroo
            </h1>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, margin: "0 0 4px", maxWidth: 480 }}>
              Delegate your real bags, pay a roll fee, get swapped with a random stranger&apos;s. <strong style={{ color: "#ffcb45" }}>0.86× to 10,000×.</strong> Provably fair on Solana slot hashes.
            </p>
            <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "#7CFFB2", marginTop: 6 }}>
              100% gacha · no house edge — the edge pays it forward
            </div>
          </div>
        </div>
      </div>

      {/* JACKPOT + PARLAY */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 18, marginBottom: 12,
        padding: "18px 22px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
        background: "radial-gradient(120% 140% at 0% 0%, rgba(255,203,69,0.16), rgba(255,255,255,0.03))",
        border: "1px solid rgba(255,203,69,0.3)", boxShadow: "0 0 40px rgba(255,203,69,0.1)",
      }}>
        <SparkleRain accent="#ffcb45" count={14} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>🎰</span>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.2em", color: "#ffcb45", fontFamily: "var(--mono)" }}>PROGRESSIVE JACKPOT</span>
          </div>
          <div style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 900, color: "#ffe27d", fontFamily: "var(--mono)", textShadow: "0 0 28px rgba(255,203,69,0.5)", lineHeight: 1.1, marginTop: 4 }}>
            {fmtSol(jackpotSol)}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "var(--mono)", marginTop: 2 }}>
            paid to one roller · 1-in-{jackpotOdds.toLocaleString("en-US")} per ticket · provably fair
          </div>
        </div>
        <div style={{ position: "relative", marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)", letterSpacing: "0.14em" }}>WIN STREAK · PARLAY</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: streak > 0 ? "#7CFFB2" : "rgba(255,255,255,0.5)", fontFamily: "var(--mono)", lineHeight: 1.2 }}>
            {streak > 0 ? `${streak}🔥` : "—"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "var(--mono)" }}>
            next wish draws <span style={{ color: "#ffcb45", fontWeight: 700 }}>{tickets}🎟</span>
          </div>
        </div>
      </div>

      {/* stat strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 18 }}>
        <StatCard label="YOUR ROLLS" value={points ? `#${points.rollNumber}` : "—"} accent="#b06bff" sub={points ? `of ${points.totalRollers.toLocaleString("en-US")} rollers · earlier earns more` : "roll to join the dividend ledger"} />
        <StatCard label="DIVIDENDS EARNED" value={points ? fmtSol(points.totalEarnedSol) : "0 ◎"} accent="#7CFFB2" sub={points && points.pendingSol > 0 ? `${fmtSol(points.pendingSol)} pending` : "paid by rollers after you"} />
        <StatCard label="DIVIDEND POINTS" value={points ? points.cumulativePoints.toLocaleString("en-US") : "0"} accent="#ffcb45" sub="exponential weight by join order" />
      </div>

      {/* main play card */}
      <div style={{ borderRadius: 20, padding: 24, marginBottom: 18, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)", letterSpacing: "0.14em", marginBottom: 6 }}>POOL STAKE — ONE-SWOOP APPROVAL</div>
            {!connected ? (
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>Connect a wallet to delegate your real bags.</div>
            ) : delegatedCount > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: "#fff", fontFamily: "var(--mono)" }}>{delegatedUsd !== null ? fmtUsd(delegatedUsd) : `${delegatedCount} tokens`}</span>
                <span style={{ fontSize: 12, color: "#7CFFB2", fontFamily: "var(--mono)" }}>✓ {delegatedCount} delegated · armed</span>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>{holdingsCount} tokens in wallet — none delegated yet.</div>
            )}
          </div>
          <button onClick={connected ? onApprove : onConnect} style={{
            padding: "11px 18px", borderRadius: 11, cursor: "pointer",
            background: delegatedCount > 0 ? "rgba(255,255,255,0.06)" : "linear-gradient(90deg,#b06bff,#7a32d6)",
            border: delegatedCount > 0 ? "1px solid rgba(255,255,255,0.16)" : "none",
            color: "#fff", fontWeight: 700, fontSize: 13,
            boxShadow: delegatedCount > 0 ? "none" : "0 6px 20px rgba(176,107,255,0.35)",
          }}>{!connected ? "Connect wallet" : delegatedCount > 0 ? "Edit / add tokens" : "Approve & sweep"}</button>
        </div>

        {/* pity */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7, fontSize: 12, fontFamily: "var(--mono)" }}>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>PITY · up-only guaranteed in {pityLeft}</span>
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
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)", letterSpacing: "0.14em", marginBottom: 10 }}>RARITY BANDS (BY USD SWING)</div>
          <OddsBar />
        </div>

        {/* roll buttons */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <button onClick={() => onRoll(1)} disabled={!canRoll} style={{
            flex: 1, minWidth: 160, padding: "18px", borderRadius: 14, cursor: canRoll ? "pointer" : "default",
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.16)", color: "#fff", opacity: canRoll ? 1 : 0.5,
          }}>
            <div style={{ fontSize: 19, fontWeight: 900 }}>{busyRoll || "Wish ×1"}</div>
            <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.5)", marginTop: 3 }}>{rollFee} ◎ roll fee</div>
          </button>
          <button onClick={() => onRoll(10)} disabled={!canRoll} style={{
            flex: 1.4, minWidth: 200, padding: "18px", borderRadius: 14, cursor: canRoll ? "pointer" : "default", border: "none", position: "relative", overflow: "hidden",
            background: "linear-gradient(90deg,#b06bff,#7a32d6)", color: "#fff", opacity: canRoll ? 1 : 0.5,
            boxShadow: "0 10px 34px rgba(176,107,255,0.45)",
          }}>
            <div style={{ position: "absolute", top: 8, right: 12, fontSize: 10, fontFamily: "var(--mono)", fontWeight: 800, color: "#ffe9a8", letterSpacing: "0.1em" }}>10 SWAPS · 10🎟</div>
            <div style={{ fontSize: 19, fontWeight: 900 }}>{busyRoll || "Wish ×10"}</div>
            <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.8)", marginTop: 3 }}>{+(rollFee * 10).toFixed(4)} ◎ roll fee</div>
          </button>
        </div>
        {connected && (
          <div style={{ marginTop: 12, fontSize: 12, fontFamily: "var(--mono)", textAlign: "center", color: "rgba(255,255,255,0.45)" }}>
            Pool: <span style={{ color: (live?.poolOwners ?? 0) >= 2 ? "#7CFFB2" : "#ffcb45", fontWeight: 700 }}>{live?.poolOwners ?? 0} players</span> · {live?.poolSize ?? 0} tokens · you: <span style={{ color: delegatedCount > 0 ? "#7CFFB2" : "rgba(255,255,255,0.6)", fontWeight: 700 }}>{delegatedCount} delegated</span>
            {delegatedCount === 0 && <><br />Delegate at least one token before you can wish.</>}
            {delegatedCount > 0 && (live?.poolOwners ?? 0) < 2 && <><br />Pool needs a 2nd delegated wallet before a swap can resolve.</>}
          </div>
        )}
      </div>

      <div style={{
        textAlign: "center", margin: "0 auto 14px", maxWidth: 560, padding: "8px 16px", borderRadius: 999,
        background: "rgba(124,255,178,0.07)", border: "1px solid rgba(124,255,178,0.2)",
        fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#7CFFB2",
      }}>
        This site will never have a meme coin.
      </div>

      <div style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "var(--mono)", lineHeight: 1.6 }}>
        100% custodial while pooled. The matchmaker holds delegate + close authority on every delegated ATA. That&apos;s the whole trick.<br />
        Rent (~{live?.rentPerSwapSol ?? 0.00408} ◎/swap) is the only skim. Everything else is zero-sum degeneracy.
      </div>
    </div>
  );
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 10_000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toLocaleString("en-US");
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
