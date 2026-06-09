/**
 * Browser-side Lit Protocol helpers for leak.markets.
 *
 * Production encrypt/decrypt happens server-side via /api/lit/* (the browser
 * Lit SDK fails on iOS Safari); these helpers remain for local/desktop use.
 * Conditions and authSig format live in ./litConditions so the server routes
 * and this module can never drift apart.
 *
 * BROWSER-ONLY: never import this from a server component / route.
 */

import { LitNodeClient } from "@lit-protocol/lit-node-client";
import {
  LEAK_MINT,
  makeLeakConditions,
  makeAuthSig,
  litAuthMessage,
  type EncryptedPayload,
} from "./litConditions";

export { LEAK_MINT, makeLeakConditions, makeAuthSig, litAuthMessage };
export type { EncryptedPayload };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LIT_NET: any = process.env.NEXT_PUBLIC_LIT_NETWORK ?? "datil";

let _client: LitNodeClient | null = null;
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

/** Encrypt raw bytes and return the payload (no Lit connection needed). */
export async function encryptBytes(
  data:        Uint8Array,
  contentType: string,
  filename?:   string,
): Promise<EncryptedPayload> {
  const client = await getLitClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { ciphertext, dataToEncryptHash } = await (client as any).encrypt({
    solRpcConditions: makeLeakConditions(),
    dataToEncrypt:    data,
  });
  return { ciphertext, dataToEncryptHash, contentType, filename };
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
  const message  = litAuthMessage();
  const msgBytes = new TextEncoder().encode(message);

  // Phantom / Solflare both expose signMessage
  const w = (window as unknown as {
    solana?:   { signMessage: (m: Uint8Array, e?: string) => Promise<{ signature: Uint8Array }> };
    solflare?: { signMessage: (m: Uint8Array, e?: string) => Promise<{ signature: Uint8Array }> };
  });
  const provider = w.solana ?? w.solflare;
  if (!provider) throw new Error("No Solana wallet found");

  const { signature } = await provider.signMessage(msgBytes, "utf8");
  return makeAuthSig(pubkey, message, signature);
}
