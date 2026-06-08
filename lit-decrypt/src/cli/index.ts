#!/usr/bin/env node
/**
 * lit-decrypt CLI
 *
 * Commands:
 *   generate-platform-key   Generate the platform keypair for Pool 1 config
 *   create-leak-config       Deploy the platform-owned Pool 1 DBC config
 *   create-pools             Mint tokens + deploy both Meteora DBC pools
 *   encrypt                  Encrypt a PNG/JPEG/text file with Lit v8
 *   decrypt                  Progressive byte-stream decryption via Lit TEE
 *   ratio                    Print live decryption ratio from pool reserves
 */
import { Command } from "commander";
import { registerGeneratePlatformKeyCommand } from "./commands/generate-platform-key.js";
import { registerCreateLeakConfigCommand } from "./commands/create-leak-config.js";
import { registerCreatePoolsCommand } from "./commands/create-pools.js";
import { registerEncryptCommand } from "./commands/encrypt-content.js";
import { registerDecryptCommand } from "./commands/decrypt-content.js";
import { registerCheckRatioCommand } from "./commands/check-ratio.js";
import { registerCreateDevConfigCommand } from "./commands/create-dev-config.js";

const program = new Command();

program
  .name("lit-decrypt")
  .description(
    "Lit Protocol v8 + Meteora DBC: Financially Incentivised Progressive Content Decryption\n\n" +
    "Two-pool model:\n" +
    "  Pool 1 (Leak / rfstacc)  — buy Leak to vote for more decryption\n" +
    "  Pool 2 (DontLeak / Leak) — buy DontLeak to vote for secrecy\n" +
    "Ratio r = Leak reserves / (Leak + DontLeak reserves) determines byte-prefix released."
  )
  .version("1.0.0");

registerGeneratePlatformKeyCommand(program);
registerCreateLeakConfigCommand(program);
registerCreatePoolsCommand(program);
registerEncryptCommand(program);
registerDecryptCommand(program);
registerCheckRatioCommand(program);
registerCreateDevConfigCommand(program);

program.parse(process.argv);
