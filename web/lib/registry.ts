/**
 * Content registry — the in-memory store of all registered leak.markets items.
 *
 * In production this lives in a Postgres/Supabase table or an on-chain PDA
 * and is populated when users call `lit-decrypt encrypt` (which POSTs metadata
 * to /api/register).  For now we ship seed data so the site is usable from day 1.
 *
 * The `REGISTRY_URL` env var can point to an external JSON file / API that
 * returns ContentEntry[].  If unset, the seed data is used.
 */
import type { ContentEntry } from "./types";

const REGISTRY_URL = process.env.REGISTRY_URL;

/** Seed data — visible immediately at launch */
const SEED_REGISTRY: ContentEntry[] = [
  {
    id: "seed-1",
    title: "Unreleased Track #001",
    description: "A finished studio recording. The market decides if the world hears it.",
    contentType: "text",
    leakPoolAddress: "11111111111111111111111111111111",   // placeholder until real pools
    dontLeakPoolAddress: "11111111111111111111111111111111",
    leakMint: "11111111111111111111111111111111",
    dontLeakMint: "11111111111111111111111111111111",
    totalBytes: 4_096,
    createdAt: Date.now() - 12 * 3_600_000,
  },
  {
    id: "seed-2",
    title: "Confidential Photo Drop",
    description: "High-resolution image. Byte by byte — the market controls the exposure.",
    contentType: "jpeg",
    leakPoolAddress: "11111111111111111111111111111111",
    dontLeakPoolAddress: "11111111111111111111111111111111",
    leakMint: "11111111111111111111111111111111",
    dontLeakMint: "11111111111111111111111111111111",
    totalBytes: 512_000,
    createdAt: Date.now() - 3 * 3_600_000,
  },
  {
    id: "seed-3",
    title: "Insider Memo",
    description: "A document someone wants kept secret. Leak holders disagree.",
    contentType: "text",
    leakPoolAddress: "11111111111111111111111111111111",
    dontLeakPoolAddress: "11111111111111111111111111111111",
    leakMint: "11111111111111111111111111111111",
    dontLeakMint: "11111111111111111111111111111111",
    totalBytes: 8_192,
    createdAt: Date.now() - 36 * 3_600_000,
  },
];

let _cache: ContentEntry[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000; // 60 s

export async function getRegistry(): Promise<ContentEntry[]> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  if (REGISTRY_URL) {
    try {
      const res = await fetch(REGISTRY_URL, { next: { revalidate: 60 } });
      const data: ContentEntry[] = await res.json();
      _cache = data;
      _cacheTime = Date.now();
      return data;
    } catch (e) {
      console.warn("Registry fetch failed, using seed data:", e);
    }
  }

  _cache = SEED_REGISTRY;
  _cacheTime = Date.now();
  return SEED_REGISTRY;
}

/** Register a new content entry (called by /api/register). */
export async function registerContent(entry: ContentEntry): Promise<void> {
  _cache = [...(await getRegistry()), entry];
  _cacheTime = Date.now();
}
