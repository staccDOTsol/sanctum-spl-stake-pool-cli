/**
 * Content type: a real MIME type ("image/png", "audio/mpeg", …) for new
 * uploads; legacy entries may carry form values ("png", "jpeg", "text", …).
 */
export type ContentType = string;
export type ContentCategory = "text" | "image" | "audio" | "video" | "other";
export type PoolType   = "stable" | "meme" | "quota";

/** Map a MIME type or legacy form value to a coarse category. */
export function contentCategory(t: string | undefined): ContentCategory {
  const v = (t ?? "").toLowerCase();
  if (v.includes("image") || v === "png" || v === "jpeg" || v === "jpg" || v === "gif" || v === "webp") return "image";
  if (v.includes("audio")) return "audio";
  if (v.includes("video")) return "video";
  if (v.includes("text") || v === "" || v === "json" || v.includes("document") || v.includes("pdf")) return "text";
  return "other";
}

export type ContentTag =
  | "Hot"
  | "Rising"
  | "Contested"
  | "Almost Leaked"
  | "Suppressed"
  | "New";

export interface PoolSnapshot {
  leakReserve: string;   // raw bigint as string
  dontLeakReserve: string;
  r: number;             // [0, 1]
  tvl: number;           // USD estimate
  slot: number;
  fetchedAt: number;     // unix ms
}

export interface PoolSnapshotHistory {
  r1hAgo: number | null;
  r24hAgo: number | null;
}

export interface ContentEntry {
  id: string;
  title: string;
  description: string;
  contentType: ContentType;
  leakPoolAddress: string;
  dontLeakPoolAddress: string;
  leakMint: string;
  dontLeakMint: string;
  totalBytes: number;
  /** base64-encoded partial preview bytes (updated after each decrypt call) */
  partialPreviewB64?: string;
  /** thumbnail data URL if content type is image */
  thumbnailDataUrl?: string;
  /** URL to the encrypted payload JSON (IPFS / Arweave) */
  encryptedPayloadUrl?: string;
  createdAt: number; // unix ms
  creator?: string;
  creatorAddress?: string;
  metadataUrl?: string;
  poolType?: PoolType;
  quoteMint?: string;
}

export interface RankedContent extends ContentEntry {
  snapshot: PoolSnapshot;
  hotScore: number;
  deltaR1h: number | null;
  deltaR24h: number | null;
  tags: ContentTag[];
  rank: number;
}
