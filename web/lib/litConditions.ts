/**
 * Shared Lit Protocol access-control conditions for leak.markets.
 *
 * IMPORTANT: encrypt and decrypt must use byte-identical conditions — the
 * condition hash is baked into the ciphertext identity. Tiered (v2) payloads
 * embed each chunk's conditions in the payload itself, which is safe: a
 * tampered condition changes the identity hash and the ciphertext simply
 * fails to decrypt. Legacy (v1) payloads use makeLeakConditions() on both
 * sides; never inline a copy.
 *
 * Isomorphic: no Lit SDK imports, safe in both server routes and client code.
 */

export const LEAK_MINT = "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS";

/* ------------------------------------------------------------------ */
/* Condition builders                                                  */
/* ------------------------------------------------------------------ */

export interface SolRpcCondition {
  conditionType: "solRpc";
  method:        string;
  params:        string[];
  pdaParams:     string[];
  pdaInterface:  { offset: number; fields: Record<string, unknown> };
  pdaKey:        string;
  chain:         "solana";
  returnValueTest: { key: string; comparator: string; value: string };
}
export interface ConditionOperator { operator: "and" | "or" }
export type ConditionSet = (SolRpcCondition | ConditionOperator)[];

/**
 * Solana RPC condition: viewer wallet holds ≥1 raw unit of LEAK.
 *
 * Notes on format (Lit datil / SDK v7):
 * - param objects must be JSON-encoded strings (LPACC_SOL schema requires
 *   string items; the nodes parse them).
 * - LEAK is a Token-2022 mint, so we filter getTokenAccountsByOwner by
 *   `mint` (program-agnostic) rather than the legacy token programId.
 * - The nodes apply returnValueTest.key to the RPC result's `value`,
 *   so JSONPaths are rooted there — not at `$.value[...]`.
 */
export function holdsLeakCondition(): SolRpcCondition {
  return {
    conditionType: "solRpc",
    method:        "getTokenAccountsByOwner",
    params: [
      ":userAddress",
      JSON.stringify({ mint: LEAK_MINT }),
      JSON.stringify({ encoding: "jsonParsed" }),
    ],
    pdaParams:    [],
    pdaInterface: { offset: 0, fields: {} },
    pdaKey:  "",
    chain:   "solana",
    returnValueTest: {
      key:        `$[?(@.account.data.parsed.info.mint == '${LEAK_MINT}')].account.data.parsed.info.tokenAmount.amount`,
      comparator: ">",
      value:      "0",
    },
  };
}

/**
 * Condition on a token account's raw balance (e.g. a DBC pool vault).
 * getTokenAccountBalance's result.value is { amount, decimals, … } and the
 * nodes root JSONPaths at result.value, hence "$.amount".
 */
export function vaultBalanceCondition(
  vaultAddress: string,
  comparator:   ">=" | "<" | ">" | "<=",
  rawAmount:    string,
): SolRpcCondition {
  return {
    conditionType: "solRpc",
    method:        "getTokenAccountBalance",
    params:        [vaultAddress],
    pdaParams:     [],
    pdaInterface:  { offset: 0, fields: {} },
    pdaKey:  "",
    chain:   "solana",
    returnValueTest: { key: "$.amount", comparator, value: rawAmount },
  };
}

/** Legacy (v1) condition set: just hold LEAK. */
export function makeLeakConditions(): ConditionSet {
  return [holdsLeakCondition()];
}

/* ------------------------------------------------------------------ */
/* Tier ladder                                                         */
/* ------------------------------------------------------------------ */

export interface TierParams {
  /** L1 leak-side quote vault (LEAK buys deposit here). */
  l1QuoteVault: string;
  /** This content's L2 quote vault (DontLeak buys deposit here). */
  l2QuoteVault: string;
  /** L1 vault raw balance at encrypt time (ladder baseline). */
  l1BaselineRaw: bigint;
  /** One whole quote token of the L2 pool, in raw units (10^decimals). */
  l2QuoteUnitRaw: bigint;
  /** Total chunks. */
  chunkCount: number;
}

/** Leak-side growth per tier: tier i needs the L1 vault ≥ baseline·1.15^i. */
const LEAK_GROWTH_PER_TIER = 1.15;
/**
 * Suppression base: locking the LAST chunk takes 1 quote token in the L2
 * vault; each earlier chunk doubles the required suppression capital —
 * exponential cost to suppress more of the content.
 */
const SUPPRESS_BASE_UNITS = 1n;

/**
 * Conditions for chunk i of chunkCount:
 *  - chunk 0: hold LEAK (the gate to view anything at all)
 *  - chunk i≥1: hold LEAK
 *               AND L1 leak vault ≥ baseline·1.15^i   (leak capital unlocks)
 *               AND L2 dontLeak vault < base·2^(K-1-i) (suppression re-locks,
 *                                                       tail chunks first)
 * All thresholds are enforced by the Lit nodes against live chain state at
 * decrypt time — the market vote moves chunks in AND out of reach.
 */
export function tierConditions(i: number, p: TierParams): ConditionSet {
  if (i === 0) return [holdsLeakCondition()];

  const floor = (() => {
    const f = Number(p.l1BaselineRaw < 1n ? 1n : p.l1BaselineRaw) * Math.pow(LEAK_GROWTH_PER_TIER, i);
    return BigInt(Math.ceil(f)).toString();
  })();
  const ceiling = (SUPPRESS_BASE_UNITS * p.l2QuoteUnitRaw * (1n << BigInt(p.chunkCount - 1 - i))).toString();

  return [
    holdsLeakCondition(),
    { operator: "and" },
    vaultBalanceCondition(p.l1QuoteVault, ">=", floor),
    { operator: "and" },
    vaultBalanceCondition(p.l2QuoteVault, "<", ceiling),
  ];
}

