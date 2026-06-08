/**
 * `create-pools`
 *
 * Deploys both Meteora DBC pools and mints the Leak + DontLeak tokens.
 *
 * Pool 1 (Leak / rfstacc)  – uses the PLATFORM config (from create-leak-config).
 * Pool 2 (DontLeak / Leak) – creates a NEW per-deployment DBC config where the
 *   USER is the partner (they pay and sign).  Total DontLeak supply = 1 B tokens.
 *
 * Flags:
 *   --leak-config <address>   Platform-owned Pool 1 config (required)
 *   --keypair <path>          User's Solana keypair (pays for Pool 2 config + both pools)
 *   --rpc <url>               Solana RPC URL
 *   --output <path>           JSON file to write deployment metadata into
 */
import { Command } from "commander";
import {
  Connection, Keypair, PublicKey, Transaction, SystemProgram,
  sendAndConfirmTransaction, TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  METEORA_DBC_PROGRAM_ID,
  R_FSTACC_LST_MINT,
  DONT_LEAK_TOTAL_SUPPLY_RAW,
  TOKEN_DECIMALS,
} from "../../constants.js";
import { deployBothPools } from "../../meteora/create-pools.js";
import { createLeakAndDontLeakMints } from "../../meteora/mint-tokens.js";
import type { PoolConfig } from "../../types.js";

// Anchor discriminator for `create_config` (sha256("global:create_config")[0..8])
// (same ix used for Pool 2 user-owned config)
const CREATE_CONFIG_DISCRIMINATOR = Buffer.from([
  0x9b, 0x16, 0x44, 0x2e, 0xc8, 0x04, 0x1b, 0xf5,
]);

function u64LE(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
function u16LE(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }

/** Create the Pool 2 DBC config with the USER as partner. */
async function createPool2Config(
  connection: Connection,
  userKp: Keypair,
  leakMint: PublicKey
): Promise<PublicKey> {
  const configKp = Keypair.generate();

  // Pool 2: quote = Leak, no binding target (open curve), low fee
  const data = Buffer.concat([
    CREATE_CONFIG_DISCRIMINATOR,
    u64LE(100n),        // 1 % trading fee
    u64LE(20n),         // 20 % protocol fee
    u64LE(0n),          // no graduation binding target
    u16LE(500),         // 5 % initial fee (lighter anti-snipe than Pool 1)
    u16LE(100),         // 1 % baseline
    u64LE(300n),        // decay over ~120 s
  ]);

  const ix = new TransactionInstruction({
    programId: METEORA_DBC_PROGRAM_ID,
    keys: [
      { pubkey: configKp.publicKey, isSigner: true,  isWritable: true  },
      { pubkey: userKp.publicKey,   isSigner: true,  isWritable: false }, // user = partner
      { pubkey: leakMint,           isSigner: false, isWritable: false }, // quote = Leak
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [userKp, configKp], { commitment: "confirmed" });

  console.log(`Pool 2 config (user-owned): ${configKp.publicKey.toBase58()}`);
  return configKp.publicKey;
}

export function registerCreatePoolsCommand(program: Command): void {
  program
    .command("create-pools")
    .description(
      "Mint Leak + DontLeak tokens and deploy both Meteora DBC pools. " +
      "User is partner on Pool 2 (DontLeak/Leak) config."
    )
    .requiredOption("--leak-config <address>", "Platform Pool 1 config address (from create-leak-config)")
    .requiredOption("--keypair <path>", "Path to user Solana keypair JSON")
    .option("--rpc <url>", "Solana RPC URL", process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com")
    .option("--output <path>", "Output JSON for deployment metadata", "./pool-deployment.json")
    .action(async (opts: {
      leakConfig: string;
      keypair: string;
      rpc: string;
      output: string;
    }) => {
      const connection = new Connection(opts.rpc, "confirmed");
      const rawKp = JSON.parse(await readFile(path.resolve(opts.keypair), "utf8"));
      const userKp = Keypair.fromSecretKey(Uint8Array.from(rawKp));
      const pool1Config = new PublicKey(opts.leakConfig);

      console.log(`User pubkey : ${userKp.publicKey.toBase58()}`);
      console.log(`Pool 1 config (platform-owned): ${pool1Config.toBase58()}`);

      // 1. Mint Leak and DontLeak tokens
      const { leakMintKp, dontLeakMintKp } = await createLeakAndDontLeakMints({
        connection,
        payer: userKp,
        mintAuthority: userKp,
        config: {
          leakSupply: DONT_LEAK_TOTAL_SUPPLY_RAW, // same supply for Leak
          dontLeakSupply: DONT_LEAK_TOTAL_SUPPLY_RAW,
          decimals: TOKEN_DECIMALS,
        },
      });

      // 2. Create Pool 2 config (user = partner, quote = Leak)
      const pool2Config = await createPool2Config(connection, userKp, leakMintKp.publicKey);

      // 3. Deploy both pools
      const poolConfig: PoolConfig = await deployBothPools({
        connection,
        creator: userKp,
        leakMint: leakMintKp.publicKey,
        dontLeakMint: dontLeakMintKp.publicKey,
        rfstaccMint: R_FSTACC_LST_MINT,
        configAddress: pool1Config,
      });

      // Overwrite pool2 config with user-owned one
      const finalConfig: PoolConfig = {
        ...poolConfig,
        poolConfigAddress: `${pool1Config.toBase58()} (Pool1) / ${pool2Config.toBase58()} (Pool2)`,
      };

      const result = {
        ...finalConfig,
        pool2ConfigAddress: pool2Config.toBase58(),
        pool1ConfigAddress: pool1Config.toBase58(),
        dontLeakTotalSupply: DONT_LEAK_TOTAL_SUPPLY_RAW.toString(),
        tokenDecimals: TOKEN_DECIMALS,
        userPartner: userKp.publicKey.toBase58(),
        createdAt: new Date().toISOString(),
      };

      await writeFile(path.resolve(opts.output), JSON.stringify(result, null, 2));

      console.log("\nBoth pools deployed!");
      console.log(`  Pool 1 (Leak/rfstacc)    : ${finalConfig.leakPoolAddress}`);
      console.log(`  Pool 2 (DontLeak/Leak)   : ${finalConfig.dontLeakPoolAddress}`);
      console.log(`  Leak mint                : ${finalConfig.leakMint}`);
      console.log(`  DontLeak mint            : ${finalConfig.dontLeakMint}`);
      console.log(`  Saved to                 : ${opts.output}`);
    });
}
