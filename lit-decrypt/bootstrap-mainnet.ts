/**
 * bootstrap-mainnet.ts
 *
 * One-shot mainnet bootstrap for leak.markets.
 * Uses @meteora-ag/dynamic-bonding-curve-sdk for correct Anchor instruction building.
 *
 * What it does:
 *   1. Creates the platform-owned Meteora DBC PoolConfig for Pool 1
 *      (Leak token / r-fstacc LST — binding target 10,000 rfstacc, 99%→1% anti-snipe fee)
 *   2. Initializes Pool 1 via initializeVirtualPoolWithToken2022
 *      (the Leak Token-2022 mint is created by this instruction)
 *   3. Writes mainnet-deployment.json
 *
 * Pool 2 (DontLeak / Leak) is user-created on-demand via the web UI.
 * The platform's job is only Pool 1 + the Leak token.
 *
 * Prerequisites:
 *   Fund the platform keypair with >= 0.05 SOL on mainnet.
 *   Address: GYKSfwaTZXJ29vGha39ETNxkBPeBGs6KaRP2eDjaRw6U
 *
 * Run:
 *   cd lit-decrypt && npx tsx bootstrap-mainnet.ts
 */
import {
  Connection, Keypair, PublicKey,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  buildCurveWithMarketCap,
  CollectFeeMode, ActivationType, TokenType,
  MigrationOption, MigrationFeeOption, TokenAuthorityOption,
  BaseFeeMode,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

const RPC_URL    = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";
const MIN_SOL    = 0.05;

// r-fstacc LST mainnet mint
const RFSTACC_MINT = new PublicKey("pSYRpDqr847kB2nD5ZhjcPsHLV2ZpUxweXm1MwiSTcc");

// Leak token metadata (stub URI — update after Vercel Blob upload)
const LEAK_TOKEN_NAME   = "Leak";
const LEAK_TOKEN_SYMBOL = "LEAK";
const LEAK_TOKEN_URI    = "https://leak.markets/tokens/leak-metadata.json";

// buildCurveWithMarketCap with migrationMarketCap=110000 yields
// migrationQuoteThreshold ≈ 10,000 rfstacc (10_000 × 10^9 lamports)
function buildPool1ConfigParam() {
  return buildCurveWithMarketCap({
    token: {
      tokenType:           TokenType.Token2022,
      tokenBaseDecimal:    9,
      tokenQuoteDecimal:   9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply:    1_000_000_000, // 1B tokens
      leftover:            0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 9900, // 99% initial anti-snipe fee
          endingFeeBps:    100, // 1% final fee
          numberOfPeriod:   10,
          totalDuration:    10, // slots
        },
      },
      dynamicFeeEnabled:          false,
      collectFeeMode:             CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50, // platform earns 50% of all Pool 1 trading fees
      poolCreationFee:             0,
      enableFirstSwapWithMinFee:  false,
    },
    migration: {
      migrationOption:    MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps25,
      migrationFee:       { feePercentage: 0, feeNumerator: 0, creatorFeePercentage: 0 },
      migratedPoolFee:    undefined,
    },
    liquidityDistribution: {
      partnerLiquidityPercentage:                90,  // platform claims 90% of LP on migration
      partnerPermanentLockedLiquidityPercentage: 10, // 10% permanently locked (protocol requirement)
      creatorLiquidityPercentage:                0,
      creatorPermanentLockedLiquidityPercentage: 0,
      partnerLiquidityVestingInfoParams:         undefined,
      creatorLiquidityVestingInfoParams:         undefined,
    },
    lockedVesting: {
      totalLockedVestingAmount:        0,
      numberOfVestingPeriod:           0,
      cliffUnlockAmount:               0,
      totalVestingDuration:            0,
      cliffDurationFromMigrationTime:  0,
    },
    activationType:      ActivationType.Slot,
    initialMarketCap:    1100,   // 1% of migration
    migrationMarketCap:  110000, // → threshold ≈ 10,000 rfstacc
  });
}

