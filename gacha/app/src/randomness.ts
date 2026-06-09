/**
 * Provably fair, offchain randomness via Solana SlotHashes.
 *
 * Protocol:
 *   1. User calls `request_roll` at slot S → emits RollRequested{request_slot: S}
 *   2. Matchmaker waits until slot S+1 is finalized (~800ms)
 *   3. entropy_slot = S + 1
 *   4. slot_hash    = SlotHashes[entropy_slot]   (public, immutable after ~0.4s)
 *   5. random_seed  = sha256(slot_hash || requester_pubkey)
 *   6. selected_idx = u64_le(random_seed[0..8]) % pool_size
 *
 * Verifiability: the slot hash for any recent slot is readable by anyone via
 * `getBlock` or the SlotHashes sysvar. The matchmaker cannot know the hash at
 * time of request, so they cannot predict or cherry-pick the outcome.
 *
 * The on-chain program re-derives this index and verifies it matches what
 * the matchmaker claims before executing the swap.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

export interface EntropyResult {
  entropySlot: bigint;
  slotHash: Buffer;
  randomIndex: bigint;
  poolSize: bigint;
}

/**
 * Wait for `targetSlot` to appear in the SlotHashes sysvar, then return
 * its hash. Polls every 400 ms; gives up after 20 attempts (~8 s).
 */
export async function waitForSlotHash(
  connection: Connection,
  targetSlot: bigint
): Promise<Buffer> {
  const SLOT_HASHES = new PublicKey(
    "SysvarS1otHashes111111111111111111111111111"
  );

  for (let attempt = 0; attempt < 20; attempt++) {
    const info = await connection.getAccountInfo(SLOT_HASHES);
    if (info) {
      const hash = parseSlotHash(info.data, targetSlot);
      if (hash) return hash;
    }
    await sleep(400);
  }
  throw new Error(`SlotHash for slot ${targetSlot} not found after polling`);
}

/**
 * Given the raw SlotHashes sysvar data, find and return the 32-byte hash
 * for `targetSlot`. Returns null if not present.
 */
export function parseSlotHash(data: Buffer, targetSlot: bigint): Buffer | null {
  const count = data.readBigUInt64LE(0);
  for (let i = 0n; i < count; i++) {
    const off = Number(8n + i * 40n);
    const slot = data.readBigUInt64LE(off);
    if (slot === targetSlot) {
      return data.subarray(off + 8, off + 40);
    }
  }
  return null;
}

/**
 * Derive the random selection index deterministically from the slot hash and
 * requester pubkey. Matches the on-chain program's derivation exactly.
 */
export function deriveRandomIndex(
  slotHash: Buffer,
  requester: PublicKey,
  poolSize: bigint
): bigint {
  const digest = createHash("sha256")
    .update(slotHash)
    .update(requester.toBuffer())
    .digest();
  const raw = digest.readBigUInt64LE(0);
  return raw % poolSize;
}

/**
 * Full flow: wait for entropy slot, derive index, return everything the
 * on-chain instruction needs.
 */
export async function computeEntropy(
  connection: Connection,
  requestSlot: bigint,
  requester: PublicKey,
  poolSize: bigint
): Promise<EntropyResult> {
  if (poolSize === 0n) throw new Error("Pool is empty — no counterparty available");

  const entropySlot = requestSlot + 1n;
  const slotHash = await waitForSlotHash(connection, entropySlot);
  const randomIndex = deriveRandomIndex(slotHash, requester, poolSize);

  return { entropySlot, slotHash, randomIndex, poolSize };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
