/**
 * Pool: all SPL token accounts that have delegated to the matchmaker.
 *
 * No on-chain program — we just query the SPL token program directly.
 * Any ATA with:
 *   delegate = MATCHMAKER_PUBKEY
 *   close_authority = MATCHMAKER_PUBKEY   (so we can collect rent)
 *   amount > 0
 * is eligible for the gacha pool.
 */

import {
  Connection,
  PublicKey,
  GetProgramAccountsFilter,
} from "@solana/web3.js";
import {
  AccountLayout,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { DelegateEntry } from "./types.js";

export class GachaPool {
  private entries: DelegateEntry[] = [];
  private lastSync = 0;

  constructor(
    private connection: Connection,
    private matchmaker: PublicKey
  ) {}

  async sync(): Promise<void> {
    const [v1, v2] = await Promise.all([
      this.fetchDelegated(TOKEN_PROGRAM_ID),
      this.fetchDelegated(TOKEN_2022_PROGRAM_ID),
    ]);
    this.entries = [...v1, ...v2];
    this.lastSync = Date.now();
    console.log(`[pool] synced ${this.entries.length} delegated ATAs`);
  }

  async syncIfStale(): Promise<void> {
    if (Date.now() - this.lastSync > 30_000) await this.sync();
  }

  private async fetchDelegated(tokenProgram: PublicKey): Promise<DelegateEntry[]> {
    // Filter: delegate = matchmaker (offset 76, 36 bytes = COption<Pubkey>)
    // COption::Some(pubkey) = [1,0,0,0, ...32 bytes...]
    const delegateFilter: GetProgramAccountsFilter = {
      memcmp: {
        offset: 72,
        bytes: Buffer.concat([
          Buffer.from([1, 0, 0, 0]),
          this.matchmaker.toBuffer(),
        ]).toString("base64"),
        encoding: "base64",
      },
    };

    const accounts = await this.connection.getProgramAccounts(tokenProgram, {
      filters: [{ dataSize: 165 }, delegateFilter],
    });

    const results: DelegateEntry[] = [];
    for (const { pubkey, account } of accounts) {
      try {
        const data = AccountLayout.decode(account.data);
        if (
          data.closeAuthorityOption !== 1 ||
          !new PublicKey(data.closeAuthority).equals(this.matchmaker)
        ) continue;
        if (data.amount === 0n) continue;
        results.push({
          owner: new PublicKey(data.owner),
          ata: pubkey,
          mint: new PublicKey(data.mint),
          registeredAmount: data.amount,
          registeredAt: 0,
          isActive: true,
          pda: pubkey,
        });
      } catch { /* skip malformed accounts */ }
    }
    return results;
  }

  get size(): number { return this.entries.length; }

  get(index: bigint): DelegateEntry | undefined {
    if (this.entries.length === 0) return undefined;
    return this.entries[Number(index % BigInt(this.entries.length))];
  }

  /** Get all ATAs delegated by a specific owner. */
  getByOwner(owner: PublicKey): DelegateEntry[] {
    return this.entries.filter(e => e.owner.equals(owner));
  }

  remove(ata: PublicKey): void {
    this.entries = this.entries.filter(e => !e.ata.equals(ata));
  }

  getAll(): DelegateEntry[] { return [...this.entries]; }
}
