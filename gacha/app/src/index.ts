#!/usr/bin/env node
import "dotenv/config";
import { startHealthServer, registerLedger } from "./health.js";
import { Command } from "commander";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAccount, getMint } from "@solana/spl-token";
import bs58 from "bs58";
import { Matchmaker } from "./matchmaker.js";
import { delegateAta, revokeAta, payToRoll } from "./register.js";
import { GachaPool } from "./pool.js";
import { getPrices } from "./jupiter.js";
import { DividendLedger } from "./dividend.js";
import { classifyMints, TIER_LABEL } from "./tiers.js";

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
    registerLedger(mm.getLedger());
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
    const [prices, tiers] = await Promise.all([
      getPrices(mints),
      classifyMints(mints, connection),
    ]);

    console.log(`\n${"Tier".padEnd(11)} ${"Owner".padEnd(44)} ${"Mint".padEnd(44)} Amount     ~USD`);
    console.log("─".repeat(165));
    for (const e of entries) {
      const p = prices.get(e.mint.toBase58()) ?? null;
      const usd = p ? `$${(Number(e.registeredAmount) * p).toFixed(2)}` : "?";
      const tier = TIER_LABEL[tiers.get(e.mint.toBase58()) ?? 3];
      console.log(
        `${tier.padEnd(11)} ${e.owner.toBase58().padEnd(44)} ` +
        `${e.mint.toBase58().padEnd(44)} ${e.registeredAmount.toString().padEnd(10)} ${usd}`
      );
    }
    console.log(`\nTotal: ${entries.length} delegates`);
  });

program
  .command("points [pubkey]")
  .description("Show dividend points and earnings for a pubkey (defaults to USER_KEYPAIR)")
  .action(async (pubkeyStr?: string) => {
    let pubkey: string;
    if (pubkeyStr) {
      pubkey = pubkeyStr;
    } else {
      const kp = loadKeypair("USER_KEYPAIR");
      pubkey = kp.publicKey.toBase58();
    }
    const ledger = new DividendLedger();
    const stats = ledger.getStats(pubkey);
    if (!stats) {
      console.log(`${pubkey} has not rolled yet.`);
      console.log(`Total rollers: ${ledger.totalRollers}, total rolls: ${ledger.totalRolls}`);
      return;
    }
    const pctShare = (Math.pow(0.5, stats.rollIndex) / (2 * (1 - Math.pow(0.5, ledger.totalRollers))) * 100);
    console.log(`\nPubkey:          ${stats.pubkey}`);
    console.log(`Roll number:     #${stats.rollIndex + 1} of ${ledger.totalRollers}`);
    console.log(`Points:          ${stats.cumulativePoints.toLocaleString()}`);
    console.log(`Dividend share:  ~${pctShare.toFixed(2)}% of each roll`);
    console.log(`Total earned:    ${(stats.totalEarnedLamports / 1e9).toFixed(6)} SOL`);
    console.log(`Pending payout:  ${(stats.pendingLamports / 1e9).toFixed(6)} SOL`);
    console.log(`Total claimed:   ${(stats.claimedLamports / 1e9).toFixed(6)} SOL`);
    console.log(`\nTotal system rolls: ${ledger.totalRolls}`);
  });

program
  .command("leaderboard")
  .description("Show all rollers ranked by join order (earliest = most dividends)")
  .action(async () => {
    const ledger = new DividendLedger();
    const board = ledger.getLeaderboard();
    if (!board.length) { console.log("No rollers yet."); return; }

    let totalWeight = 0;
    for (const r of board) totalWeight += Math.pow(0.5, r.rollIndex);

    console.log(`\nGacha Dividend Leaderboard — ${ledger.totalRolls} total rolls\n`);
    console.log(
      `${"#".padEnd(4)} ${"Pubkey".padEnd(44)} ${"Share%".padEnd(8)} ` +
      `${"Points".padEnd(12)} ${"Earned SOL".padEnd(14)} ${"Pending SOL"}`
    );
    console.log("─".repeat(100));
    for (const r of board) {
      const share = (Math.pow(0.5, r.rollIndex) / totalWeight * 100).toFixed(2);
      console.log(
        `${String(r.rollIndex + 1).padEnd(4)} ${r.pubkey.padEnd(44)} ${(share + "%").padEnd(8)} ` +
        `${r.cumulativePoints.toLocaleString().padEnd(12)} ` +
        `${(r.totalEarnedLamports / 1e9).toFixed(6).padEnd(14)} ` +
        `${(r.pendingLamports / 1e9).toFixed(6)}`
      );
    }
  });

program.parseAsync(process.argv).catch(err => { console.error(err); process.exit(1); });
