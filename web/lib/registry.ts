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
const B2_TOKEN      = process.env.B2_READ_WRITE_TOKEN;

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
    contentType:      "application/json",
  });
}

export async function getRegistry(): Promise<ContentEntry[]> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  const entries = await loadFromBlob();
  _cache     = entries;
  _cacheTime = Date.now();
  return entries;
}

export async function registerContent(entry: ContentEntry): Promise<void> {
  const current = await getRegistry();
  const updated = [...current.filter(e => e.id !== entry.id), entry];
  await saveToBlob(updated);
  _cache     = updated;
  _cacheTime = Date.now();
}

/** Replace the full registry (used by /api/registry/sync). */
export async function replaceRegistry(entries: ContentEntry[]): Promise<void> {
  await saveToBlob(entries);
  _cache     = entries;
  _cacheTime = Date.now();
}
