/**
 * `generate-platform-key`
 *
 * Generates a new Solana keypair to act as the PLATFORM authority — the wallet
 * that creates and owns the single shared Meteora DBC PoolConfig for Pool 1
 * (Leak / rfstacc).  This config encodes the binding target (10 000 rfstacc)
 * and the anti-snipe FeeScheduler.
 *
 * After running this command, fund the printed public key with enough SOL to
 * cover rent + transaction fees on Solana mainnet, then run `create-leak-config`
 * to deploy the Pool 1 config.
 *
 * The keypair is saved to ./platform-keypair.json.  Keep it secret.
 */
import { Command } from "commander";
import { Keypair } from "@solana/web3.js";
import { writeFile, access } from "node:fs/promises";
import path from "node:path";

export function registerGeneratePlatformKeyCommand(program: Command): void {
  program
    .command("generate-platform-key")
    .description(
      "Generate the platform keypair that owns the Pool 1 (Leak/rfstacc) Meteora DBC config. " +
      "Fund the printed address before running create-leak-config."
    )
    .option("--output <path>", "Output path for keypair JSON", "./platform-keypair.json")
    .option("--force", "Overwrite existing file", false)
    .action(async (opts: { output: string; force: boolean }) => {
      const outPath = path.resolve(opts.output);

      if (!opts.force) {
        try {
          await access(outPath);
          console.error(
            `File already exists: ${outPath}\nUse --force to overwrite.`
          );
          process.exit(1);
        } catch {
          // file does not exist — proceed
        }
      }

      const kp = Keypair.generate();
      const secretArray = Array.from(kp.secretKey);

      await writeFile(outPath, JSON.stringify(secretArray), "utf8");

      console.log("Platform keypair generated.");
      console.log(`  Public key : ${kp.publicKey.toBase58()}`);
      console.log(`  Saved to   : ${outPath}`);
      console.log();
      console.log("Next steps:");
      console.log(`  1. Fund ${kp.publicKey.toBase58()} with ≥ 0.05 SOL on mainnet.`);
      console.log(`  2. Run: lit-decrypt create-leak-config --keypair ${outPath}`);
    });
}
