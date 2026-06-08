"use client";

import clsx from "clsx";

interface Props {
  r: number;            // [0, 1]
  animated?: boolean;
  showLabels?: boolean;
  height?: "sm" | "md" | "lg";
}

const HEIGHTS = { sm: "h-1.5", md: "h-2.5", lg: "h-4" };

export default function RatioBar({ r, animated = true, showLabels = false, height = "md" }: Props) {
  const leakPct = Math.round(r * 100);
  const dontLeakPct = 100 - leakPct;

  return (
    <div className="w-full">
      {showLabels && (
        <div className="flex justify-between text-xs mb-1.5 font-mono">
          <span className="text-green-400">LEAK {leakPct}%</span>
          <span className="text-red-400">DON'T LEAK {dontLeakPct}%</span>
        </div>
      )}

      <div className={clsx("w-full rounded-full overflow-hidden bg-white/5 flex", HEIGHTS[height])}>
        {/* Leak (pro-decrypt) side — green */}
        <div
          className={clsx(
            "bg-gradient-to-r from-green-500 to-green-400 rounded-l-full transition-all",
            animated && "duration-700 ease-out"
          )}
          style={{ width: `${leakPct}%` }}
        />
        {/* DontLeak (pro-secrecy) side — red */}
        <div
          className={clsx(
            "bg-gradient-to-l from-red-600 to-red-500 rounded-r-full transition-all",
            animated && "duration-700 ease-out"
          )}
          style={{ width: `${dontLeakPct}%` }}
        />
      </div>
    </div>
  );
}
