/**
 * bootstrap-devnet.ts
 *
 * Fully automated devnet bootstrap for leak.markets.
 * Runs once — creates all on-chain infrastructure and writes dev-deployment.json.
 *
 * Prerequisites:
 *   1. Fund the platform keypair (platform-keypair.json) with devnet SOL:
 *        solana airdrop 2 GYKSfwaTZXJ29vGha39ETNxkBPeBGs6KaRP2eDjaRw6U --url devnet
 *      Or visit https://faucet.solana.com and paste the address.
 *   2. Ensure Meteora DBC is deployed on devnet (check docs.meteora.ag for program ID).
 *
 * Run:
 *   npx tsx bootstrap-devnet.ts
 */
import {
  Connection, Keypair, PublicKey, Transaction, SystemProgram,
  sendAndConfirmTransaction, TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  getMintLen,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

// ---- Config ----------------------------------------------------------------
const RPC_URL = "https://api.devnet.solana.com";
const DONT_LEAK_SUPPLY = 1_000_000_000n * 1_000_000_000n; // 1 B × 10^9
const BINDING_TARGET   = 10_000n * 1_000_000_000n;         // 10 000 × 10^9
const TOKEN_DECIMALS   = 9;
// Meteora DBC on devnet (verify at docs.meteora.ag)
const DBC_PROGRAM = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
// Discriminators
const DISC_CREATE_CONFIG = Buffer.from([0x9b, 0x16, 0x44, 0x2e, 0xc8, 0x04, 0x1b, 0xf5]);
const DISC_INIT_POOL     = Buffer.from([0x11, 0x37, 0x20, 0x9a, 0x4e, 0x85, 0x9f, 0x1d]);

function u64LE(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
function u16LE(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }

// ---- Helpers ---------------------------------------------------------------
async function createMint(conn: Connection, payer: Keypair, decimals: number): Promise<Keypair> {
  const kp = Keypair.generate();
  const len = getMintLen([]);
  const lamports = await conn.getMinimumBalanceForRentExemption(len);
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: kp.publicKey, space: len, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMint2Instruction(kp.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID)
  ), [payer, kp], { commitment: "confirmed" });
  console.log(`  mint: ${kp.publicKey.toBase58()}`);
  return kp;
}

async function mintTokens(conn: Connection, payer: Keypair, mint: PublicKey, amount: bigint): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const ataInfo = await conn.getAccountInfo(ata);
  const tx = new Transaction();
  if (!ataInfo) tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, ata, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID));
  tx.add(createMintToInstruction(mint, ata, payer.publicKey, amount, [], TOKEN_2022_PROGRAM_ID));
  await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
  console.log(`  minted ${amount} to ${ata.toBase58()}`);
  return ata;
}

async function createDbcConfig(
  conn: Connection, payer: Keypair, quoteMint: PublicKey,
  bindingTarget: bigint, initFee: number, baseFee: number, decaySlots: number
): Promise<PublicKey> {
  const configKp = Keypair.generate();
  const data = Buffer.concat([DISC_CREATE_CONFIG, u64LE(100n), u64LE(20n), u64LE(bindingTarget), u16LE(initFee), u16LE(baseFee), u64LE(BigInt(decaySlots))]);
  await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
    programId: DBC_PROGRAM,
    keys: [
      { pubkey: configKp.publicKey, isSigner: true,  isWritable: true  },
      { pubkey: payer.publicKey,    isSigner: true,  isWritable: false },
      { pubkey: quoteMint,          isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })), [payer, configKp], { commitment: "confirmed" });
  console.log(`  DBC config: ${configKp.publicKey.toBase58()}`);
  return configKp.publicKey;
}

function derivePool(base: PublicKey, quote: PublicKey, config: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), config.toBuffer(), base.toBuffer(), quote.toBuffer()],
    DBC_PROGRAM
  )[0];
}

function deriveEventAuth(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], DBC_PROGRAM)[0];
}

