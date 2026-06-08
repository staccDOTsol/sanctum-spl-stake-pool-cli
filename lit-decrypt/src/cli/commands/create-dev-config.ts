/**
 * `create-dev-config`
 *
 * One-shot devnet / localnet bootstrap:
 *
 *   1. Creates a mock rfstacc Token-2022 mint (replaces the mainnet LST)
 *   2. Creates the platform-owned Meteora DBC PoolConfig for Pool 1
 *      (Leak / mock-rfstacc, binding target = 10 000 mock-rfstacc)
 *   3. Mints Leak and DontLeak tokens (1 B supply each)
 *   4. Creates a user-owned Pool 2 DBC config (DontLeak / Leak)
 *   5. Deploys both pools
 *   6. Writes a complete dev-deployment.json with all addresses
 *
 * Run this once against devnet / localnet.  On mainnet use the individual
 * commands (generate-platform-key → create-leak-config → create-pools).
 */
import { Command } from "commander";
import {
  Connection, Keypair, PublicKey, Transaction, SystemProgram,
  sendAndConfirmTransaction, TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMint2Instruction,
  getMintLen,
  ExtensionType,
} from "@solana/spl-token";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  METEORA_DBC_PROGRAM_ID,
  POOL1_BINDING_TARGET_QUOTE_RAW,
  POOL1_INITIAL_FEE_BPS,
  POOL1_BASELINE_FEE_BPS,
  POOL1_FEE_DECAY_SLOTS,
  DONT_LEAK_TOTAL_SUPPLY_RAW,
  TOKEN_DECIMALS,
} from "../../constants.js";
import { deployBothPools } from "../../meteora/create-pools.js";
import { createLeakAndDontLeakMints } from "../../meteora/mint-tokens.js";

const CREATE_CONFIG_DISC = Buffer.from([0x9b, 0x16, 0x44, 0x2e, 0xc8, 0x04, 0x1b, 0xf5]);

function u64LE(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
function u16LE(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }

async function mintDevToken(
  connection: Connection, payer: Keypair, decimals: number
): Promise<Keypair> {
  const kp = Keypair.generate();
  const len = getMintLen([]);
  const lamports = await connection.getMinimumBalanceForRentExemption(len);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: kp.publicKey,
      space: len, lamports, programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(kp.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID)
  );
  await sendAndConfirmTransaction(connection, tx, [payer, kp], { commitment: "confirmed" });
  console.log(`  Dev mint: ${kp.publicKey.toBase58()}`);
  return kp;
}

async function createDbcConfig(
  connection: Connection, payer: Keypair, quoteMint: PublicKey,
  bindingTarget: bigint, initialFee: number, baselineFee: number, decaySlots: number
): Promise<PublicKey> {
  const configKp = Keypair.generate();
  const data = Buffer.concat([
    CREATE_CONFIG_DISC,
    u64LE(100n), u64LE(20n),
    u64LE(bindingTarget),
    u16LE(initialFee), u16LE(baselineFee),
    u64LE(BigInt(decaySlots)),
  ]);
  const ix = new TransactionInstruction({
    programId: METEORA_DBC_PROGRAM_ID,
    keys: [
      { pubkey: configKp.publicKey, isSigner: true,  isWritable: true  },
      { pubkey: payer.publicKey,    isSigner: true,  isWritable: false },
      { pubkey: quoteMint,          isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer, configKp], { commitment: "confirmed" });
  console.log(`  DBC config: ${configKp.publicKey.toBase58()}`);
  return configKp.publicKey;
}

export function registerCreateDevConfigCommand(program: Command): void {
  program
    .command("create-dev-config")
    .description(
      "One-shot dev bootstrap: mints mock rfstacc + Leak + DontLeak, deploys both DBC configs and pools. " +
      "Use on devnet / localnet only — on mainnet use the individual commands."
    )
    .requiredOption("--keypair <path>", "Path to funder Solana keypair JSON")
    .option("--rpc <url>", "Solana RPC URL", "https://api.devnet.solana.com")
    .option("--output <path>", "Output JSON for all deployment addresses", "./dev-deployment.json")
    .action(async (opts: { keypair: string; rpc: string; output: string }) => {
      const connection = new Connection(opts.rpc, "confirmed");
      const rawKp = JSON.parse(await readFile(path.resolve(opts.keypair), "utf8"));
      const payer = Keypair.fromSecretKey(Uint8Array.from(rawKp));

      console.log(`Payer: ${payer.publicKey.toBase58()}  RPC: ${opts.rpc}\n`);

      console.log("1. Minting mock rfstacc (dev quote token for Pool 1)...");
      const mockRfstaccKp = await mintDevToken(connection, payer, TOKEN_DECIMALS);

      console.log("2. Creating Pool 1 DBC config (Leak/mock-rfstacc, binding 10 000)...");
      const pool1Config = await createDbcConfig(
        connection, payer, mockRfstaccKp.publicKey,
        POOL1_BINDING_TARGET_QUOTE_RAW, POOL1_INITIAL_FEE_BPS, POOL1_BASELINE_FEE_BPS, POOL1_FEE_DECAY_SLOTS
      );

      console.log("3. Minting Leak and DontLeak tokens...");
      const { leakMintKp, dontLeakMintKp } = await createLeakAndDontLeakMints({
        connection, payer, mintAuthority: payer,
        config: { leakSupply: DONT_LEAK_TOTAL_SUPPLY_RAW, dontLeakSupply: DONT_LEAK_TOTAL_SUPPLY_RAW, decimals: TOKEN_DECIMALS },
      });

      console.log("4. Creating Pool 2 DBC config (DontLeak/Leak, user-owned)...");
      const pool2Config = await createDbcConfig(
        connection, payer, leakMintKp.publicKey,
        0n, 500, 100, 300
      );

      console.log("5. Deploying both pools...");
      const poolConfig = await deployBothPools({
        connection, creator: payer,
        leakMint: leakMintKp.publicKey,
        dontLeakMint: dontLeakMintKp.publicKey,
        rfstaccMint: mockRfstaccKp.publicKey,
        configAddress: pool1Config,
      });

      const result = {
        network: opts.rpc,
        mockRfstaccMint: mockRfstaccKp.publicKey.toBase58(),
        pool1ConfigAddress: pool1Config.toBase58(),
        pool2ConfigAddress: pool2Config.toBase58(),
        leakMint: poolConfig.leakMint,
        dontLeakMint: poolConfig.dontLeakMint,
        leakPoolAddress: poolConfig.leakPoolAddress,
        dontLeakPoolAddress: poolConfig.dontLeakPoolAddress,
        dontLeakTotalSupply: DONT_LEAK_TOTAL_SUPPLY_RAW.toString(),
        tokenDecimals: TOKEN_DECIMALS,
        createdAt: new Date().toISOString(),
      };

      await writeFile(path.resolve(opts.output), JSON.stringify(result, null, 2));

      console.log("\n✓ Dev deployment complete!");
      Object.entries(result).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    });
}
