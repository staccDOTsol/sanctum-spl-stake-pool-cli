#!/usr/bin/env node
/**
 * CLI entry point.
 *
 * Commands:
 *   matchmaker          Run the matchmaker service (requires MATCHMAKER_KEYPAIR env)
 *   register <ata>      Join the gacha pool with a given ATA
 *   deregister <ata>    Leave the pool
 *   roll <ata>          Pay to roll (matchmaker executes swap async)
 *   pool                Print the current active pool and USD values
 */

import "dotenv/config";
import { startHealthServer } from "./health.js";
import { Command } from "commander";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getMint, getAccount } from "@solana/spl-token";
import bs58 from "bs58";
import { Matchmaker } from "./matchmaker.js";
import { registerDelegate, deregisterDelegate, requestRoll } from "./register.js";
import { GachaPool } from "./pool.js";
import { getPrices } from "./jupiter.js";

function loadKeypair(envKey: string): Keypair {
  const raw = process.env[envKey];
  if (!raw) throw new Error(`Missing env var ${envKey}`);
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    return Keypair.fromSecretKey(bs58.decode(raw));
  }
}

function getConnection(): Connection {
  const rpc = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
  return new Connection(rpc, "confirmed");
}

const program = new Command()
  .name("gacha")
  .description("Solana gacha CLI")
  .version("0.1.0");

program
  .command("matchmaker")
  .description("Run the matchmaker service")
  .action(async () => {
    startHealthServer();
    const keypair = loadKeypair("MATCHMAKER_KEYPAIR");
    const connection = getConnection();
    const mm = new Matchmaker(connection, keypair);
    await mm.run();
  });

program
  .command("register <ata>")
  .description("Register an ATA for the gacha pool")
  .option("-a, --amount <n>", "Raw token amount to delegate (default: full balance)")
  .action(async (ataStr: string, opts: { amount?: string }) => {
    const keypair = loadKeypair("USER_KEYPAIR");
    const connection = getConnection();
    const ata = new PublicKey(ataStr);
    const matchmaker = new PublicKey(
      process.env.MATCHMAKER_PUBKEY ??
        (() => { throw new Error("Missing MATCHMAKER_PUBKEY"); })()
    );

    let amount: bigint;
    if (opts.amount) {
      amount = BigInt(opts.amount);
    } else {
      const acc = await getAccount(connection, ata);
      amount = acc.amount;
    }

    console.log(`Registering ATA ${ataStr} with amount ${amount}…`);
    const sig = await registerDelegate(connection, keypair, ata, matchmaker, amount);
    console.log(`Done: ${sig}`);
  });

program
  .command("deregister <ata>")
  .description("Remove an ATA from the gacha pool")
  .action(async (ataStr: string) => {
    const keypair = loadKeypair("USER_KEYPAIR");
    const connection = getConnection();
    const sig = await deregisterDelegate(connection, keypair, new PublicKey(ataStr));
    console.log(`Deregistered: ${sig}`);
  });

program
  .command("roll <ata>")
  .description("Pay to roll — matchmaker will execute the swap")
  .option("-f, --fee <lamports>", "Roll fee in lamports", "5000000")
  .action(async (ataStr: string, opts: { fee: string }) => {
    const keypair = loadKeypair("USER_KEYPAIR");
    const connection = getConnection();
    const matchmaker = new PublicKey(
      process.env.MATCHMAKER_PUBKEY ??
        (() => { throw new Error("Missing MATCHMAKER_PUBKEY"); })()
    );
    const sig = await requestRoll(
      connection,
      keypair,
      new PublicKey(ataStr),
      matchmaker,
      BigInt(opts.fee)
    );
    console.log(`Roll requested: ${sig}`);
    console.log("Waiting for matchmaker to execute swap…");
  });

program
  .command("pool")
  .description("Show current active delegates with USD values")
  .action(async () => {
    const connection = getConnection();
    const pool = new GachaPool(connection);
    await pool.sync();

    const entries = pool.getAll();
    if (entries.length === 0) {
      console.log("Pool is empty.");
      return;
    }

    // Batch price all unique mints
    const mints = [...new Set(entries.map((e) => e.mint.toBase58()))];
    const prices = await getPrices(mints);

    console.log(`\n${"Owner".padEnd(44)} ${"ATA".padEnd(44)} ${"Mint".padEnd(44)} Amount     USD`);
    console.log("─".repeat(160));

    for (const e of entries) {
      const price = prices.get(e.mint.toBase58()) ?? null;
      let usdStr = "?";
      if (price !== null) {
        usdStr = `$${(Number(e.registeredAmount) * price).toFixed(2)}`;
      }
      console.log(
        `${e.owner.toBase58().padEnd(44)} ${e.ata.toBase58().padEnd(44)} ` +
          `${e.mint.toBase58().padEnd(44)} ${e.registeredAmount.toString().padEnd(10)} ${usdStr}`
      );
    }
    console.log(`\nTotal: ${entries.length} delegates`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
