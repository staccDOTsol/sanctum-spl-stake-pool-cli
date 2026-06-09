"use client";

// The "one fell swoop" delegation: a single approval that sweeps every token
// you own below a value threshold X into the pool.

import { HOLDINGS, sweepByThreshold, fmtUsd } from "@/lib/gacha/data";

export function ApprovalSheet({ threshold, setThreshold, approved, onApprove, onClose }: {
  threshold: number;
  setThreshold: (n: number) => void;
  approved: boolean;
  onApprove: () => void;
  onClose: () => void;
}) {
  const swept = sweepByThreshold(threshold);
  const sweptUsd = swept.reduce((s, h) => s + h.usd, 0);

  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(4,2,12,0.82)", backdropFilter: "blur(8px)", padding: 20, animation: "fadein .2s ease",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(520px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column",
        borderRadius: 20, overflow: "hidden",
        background: "linear-gradient(180deg, #14121f, #0b0a14)",
        border: "1px solid rgba(176,107,255,0.25)", boxShadow: "0 30px 90px rgba(0,0,0,0.6), 0 0 50px rgba(176,107,255,0.15)",
      }}>
        {/* header */}
        <div style={{ padding: "20px 24px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>⇄</span>
            <div style={{ fontWeight: 800, color: "#fff", fontSize: 18 }}>One-Swoop Approval</div>
            <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}>×</button>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
            One signature delegates <strong style={{ color: "#fff" }}>every token under your threshold</strong> into the pool. Each is fair game for the switcheroo. Above it stays untouched.
          </div>
        </div>

        {/* threshold slider */}
        <div style={{ padding: "4px 24px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: "var(--mono)", letterSpacing: "0.1em" }}>SWEEP EVERYTHING UNDER</span>
            <span style={{ fontFamily: "var(--mono)", fontWeight: 800, fontSize: 22, color: "#b06bff" }}>{fmtUsd(threshold)}</span>
          </div>
          <input type="range" min={20} max={3000} step={10} value={threshold}
            onChange={e => setThreshold(+e.target.value)}
            style={{ width: "100%", accentColor: "#b06bff", cursor: "pointer" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
            <span>$20</span><span>$3,000</span>
          </div>
        </div>

        {/* holdings list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 8px" }}>
          {HOLDINGS.map(h => {
            const inSweep = h.usd < threshold;
            return (
              <div key={h.tk} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "9px 10px", borderRadius: 10,
                opacity: inSweep ? 1 : 0.32, transition: "opacity .15s",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: "50%", flex: "none",
                  background: `radial-gradient(circle at 38% 30%, ${h.c}, ${h.c}55)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: h.mono.length > 1 ? 13 : 14, fontWeight: 800, color: "#fff",
                }}>{h.mono}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>${h.tk}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)" }}>{h.amt}</div>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: inSweep ? "#fff" : "rgba(255,255,255,0.5)" }}>{fmtUsd(h.usd)}</div>
                <div style={{
                  width: 64, textAlign: "right", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
                  color: inSweep ? "#b06bff" : "rgba(255,255,255,0.3)",
                }}>
                  {inSweep ? "IN POOL" : "SAFE"}
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div style={{ padding: "14px 24px 20px", borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(176,107,255,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, fontFamily: "var(--mono)", fontSize: 13 }}>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{swept.length} tokens · sweeping</span>
            <span style={{ color: "#b06bff", fontWeight: 800 }}>{fmtUsd(sweptUsd)} into the pool</span>
          </div>
          <button onClick={onApprove} style={{
            width: "100%", padding: "14px", borderRadius: 12, border: "none", cursor: "pointer",
            background: approved ? "rgba(124,255,178,0.15)" : "linear-gradient(90deg, #b06bff, #7a32d6)",
            color: approved ? "#7CFFB2" : "#fff", fontWeight: 800, fontSize: 15,
            boxShadow: approved ? "none" : "0 8px 30px rgba(176,107,255,0.4)",
          }}>
            {approved ? "✓ DELEGATED — POOL ARMED" : `APPROVE & SWEEP ${swept.length} TOKENS`}
          </button>
          <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center", lineHeight: 1.5 }}>
            100% custodial. The matchmaker holds delegate + close authority. That&apos;s the bit. No house edge — the edge pays it forward.
          </div>
        </div>
      </div>
    </div>
  );
}
