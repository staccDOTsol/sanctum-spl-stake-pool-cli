/**
 * Client-side entry point for progressive decryption.
 *
 * Calls the Lit Action inside a TEE on the Naga network.  The action fetches
 * live Meteora DBC reserve data from Solana, computes ratio r, decrypts the
 * full payload inside the TEE, and returns only the first floor(r×N) bytes.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client";
import type { SessionSigsMap } from "@lit-protocol/types";
import { SOLANA_RPC_URL_FOR_LIT_ACTION } from "../constants.js";
import type { EncryptedPayload, DecryptionResult, LitActionResponse, DisparitySnapshot } from "../types.js";

/** Load the Lit Action source from disk (relative to this file). */
async function loadLitActionCode(): Promise<string> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const actionPath = path.join(dir, "actions", "progressive-decrypt.js");
  return readFile(actionPath, "utf8");
}

/**
 * Execute a progressive decryption call against the Lit Naga network.
 *
 * @param client       Connected LitNodeClientNodeJs (Naga mainnet).
 * @param sessionSigs  Session signatures authorising PKP + Lit Action execution.
 * @param payload      EncryptedPayload metadata (from `encrypt` step).
 * @returns            DecryptionResult with partial bytes and ratio snapshot.
 */
export async function progressiveDecrypt(opts: {
  client: LitNodeClientNodeJs;
  sessionSigs: SessionSigsMap;
  payload: EncryptedPayload;
}): Promise<DecryptionResult> {
  const { client, sessionSigs, payload } = opts;

  const litActionCode = await loadLitActionCode();

  const acc = JSON.parse(payload.accessControlConditions);

  const result = await client.executeJs({
    sessionSigs,
    code: litActionCode,
    jsParams: {
      poolAAddress: payload.poolConfig.leakPoolAddress,
      poolBAddress: payload.poolConfig.dontLeakPoolAddress,
      ciphertext: payload.ciphertext,
      dataToEncryptHash: payload.dataToEncryptHash,
      totalBytes: payload.totalBytes,
      accessControlConditions: acc,
      solanaRpcUrl: SOLANA_RPC_URL_FOR_LIT_ACTION,
    },
  });

  const raw = result.response as string;
  const resp: LitActionResponse = JSON.parse(raw);

  if (resp.error) {
    throw new Error(`Lit Action error: ${resp.error}`);
  }

  // Decode base64 prefix
  const binStr = atob(resp.prefix);
  const partialBytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    partialBytes[i] = binStr.charCodeAt(i);
  }

  const snapshot: DisparitySnapshot = {
    leakReserve: BigInt(resp.leakReserves),
    dontLeakReserve: BigInt(resp.dontLeakReserves),
    r: resp.r,
    slotFetched: 0, // not returned by action; use on-chain slot if needed
  };

  return {
    partialBytes,
    snapshot,
    totalBytes: payload.totalBytes,
    contentType: payload.contentType,
  };
}
