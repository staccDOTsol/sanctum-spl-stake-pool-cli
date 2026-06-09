/**
 * Offchain pool index: tracks all active DelegateEntry accounts by listening
 * to on-chain program events and doing periodic resync.
 *
 * The matchmaker uses this to:
 *   - Know the current pool size (for randomness index)
 *   - Look up the N-th active entry (counterparty selection)
 *   - Price all entries via Jupiter for USD-value logging
 */

import {
  Connection,
  GetProgramAccountsFilter,
  PublicKey,
} from "@solana/web3.js";
import { DelegateEntry } from "./types.js";

function getProgramId(): PublicKey {
  const id = process.env.GACHA_PROGRAM_ID;
  if (!id) throw new Error("GACHA_PROGRAM_ID env var not set");
  return new PublicKey(id);
}

// Discriminator for DelegateEntry (first 8 bytes of sha256("account:DelegateEntry"))
// Recompute with: `anchor build && cat target/idl/gacha.json | jq .accounts`
const DELEGATE_ENTRY_DISC = Buffer.from([
  // Placeholder — replace after anchor build
  0xd3, 0x5a, 0x85, 0x01, 0x23, 0x4f, 0xb1, 0xe2,
]);

export class GachaPool {
  private entries: DelegateEntry[] = [];
  private lastSync = 0;

  constructor(private connection: Connection) {}

  /** Fetch all active DelegateEntry PDAs from the program. */
  async sync(): Promise<void> {
    const filters: GetProgramAccountsFilter[] = [
      { dataSize: 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 30 }, // DelegateEntry::LEN
      { memcmp: { offset: 0, bytes: DELEGATE_ENTRY_DISC.toString("base64") } },
      { memcmp: { offset: 8 + 32 + 32 + 32 + 8 + 8, bytes: "01" } }, // is_active = true (offset 112, value 0x01)
    ];

    const accounts = await this.connection.getProgramAccounts(getProgramId(), {
      filters,
      encoding: "base64",
    });

    this.entries = accounts
      .map(({ pubkey, account }) => {
        try {
          return deserializeDelegateEntry(pubkey, account.data as unknown as Buffer);
        } catch {
          return null;
        }
      })
      .filter((e): e is DelegateEntry => e !== null);

    this.lastSync = Date.now();
    console.log(`[pool] synced ${this.entries.length} active delegates`);
  }

  /** Sync if stale (> 30 s since last sync). */
  async syncIfStale(): Promise<void> {
    if (Date.now() - this.lastSync > 30_000) await this.sync();
  }

  get size(): number {
    return this.entries.length;
  }

  /** Get the N-th entry (the random selection result). */
  get(index: bigint): DelegateEntry | undefined {
    return this.entries[Number(index % BigInt(this.entries.length))];
  }

  /** Remove an entry locally (post-swap, before next resync). */
  remove(ata: PublicKey): void {
    this.entries = this.entries.filter(
      (e) => !e.ata.equals(ata)
    );
  }

  getAll(): DelegateEntry[] {
    return [...this.entries];
  }
}

function deserializeDelegateEntry(
  pda: PublicKey,
  data: Buffer
): DelegateEntry {
  let offset = 8; // skip discriminator
  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const ata = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const mint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const registeredAmount = data.readBigUInt64LE(offset);
  offset += 8;
  const registeredAt = Number(data.readBigInt64LE(offset));
  offset += 8;
  const isActive = data[offset] === 1;

  return { owner, ata, mint, registeredAmount, registeredAt, isActive, pda };
}
