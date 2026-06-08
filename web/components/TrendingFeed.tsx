"use client";

import { useState } from "react";
import useSWR from "swr";
import ContentCard from "./ContentCard";
import type { RankedContent } from "@/lib/types";

type SortMode = "hot" | "new" | "rising" | "contested";

const SORT_OPTIONS: { value: SortMode; label: string; icon: string }[] = [
  { value: "hot",       label: "Trending",  icon: "🔥" },
  { value: "rising",    label: "Rising",    icon: "↑"  },
  { value: "contested", label: "Contested", icon: "⚔"  },
  { value: "new",       label: "New",       icon: "✦"  },
];

const TYPE_OPTIONS = [
  { value: "all",  label: "All"    },
  { value: "text", label: "Text"   },
  { value: "jpeg", label: "Image"  },
  { value: "png",  label: "PNG"    },
];

async function fetcher(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function TrendingFeed() {
  const [sort, setSort] = useState<SortMode>("hot");
  const [type, setType] = useState("all");

  const { data, error, isLoading } = useSWR<{ items: RankedContent[]; total: number }>(
    `/api/trending?sort=${sort}&type=${type}&limit=20`,
    fetcher,
    { refreshInterval: 20_000 }
  );

  return (
    <section>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Sort */}
        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSort(opt.value)}
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
              onClick={() => setType(opt.value)}
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

        {data && (
          <span className="ml-auto text-xs text-white/30 font-mono">
            {data.total} items
          </span>
        )}
      </div>

      {/* Grid */}
      {isLoading && (
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

      {data && data.items.length === 0 && (
        <div className="text-white/30 text-sm py-12 text-center">
          Nothing here yet.
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.items.map((item, i) => (
            <ContentCard key={item.id} item={item} featured={i === 0 && sort === "hot"} />
          ))}
        </div>
      )}
    </section>
  );
}
