/**
 * `ratio`
 *
 * Fetches the current Meteora DBC pool reserves and prints the live
 * decryption ratio r without triggering an actual Lit decryption call.
 *
 * Useful for monitoring, dashboards, or arbitrage tooling.
 */
import { Command } from "commander";
import { Connection, PublicKey } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { computeDisparityRatio } from "../../meteora/pool-state.js";
import type { EncryptedPayload } from "../../types.js";

export function registerCheckRatioCommand(program: Command): void {
  program
    .command("ratio")
    .description(
      "Print the current progressive decryption ratio r from live Meteora pool reserves."
    )
    .option("--payload <path>", "Path to encrypted-payload.json (reads pool addresses from it)")
    .option("--leak-pool <address>", "Pool 1 address (Leak/rfstacc) — overrides --payload")
    .option("--dont-leak-pool <address>", "Pool 2 address (DontLeak/Leak) — overrides --payload")
    .option("--rpc <url>", "Solana RPC URL", process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com")
    .option("--watch <seconds>", "Poll interval in seconds (0 = single fetch)", "0")
    .action(async (opts: {
      payload?: string;
      leakPool?: string;
      dontLeakPool?: string;
      rpc: string;
      watch: string;
    }) => {
      let leakPoolAddress: string;
      let dontLeakPoolAddress: string;

      if (opts.leakPool && opts.dontLeakPool) {
        leakPoolAddress = opts.leakPool;
        dontLeakPoolAddress = opts.dontLeakPool;
      } else if (opts.payload) {
        const raw: EncryptedPayload = JSON.parse(
          await readFile(path.resolve(opts.payload), "utf8")
        );
        leakPoolAddress = raw.poolConfig.leakPoolAddress;
        dontLeakPoolAddress = raw.poolConfig.dontLeakPoolAddress;
      } else {
        console.error("Provide either --payload or both --leak-pool and --dont-leak-pool.");
        process.exit(1);
      }

      const connection = new Connection(opts.rpc, "confirmed");
      const leakPool = new PublicKey(leakPoolAddress);
      const dontLeakPool = new PublicKey(dontLeakPoolAddress);

      const intervalSec = parseInt(opts.watch);

      const printRatio = async () => {
        const snap = await computeDisparityRatio(connection, leakPool, dontLeakPool);
        const pct = (snap.r * 100).toFixed(2);
        const releasedBytes = snap.r; // caller multiplies by totalBytes if needed
        console.log(
          `[slot ${snap.slotFetched}] ` +
          `Leak=${snap.leakReserve}  DontLeak=${snap.dontLeakReserve}  ` +
          `r=${pct}%`
        );
      };

      await printRatio();

      if (intervalSec > 0) {
        console.log(`Polling every ${intervalSec}s — Ctrl+C to stop.`);
        setInterval(printRatio, intervalSec * 1000);
      }
    });
}