/**
 * Chunking policy. Default: ~16 KiB chunks, 4–12 of them. A specific tier
 * count can be requested (launch form / API), clamped to LIT_MAX_TIERS
 * (default 64): every tier costs one TEE encrypt at upload and one TEE
 * decrypt per view, so tier count scales credits + action time linearly.
 */
export function chunkCountFor(totalBytes: number, requested?: number): number {
  // Measured on Chipotle: 32 tiers encrypt in ~1.2s (time is not the
  // constraint); the binding limit is the ~1MB action response cap, which
  // scales with TOTAL content size, not tier count.
  const max = Number(process.env.LIT_MAX_TIERS ?? 48);
  if (requested && Number.isFinite(requested) && requested > 0) {
    return Math.max(2, Math.min(Math.floor(requested), max));
  }
  return Math.max(8, Math.min(24, Math.ceil(totalBytes / 8_192)));
}

/**
 * Ciphertext ≈ 2.7× the original bytes and Chipotle caps an action's
 * response around 1MB — content beyond this needs batched executions.
 */
export const MAX_CONTENT_BYTES = Number(process.env.LIT_MAX_CONTENT_BYTES ?? 320_000);

/**
 * Numeric ladder thresholds for chunk i (used by the Chipotle TEE action,
 * which seals them inside each chunk's ciphertext):
 *   floor   — L1 leak vault must hold ≥ baseline·1.15^i raw units
 *   ceiling — L2 dontLeak vault must hold < unit·2^(K-1-i) raw units
 * Chunk 0 has no thresholds (LEAK-holding alone gates it).
 */
export function tierThresholds(
  i: number,
  p: { l1BaselineRaw: bigint; l2QuoteUnitRaw: bigint; chunkCount: number },
): { floor?: string; ceiling?: string } {
  if (i === 0) return {};
  // Exponents are capped so high tier counts can't overflow doubles
  // (1.15^i) or produce astronomically meaningless BigInt ceilings (2^K).
  const base  = Number(p.l1BaselineRaw < 1n ? 1n : p.l1BaselineRaw);
  const floor = BigInt(Math.ceil(base * Math.pow(LEAK_GROWTH_PER_TIER, Math.min(i, 200)))).toString();
  const ceilExp = BigInt(Math.min(p.chunkCount - 1 - i, 24));
  const ceiling = (SUPPRESS_BASE_UNITS * p.l2QuoteUnitRaw * (1n << ceilExp)).toString();
  return { floor, ceiling };
}

/* ------------------------------------------------------------------ */
/* Payload formats                                                     */
/* ------------------------------------------------------------------ */

/** Legacy single-ciphertext payload (v1). */
export interface EncryptedPayload {
  ciphertext:        string; // base64
  dataToEncryptHash: string; // hex
  contentType:       string; // MIME
  filename?:         string;
}

export interface EncryptedChunk {
  index:             number;
  offset:            number;
  length:            number;
  ciphertext:        string;
  dataToEncryptHash: string;
  /** Exact conditions this chunk was encrypted under (tamper-proof: the
   *  condition hash is part of the ciphertext identity). */
  conditions:        ConditionSet;
}

/** Tiered payload (v2, datil — UNRECOVERABLE since the network sunset). */
export interface TieredPayload {
  version:      2;
  contentType:  string;
  filename?:    string;
  totalBytes:   number;
  l1QuoteVault: string;
  l2QuoteVault: string;
  chunks:       EncryptedChunk[];
}

export interface ChipotleChunk {
  index:      number;
  offset:     number;
  length:     number;
  /** Lit.Actions.encrypt output; the chunk's thresholds + vault addresses
   *  are sealed INSIDE the ciphertext (tamper-proof). */
  ciphertext: string;
}

/** Tiered payload (v3, Chipotle): TEE-enforced threshold ladder. */
export interface ChipotlePayload {
  version:      3;
  contentType:  string;
  filename?:    string;
  totalBytes:   number;
  /**
   * "bytes" (default): chunks are byte ranges; reveal = contiguous prefix.
   * "image-strips": chunks are horizontal crops of the image, top to
   * bottom — each strip is a complete, independently renderable image
   * (byte-prefixes of PNG/WebP don't render at all).
   */
  mode?:        "bytes" | "image-strips";
  l1QuoteVault: string;
  l2QuoteVault: string;
  chunks:       ChipotleChunk[];
}

export type AnyPayload = EncryptedPayload | TieredPayload | ChipotlePayload;

export function isTieredPayload(p: unknown): p is TieredPayload | ChipotlePayload {
  const v = (p as TieredPayload | ChipotlePayload | null)?.version;
  return !!p && typeof p === "object" && (v === 2 || v === 3)
    && Array.isArray((p as TieredPayload).chunks);
}

export function isChipotlePayload(p: unknown): p is ChipotlePayload {
  return isTieredPayload(p) && p.version === 3;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

/**
 * The canonical Lit auth message body for Solana wallets (what the SDK's
 * checkAndSignSolAuthMessage signs). The nodes verify the ed25519 signature
 * over exactly this text; sig must be hex-encoded.
 */
export function litAuthMessage(): string {
  return `I am creating an account to use Lit Protocol at ${new Date().toISOString()}`;
}

/** Build a Solana authSig from an already-signed message (sig hex-encoded). */
export function makeAuthSig(
  pubkey:         string,
  message:        string,
  signatureBytes: Uint8Array,
): { sig: string; derivedVia: string; signedMessage: string; address: string } {
  return {
    sig:           Array.from(signatureBytes).map((b) => b.toString(16).padStart(2, "0")).join(""),
    derivedVia:    "solana.signMessage",
    signedMessage: message,
    address:       pubkey,
  };
}
