/**
 * Lit Protocol v6 utilities for leak.markets.
 *
 * Encryption: symmetric AES key is encrypted under the Lit network's BLS key,
 * conditioned on the viewer holding ≥1 LEAK token on Solana mainnet.
 *
 * Decryption: user signs a message with their Solana wallet → authSig →
 * Lit nodes verify the access condition and return key shares → decrypt.
 *
 * The ratio (from pool reserves) then controls HOW MANY bytes are shown
 * client-side; Lit controls WHETHER the user can decrypt at all.
 *
 * BROWSER-ONLY: never import this from a server component / route.
 */

import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LIT_NETWORK } from "@lit-protocol/constants";

export const LEAK_MINT = "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS";
const LIT_NET = (process.env.NEXT_PUBLIC_LIT_NETWORK as "datil" | "datil-dev" | undefined)
  ?? LIT_NETWORK.Naga; // Naga = mainnet equivalent

let _client: LitNodeClient | null = null;
let _connecting = false;
let _connectPromise: Promise<LitNodeClient> | null = null;

export async function getLitClient(): Promise<LitNodeClient> {
  if (_client?.ready) return _client;
  if (_connectPromise) return _connectPromise;
  _connectPromise = (async () => {
    _client = new LitNodeClient({ litNetwork: LIT_NET, debug: false });
    await _client.connect();
    return _client;
  })();
  return _connectPromise;
}

/** Solana RPC condition: viewer wallet holds ≥1 LEAK token. */
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
      pdaInterface: { offset: 0, fields: {} as Record<string, unknown> },
      pdaKey:  "",
      chain:   "solana" as const,
      returnValueTest: {
        key:        "$.value[0].account.data.parsed.info.tokenAmount.uiAmount",
        comparator: ">" as const,
        value:      "0",
      },
    },
  ];
}

export interface EncryptedPayload {
  ciphertext:        string; // base64
  dataToEncryptHash: string; // hex
  contentType:       string; // MIME
  filename?:         string;
}

/** Encrypt raw bytes and return the payload (no Lit connection needed). */
export async function encryptBytes(
  data:        Uint8Array,
  contentType: string,
  filename?:   string,
): Promise<EncryptedPayload> {
  const client = await getLitClient();
  const { ciphertext, dataToEncryptHash } = await client.encrypt({
    solRpcConditions: makeLeakConditions(),
    dataToEncrypt:    data,
    chain:            "solana",
  });
  return { ciphertext, dataToEncryptHash, contentType, filename };
}

/** Build a Solana authSig from an already-signed message. */
export function makeAuthSig(
  pubkey:        string,
  message:       string,
  signatureBytes: Uint8Array,
): object {
  return {
    sig:           Buffer.from(signatureBytes).toString("base64"),
    derivedVia:    "solana.signMessage",
    signedMessage: message,
    address:       pubkey,
  };
}

/** Decrypt bytes using an authSig (user must hold LEAK). */
export async function decryptBytes(
  payload:  EncryptedPayload,
  authSig:  object,
): Promise<Uint8Array> {
  const client = await getLitClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client as any).decrypt({
    solRpcConditions:  makeLeakConditions(),
    ciphertext:        payload.ciphertext,
    dataToEncryptHash: payload.dataToEncryptHash,
    authSig,
    chain: "solana",
  });
  return result.decryptedData as Uint8Array;
}

/** Sign the Lit auth message with a Solana wallet and return authSig. */
export async function signForLit(pubkey: string): Promise<object> {
  const message = `leak.markets: authorize Lit Protocol decryption for ${pubkey}`;
  const msgBytes = new TextEncoder().encode(message);

  // Phantom / Solflare both expose window.solana.signMessage
  const w = (window as unknown as { solana?: { signMessage: (m: Uint8Array) => Promise<{ signature: Uint8Array }> } }).solana;
  if (!w) throw new Error("No Solana wallet found");

  const { signature } = await w.signMessage(msgBytes);
  return makeAuthSig(pubkey, message, signature);
}
