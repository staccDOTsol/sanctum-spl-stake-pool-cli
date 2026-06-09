/**
 * Shared Lit Protocol access-control conditions for leak.markets.
 *
 * IMPORTANT: encrypt and decrypt must use byte-identical conditions — the
 * condition hash is baked into the ciphertext identity. Both API routes and
 * any client helper import from here; never inline a copy.
 *
 * Isomorphic: no Lit SDK imports, safe in both server routes and client code.
 */

export const LEAK_MINT = "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS";

/**
 * Solana RPC condition: viewer wallet holds ≥1 LEAK token.
 *
 * Notes on format (Lit datil / SDK v7):
 * - param objects must be JSON-encoded strings (LPACC_SOL schema requires
 *   string items; the nodes parse them).
 * - LEAK is a Token-2022 mint, so we filter getTokenAccountsByOwner by
 *   `mint` (program-agnostic) rather than the legacy token programId.
 * - The nodes apply returnValueTest.key to the RPC result's `value` array,
 *   so the JSONPath is rooted at the array — not `$.value[...]`.
 */
export function makeLeakConditions() {
  return [
    {
      conditionType: "solRpc" as const,
      method:        "getTokenAccountsByOwner",
      params: [
        ":userAddress",
        JSON.stringify({ mint: LEAK_MINT }),
        JSON.stringify({ encoding: "jsonParsed" }),
      ],
      pdaParams:    [] as string[],
      pdaInterface: { offset: 0, fields: {} as Record<string, unknown> },
      pdaKey:  "",
      chain:   "solana" as const,
      returnValueTest: {
        key:        `$[?(@.account.data.parsed.info.mint == '${LEAK_MINT}')].account.data.parsed.info.tokenAmount.amount`,
        comparator: ">" as const,
        value:      "0",
      },
    },
  ];
}

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

export interface EncryptedPayload {
  ciphertext:        string; // base64
  dataToEncryptHash: string; // hex
  contentType:       string; // MIME
  filename?:         string;
}
