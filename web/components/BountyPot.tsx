"use client";

/**
 * Live "pot" banner for bounty content: the claimable Meteora partner fees
 * accrued across both pools to the secret wallet. Crack the key → /claim
 * sweeps this. Polls every 20s.
 */
import { useEffect, useState } from "react";
import useSWR from "swr";

interface Props {
  leakPool:     string;
  dontLeakPool: string;
  bountyPubkey: string;
  quoteDecimals: number;
}

async function fetchPot(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("pot unavailable");
  return r.json() as Promise<{ quote: string; base: string; solLamports: number }>;
}

export default function BountyPot({ leakPool, dontLeakPool, bountyPubkey, quoteDecimals }: Props) {
  const [copied, setCopied] = useState(false);
  const { data } = useSWR(
    `/api/bounty/pot?leak=${leakPool}&dontleak=${dontLeakPool}&wallet=${bountyPubkey}`,
    fetchPot,
    { refreshInterval: 20_000 },
  );
  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(t); } }, [copied]);

  const quote = data ? Number(data.quote) / 10 ** quoteDecimals : null;
  const sol   = data ? data.solLamports / 1e9 : null;

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-500/8 to-transparent p-5 mb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-amber-400/80 uppercase tracking-widest">🏴 Capture-the-key bounty</span>
        <span className="text-xs font-mono text-white/25">pot updates every 20s</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black text-amber-300">
            {sol === null ? "…" : sol.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </span>
          <span className="text-sm text-white/40 font-mono">SOL on wallet</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black text-amber-300/80">
            {quote === null ? "…" : quote.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
          <span className="text-sm text-white/40 font-mono">quote fees claimable</span>
        </div>
      </div>
      <p className="text-white/55 text-sm leading-relaxed mt-3">
        The secret being revealed below is this wallet&apos;s private key. Every trade on
        either side pools its fees here. Reveal enough of the key, reconstruct it, and
        sweep the pot — first to do it wins.
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={() => { navigator.clipboard.writeText(bountyPubkey); setCopied(true); }}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white/80 text-xs font-mono transition-colors"
        >
          {copied ? "copied ✓" : `wallet: ${bountyPubkey.slice(0, 6)}…${bountyPubkey.slice(-4)}`}
        </button>
        <a
          href="/claim"
          className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-xs font-bold transition-colors"
        >
          I cracked it → claim →
        </a>
      </div>
    </div>
  );
}
