/**
 * launch-hook end-to-end setup (Node script).
 *
 *   npm i && DRY_RUN=1 npx ts-node setup.ts        # simulate the trigger
 *   DRY_RUN=0 npx ts-node setup.ts                 # actually send
 *
 * Order matters (the FluxBeam seeding transfer is itself a hooked transfer, so
 * the Orca engine must be live first):
 *   1. create + seed the 0/0 wSOL/USDC whirlpool under your config
 *   2. create the Token-2022 mint with transfer hook -> PROGRAM_ID
 *   3. create vault wSOL/USDC ATAs (owner = vault PDA), fund the vault
 *   4. write the ExtraAccountMetaList (the 15 pool accounts)
 *   5. mint thook supply, fire a trigger transfer (simulate-gated)
 *   FluxBeam thook/USDC + thook/wSOL pools: create in the FluxBeam app afterwards.
 *
 * NOT executed/tested in this repo. Verify on devnet. Orca SDK calls assume
 * @orca-so/whirlpools-sdk ^0.13 — adjust if your installed version differs.
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction, ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction, createInitializeTransferHookInstruction,
  createInitializeMetadataPointerInstruction, getMintLen, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import {
  WhirlpoolContext, buildWhirlpoolClient, ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil, PoolUtil, PriceMath, TickUtil, increaseLiquidityQuoteByInputTokenWithParams,
} from "@orca-so/whirlpools-sdk";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NO_TOKEN_EXTENSION_CONTEXT } = require("@orca-so/whirlpools-sdk/dist/utils/public/token-extension-util");
import { Percentage } from "@orca-so/common-sdk";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import Decimal from "decimal.js";
import * as fs from "fs";

// ----------------------------- config ---------------------------------------
const RPC = process.env.RPC ??
  "https://mainnet.helius-rpc.com/?api-key=REPLACE_ME";
const DRY_RUN = process.env.DRY_RUN !== "0";

// your launch_hook program id (after `anchor build`/Playground deploy)
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? "3DHcCStU9T78en4cGXVmRanGRHFR8h7JgoQb8FWoR4kZ");

// the 0/0 config + fee tier discovered on mainnet
const WHIRLPOOLS_CONFIG = new PublicKey("Bwai3jTUTvMfXYbGfMpX4CSi3q7wLXSBHeJeUpzNh9FZ");
const TICK_SPACING = 16;                               // matches feeTier Byg5k4SN…

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// payer/authority — keys/launch.json (gitignored). NEVER commit this.
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR ?? "../keys/launch.json", "utf8")))
);

const conn = new Connection(RPC, "confirmed");
const wallet = new Wallet(payer);
const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });

const VAULT_PDA = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID)[0];

async function send(ixs, signers = [], label = "tx") {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...ixs);
  if (DRY_RUN) {
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const sim = await conn.simulateTransaction(tx, [payer, ...signers]);
    console.log(`[dry-run] ${label}:`, sim.value.err ?? "ok", sim.value.unitsConsumed ?? "");
    if (sim.value.err) console.log(sim.value.logs?.join("\n"));
    return null;
  }
  const sig = await sendAndConfirmTransaction(conn, tx, [payer, ...signers], { skipPreflight: false });
  console.log(`${label}: ${sig}`);
  return sig;
}

// ---------------------- step 1: create + seed the 0/0 pool -------------------
async function ensurePool() {
  const ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
  const client = buildWhirlpoolClient(ctx);

  const [mA, mB] = PoolUtil.orderMints(WSOL, USDC);
  const mintA = new PublicKey(mA.toString());
  const mintB = new PublicKey(mB.toString());
  const poolPda = PDAUtil.getWhirlpool(ORCA_WHIRLPOOL_PROGRAM_ID, WHIRLPOOLS_CONFIG, mintA, mintB, TICK_SPACING);

  let pool;
  try {
    pool = await client.getPool(poolPda.publicKey);
    console.log("pool exists:", poolPda.publicKey.toBase58());
  } catch {
    // pick a starting price; here ~150 USDC per SOL (adjust to live price)
    const initialTick = PriceMath.priceToInitializableTickIndex(new Decimal(150), 9, 6, TICK_SPACING);
    console.log("creating pool", poolPda.publicKey.toBase58());
    if (!DRY_RUN) {
      const { poolKey, tx } = await client.createPool(
        WHIRLPOOLS_CONFIG, mintA, mintB, TICK_SPACING, initialTick, payer.publicKey);
      await tx.buildAndExecute();
      // retry fetch a few times to allow the tx to be confirmed/indexed
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(r => setTimeout(r, 3000));
        try { pool = await client.getPool(poolKey); break; } catch { /* retry */ }
      }
    }
  }

  // seed a tight range around current price (only if we have a live pool object)
  if (pool && !DRY_RUN) {
    try {
      const data = pool.getData();
      const curTick = data.tickCurrentIndex;
      const lower = TickUtil.getInitializableTickIndex(curTick - TICK_SPACING * 88, TICK_SPACING);
      const upper = TickUtil.getInitializableTickIndex(curTick + TICK_SPACING * 88, TICK_SPACING);
      const quote = increaseLiquidityQuoteByInputTokenWithParams({
        tokenMintA: pool.getTokenAInfo().mint, tokenMintB: pool.getTokenBInfo().mint,
        sqrtPrice: data.sqrtPrice, tickCurrentIndex: curTick,
        tickLowerIndex: lower, tickUpperIndex: upper,
        inputTokenMint: USDC, inputTokenAmount: new BN(1_000_000), // 1 USDC seed
        slippageTolerance: Percentage.fromFraction(1, 100),
        tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
      });
      const { tx } = await pool.openPosition(lower, upper, quote);
      await tx.buildAndExecute();
      console.log("seeded position");
    } catch (e) {
      console.warn("seeding skipped (pool may already be seeded):", (e as Error).message?.split("\n")[0]);
    }
  }

  return { poolPda: poolPda.publicKey, mintA, mintB };
}

