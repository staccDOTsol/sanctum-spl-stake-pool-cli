/**
 * Server-side OG image for a switcheroo — renders a 1200×630 PnL card PNG so a
 * shared link (switcheroo.lol/c/<sig>) unfurls into the card in the timeline.
 * Uses @napi-rs/canvas (no browser; musl-compatible). Guarded so a render
 * failure can never take down the rest of the crank.
 */
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { resolve } from "path";
import type { SwapRecord, Rarity } from "./history.js";

const ASSETS = resolve(process.env.ASSETS_DIR ?? "./assets");
let fontsReady = false;
function ensureFonts(): void {
  if (fontsReady) return;
  try {
    GlobalFonts.registerFromPath(`${ASSETS}/JetBrainsMono-Bold.ttf`, "JBM-Bold");
    GlobalFonts.registerFromPath(`${ASSETS}/JetBrainsMono-Regular.ttf`, "JBM");
    fontsReady = true;
  } catch (e) {
    console.warn("[og] font load failed:", (e as Error).message);
  }
}

const ACCENT: Record<Rarity, string> = {
  common: "#8aa0c4", rare: "#3fd6e0", epic: "#b06bff", legendary: "#ffcb45", jackpot: "#ff8ae6",
};
const LABEL: Record<Rarity, string> = {
  common: "COMMON", rare: "RARE", epic: "EPIC", legendary: "LEGENDARY", jackpot: "SWITCHEROO",
};

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 10_000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtMult(m: number): string {
  if (m >= 1000) return Math.round(m).toLocaleString("en-US") + "×";
  if (m >= 100) return m.toFixed(0) + "×";
  if (m >= 10) return m.toFixed(1) + "×";
  return m.toFixed(2) + "×";
}

export function renderCardPng(rec: SwapRecord): Buffer {
  ensureFonts();
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const c = canvas.getContext("2d");

  const mult = rec.multiplier ?? 1;
  const up = mult >= 1;
  const from = rec.requesterUsd ?? 0;
  const to = rec.counterpartyUsd ?? 0;
  const pct = from > 0 ? ((to - from) / from) * 100 : 0;
  const rarity = (rec.rarity ?? "common") as Rarity;
  const accent = ACCENT[rarity];
  const win = up ? "#7CFFB2" : "#ff6b6b";

  // background
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#100b22"); g.addColorStop(1, "#06040f");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // accent glow top
  const rg = c.createRadialGradient(W / 2, -40, 60, W / 2, -40, 700);
  rg.addColorStop(0, accent + "33"); rg.addColorStop(1, "transparent");
  c.fillStyle = rg; c.fillRect(0, 0, W, H);
  // border
  c.strokeStyle = accent + "55"; c.lineWidth = 3; c.strokeRect(12, 12, W - 24, H - 24);

  // header
  c.textBaseline = "alphabetic";
  c.fillStyle = "#ffffff"; c.font = "44px JBM-Bold";
  c.fillText("SWITCHEROO", 56, 92);
  c.fillStyle = "rgba(255,255,255,0.45)"; c.font = "20px JBM";
  c.fillText("PROVABLY-FAIR TOKEN GACHA", 58, 124);

  // rarity label
  c.fillStyle = accent; c.font = "30px JBM-Bold";
  c.textAlign = "center";
  c.fillText(LABEL[rarity], W / 2, 250);

  // big multiplier
  c.fillStyle = win; c.font = "170px JBM-Bold";
  c.fillText(fmtMult(mult), W / 2, 410);

  // usd swing
  c.fillStyle = "rgba(255,255,255,0.7)"; c.font = "44px JBM";
  c.fillText(`${fmtUsd(from)}  →  ${fmtUsd(to)}`, W / 2, 478);

  // pct
  c.fillStyle = win; c.font = "32px JBM-Bold";
  c.fillText(`${pct >= 0 ? "+" : ""}${pct.toFixed(pct >= 100 || pct <= -100 ? 0 : 1)}%`, W / 2, 524);

  // footer
  c.textAlign = "left";
  c.fillStyle = "#b8a6ff"; c.font = "24px JBM-Bold";
  c.fillText("switcheroo.lol", 56, H - 48);
  c.textAlign = "right";
  c.fillStyle = "rgba(255,255,255,0.4)"; c.font = "20px JBM";
  c.fillText("no house edge — the edge pays it forward", W - 56, H - 48);

  c.textAlign = "left";
  c.fillStyle = "rgba(255,255,255,0.3)"; c.font = "16px JBM";
  c.fillText(`slot ${rec.requestSlot} · ${rec.signature.slice(0, 24)}…`, 56, H - 80);

  return canvas.toBuffer("image/png");
}
