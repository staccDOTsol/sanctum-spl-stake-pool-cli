"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const LINKS = [
  { href: "/",        label: "Home"    },
  { href: "/explore", label: "Explore" },
];

export default function Nav() {
  const path = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-[#0a0a0f]/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Wordmark */}
        <Link href="/" className="flex items-center gap-2 group">
          <span className="text-xl font-black tracking-tight">
            <span className="text-green-400 group-hover:text-green-300 transition-colors">leak</span>
            <span className="text-white/60">.</span>
            <span className="text-white/80">markets</span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                path === href
                  ? "bg-white/10 text-white"
                  : "text-white/50 hover:text-white/80 hover:bg-white/5"
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* CTA */}
        <a
          href="https://github.com/staccDOTsol/sanctum-spl-stake-pool-cli/tree/claude/lit-protocol-decryption-N3Car/lit-decrypt"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-500/30 text-green-400 text-xs font-mono font-semibold hover:bg-green-500/10 transition-colors"
        >
          <span>⌨</span> CLI Docs
        </a>
      </div>
    </header>
  );
}
