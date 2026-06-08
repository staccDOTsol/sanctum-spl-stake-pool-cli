import TrendingFeed from "@/components/TrendingFeed";

export const metadata = {
  title: "Explore — leak.markets",
  description: "Browse all encrypted content on leak.markets sorted by market-driven reveal ratio.",
};

export default function ExplorePage() {
  return (
    <div className="max-w-6xl mx-auto px-4 pb-20">
      {/* Page header */}
      <div className="pt-10 pb-8 border-b border-white/8 mb-8">
        <h1 className="text-3xl font-black text-white mb-2">Explore</h1>
        <p className="text-white/40 text-sm max-w-lg">
          Every item is encrypted and owned by its creator. Capital in{" "}
          <span className="text-green-400">Leak</span> and{" "}
          <span className="text-red-400">DontLeak</span> pools sets exactly how many
          bytes are visible right now — updated in real time.
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Active leaks",     value: "3",      sub: "seed items" },
          { label: "Avg ratio",         value: "44 %",   sub: "Leak dominance" },
          { label: "Pool 1 target",     value: "10 K",   sub: "rfstacc binding" },
          { label: "DontLeak supply",   value: "1 B",    sub: "per deployment" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-xl bg-white/4 border border-white/6 px-4 py-3">
            <div className="text-xs text-white/40 font-mono mb-1">{label}</div>
            <div className="text-xl font-black text-white">{value}</div>
            <div className="text-[10px] text-white/25 font-mono mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      <TrendingFeed />
    </div>
  );
}
