"use client";

// 10-pull summary grid, provably-fair receipt, collection log drawer.

import { RARITIES, Pull, fmtMult, fmtUsd, fmtPts } from "@/lib/gacha/data";
import { RarityCoin, Stars } from "./Fx";
import type { ReactNode } from "react";

// ─── 10-pull summary grid ─────────────────────────────────────────────────────
export function SummaryGrid({ pulls, onReceipt }: {
  pulls: Pull[]; onReceipt: (p: Pull) => void;
}) {
  const totalEarly = pulls.reduce((s, p) => s + p.earlyPts, 0);
  const totalDiv = pulls.reduce((s, p) => s + p.dividend, 0);
  return (
    <div style={{ width: "100%", maxWidth: 900 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        {pulls.map((p, i) => {
          const R = RARITIES[p.rarity];
          return (
            <button key={p.id} onClick={() => onReceipt(p)} style={{
              position: "relative", padding: "16px 8px 14px", borderRadius: 14,
              background: R.bg, border: `1px solid ${R.accent}44`,
              boxShadow: `0 0 24px ${R.glow}33, inset 0 1px 0 ${R.accent}22`,
              cursor: "pointer", textAlign: "center",
              animation: `cardflip .5s cubic-bezier(.2,1.2,.4,1) ${i * 0.08}s both`,
              transformStyle: "preserve-3d",
            }}>
              {(p.rarity === "legendary" || p.rarity === "jackpot") && (
                <div style={{
                  position: "absolute", top: 6, right: 8, fontSize: 9, fontWeight: 800,
                  letterSpacing: "0.1em", color: R.accent, fontFamily: "var(--mono)",
                  textShadow: `0 0 10px ${R.glow}`,
                }}>{R.short}</div>
              )}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <RarityCoin token={p.token} rarity={p.rarity} size={84} />
              </div>
              <div style={{ marginTop: 8 }}><Stars rarity={p.rarity} size={11} /></div>
              <div style={{
                marginTop: 6, fontFamily: "var(--mono)", fontWeight: 800, fontSize: 20,
                color: p.isWin ? R.accent : "#ff6b6b",
                textShadow: `0 0 14px ${p.isWin ? R.glow : "rgba(255,107,107,0.5)"}`,
              }}>{fmtMult(p.mult)}</div>
              <div style={{ marginTop: 2, fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)" }}>
                ${p.token.tk}
              </div>
            </button>
          );
        })}
      </div>
      {(totalEarly > 0 || totalDiv > 0) && (
        <div style={{
          marginTop: 18, display: "flex", justifyContent: "center", gap: 26,
          fontFamily: "var(--mono)", fontSize: 13,
        }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>{pulls.length} wishes ·
            <span style={{ color: "#ffcb45", fontWeight: 700 }}> +{fmtPts(totalEarly)} $EARLY</span>
          </span>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>edge paid back ·
            <span style={{ color: "#7CFFB2", fontWeight: 700 }}> +{fmtUsd(totalDiv)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Provably-fair receipt modal ──────────────────────────────────────────────
export function Receipt({ pull, onClose }: { pull: Pull; onClose: () => void }) {
  const R = RARITIES[pull.rarity];
  const row = (k: string, v: ReactNode, mono = true) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>{k}</span>
      <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: mono ? "var(--mono)" : "inherit", textAlign: "right", wordBreak: "break-all" }}>{v}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(4,2,12,0.8)", backdropFilter: "blur(8px)", padding: 20,
      animation: "fadein .2s ease",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(480px, 100%)", borderRadius: 18, overflow: "hidden",
        background: "linear-gradient(180deg, #12101f, #0b0a15)",
        border: `1px solid ${R.accent}33`, boxShadow: `0 30px 80px rgba(0,0,0,0.6), 0 0 40px ${R.glow}22`,
      }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 18 }}>⛓</div>
          <div>
            <div style={{ fontWeight: 800, color: "#fff", fontSize: 15 }}>Provably Fair Receipt</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)" }}>Solana SlotHashes · no house, no edit</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "8px 22px 18px" }}>
          {row("Outcome", <span style={{ color: R.accent, fontWeight: 700 }}>{R.label} · {fmtMult(pull.mult)} · ${pull.token.tk}</span>, false)}
          {row("Request slot", pull.requestSlot.toLocaleString("en-US"))}
          {row("Entropy slot", (pull.requestSlot + 1).toLocaleString("en-US"))}
          {row("Slot hash", pull.slotHash.slice(0, 32) + "…")}
          {row("Requester", "9xQp…" + pull.slotHash.slice(0, 4))}
          {row("seed = sha256(hash ‖ pubkey)", "→ index")}
          {row("Selected index", pull.selectedIndex + " / " + pull.poolSize)}
          {pull.earlyPts > 0 && row("$EARLY minted", <span style={{ color: "#ffcb45", fontWeight: 700 }}>+{fmtPts(pull.earlyPts)}</span>, false)}
          {pull.dividend > 0 && row("Dividend to prior roller", <span style={{ color: "#7CFFB2", fontWeight: 700 }}>{fmtUsd(pull.dividend)}</span>, false)}
        </div>
        <div style={{ padding: "0 22px 20px" }}>
          <div style={{ fontSize: 11, lineHeight: 1.5, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
            The matchmaker can&apos;t know the slot hash at request time, so it can&apos;t predict or cherry-pick your counterparty. Re-derive it yourself ↓
          </div>
          <a href="#" onClick={e => e.preventDefault()} style={{
            display: "block", textAlign: "center", padding: "11px", borderRadius: 10,
            background: R.accent + "1a", border: `1px solid ${R.accent}44`,
            color: R.accent, fontWeight: 700, fontSize: 13, textDecoration: "none", fontFamily: "var(--mono)",
          }}>VERIFY ON SOLSCAN ↗</a>
        </div>
      </div>
    </div>
  );
}

// ─── Pull history drawer ──────────────────────────────────────────────────────
export function HistoryDrawer({ open, history, onClose, onReceipt }: {
  open: boolean; history: Pull[]; onClose: () => void; onReceipt: (p: Pull) => void;
}) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50, pointerEvents: open ? "auto" : "none",
    }}>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0, background: "rgba(4,2,12,0.6)",
        opacity: open ? 1 : 0, transition: "opacity .3s",
      }} />
      <div style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: "min(420px, 88%)",
        background: "linear-gradient(180deg, #100e1c, #0a0912)",
        borderLeft: "1px solid rgba(255,255,255,0.1)",
        transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform .35s cubic-bezier(.3,1,.4,1)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, color: "#fff", fontSize: 16 }}>Collection Log</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono)" }}>{history.length} wishes recorded</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 14px" }}>
          {history.length === 0 && (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13, marginTop: 40, fontFamily: "var(--mono)" }}>
              No wishes yet.<br />The pool is waiting.
            </div>
          )}
          {history.map((p) => {
            const R = RARITIES[p.rarity];
            return (
              <button key={p.id} onClick={() => onReceipt(p)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 10px",
                background: "transparent", border: "none", borderRadius: 10, cursor: "pointer", textAlign: "left",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <RarityCoin token={p.token} rarity={p.rarity} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>${p.token.tk}</div>
                  <div style={{ fontSize: 10, color: R.accent, fontFamily: "var(--mono)", letterSpacing: "0.08em" }}>{R.label}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--mono)", fontWeight: 800, fontSize: 16, color: p.isWin ? R.accent : "#ff6b6b" }}>{fmtMult(p.mult)}</div>
                  <div style={{ fontSize: 10, color: "#ffcb45", fontFamily: "var(--mono)" }}>+{fmtPts(p.earlyPts)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
