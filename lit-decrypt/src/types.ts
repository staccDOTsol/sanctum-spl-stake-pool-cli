export type ContentType = "png" | "jpeg" | "text";

/** Addresses produced after deploying the two Meteora DBC pools. */
export interface PoolConfig {
  /** Pool 1: base=Leak, quote=rfstacc */
  leakPoolAddress: string;
  /** Pool 2: base=DontLeak, quote=Leak */
  dontLeakPoolAddress: string;
  leakMint: string;
  dontLeakMint: string;
  /** Meteora DBC config account shared by both pools (or separate configs). */
  poolConfigAddress?: string;
}

/** On-chain reserve snapshot for a single Meteora DBC pool. */
export interface PoolReserves {
  baseReserve: bigint;
  quoteReserve: bigint;
  baseVault: string;
  quoteVault: string;
}

/** Full disparity snapshot used to compute the decryption ratio. */
export interface DisparitySnapshot {
  /** Leak tokens locked in Pool 1 (base vault balance). */
  leakReserve: bigint;
  /** DontLeak tokens locked in Pool 2 (base vault balance). */
  dontLeakReserve: bigint;
  /** r = leakReserve / (leakReserve + dontLeakReserve), clamped to [0, 1]. */
  r: number;
  slotFetched: number;
}

/** Metadata persisted alongside the ciphertext (e.g. to IPFS / local JSON). */
export interface EncryptedPayload {
  /** Lit-encrypted ciphertext (base64). */
  ciphertext: string;
  /** SHA-256 hash of the original plaintext bytes (hex). */
  dataToEncryptHash: string;
  /** Total byte-length of the original plaintext. */
  totalBytes: number;
  contentType: ContentType;
  /** Unified access-control conditions used during encryption (serialised JSON). */
  accessControlConditions: string;
  /** PKP that holds the decryption key shares. */
  pkpPublicKey: string;
  pkpTokenId: string;
  /** Addresses of the two Meteora DBC pools. */
  poolConfig: PoolConfig;
  /** IPFS CID of the Lit Action code (for auditability). */
  litActionIpfsCid?: string;
  createdAt: number;
}

/** Result returned to the caller after a progressive decryption call. */
export interface DecryptionResult {
  /** Decrypted prefix bytes (length = floor(r × totalBytes)). */
  partialBytes: Uint8Array;
  snapshot: DisparitySnapshot;
  totalBytes: number;
  contentType: ContentType;
}

/** Parameters passed into the Lit Action via jsParams. */
export interface LitActionParams {
  poolAAddress: string;
  poolBAddress: string;
  ciphertext: string;
  dataToEncryptHash: string;
  totalBytes: number;
  accessControlConditions: unknown[];
  solanaRpcUrl: string;
}

/** Response JSON returned by the Lit Action. */
export interface LitActionResponse {
  prefix: string;       // base64-encoded prefix bytes
  r: number;
  decryptedBytes: number;
  totalBytes: number;
  leakReserves: string;
  dontLeakReserves: string;
  error?: string;
}

/** Configuration for minting the Leak and DontLeak Token-2022 tokens. */
export interface TokenMintConfig {
  leakSupply: bigint;
  dontLeakSupply: bigint;
  /** Token-2022 decimals (typically 9). */
  decimals: number;
}
