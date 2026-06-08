/**
 * Lit Action: Progressive Byte-Stream Decryption
 * ================================================
 * Executed inside a Lit Protocol v8 TEE (hardware-attested compute node).
 *
 * Input (jsParams):
 *   poolAAddress          – Pool 1 address (Leak / rfstacc)
 *   poolBAddress          – Pool 2 address (DontLeak / Leak)
 *   ciphertext            – Lit-encrypted payload (base64)
 *   dataToEncryptHash     – SHA-256 hash of the original plaintext (hex)
 *   totalBytes            – Total byte-length of the original plaintext
 *   accessControlConditions – ACC used during encryption (object array)
 *   solanaRpcUrl          – Solana RPC endpoint for on-chain reads
 *
 * Logic:
 *   1. Fetch Pool 1 base_vault balance  (Leak tokens locked)
 *   2. Fetch Pool 2 base_vault balance  (DontLeak tokens locked)
 *   3. r = leakReserve / (leakReserve + dontLeakReserve)   (∈ [0,1])
 *   4. Decrypt full ciphertext inside TEE via LitActions.decryptAndCombine
 *   5. Return ONLY the first floor(r × totalBytes) bytes as base64
 *
 * Output (response JSON):
 *   prefix         – base64-encoded decrypted prefix bytes
 *   r              – decryption ratio
 *   decryptedBytes – number of bytes released
 *   totalBytes
 *   leakReserves   – raw bigint string
 *   dontLeakReserves
 */

// ---------------------------------------------------------------------------
// Constants: Meteora DBC pool account layout offsets (Anchor IDL v0.5)
//   [0..8]   discriminator
//   [8..40]  quote_mint
//   [40..72] base_mint
//   [72..104] config
//   [104..136] creator
//   [136..168] base_vault  ← offset used below
//   [168..200] quote_vault
// ---------------------------------------------------------------------------
const BASE_VAULT_OFFSET = 136;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal base-58 encoder (no external libraries available in Lit Action TEE).
 * Converts a Uint8Array of 32 bytes → base58 string.
 */
function encodeBase58(bytes) {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    num = num * 256n + BigInt(bytes[i]);
  }
  let encoded = "";
  while (num > 0n) {
    const remainder = num % 58n;
    num = num / 58n;
    encoded = ALPHABET[Number(remainder)] + encoded;
  }
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded;
}

/** Decode base64 string → Uint8Array (available via global atob in Lit TEE). */
function base64ToUint8Array(b64) {
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

/** Encode Uint8Array → base64 string. */
function uint8ArrayToBase64(bytes) {
  let binStr = "";
  for (let i = 0; i < bytes.length; i++) {
    binStr += String.fromCharCode(bytes[i]);
  }
  return btoa(binStr);
}

/** POST a Solana JSON-RPC request and return the parsed response. */
async function solanaRpc(url, method, params) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await resp.json();
  if (json.error) throw new Error(`Solana RPC error (${method}): ${JSON.stringify(json.error)}`);
  return json.result;
}

/** Fetch raw base64 account data for a Solana address. */
async function getAccountData(rpcUrl, address) {
  const result = await solanaRpc(rpcUrl, "getAccountInfo", [
    address,
    { encoding: "base64" },
  ]);
  if (!result?.value?.data) throw new Error(`Account not found: ${address}`);
  return base64ToUint8Array(result.value.data[0]);
}

/**
 * Parse the base_vault pubkey from a raw Meteora DBC Pool account buffer.
 * Returns the vault address as a base-58 string.
 */
function parseBaseVault(data) {
  if (data.length < BASE_VAULT_OFFSET + 32) {
    throw new Error(`Pool account too small: ${data.length} bytes`);
  }
  return encodeBase58(data.slice(BASE_VAULT_OFFSET, BASE_VAULT_OFFSET + 32));
}

/** Return the raw token balance (as bigint) of an SPL / Token-2022 account. */
async function getTokenBalance(rpcUrl, tokenAccountAddress) {
  const result = await solanaRpc(rpcUrl, "getTokenAccountBalance", [
    tokenAccountAddress,
  ]);
  if (!result?.value?.amount) return 0n;
  return BigInt(result.value.amount);
}

// ---------------------------------------------------------------------------
// Main action
// ---------------------------------------------------------------------------

const go = async () => {
  const {
    poolAAddress,
    poolBAddress,
    ciphertext,
    dataToEncryptHash,
    totalBytes,
    accessControlConditions,
    solanaRpcUrl,
  } = jsParams;

  const rpcUrl = solanaRpcUrl || "https://api.mainnet-beta.solana.com";

  // --- 1. Fetch pool accounts and extract base vault addresses ---
  const [poolAData, poolBData] = await Promise.all([
    getAccountData(rpcUrl, poolAAddress),
    getAccountData(rpcUrl, poolBAddress),
  ]);

  const pool1BaseVault = parseBaseVault(poolAData);  // Leak vault in Pool 1
  const pool2BaseVault = parseBaseVault(poolBData);  // DontLeak vault in Pool 2

  // --- 2. Read reserve balances ---
  const [leakReserve, dontLeakReserve] = await Promise.all([
    getTokenBalance(rpcUrl, pool1BaseVault),
    getTokenBalance(rpcUrl, pool2BaseVault),
  ]);

  const totalVotes = leakReserve + dontLeakReserve;
  const r = totalVotes === 0n
    ? 0
    : Number(leakReserve) / Number(totalVotes);
  const rClamped = Math.max(0, Math.min(1, r));

  // --- 3. Decrypt full payload inside TEE ---
  const decryptedBytes = await LitActions.decryptAndCombine({
    accessControlConditions,
    ciphertext,
    dataToEncryptHash,
    chain: "ethereum",
    authSig: null,     // session sigs are passed by the SDK at execution time
  });

  const decryptedArray = typeof decryptedBytes === "string"
    ? base64ToUint8Array(decryptedBytes)
    : new Uint8Array(decryptedBytes);

  // --- 4. Slice to byte prefix ---
  const prefixByteCount = Math.floor(rClamped * totalBytes);
  const prefix = decryptedArray.slice(0, prefixByteCount);

  // --- 5. Return result ---
  LitActions.setResponse({
    response: JSON.stringify({
      prefix: uint8ArrayToBase64(prefix),
      r: rClamped,
      decryptedBytes: prefixByteCount,
      totalBytes,
      leakReserves: leakReserve.toString(),
      dontLeakReserves: dontLeakReserve.toString(),
    }),
  });
};

go().catch((err) => {
  LitActions.setResponse({
    response: JSON.stringify({ error: err.message ?? String(err) }),
  });
});
