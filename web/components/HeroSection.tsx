import Link from "next/link";

export default function HeroSection() {
  return (
    <section className="relative pt-16 pb-12 overflow-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 40% at 50% -10%, rgba(74,222,128,0.08) 0%, transparent 70%)",
        }}
      />

      <div className="max-w-3xl">
        {/* Eyebrow */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/20 bg-green-500/8 mb-6">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-mono text-green-400/80 uppercase tracking-widest">
            Lit Protocol v8 · Meteora DBC · Solana
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl font-black tracking-tight leading-[1.05] text-white mb-5">
          The market{" "}
          <span
            className="bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent"
          >
            decides
          </span>{" "}
          <br className="hidden sm:block" />
          what gets leaked.
        </h1>

        {/* Sub */}
        <p className="text-lg text-white/50 max-w-xl leading-relaxed mb-8">
          Two competing token pools — <strong className="text-green-400 font-semibold">Leak</strong>{" "}
          and <strong className="text-red-400 font-semibold">Don't Leak</strong> — vote with real
          capital to reveal encrypted content byte by byte. Higher Leak dominance = more of the
          payload decrypted in real time.
        </p>

        {/* How it works pills */}
        <div className="flex flex-wrap gap-2 mb-10">
          {[
            { icon: "🔒", text: "Content encrypted on Lit v8 (Naga)" },
            { icon: "📈", text: "Leak token = buy more decryption" },
            { icon: "🔐", text: "DontLeak token = vote for secrecy" },
            { icon: "⚡", text: "TEE decrypts only floor(r × bytes)" },
          ].map(({ icon, text }) => (
            <span
              key={text}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/8 text-xs text-white/60"
            >
              <span>{icon}</span> {text}
            </span>
          ))}
        </div>

        {/* CTAs */}
        <div className="flex flex-wrap gap-3">
          <Link
            href="/explore"
            className="px-5 py-2.5 rounded-xl bg-green-500 hover:bg-green-400 text-black font-semibold text-sm transition-colors"
          >
            Explore Content
          </Link>
          <a
            href="https://github.com/staccDOTsol/sanctum-spl-stake-pool-cli/tree/claude/lit-protocol-decryption-N3Car/lit-decrypt"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-xl border border-white/12 text-white/70 hover:text-white hover:border-white/24 font-semibold text-sm transition-colors"
          >
            Deploy a Leak →
          </a>
        </div>
      </div>
    </section>
  );
}
