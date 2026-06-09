"use client";

// Shareable PnL cards for the switcheroo — three modes:
//   single  : one wish (token in → token out, multiplier, rarity, receipt)
//   batch   : a 10× wish (grid + aggregate PnL)
//   overall : career PnL across every wish this wallet initiated
// Rendered branded + fixed-width so they screenshot cleanly; with Tweet + PNG.

import { useEffect, useRef, useState } from "react";
import { toPng, toBlob } from "html-to-image";
import { RARITIES, Pull, PnlStats, fmtUsd, fmtMult } from "@/lib/gacha/data";
import { RarityCoin, Stars } from "./Fx";

export type PnlMode =
  | { kind: "single"; pull: Pull }
  | { kind: "batch"; pulls: Pull[]; stats: PnlStats }
  | { kind: "overall"; stats: PnlStats; address: string };
type Mode = PnlMode;

function pctStr(p: number) { return (p >= 0 ? "+" : "") + p.toFixed(p >= 100 || p <= -100 ? 0 : 1) + "%"; }
const GREEN = "#7CFFB2", RED = "#ff6b6b";

export function PnlCardModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const fileRef = useRef<File | null>(null);

  const tweetText = buildTweet(mode);
  const tweetHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent("https://switcheroo.lol")}`;

  const opts = { pixelRatio: 2, cacheBust: true, backgroundColor: "#06040f" } as const;

  // Pre-render the PNG once the card has painted so the Share tap stays a valid
  // user gesture on iOS (which forbids async work before navigator.share).
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        if (!cardRef.current) return;
        const blob = await toBlob(cardRef.current, opts);
        if (blob) fileRef.current = new File([blob], "switcheroo-pnl.png", { type: "image/png" });
      } catch { /* ignore */ }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePng = async () => {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      const url = await toPng(cardRef.current, opts);
      const a = document.createElement("a");
      a.href = url; a.download = "switcheroo-pnl.png"; a.click();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  // Share the actual PNG (attaches the image in the X app on mobile via the
  // native share sheet — tweet-intent URLs can't carry media). Desktop falls
  // back to downloading the PNG + opening the X composer.
  const share = async () => {
    setSharing(true);
    try {
      let file = fileRef.current;
      if (!file && cardRef.current) {
        const blob = await toBlob(cardRef.current, opts);
        if (blob) file = new File([blob], "switcheroo-pnl.png", { type: "image/png" });
      }
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (file && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], text: tweetText } as ShareData);
        return;
      }
      if (file) {
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url; a.download = "switcheroo-pnl.png"; a.click();
        URL.revokeObjectURL(url);
      }
      window.open(tweetHref, "_blank", "noopener");
    } catch { /* user cancelled share */ } finally { setSharing(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 62, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 16, padding: 18,
      background: "rgba(4,2,12,0.85)", backdropFilter: "blur(8px)", animation: "fadein .2s ease", overflowY: "auto",
    }}>
      <div onClick={e => e.stopPropagation()} ref={cardRef} style={{
        width: 380, maxWidth: "100%", borderRadius: 20, overflow: "hidden", position: "relative",
        background: "radial-gradient(120% 90% at 50% 0%, rgba(176,107,255,0.18), #0b0917 60%, #06040f)",
        border: "1px solid rgba(176,107,255,0.3)", boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
        fontFamily: "var(--gacha-sans)",
      }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 18px 0" }}>
          <span style={{ fontSize: 18 }}>⇄</span>
          <span style={{ fontWeight: 900, letterSpacing: "0.04em", color: "#fff", fontSize: 15 }}>SWITCHEROO</span>
          <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.4)", letterSpacing: "0.16em" }}>PROVABLY-FAIR · NO HOUSE</span>
        </div>

        {mode.kind === "single" && <SingleBody pull={mode.pull} />}
        {mode.kind === "batch" && <BatchBody pulls={mode.pulls} stats={mode.stats} />}
        {mode.kind === "overall" && <OverallBody stats={mode.stats} address={mode.address} />}

        {/* footer watermark */}
        <div style={{ padding: "12px 18px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#b8a6ff", fontWeight: 700 }}>switcheroo.lol</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "rgba(255,255,255,0.35)" }}>the edge pays it forward</span>
        </div>
      </div>

      {/* actions (not captured in the PNG) */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={share} style={btn("#1d9bf0")}>{sharing ? "Sharing…" : "📤 Share to X (with image)"}</button>
        <button onClick={savePng} style={btn("#b06bff")}>{saving ? "Saving…" : "⬇ Save PNG"}</button>
        <button onClick={onClose} style={btn("rgba(255,255,255,0.1)", true)}>Close</button>
      </div>
    </div>
  );
}

function SingleBody({ pull }: { pull: Pull }) {
  const R = RARITIES[pull.rarity];
  const up = pull.mult >= 1;
  return (
    <div style={{ padding: "14px 18px 8px", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <RarityCoin token={pull.token} rarity={pull.rarity} size={120} />
      </div>
      <Stars rarity={pull.rarity} size={16} />
      <div style={{ marginTop: 6, fontSize: 11, letterSpacing: "0.3em", fontWeight: 800, color: R.accent, fontFamily: "var(--mono)" }}>{R.label}</div>
      <div style={{ marginTop: 10, fontSize: 52, fontWeight: 900, lineHeight: 1, fontFamily: "var(--mono)", color: up ? R.accent : RED, textShadow: `0 0 30px ${up ? R.glow : "rgba(255,107,107,0.5)"}` }}>
        {fmtMult(pull.mult)}
      </div>
      <div style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 15, color: "rgba(255,255,255,0.6)" }}>
        {fmtUsd(pull.fromUsd)} <span style={{ color: R.accent }}>→</span> <span style={{ color: up ? GREEN : RED, fontWeight: 800 }}>{fmtUsd(pull.toUsd)}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 13, color: up ? GREEN : RED, fontWeight: 700 }}>
        {pctStr(pull.fromUsd > 0 ? (pull.toUsd - pull.fromUsd) / pull.fromUsd * 100 : 0)} · won ${pull.token.tk}
      </div>
      <div style={{ marginTop: 10, fontFamily: "var(--mono)", fontSize: 9, color: "rgba(255,255,255,0.3)", wordBreak: "break-all" }}>
        slot {pull.requestSlot.toLocaleString("en-US")} · hash {pull.slotHash.slice(0, 16)}…
      </div>
    </div>
  );
}

function BatchBody({ pulls, stats }: { pulls: Pull[]; stats: PnlStats }) {
  const up = stats.netUsd >= 0;
  return (
    <div style={{ padding: "12px 18px 6px" }}>
      <div style={{ textAlign: "center", fontSize: 11, letterSpacing: "0.3em", color: "#b8a6ff", fontFamily: "var(--mono)", fontWeight: 700 }}>{pulls.length}× WISH</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, margin: "12px 0" }}>
        {pulls.map(p => {
          const R = RARITIES[p.rarity];
          return (
            <div key={p.id} style={{ borderRadius: 8, padding: "8px 2px", background: R.bg, border: `1px solid ${R.accent}44`, textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center" }}><RarityCoin token={p.token} rarity={p.rarity} size={38} /></div>
              <div style={{ marginTop: 4, fontFamily: "var(--mono)", fontWeight: 800, fontSize: 11, color: p.mult >= 1 ? R.accent : RED }}>{fmtMult(p.mult)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, fontFamily: "var(--mono)", color: up ? GREEN : RED }}>{pctStr(stats.pct)}</div>
        <div style={{ marginTop: 6, fontFamily: "var(--mono)", fontSize: 14, color: "rgba(255,255,255,0.6)" }}>
          {fmtUsd(stats.fromUsd)} → <span style={{ color: up ? GREEN : RED, fontWeight: 800 }}>{fmtUsd(stats.toUsd)}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "var(--mono)" }}>
          {stats.wins}/{stats.count} up · best {fmtMult(stats.bestMult)}
        </div>
      </div>
    </div>
  );
}

function OverallBody({ stats, address }: { stats: PnlStats; address: string }) {
  const up = stats.netUsd >= 0;
  const short = address.slice(0, 4) + "…" + address.slice(-4);
  return (
    <div style={{ padding: "14px 18px 8px", textAlign: "center" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#b8a6ff", fontFamily: "var(--mono)", fontWeight: 700 }}>CAREER PnL · {short}</div>
      <div style={{ marginTop: 14, fontSize: 56, fontWeight: 900, lineHeight: 1, fontFamily: "var(--mono)", color: up ? GREEN : RED, textShadow: `0 0 34px ${up ? "rgba(124,255,178,0.5)" : "rgba(255,107,107,0.5)"}` }}>
        {pctStr(stats.pct)}
      </div>
      <div style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 16, color: up ? GREEN : RED, fontWeight: 800 }}>
        {up ? "+" : "−"}{fmtUsd(Math.abs(Math.round(stats.netUsd)))}
      </div>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap", fontFamily: "var(--mono)" }}>
        <Stat label="SWITCHES" value={String(stats.count)} />
        <Stat label="WIN RATE" value={stats.winRate.toFixed(0) + "%"} />
        <Stat label="BEST" value={fmtMult(stats.bestMult)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.14em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>{value}</div>
    </div>
  );
}

function buildTweet(mode: Mode): string {
  if (mode.kind === "single") {
    const p = mode.pull;
    return `I just switcheroo'd ${fmtUsd(p.fromUsd)} → ${fmtUsd(p.toUsd)} (${fmtMult(p.mult)}, ${RARITIES[p.rarity].label}) ⇄ provably fair, no house edge.`;
  }
  if (mode.kind === "batch") {
    return `My 10× SWITCHEROO: ${pctStr(mode.stats.pct)} (${mode.stats.wins}/${mode.stats.count} up, best ${fmtMult(mode.stats.bestMult)}) ⇄`;
  }
  return `My SWITCHEROO career: ${pctStr(mode.stats.pct)} over ${mode.stats.count} switches, ${mode.stats.winRate.toFixed(0)}% win rate ⇄`;
}

function btn(bg: string, ghost = false): React.CSSProperties {
  return {
    padding: "11px 20px", borderRadius: 11, cursor: "pointer", border: ghost ? "1px solid rgba(255,255,255,0.18)" : "none",
    background: bg, color: ghost ? "rgba(255,255,255,0.8)" : "#fff", fontWeight: 800, fontSize: 14,
    fontFamily: "inherit", textDecoration: "none", display: "inline-block",
  };
}
