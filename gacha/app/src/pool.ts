/**
 * Pool: all SPL token accounts delegated to the matchmaker (approve + close
 * authority).
 *
 * Discovery is REGISTRY-based, not a chain-wide scan. Most RPC providers
 * (incl. our Helius plan) exclude the SPL Token program from secondary
 * indexes, so getProgramAccounts / getTokenAccountsByDelegate over the Token
 * program return nothing. Instead, wallets register their pubkey (POST
 * /register, and the matchmaker auto-registers anyone who pays a roll fee),
 * and we enumerate each owner's accounts with getTokenAccountsByOwner —
 * which every provider supports — keeping those delegated to us.
 *
 * The owner registry is persisted on the mounted volume so it survives deploys.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DelegateEntry } from "./types.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const REGISTRY_PATH = process.env.REGISTRY_PATH ?? "/data/registry.json";

interface ParsedInfo {
  mint: string;
  delegate?: string;
  closeAuthority?: string;
  tokenAmount: { amount: string; decimals: number; uiAmount: number | null };
}

export class GachaPool {
  private entries: DelegateEntry[] = [];
  private owners = new Set<string>();
  private lastSync = 0;
  private mmStr: string;
  private rpc: Connection;

  constructor(
    private connection: Connection,
    private matchmaker: PublicKey
  ) {
    this.mmStr = matchmaker.toBase58();
    // Reads use POOL_DISCOVERY_RPC (unrestricted) when set, else the main RPC.
    const url = process.env.POOL_DISCOVERY_RPC;
    this.rpc = url ? new Connection(url, "confirmed") : connection;
    this.loadOwners();
    console.log(`[pool] registry: ${this.owners.size} owners`);
  }

  private loadOwners(): void {
    try {
      if (existsSync(REGISTRY_PATH)) {
        const arr = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as string[];
        this.owners = new Set(arr);
      }
    } catch (e) { console.warn("[pool] could not load registry:", (e as Error).message); }
  }

  private saveOwners(): void {
    try {
      mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
      writeFileSync(REGISTRY_PATH, JSON.stringify([...this.owners]));
    } catch (e) { console.warn("[pool] could not save registry:", (e as Error).message); }
  }

  /** Register an owner so their delegated accounts join the pool. */
  addOwner(owner: PublicKey): boolean {
    const k = owner.toBase58();
    if (this.owners.has(k)) return false;
    this.owners.add(k);
    this.saveOwners();
    console.log(`[pool] registered owner ${k}`);
    return true;
  }

  /** Enumerate one owner's delegated-to-us token accounts (both token programs). */
  private async fetchOwner(owner: PublicKey): Promise<DelegateEntry[]> {
    const out: DelegateEntry[] = [];
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const res = await this.rpc.getParsedTokenAccountsByOwner(owner, { programId });
      for (const { pubkey, account } of res.value) {
        const info = (account.data as { parsed: { info: ParsedInfo } }).parsed.info;
        if (info.delegate !== this.mmStr || info.closeAuthority !== this.mmStr) continue;
        const amount = BigInt(info.tokenAmount.amount);
        if (amount === 0n) continue;
        const decimals = info.tokenAmount.decimals;
        const uiAmount = info.tokenAmount.uiAmount ?? Number(amount) / Math.pow(10, decimals);
        out.push({
          owner,
          ata: pubkey,
          mint: new PublicKey(info.mint),
          programId,
          uiAmount,
          decimals,
          registeredAmount: amount,
          registeredAt: Date.now(),
          isActive: true,
          pda: pubkey,
        });
      }
    }
    return out;
  }

  /** Full re-sync across all registered owners. */
  async sync(): Promise<void> {
    const all: DelegateEntry[] = [];
    for (const o of this.owners) {
      try { all.push(...await this.fetchOwner(new PublicKey(o))); }
      catch (e) { console.warn(`[pool] sync owner ${o.slice(0, 8)}… failed:`, (e as Error).message); }
    }
    this.entries = all;
    this.lastSync = Date.now();
    console.log(`[pool] synced ${this.entries.length} delegated ATAs across ${this.owners.size} owners`);
  }

  async syncIfStale(): Promise<void> {
    if (Date.now() - this.lastSync > 30_000) await this.sync();
  }

  /** Register + immediately load one owner (used on roll payment + /register). */
  async refreshOwner(owner: PublicKey): Promise<void> {
    this.addOwner(owner);
    const fresh = await this.fetchOwner(owner);
    this.entries = this.entries.filter(e => !e.owner.equals(owner)).concat(fresh);
  }

  get size(): number { return this.entries.length; }
  get ownerCount(): number { return this.owners.size; }

  get(index: bigint): DelegateEntry | undefined {
    if (this.entries.length === 0) return undefined;
    return this.entries[Number(index % BigInt(this.entries.length))];
  }

  getByOwner(owner: PublicKey): DelegateEntry[] {
    return this.entries.filter(e => e.owner.equals(owner));
  }

  remove(ata: PublicKey): void {
    this.entries = this.entries.filter(e => !e.ata.equals(ata));
  }

  getAll(): DelegateEntry[] { return [...this.entries]; }
}
