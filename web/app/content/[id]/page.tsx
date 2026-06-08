/**
 * /content/[id] — Content detail page
 *
 * Shows the live Leak/DontLeak ratio, how many bytes are currently revealed,
 * the partial content preview, and links to buy Leak or DontLeak on Meteora.
 */
import { notFound } from "next/navigation";
import { getRegistry } from "@/lib/registry";
import { fetchPoolRatio } from "@/lib/solana";
import { getMockSnapshot } from "@/lib/mockRatio";
import RatioBar from "@/components/RatioBar";
import SwapWidget from "@/components/SwapWidget";
import Link from "next/link";

export const revalidate = 15;

function formatBytes(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const registry = await getRegistry();
  const entry = registry.find((e) => e.id === id);
  if (!entry) notFound();

  const mock = getMockSnapshot(entry.id, entry.leakPoolAddress);
  let r = 0, leakReserve = "0", dontLeakReserve = "0";
  try {
    const data = mock
      ? mock
      : await fetchPoolRatio(entry.leakPoolAddress, entry.dontLeakPoolAddress);
    r              = data.r;
    leakReserve    = data.leakReserve.toString();
    dontLeakReserve = data.dontLeakReserve.toString();
  } catch { /* fallback to 0 */ }

  const leakPct      = Math.round(r * 100);
  const revealedBytes = Math.floor(r * entry.totalBytes);

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* Back */}
      <Link href="/explore" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-8 transition-colors">
        ← Explore
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-mono text-white/30 uppercase tracking-widest">{entry.contentType}</span>
          <span className="text-white/15">·</span>
          <span className="text-xs font-mono text-white/30">{formatBytes(entry.totalBytes)} total</span>
        </div>
        <h1 className="text-3xl font-black text-white mb-3">{entry.title}</h1>
        {entry.description && (
          <p className="text-white/50 text-sm leading-relaxed max-w-lg">{entry.description}</p>
        )}
      </div>

      {/* Live ratio card */}
      <div className="rounded-2xl border border-white/8 bg-[#13131a] p-6 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <span className="text-xs font-mono text-white/40 uppercase tracking-widest">Live market vote</span>
          <span className="text-xs font-mono text-white/25">auto-refreshes every 15s</span>
        </div>

        <RatioBar r={r} showLabels height="lg" />

        <div className="mt-5 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-black text-green-400">{leakPct}%</div>
            <div className="text-xs text-white/30 font-mono mt-0.5">Leak dominance</div>
          </div>
          <div>
            <div className="text-2xl font-black text-white">{formatBytes(revealedBytes)}</div>
            <div className="text-xs text-white/30 font-mono mt-0.5">currently revealed</div>
          </div>
          <div>
            <div className="text-2xl font-black text-white/60">{formatBytes(entry.totalBytes - revealedBytes)}</div>
            <div className="text-xs text-white/30 font-mono mt-0.5">still encrypted</div>
          </div>
        </div>
      </div>

      {/* Partial content preview */}
      <div className="rounded-2xl border border-white/8 bg-[#13131a] overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-white/6 flex items-center justify-between">
          <span className="text-xs font-mono text-white/40">Content preview</span>
          <span className="text-xs font-mono text-green-400/60">{leakPct}% revealed</span>
        </div>

        <div className="relative h-64">
          {/* Revealed portion */}
          <div
            className="absolute inset-x-0 top-0 bg-gradient-to-b from-green-950/40 to-transparent flex items-start justify-center overflow-hidden transition-all duration-700"
            style={{ height: `${leakPct}%` }}
          >
            {entry.encryptedPayloadUrl && r > 0.05 ? (
              <p className="text-white/50 text-xs font-mono p-4 pt-6">
                {/* In production this would be the Lit-decrypted prefix bytes */}
                [{formatBytes(revealedBytes)} of plaintext — connect wallet + buy Leak to decrypt via Lit TEE]
              </p>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-white/20 text-xs font-mono">Buy Leak tokens to start revealing →</span>
              </div>
            )}
          </div>

          {/* Encrypted portion */}
          <div
            className="absolute inset-x-0 bottom-0 flex items-center justify-center"
            style={{
              height: `${100 - leakPct}%`,
              backgroundImage: `repeating-linear-gradient(
                0deg,
                transparent,
                transparent 3px,
                rgba(255,255,255,0.015) 3px,
                rgba(255,255,255,0.015) 6px
              )`,
            }}
          >
            {100 - leakPct > 15 && (
              <span className="text-white/15 font-mono text-xs select-none tracking-widest">
                ██████ ENCRYPTED ██████
              </span>
            )}
          </div>

          {/* Divider line at the leak boundary */}
          {r > 0.02 && r < 0.98 && (
            <div
              className="absolute inset-x-0 h-px bg-green-500/30"
              style={{ top: `${leakPct}%` }}
            />
          )}
        </div>
      </div>

      {/* In-app swap widget — SOL→LEAK→quoteMint→DontLeak */}
      <div className="mb-8">
        <SwapWidget
          dontLeakPoolAddress={entry.dontLeakPoolAddress}
          dontLeakMint={entry.dontLeakMint}
          quoteMint={entry.quoteMint ?? "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS"}
          l1PoolAddress={entry.leakPoolAddress}
          quoteDecimals={entry.poolType === "meme" ? 6 : 9}
        />
      </div>

      {/* Pool addresses */}
      <div className="rounded-xl border border-white/6 bg-white/2 p-4 space-y-2.5 text-xs font-mono">
        <div className="flex justify-between gap-4">
          <span className="text-white/30 shrink-0">Leak pool</span>
          <span className="text-white/50 truncate">{entry.leakPoolAddress}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/30 shrink-0">DontLeak pool</span>
          <span className="text-white/50 truncate">{entry.dontLeakPoolAddress}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/30 shrink-0">Leak mint</span>
          <span className="text-white/50 truncate">{entry.leakMint}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/30 shrink-0">DontLeak mint</span>
          <span className="text-white/50 truncate">{entry.dontLeakMint}</span>
        </div>
      </div>
    </div>
  );
}