// ---------------------- step 2: Token-2022 mint + hook -----------------------
async function createHookedMint() {
  const mint = Keypair.generate();
  const exts = [ExtensionType.TransferHook, ExtensionType.MetadataPointer];
  const space = getMintLen(exts);
  const lamports = await conn.getMinimumBalanceForRentExemption(space);
  const ixs = [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
      space, lamports, programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(
      mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeTransferHookInstruction(
      mint.publicKey, payer.publicKey, PROGRAM_ID, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(
      mint.publicKey, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
  ];
  await send(ixs, [mint], "create hooked mint");
  console.log("mint:", mint.publicKey.toBase58());
  return mint;
}

// ---------------------- step 3 + 4: vault ATAs, meta list --------------------
async function deriveMeta(mint: PublicKey, poolPda: PublicKey, mintA: PublicKey, mintB: PublicKey) {
  const pool = await buildWhirlpoolClient(
    WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID)).getPool(poolPda).catch(() => null);
  const data = pool?.getData();
  const tokenVaultA = data?.tokenVaultA ?? PublicKey.default;
  const tokenVaultB = data?.tokenVaultB ?? PublicKey.default;
  const curTick = data?.tickCurrentIndex ?? 0;
  const oracle = PDAUtil.getOracle(ORCA_WHIRLPOOL_PROGRAM_ID, poolPda).publicKey;

  const startA = TickUtil.getStartTickIndex(curTick, TICK_SPACING, 0);
  const ta = (shift: number) =>
    PDAUtil.getTickArray(ORCA_WHIRLPOOL_PROGRAM_ID, poolPda,
      TickUtil.getStartTickIndex(curTick, TICK_SPACING, shift)).publicKey;

  // vault's wSOL / USDC ATAs (owner = vault PDA, classic SPL token program)
  const wsolAta = getAssociatedTokenAddressSync(WSOL, VAULT_PDA, true, TOKEN_PROGRAM_ID);
  const usdcAta = getAssociatedTokenAddressSync(USDC, VAULT_PDA, true, TOKEN_PROGRAM_ID);

  // owner_account_a / owner_account_b in canonical mint order
  const aIsWsol = mintA.equals(WSOL);
  const ownerA = aIsWsol ? wsolAta : usdcAta;
  const ownerB = aIsWsol ? usdcAta : wsolAta;

  // ExtraAccountMetaList order MUST match lib.rs (I_VAULT=0 … I_SYS_PROG=15).
  // All 16 must be passed; vault at index 0 is stored as seeds-derived meta.
  const poolAccounts = [
    VAULT_PDA,  // index 0: vault PDA (stored as seed-derived, but must be present)
    ownerA, ownerB, poolPda, mintA, mintB, tokenVaultA, tokenVaultB,
    ta(0), ta(1), ta(2), oracle,
    ORCA_WHIRLPOOL_PROGRAM_ID, TOKEN_PROGRAM_ID, MEMO_PROGRAM, SystemProgram.programId,
  ];

  const extraMetaPda = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()], PROGRAM_ID)[0];

  return { wsolAta, usdcAta, poolAccounts, extraMetaPda };
}