async function deployPool(conn: Connection, creator: Keypair, base: PublicKey, quote: PublicKey, config: PublicKey): Promise<PublicKey> {
  const pool = derivePool(base, quote, config);
  const ev   = deriveEventAuth();
  const bv   = getAssociatedTokenAddressSync(base, pool, true, TOKEN_2022_PROGRAM_ID);
  const qv   = getAssociatedTokenAddressSync(quote, pool, true, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction();
  const [bvInfo, qvInfo] = await Promise.all([conn.getAccountInfo(bv), conn.getAccountInfo(qv)]);
  if (!bvInfo) tx.add(createAssociatedTokenAccountInstruction(creator.publicKey, bv, pool, base, TOKEN_2022_PROGRAM_ID));
  if (!qvInfo) tx.add(createAssociatedTokenAccountInstruction(creator.publicKey, qv, pool, quote, TOKEN_2022_PROGRAM_ID));
  tx.add(new TransactionInstruction({
    programId: DBC_PROGRAM,
    keys: [
      { pubkey: pool,            isSigner: false, isWritable: true  },
      { pubkey: config,          isSigner: false, isWritable: false },
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: base,            isSigner: false, isWritable: false },
      { pubkey: quote,           isSigner: false, isWritable: false },
      { pubkey: bv,              isSigner: false, isWritable: true  },
      { pubkey: qv,              isSigner: false, isWritable: true  },
      { pubkey: ev,              isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID,   isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: DISC_INIT_POOL,
  }));
  const sig = await sendAndConfirmTransaction(conn, tx, [creator], { commitment: "confirmed" });
  console.log(`  pool: ${pool.toBase58()} (${sig})`);
  return pool;
}

// ---- Main ------------------------------------------------------------------
(async () => {
  const conn = new Connection(RPC_URL, "confirmed");
  const raw = JSON.parse(readFileSync(path.join(__dir, "../platform-keypair.json"), "utf8"));
  const platform = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log(`Platform: ${platform.publicKey.toBase58()}`);

  const bal = await conn.getBalance(platform.publicKey);
  if (bal < 0.05 * LAMPORTS_PER_SOL) {
    console.error(`\nNeed ≥ 0.05 SOL on devnet. Current: ${bal / LAMPORTS_PER_SOL} SOL`);
    console.error(`Fund with: solana airdrop 2 ${platform.publicKey.toBase58()} --url devnet`);
    console.error("Or visit: https://faucet.solana.com");
    process.exit(1);
  }

  console.log("\n1. Minting mock rfstacc...");
  const rfstaccKp = await createMint(conn, platform, TOKEN_DECIMALS);

  console.log("\n2. Pool 1 DBC config (platform-owned, Leak/rfstacc)...");
  const pool1Config = await createDbcConfig(conn, platform, rfstaccKp.publicKey, BINDING_TARGET, 9900, 100, 500);

  console.log("\n3. Minting Leak token (1 B)...");
  const leakKp = await createMint(conn, platform, TOKEN_DECIMALS);
  await mintTokens(conn, platform, leakKp.publicKey, DONT_LEAK_SUPPLY);

  console.log("\n4. Minting DontLeak token (1 B)...");
  const dontLeakKp = await createMint(conn, platform, TOKEN_DECIMALS);
  await mintTokens(conn, platform, dontLeakKp.publicKey, DONT_LEAK_SUPPLY);

  console.log("\n5. Pool 2 DBC config (user-owned, DontLeak/Leak)...");
  const pool2Config = await createDbcConfig(conn, platform, leakKp.publicKey, 0n, 500, 100, 300);

  console.log("\n6. Deploying Pool 1 (Leak/rfstacc)...");
  const leakPool = await deployPool(conn, platform, leakKp.publicKey, rfstaccKp.publicKey, pool1Config);

  console.log("\n7. Deploying Pool 2 (DontLeak/Leak)...");
  const dontLeakPool = await deployPool(conn, platform, dontLeakKp.publicKey, leakKp.publicKey, pool2Config);

  const result = {
    network: "devnet",
    platformPubkey: platform.publicKey.toBase58(),
    mockRfstaccMint: rfstaccKp.publicKey.toBase58(),
    leakMint: leakKp.publicKey.toBase58(),
    dontLeakMint: dontLeakKp.publicKey.toBase58(),
    pool1ConfigAddress: pool1Config.toBase58(),
    pool2ConfigAddress: pool2Config.toBase58(),
    leakPoolAddress: leakPool.toBase58(),
    dontLeakPoolAddress: dontLeakPool.toBase58(),
    createdAt: new Date().toISOString(),
  };

  writeFileSync(path.join(__dir, "../dev-deployment.json"), JSON.stringify(result, null, 2));
  console.log("\n✓ Bootstrap complete! Saved to dev-deployment.json");
  console.table(result);
})();
