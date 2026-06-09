"use client";

// Visual effects: starfield, rarity coin medallion, particle burst,
// sparkle rain, screen shake. Anime-gacha (Genshin/Star Rail "Wish") flavor.

import { useCallback, useEffect, useRef, useState } from "react";
import { RARITIES, RarityKey, GachaToken, shade } from "@/lib/gacha/data";

// ─── Canvas starfield + warp tunnel ──────────────────────────────────────────
export function Starfield({ warp = false, hue = "#b8a6ff", density = 1 }: {
  warp?: boolean; hue?: string; density?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ warp, hue });
  stateRef.current.warp = warp;
  stateRef.current.hue = hue;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0, w = 0, h = 0, cx = 0, cy = 0;
    const N = Math.floor(220 * density);
    const stars: { x: number; y: number; z: number; r: number; tw: number }[] = [];
    function resize() {
      if (!canvas) return;
      w = canvas.width = canvas.offsetWidth * devicePixelRatio;
      h = canvas.height = canvas.offsetHeight * devicePixelRatio;
      cx = w / 2; cy = h / 2;
    }
    resize();
    window.addEventListener("resize", resize);
    for (let i = 0; i < N; i++) {
      stars.push({
        x: Math.random() * w, y: Math.random() * h,
        z: Math.random() * w, r: Math.random() * 1.4 + 0.3,
        tw: Math.random() * Math.PI * 2,
      });
    }
    function frame() {
      if (!ctx) return;
      const warping = stateRef.current.warp;
      ctx.fillStyle = warping ? "rgba(4,2,12,0.35)" : "rgba(6,5,16,0.4)";
      ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        if (warping) {
          s.z -= 22;
          if (s.z < 1) { s.z = w; s.x = Math.random() * w; s.y = Math.random() * h; }
          const k = 128 / s.z;
          const px = (s.x - cx) * k + cx;
          const py = (s.y - cy) * k + cy;
          const k2 = 128 / (s.z + 22);
          const px2 = (s.x - cx) * k2 + cx;
          const py2 = (s.y - cy) * k2 + cy;
          const sz = (1 - s.z / w) * 2.4;
          ctx.strokeStyle = stateRef.current.hue;
          ctx.globalAlpha = Math.min(1, (1 - s.z / w) * 1.2);
          ctx.lineWidth = sz;
          ctx.beginPath(); ctx.moveTo(px2, py2); ctx.lineTo(px, py); ctx.stroke();
        } else {
          s.tw += 0.04;
          ctx.globalAlpha = 0.35 + Math.sin(s.tw) * 0.3;
          ctx.fillStyle = Math.random() > 0.985 ? stateRef.current.hue : "#cdd6f0";
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    frame();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [density]);

  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

// ─── Rarity coin medallion (the "character art" stand-in) ─────────────────────
export function RarityCoin({ token, rarity, size = 200, spin = false }: {
  token: GachaToken; rarity: RarityKey; size?: number; spin?: boolean;
}) {
  const R = RARITIES[rarity];
  const ringGrad = `conic-gradient(from 0deg, ${R.ring.join(", ")}, ${R.ring[0]})`;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      {/* rotating rarity ring */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: ringGrad,
        animation: spin ? "coinspin 8s linear infinite" : "none",
        filter: `drop-shadow(0 0 ${size * 0.12}px ${R.glow})`,
      }} />
      {/* inner coin face */}
      <div style={{
        position: "absolute", inset: size * 0.055, borderRadius: "50%",
        background: `radial-gradient(circle at 38% 30%, ${shade(token.c, 0.35)}, ${shade(token.c, -0.5)})`,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        boxShadow: `inset 0 ${size * 0.03}px ${size * 0.08}px rgba(255,255,255,0.25), inset 0 -${size * 0.04}px ${size * 0.1}px rgba(0,0,0,0.5)`,
        overflow: "hidden",
      }}>
        {/* sheen */}
        <div style={{
          position: "absolute", top: "-30%", left: "-20%", width: "80%", height: "60%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.4), transparent)",
          borderRadius: "50%", filter: "blur(6px)",
        }} />
        <div style={{
          fontSize: size * (token.mono.length > 3 ? 0.16 : 0.42), lineHeight: 1,
          fontWeight: 800, color: "rgba(255,255,255,0.95)",
          textShadow: "0 2px 8px rgba(0,0,0,0.5)",
          fontFamily: token.mono.length > 3 ? "var(--mono)" : "inherit",
        }}>{token.mono}</div>
        <div style={{
          marginTop: size * 0.04, fontSize: size * 0.075, fontWeight: 800, letterSpacing: "0.06em",
          color: "rgba(255,255,255,0.92)", fontFamily: "var(--mono)",
        }}>${token.tk}</div>
      </div>
    </div>
  );
}