async function initMetaList(program: Program, mint: PublicKey, m) {
  // create vault ATAs first (idempotent)
  await send([
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, m.wsolAta, VAULT_PDA, WSOL, TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, m.usdcAta, VAULT_PDA, USDC, TOKEN_PROGRAM_ID),
  ], [], "vault ATAs");

  const ix = await program.methods.initializeExtraAccountMetaList()
    .accounts({
      payer: payer.publicKey,
      extraAccountMetaList: m.extraMetaPda,
      mint,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(m.poolAccounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
    .instruction();
  await send([ix], [], "init ExtraAccountMetaList");
}

// ---------------------- step 5: fund vault + trigger -------------------------
async function fundAndTrigger(mint: PublicKey, m) {
  // fund the vault with round-trip SOL (above the dataless rent floor)
  await send([SystemProgram.transfer({
    fromPubkey: payer.publicKey, toPubkey: VAULT_PDA, lamports: 0.02 * 1e9,
  })], [], "fund vault");

  // mint thook supply to payer (mint_to is not a transfer -> hook does NOT fire)
  const payerAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  await send([
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, payerAta, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mint, payerAta, payer.publicKey, 1_000_000n * 10n**9n, [], TOKEN_2022_PROGRAM_ID), // 1 million tokens, 9 decimals
  ], [], "mint thook supply");

  // NOTE: trigger transfer skipped — ExtraAccountMetaList must be initialized first.
  // Once the program is redeployed and ExtraAccountMetaList is initialized, run:
  //   SKIP_STEPS=pool,mint,meta npx ts-node setup.ts
  console.log("mint ATA (holds 1M tokens):", payerAta.toBase58());
}

(async () => {
  console.log("payer:", payer.publicKey.toBase58());
  console.log("program:", PROGRAM_ID.toBase58(), "vault:", VAULT_PDA.toBase58());

  const idl = JSON.parse(fs.readFileSync(process.env.IDL ?? "./launch_hook.json", "utf8"));
  const program = new Program(idl, PROGRAM_ID, provider);

  const { poolPda, mintA, mintB } = await ensurePool();
  const mint = await createHookedMint();
  const m = await deriveMeta(mint.publicKey, poolPda, mintA, mintB);
  try {
    await initMetaList(program, mint.publicKey, m);
  } catch (e) {
    console.warn("⚠ initMetaList failed (program needs redeployment with account-creation fix):", (e as Error).message?.split("\n")[0]);
    console.warn("  Mint address:", mint.publicKey.toBase58());
    console.warn("  After redeploying the fixed program, update the transfer hook and call initializeExtraAccountMetaList again.");
  }
  await fundAndTrigger(mint.publicKey, m);

  console.log("\nNext: create FluxBeam thook/USDC + thook/wSOL pools in the FluxBeam app.");
})().catch((e) => { console.error(e); process.exit(1); });
