/**
 * Encrypt a raw byte payload (PNG, JPEG, or flat text) with Lit Protocol v8.
 *
 * The content is treated as a single contiguous byte array regardless of type.
 * Lit encrypts it with AES-256-GCM; the symmetric key is split via threshold
 * MPC and held by the Naga network.  Decryption is gated by the access-control
 * conditions — here we use a PKP-based condition so only valid Lit Action
 * executions (which check pool reserves in TEE) can decrypt.
 */
import { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client";
import { encryptUint8Array } from "@lit-protocol/lit-node-client";
import type { AccessControlConditions } from "@lit-protocol/types";
import type { MintedPKP } from "./pkp.js";
import type { EncryptedPayload, PoolConfig, ContentType } from "../types.js";

/**
 * Build the access-control conditions that allow decryption only when the
 * Lit Action (progressive-decrypt) is executed by the registered PKP.
 *
 * We use a PKP-bound condition: the PKP eth-address must match, which ensures
 * only the TEE-executed Lit Action (which is ipfs-pinned and immutable) can
 * reconstruct the key.
 */
export function buildAccessControlConditions(
  pkpEthAddress: string
): AccessControlConditions {
  return [
    {
      conditionType: "evmBasic",
      contractAddress: "",
      standardContractType: "",
      chain: "ethereum",
      method: "",
      parameters: [":userAddress"],
      returnValueTest: {
        comparator: "=",
        value: pkpEthAddress.toLowerCase(),
      },
    },
  ];
}

/**
 * Encrypt `plaintext` bytes using the Lit Naga network.
 *
 * @param client           Connected LitNodeClientNodeJs.
 * @param plaintext        Raw byte array to encrypt.
 * @param contentType      "png" | "jpeg" | "text" – stored in metadata only.
 * @param pkp              PKP whose eth-address is bound to the ACC.
 * @param poolConfig       The two deployed Meteora DBC pool addresses.
 * @param litActionIpfsCid Optional: IPFS CID of the pinned Lit Action code.
 * @returns                EncryptedPayload metadata to persist.
 */
export async function encryptPayload(opts: {
  client: LitNodeClientNodeJs;
  plaintext: Uint8Array;
  contentType: ContentType;
  pkp: MintedPKP;
  poolConfig: PoolConfig;
  litActionIpfsCid?: string;
}): Promise<EncryptedPayload> {
  const { client, plaintext, contentType, pkp, poolConfig, litActionIpfsCid } = opts;

  const accessControlConditions = buildAccessControlConditions(pkp.ethAddress);

  const { ciphertext, dataToEncryptHash } = await (client as any).encrypt({
    dataToEncrypt: plaintext,
    accessControlConditions,
  });

  return {
    ciphertext,
    dataToEncryptHash,
    totalBytes: plaintext.length,
    contentType,
    accessControlConditions: JSON.stringify(accessControlConditions),
    pkpPublicKey: pkp.publicKey,
    pkpTokenId: pkp.tokenId,
    poolConfig,
    litActionIpfsCid,
    createdAt: Date.now(),
  };
}

/** Read a file and return its raw bytes + detected content type. */
export async function readFileAsBytes(
  filePath: string
): Promise<{ bytes: Uint8Array; contentType: ContentType }> {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(filePath);
  const bytes = new Uint8Array(buf);

  let contentType: ContentType = "text";
  if (filePath.endsWith(".png")) contentType = "png";
  else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) contentType = "jpeg";

  return { bytes, contentType };
}
