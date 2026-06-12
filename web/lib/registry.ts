/**
 * Content registry — persistent via Vercel Blob (registry/index.json).
 * Falls back to empty array on first deploy (no seed data).
 *
 * On-chain sync: GET /api/registry/sync  — queries DBC program accounts
 * filtered by the two shared config addresses and rebuilds the JSON.
 */
import { put, list } from "@vercel/blob";
import type { ContentEntry } from "./types";

const REGISTRY_PATH = "registry/index.json";
const B2_TOKEN      = process.env.B2_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;

// Permanently hidden entries: datil-era ciphertexts (network sunset —
// unrecoverable) and pools created with the broken micro-curve config.
// Extend without code changes via REGISTRY_BLACKLIST=id1,id2,…
const BLACKLIST = new Set([
  "user-1780960638184-elylm4", // Memes — datil ciphertext, undecryptable
  "user-1780962748533-ur3d3s", // Memery — datil ciphertext, undecryptable
  "user-1781247483022-zzoiu4", // staccana 4 eva — broken micro-curve pool (6033)
  "user-1781249228886-swvp2s", // 152 — test launch
  "user-1781249055312-j586b6", // staccana 5 eva <3 — test launch
  "user-1781253082104-orvqbv", // ong? — test launch
  "user-1781253832945-kk1jal", // safu — test launch (bytes-mode avif)
  "user-1781250525259-e91bo5", // bigww — test launch
  "user-1781254814070-p26vxy", // yeayeanahnahnah — test launch
  "user-1781254342230-rseo81", // staccana <3 — test launch
  "user-1781254237835-laf2a0", // <3 staccana — test launch
  ...(process.env.REGISTRY_BLACKLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

let _cache: ContentEntry[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000;

async function loadFromBlob(): Promise<ContentEntry[]> {
  if (!B2_TOKEN) return [];
  try {
    const { blobs } = await list({ prefix: REGISTRY_PATH, token: B2_TOKEN });
    if (!blobs.length) return [];
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function saveToBlob(entries: ContentEntry[]): Promise<void> {
  if (!B2_TOKEN) return;
  await put(REGISTRY_PATH, JSON.stringify(entries), {
    access:           "public",
    token:            B2_TOKEN,
    addRandomSuffix:  false,
    allowOverwrite:   true,
    contentType:      "application/json",
  });
}

export async function getRegistry(fresh = false): Promise<ContentEntry[]> {
  if (!fresh && _cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  const entries = (await loadFromBlob()).filter((e) => !BLACKLIST.has(e.id));
  _cache     = entries;
  _cacheTime = Date.now();
  return entries;
}

export async function registerContent(entry: ContentEntry): Promise<void> {
  // Read FRESH from Blob (never the cache) immediately before writing —
  // building the write from a stale cached list silently deletes entries
  // registered by other instances in the meantime.
  const current = await loadFromBlob();
  const updated = [...current.filter(e => e.id !== entry.id), entry];
  await saveToBlob(updated);
  _cache     = updated.filter((e) => !BLACKLIST.has(e.id));
  _cacheTime = Date.now();
}

/** Replace the full registry (used by /api/registry/sync). */
export async function replaceRegistry(entries: ContentEntry[]): Promise<void> {
  await saveToBlob(entries);
  _cache     = entries;
  _cacheTime = Date.now();
}
