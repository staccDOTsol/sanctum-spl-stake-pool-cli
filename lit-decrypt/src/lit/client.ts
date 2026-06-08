/**
 * Initialises and caches the Lit Protocol v8 LitNodeClient for Naga Mainnet.
 *
 * Uses the Viem-based client pattern required by Lit v8.  All Solana-side
 * reads are delegated to Lit Actions (TEE-executed JS), so no direct Solana
 * SDK calls are needed here.
 */
import { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client";
import { LIT_NAGA_NETWORK } from "../constants.js";

let _client: LitNodeClientNodeJs | null = null;

/** Return a connected Lit node client (singleton per process). */
export async function getLitClient(): Promise<LitNodeClientNodeJs> {
  if (_client) return _client;

  const client = new LitNodeClientNodeJs({
    litNetwork: LIT_NAGA_NETWORK,
    debug: false,
  });

  await client.connect();
  _client = client;
  return client;
}

/** Disconnect the cached client (call on process exit). */
export async function disconnectLitClient(): Promise<void> {
  if (_client) {
    await _client.disconnect();
    _client = null;
  }
}