// ─── Star rating row ──────────────────────────────────────────────────────────
export function Stars({ rarity, size = 20 }: { rarity: RarityKey; size?: number }) {
  const R = RARITIES[rarity];
  return (
    <div style={{ display: "flex", gap: size * 0.12, justifyContent: "center" }}>
      {Array.from({ length: R.stars }).map((_, i) => (
        <span key={i} style={{
          fontSize: size, color: R.accent, lineHeight: 1,
          textShadow: `0 0 ${size * 0.6}px ${R.glow}`,
        }}>★</span>
      ))}
    </div>
  );
}

// ─── Particle burst on reveal ─────────────────────────────────────────────────
interface BurstPart {
  x: number; y: number; rot: number; delay: number;
  size: number; dur: number; color: string; round: boolean;
}

export function ParticleBurst({ rarity, count, run }: {
  rarity: RarityKey; count: number; run: boolean;
}) {
  const R = RARITIES[rarity];
  const parts = useRef<BurstPart[] | null>(null);
  if (!parts.current) {
    parts.current = Array.from({ length: count }).map(() => {
      const ang = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 320;
      return {
        x: Math.cos(ang) * dist, y: Math.sin(ang) * dist,
        rot: Math.random() * 360, delay: Math.random() * 0.25,
        size: 4 + Math.random() * 8, dur: 0.7 + Math.random() * 0.8,
        color: R.ring[Math.floor(Math.random() * R.ring.length)],
        round: Math.random() > 0.5,
      };
    });
  }
  if (!run) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "50%", top: "48%" }}>
        {parts.current.map((p, i) => (
          <span key={i} style={{
            position: "absolute", width: p.size, height: p.size,
            background: p.color, borderRadius: p.round ? "50%" : "1px",
            boxShadow: `0 0 ${p.size}px ${p.color}`,
            animation: `burst ${p.dur}s cubic-bezier(.15,.7,.3,1) ${p.delay}s forwards`,
            ["--bx" as string]: p.x + "px",
            ["--by" as string]: p.y + "px",
            ["--brot" as string]: p.rot + "deg",
          }} />
        ))}
      </div>
    </div>
  );
}

// ─── Falling sparkle field (ambient on legendary+) ───────────────────────────
interface SparkleItem { left: number; delay: number; dur: number; size: number; op: number }

export function SparkleRain({ accent, count = 30 }: { accent: string; count?: number }) {
  const items = useRef<SparkleItem[] | null>(null);
  if (!items.current) {
    items.current = Array.from({ length: count }).map(() => ({
      left: Math.random() * 100, delay: Math.random() * 4, dur: 3 + Math.random() * 4,
      size: 2 + Math.random() * 4, op: 0.3 + Math.random() * 0.5,
    }));
  }
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {items.current.map((s, i) => (
        <span key={i} style={{
          position: "absolute", top: "-10px", left: s.left + "%",
          width: s.size, height: s.size, borderRadius: "50%",
          background: accent, opacity: s.op, boxShadow: `0 0 6px ${accent}`,
          animation: `sparklefall ${s.dur}s linear ${s.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ─── Screen shake hook ────────────────────────────────────────────────────────
export function useScreenShake(): [number, (intensity?: number) => void] {
  const [shaking, setShaking] = useState(0);
  const shake = useCallback((intensity = 1) => setShaking(intensity), []);
  useEffect(() => {
    if (!shaking) return;
    const t = setTimeout(() => setShaking(0), 600);
    return () => clearTimeout(t);
  }, [shaking]);
  return [shaking, shake];
}