(async () => {
  const conn = new Connection(RPC_URL, "confirmed");
  const raw  = JSON.parse(readFileSync(path.join(__dir, "..", "platform-keypair.json"), "utf8"));
  const platform = Keypair.fromSecretKey(Uint8Array.from(raw));

  console.log("\nleak.markets — mainnet bootstrap");
  console.log(`  Platform : ${platform.publicKey.toBase58()}`);
  console.log(`  rfstacc  : ${RFSTACC_MINT.toBase58()}`);
  console.log(`  RPC      : ${RPC_URL}\n`);

  const bal = await conn.getBalance(platform.publicKey);
  const solBal = bal / LAMPORTS_PER_SOL;
  console.log(`  Balance  : ${solBal.toFixed(4)} SOL`);
  if (solBal < MIN_SOL) {
    console.error(`\n  Need >= ${MIN_SOL} SOL to proceed.`);
    process.exit(1);
  }

  const client = DynamicBondingCurveClient.create(conn, "confirmed");

  // Generate keypairs
  const pool1ConfigKp = Keypair.generate();
  const leakMintKp    = Keypair.generate();

  console.log(`  pool1Config keypair : ${pool1ConfigKp.publicKey.toBase58()}`);
  console.log(`  leakMint keypair    : ${leakMintKp.publicKey.toBase58()}`);

  // ── Step 1: Create Pool 1 config ─────────────────────────────────────────
  console.log("\n1. Creating Pool 1 config (Leak/rfstacc, 10K rfstacc binding target)...");

  const configParam = buildPool1ConfigParam();
  console.log(`   migrationQuoteThreshold: ${configParam.migrationQuoteThreshold?.toString()} lamports`);
  console.log(`   (≈ ${(Number(configParam.migrationQuoteThreshold?.toString()) / 1e9).toFixed(2)} rfstacc)`);

  const configTx = await client.partner.createConfig({
    config:           pool1ConfigKp.publicKey.toBase58(),
    feeClaimer:       platform.publicKey.toBase58(),
    leftoverReceiver: platform.publicKey.toBase58(),
    quoteMint:        RFSTACC_MINT.toBase58(),
    payer:            platform.publicKey.toBase58(),
    ...configParam,
  });

  const configSig = await sendAndConfirmTransaction(conn, configTx, [platform, pool1ConfigKp], { commitment: "confirmed" });
  console.log(`   ✓ config: ${pool1ConfigKp.publicKey.toBase58()}`);
  console.log(`     tx: ${configSig}`);

  // ── Step 2: Initialize Pool 1 (creates Leak Token-2022 mint) ─────────────
  console.log("\n2. Initializing Pool 1 / creating Leak token...");

  const poolTx = await client.partner.buildCreatePoolTx(
    {
      config:      pool1ConfigKp.publicKey,
      payer:       platform.publicKey,
      poolCreator: platform.publicKey,
      baseMint:    leakMintKp.publicKey,
      name:        LEAK_TOKEN_NAME,
      symbol:      LEAK_TOKEN_SYMBOL,
      uri:         LEAK_TOKEN_URI,
    },
    TokenType.Token2022,
    RFSTACC_MINT,
  );

  const poolSig = await sendAndConfirmTransaction(conn, poolTx, [platform, leakMintKp], { commitment: "confirmed" });

  // Derive pool address for display
  const { deriveDbcPoolAddress } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const pool1Address = deriveDbcPoolAddress(RFSTACC_MINT, leakMintKp.publicKey, pool1ConfigKp.publicKey);

  console.log(`   ✓ pool:  ${pool1Address.toBase58()}`);
  console.log(`   ✓ leak:  ${leakMintKp.publicKey.toBase58()}`);
  console.log(`     tx: ${poolSig}`);

  // ── Save deployment ───────────────────────────────────────────────────────
  const out = {
    network:            "mainnet-beta",
    platformPubkey:     platform.publicKey.toBase58(),
    rfstaccMint:        RFSTACC_MINT.toBase58(),
    leakMint:           leakMintKp.publicKey.toBase58(),
    pool1ConfigAddress: pool1ConfigKp.publicKey.toBase58(),
    pool1Address:       pool1Address.toBase58(),
    migrationQuoteThresholdLamports: configParam.migrationQuoteThreshold?.toString(),
    createdAt:          new Date().toISOString(),
  };

  writeFileSync(
    path.join(__dir, "..", "mainnet-deployment.json"),
    JSON.stringify(out, null, 2),
  );

  console.log("\n  Bootstrap complete! Saved mainnet-deployment.json");
  console.table(out);
})();
