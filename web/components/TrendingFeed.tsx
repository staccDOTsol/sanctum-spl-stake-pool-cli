"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import ContentCard from "./ContentCard";
import type { RankedContent } from "@/lib/types";

type SortMode = "bump" | "hot" | "new" | "rising" | "contested";

const SORT_OPTIONS: { value: SortMode; label: string; icon: string }[] = [
  { value: "bump",      label: "Bump",      icon: "⚡" },
  { value: "hot",       label: "Trending",  icon: "🔥" },
  { value: "rising",    label: "Rising",    icon: "↑"  },
  { value: "contested", label: "Contested", icon: "⚔"  },
  { value: "new",       label: "New",       icon: "✦"  },
];

const TYPE_OPTIONS = [
  { value: "all",   label: "All"    },
  { value: "text",  label: "Text"   },
  { value: "image", label: "Image"  },
  { value: "audio", label: "Audio"  },
  { value: "video", label: "Video"  },
];

const PAGE_SIZE = 24;
// How long a card keeps its bump highlight (ms)
const BUMP_GLOW_MS = 2_500;

async function fetcher(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/** Fingerprint of an entry's market state — any change counts as activity. */
function activityKey(item: RankedContent): string {
  return `${item.snapshot.leakReserve}|${item.snapshot.dontLeakReserve}|${item.snapshot.r.toFixed(6)}`;
}

export default function TrendingFeed() {
  const [sort, setSort]   = useState<SortMode>("bump");
  const [type, setType]   = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage]   = useState(0);
  // Bump state: client-side order + which ids are currently glowing
  const [bumpOrder, setBumpOrder]   = useState<string[]>([]);
  const [bumpedIds, setBumpedIds]   = useState<Set<string>>(new Set());
  const prevActivity = useRef<Map<string, string>>(new Map());
  const seededRef    = useRef(false);
  const glowTimers   = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Debounce search input
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setQ(query.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [query]);

  // Bump mode ranks client-side from the server's hot feed
  const serverSort = sort === "bump" ? "hot" : sort;
  const { data, error, isLoading } = useSWR<{ items: RankedContent[]; total: number }>(
    `/api/trending?sort=${serverSort}&type=${type}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&q=${encodeURIComponent(q)}`,
    fetcher,
    { refreshInterval: sort === "bump" ? 8_000 : 20_000 }
  );

  // Reset bump tracking when the feed identity changes
  useEffect(() => {
    prevActivity.current.clear();
    seededRef.current = false;
    setBumpOrder([]);
    setBumpedIds(new Set());
  }, [type, q, page, sort]);

  // pump.fun-style bump ordering: any entry whose reserves/ratio changed
  // (or that newly appeared) jumps to the front and shakes/glows briefly.
  useEffect(() => {
    if (sort !== "bump" || !data?.items) return;
    const items = data.items;
    const prev = prevActivity.current;

    if (!seededRef.current) {
      // First load: take server order, just record fingerprints
      for (const it of items) prev.set(it.id, activityKey(it));
      seededRef.current = true;
      setBumpOrder(items.map((i) => i.id));
      return;
    }

    const changed: string[] = [];
    for (const it of items) {
      const key = activityKey(it);
      if (prev.get(it.id) !== key) changed.push(it.id);
      prev.set(it.id, key);
    }

    setBumpOrder((order) => {
      const present = new Set(items.map((i) => i.id));
      const kept = order.filter((id) => present.has(id) && !changed.includes(id));
      const fresh = items.map((i) => i.id).filter((id) => !order.includes(id) && !changed.includes(id));
      return [...changed, ...kept, ...fresh];
    });

    if (changed.length) {
      setBumpedIds((s) => new Set([...s, ...changed]));
      for (const id of changed) {
        const existing = glowTimers.current.get(id);
        if (existing) clearTimeout(existing);
        glowTimers.current.set(id, setTimeout(() => {
          setBumpedIds((s) => { const n = new Set(s); n.delete(id); return n; });
          glowTimers.current.delete(id);
        }, BUMP_GLOW_MS));
      }
    }
  }, [data, sort]);

  useEffect(() => () => { for (const t of glowTimers.current.values()) clearTimeout(t); }, []);

  const items = useMemo(() => {
    if (!data?.items) return [];
    if (sort !== "bump" || bumpOrder.length === 0) return data.items;
    const byId = new Map(data.items.map((i) => [i.id, i]));
    const ordered = bumpOrder.map((id) => byId.get(id)).filter((x): x is RankedContent => !!x);
    // Anything the order list missed goes at the end
    for (const it of data.items) if (!bumpOrder.includes(it.id)) ordered.push(it);
    return ordered;
  }, [data, sort, bumpOrder]);

  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Sort */}
        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setSort(opt.value); setPage(0); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                sort === opt.value
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              <span>{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setType(opt.value); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                type === opt.value
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-44 max-w-xs">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 text-sm">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, creator, mint…"
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-white/5 border border-white/8 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-green-500/30"
          />
        </div>

        {data && (
          <span className="ml-auto text-xs text-white/30 font-mono">
            {total} item{total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Grid */}
      {isLoading && !data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white/4 animate-pulse h-64" />
          ))}
        </div>
      )}

      {error && (
        <div className="text-red-400/70 text-sm py-12 text-center">
          Failed to load feed. Retrying…
        </div>
      )}

      {data && items.length === 0 && (
        <div className="text-white/30 text-sm py-12 text-center">
          {q ? `Nothing matches “${q}”.` : "Nothing here yet."}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((item, i) => (
            <div key={item.id} className={bumpedIds.has(item.id) ? "bump-active rounded-2xl" : undefined}>
              <ContentCard item={item} featured={i === 0 && sort === "hot"} />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/8 text-white/60 text-sm hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-xs text-white/40 font-mono">
            page {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/8 text-white/60 text-sm hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}
