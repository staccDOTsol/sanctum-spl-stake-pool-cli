#!/usr/bin/env node
import "dotenv/config";
import { startHealthServer } from "./health.js";
import { Command } from "commander";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAccount, getMint } from "@solana/spl-token";
import bs58 from "bs58";
import { Matchmaker } from "./matchmaker.js";
import { delegateAta, revokeAta, payToRoll } from "./register.js";
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
  const rpc = process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
  return new Connection(rpc, "confirmed");
}

const program = new Command()
  .name("gacha")
  .description("Solana gacha — offchain matchmaker")
  .version("0.1.0");

program
  .command("matchmaker")
  .description("Run the matchmaker service")
  .action(async () => {
    startHealthServer();

    if (!process.env.MATCHMAKER_KEYPAIR) {
      console.error(
        "[matchmaker] MATCHMAKER_KEYPAIR not set.\n" +
        "  fly secrets set MATCHMAKER_KEYPAIR=<base58-or-json> -a gacha-matchmaker\n" +
        "Process parked — health check passing."
      );
      await new Promise(() => {});
      return;
    }

    const keypair = loadKeypair("MATCHMAKER_KEYPAIR");
    const connection = getConnection();
    const mm = new Matchmaker(connection, keypair);
    await mm.run();
  });

program
  .command("delegate <ata>")
  .description("Approve matchmaker on an ATA to enter the pool")
  .action(async (ataStr: string) => {
    const user = loadKeypair("USER_KEYPAIR");
    const matchmaker = new PublicKey(
      process.env.MATCHMAKER_PUBKEY ??
        (() => { throw new Error("Missing MATCHMAKER_PUBKEY"); })()
    );
    const sig = await delegateAta(getConnection(), user, new PublicKey(ataStr), matchmaker);
    console.log(`Delegated: ${sig}`);
  });

program
  .command("revoke <ata>")
  .description("Revoke matchmaker delegation (exit the pool)")
  .action(async (ataStr: string) => {
    const user = loadKeypair("USER_KEYPAIR");
    const matchmaker = new PublicKey(process.env.MATCHMAKER_PUBKEY!);
    const sig = await revokeAta(getConnection(), user, new PublicKey(ataStr), matchmaker);
    console.log(`Revoked: ${sig}`);
  });

program
  .command("roll")
  .description("Send roll fee to matchmaker to trigger a swap")
  .option("-f, --fee <sol>", "Roll fee in SOL", "0.003")
  .action(async (opts: { fee: string }) => {
    const user = loadKeypair("USER_KEYPAIR");
    const matchmaker = new PublicKey(process.env.MATCHMAKER_PUBKEY!);
    const feeLamports = BigInt(Math.floor(parseFloat(opts.fee) * LAMPORTS_PER_SOL));
    const sig = await payToRoll(getConnection(), user, matchmaker, feeLamports);
    console.log(`Roll sent: ${sig}`);
    console.log("Matchmaker will execute the swap within ~1 slot (~400ms).");
  });

program
  .command("pool")
  .description("Show all ATAs currently delegated to the matchmaker")
  .action(async () => {
    const matchmaker = new PublicKey(process.env.MATCHMAKER_PUBKEY!);
    const connection = getConnection();
    const pool = new GachaPool(connection, matchmaker);
    await pool.sync();

    const entries = pool.getAll();
    if (!entries.length) { console.log("Pool is empty."); return; }

    const mints = [...new Set(entries.map(e => e.mint.toBase58()))];
    const prices = await getPrices(mints);

    console.log(`\n${"Owner".padEnd(44)} ${"ATA".padEnd(44)} ${"Mint".padEnd(44)} Amount     ~USD`);
    console.log("─".repeat(165));
    for (const e of entries) {
      const p = prices.get(e.mint.toBase58()) ?? null;
      const usd = p ? `$${(Number(e.registeredAmount) * p).toFixed(2)}` : "?";
      console.log(
        `${e.owner.toBase58().padEnd(44)} ${e.ata.toBase58().padEnd(44)} ` +
        `${e.mint.toBase58().padEnd(44)} ${e.registeredAmount.toString().padEnd(10)} ${usd}`
      );
    }
    console.log(`\nTotal: ${entries.length} delegates`);
  });

program.parseAsync(process.argv).catch(err => { console.error(err); process.exit(1); });
