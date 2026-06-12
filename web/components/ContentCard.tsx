"use client";

import clsx from "clsx";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import RatioBar from "./RatioBar";
import ContentTagBadge from "./ContentTag";
import type { RankedContent } from "@/lib/types";

interface Props {
  item: RankedContent;
  featured?: boolean;
}

function typeIcon(t: string) {
  const v = t.toLowerCase();
  if (v.includes("image") || v === "png" || v === "jpeg") return "🖼";
  if (v.includes("audio")) return "🎵";
  if (v.includes("video")) return "🎬";
  return "📄";
}

function formatBytes(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtReserve(raw: string): string {
  const n = Number(BigInt(raw) / BigInt(1_000_000));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function ContentCard({ item, featured = false }: Props) {
  const { r, leakReserve, dontLeakReserve, tvl } = item.snapshot;
  const leakPct = Math.round(r * 100);
  const releasedBytes = Math.floor(r * item.totalBytes);

  return (
    <Link href={`/content/${item.id}`} className="contents">
    <article
      className={clsx(
        "group relative flex flex-col rounded-2xl border bg-[#13131a] overflow-hidden cursor-pointer",
        "transition-all duration-200 hover:scale-[1.015] hover:shadow-xl hover:shadow-black/40",
        featured
          ? "border-green-500/30 shadow-green-500/10 shadow-lg"
          : "border-white/8 hover:border-white/16"
      )}
    >
      {/* Preview area */}
      <div className={clsx("relative overflow-hidden bg-black/40", featured ? "h-48" : "h-32")}>
        {item.thumbnailDataUrl ? (
          // Actual partial image preview (blurred at low r)
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailDataUrl}
            alt=""
            className="w-full h-full object-cover"
            style={{ filter: r < 0.5 ? `blur(${Math.round((1 - r) * 16)}px)` : undefined }}
          />
        ) : (
          // Abstract preview: scanline mosaic representing partial reveal
          <div className="w-full h-full flex flex-col">
            {/* Revealed portion */}
            <div
              className="bg-gradient-to-b from-green-950/60 to-green-900/40 flex items-center justify-center"
              style={{ height: `${leakPct}%` }}
            >
              {leakPct > 20 && (
                <span className="text-green-400/60 font-mono text-xs">
                  {formatBytes(releasedBytes)} revealed
                </span>
              )}
            </div>
            {/* Encrypted portion */}
            <div
              className="flex-1 flex items-center justify-center"
              style={{
                backgroundImage: `repeating-linear-gradient(
                  0deg,
                  transparent,
                  transparent 2px,
                  rgba(255,255,255,0.02) 2px,
                  rgba(255,255,255,0.02) 4px
                )`,
              }}
            >
              {leakPct < 90 && (
                <span className="text-white/20 font-mono text-xs select-none">
                  ████ ENCRYPTED ████
                </span>
              )}
            </div>
          </div>
        )}

        {/* Type badge */}
        <div className="absolute top-2 left-2">
          <span className="text-lg leading-none">{typeIcon(item.contentType)}</span>
        </div>

        {/* Rank badge */}
        <div className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-0.5">
          <span className="font-mono text-[10px] text-white/50">#{item.rank}</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {item.tags.slice(0, 3).map((tag) => (
              <ContentTagBadge key={tag} tag={tag} />
            ))}
          </div>
        )}

        {/* Title & description */}
        <div>
          <h3 className={clsx("font-semibold text-white leading-snug", featured ? "text-base" : "text-sm")}>
            {item.title}
          </h3>
          {featured && (
            <p className="text-xs text-white/50 mt-1 line-clamp-2">{item.description}</p>
          )}
        </div>

        {/* Ratio bar */}
        <div>
          <RatioBar r={r} showLabels height="sm" />
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between text-[11px] font-mono text-white/40 mt-auto">
          <span title="Leak token reserves">
            <span className="text-green-400/70">L</span> {fmtReserve(leakReserve)}
            {"  "}
            <span className="text-red-400/70">D</span> {fmtReserve(dontLeakReserve)}
          </span>
          <span>{formatDistanceToNow(item.createdAt, { addSuffix: true })}</span>
        </div>
      </div>

      {/* Featured glow border */}
      {featured && (
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{ boxShadow: "inset 0 0 0 1px rgba(74,222,128,0.2)" }}
        />
      )}
    </article>
    </Link>
  );
}
