export type ContentType = "png" | "jpeg" | "text" | "audio" | "video";
export type PoolType   = "stable" | "meme" | "quota";

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
