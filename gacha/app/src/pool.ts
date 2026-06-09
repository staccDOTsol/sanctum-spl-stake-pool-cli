/**
 * Pool: all SPL token accounts that have delegated to the matchmaker.
 *
 * Discovery strategy (auto-detected):
 *   1. Helius RPCs → getProgramAccountsV2 with pagination (required for token program)
 *   2. Other RPCs  → standard getProgramAccounts with dataSize + memcmp filters
 *
 * POOL_DISCOVERY_RPC can point to a separate endpoint (e.g. Helius) if the
 * primary RPC (e.g. Shyft) blocks getProgramAccounts.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { AccountLayout, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DelegateEntry } from "./types.js";

interface HeliusAccount {
  pubkey: string;
  account: { data: [string, "base64"]; owner: string };
}

export class GachaPool {
  private entries: DelegateEntry[] = [];
  private lastSync = 0;
  private discoveryRpcUrl: string;
  private discoveryConnection: Connection;

  constructor(
    private connection: Connection,
    private matchmaker: PublicKey
  ) {
    this.discoveryRpcUrl =
      process.env.POOL_DISCOVERY_RPC ??
      process.env.SOLANA_RPC ??
      "https://api.mainnet-beta.solana.com";

    const primaryUrl =
      (connection as unknown as { _rpcEndpoint: string })._rpcEndpoint ??
      process.env.SOLANA_RPC ?? "";

    this.discoveryConnection =
      this.discoveryRpcUrl === primaryUrl
        ? connection
        : new Connection(this.discoveryRpcUrl, "confirmed");

    console.log(`[pool] discovery RPC: ${this.discoveryRpcUrl.replace(/api[-_]key=[^&]+/, "api_key=***")}`);
  }

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
    // COption<Pubkey> delegate at offset 72: [1,0,0,0, ...32 bytes...]
    const delegateBytes = bs58.encode(
      Buffer.concat([Buffer.from([1, 0, 0, 0]), this.matchmaker.toBuffer()])
    );
    const filters = [
      { dataSize: 165 },
      { memcmp: { offset: 72, bytes: delegateBytes } },
    ];

    // Try Helius getProgramAccountsV2 first (required for token program scale).
    // Falls back to standard getProgramAccounts for non-Helius RPCs.
    try {
      return await this.fetchViaHeliusV2(tokenProgram, filters);
    } catch (heliusErr) {
      const msg = (heliusErr as Error).message;
      // If the error isn't a "method not found" style error, re-throw
      if (!msg.includes("Method not found") && !msg.includes("getProgramAccountsV2")) {
        throw heliusErr;
      }
      // Non-Helius RPC — fall back to standard getProgramAccounts
      return await this.fetchViaStandard(tokenProgram, filters);
    }
  }

  /** Helius-specific: getProgramAccountsV2 with cursor-based pagination */
  private async fetchViaHeliusV2(
    tokenProgram: PublicKey,
    filters: unknown[]
  ): Promise<DelegateEntry[]> {
    const results: DelegateEntry[] = [];
    let cursor: string | undefined;

    do {
      const pagination: Record<string, unknown> = { limit: 1000 };
      if (cursor) pagination.cursor = cursor;

      const resp = await fetch(this.discoveryRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getProgramAccountsV2",
          params: [
            tokenProgram.toBase58(),
            { filters, encoding: "base64", commitment: "confirmed", pagination },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      const json = await resp.json() as {
        result?: { accounts?: HeliusAccount[]; cursor?: string };
        error?: { code: number; message: string };
      };
      if (json.error) throw new Error(json.error.message);

      const accounts: HeliusAccount[] = json.result?.accounts ?? [];
      cursor = json.result?.cursor;

      for (const { pubkey, account } of accounts) {
        this.decodeAndPush(pubkey, Buffer.from(account.data[0], "base64"), results);
      }
    } while (cursor);

    return results;
  }

  /** Standard Solana RPC: getProgramAccounts via web3.js */
  private async fetchViaStandard(
    tokenProgram: PublicKey,
    filters: unknown[]
  ): Promise<DelegateEntry[]> {
    const accounts = await this.discoveryConnection.getProgramAccounts(tokenProgram, {
      filters: filters as Parameters<Connection["getProgramAccounts"]>[1] extends { filters?: infer F } ? F : never,
    });
    const results: DelegateEntry[] = [];
    for (const { pubkey, account } of accounts) {
      this.decodeAndPush(pubkey.toBase58(), account.data, results);
    }
    return results;
  }

  private decodeAndPush(pubkeyStr: string, data: Buffer, results: DelegateEntry[]): void {
    try {
      const decoded = AccountLayout.decode(data);
      if (
        decoded.closeAuthorityOption !== 1 ||
        !new PublicKey(decoded.closeAuthority).equals(this.matchmaker)
      ) return;
      if (decoded.amount === 0n) return;
      results.push({
        owner: new PublicKey(decoded.owner),
        ata: new PublicKey(pubkeyStr),
        mint: new PublicKey(decoded.mint),
        registeredAmount: decoded.amount,
        registeredAt: 0,
        isActive: true,
        pda: new PublicKey(pubkeyStr),
      });
    } catch { /* skip malformed */ }
  }

  get size(): number { return this.entries.length; }

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
