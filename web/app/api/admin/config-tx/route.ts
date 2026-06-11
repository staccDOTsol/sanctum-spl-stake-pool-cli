/**
 * POST /api/admin/config-tx
 *
 * Builds an unsigned createConfig transaction for either the stable or meme
 * L1 pool config. The browser signs with an ephemeral config keypair + the
 * user's wallet (payer), then broadcasts. Call this ONCE per config type on
 * mainnet — save the resulting config address as an env var.
 *
 * Body: { payer: string, configType: "stable" | "meme", configPubkey: string }
 * Response: { txBase64, configAddress, blockhash, lastValidBlockHeight }
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey }      from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  buildCurveWithMarketCap,
  CollectFeeMode, ActivationType, TokenType,
  MigrationOption, MigrationFeeOption, TokenAuthorityOption,
  BaseFeeMode,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const runtime = "nodejs";

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";

// Platform fee recipient — we earn partner share on both L1 configs
const PLATFORM_FEE_RECEIVER = process.env.PLATFORM_FEE_RECEIVER ?? "";

const QUOTE_MINTS = {
  stable: process.env.RFREESTACC_QUOTE_MINT ?? "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS",
  meme:   "GNcibpKH7dyMux4JEYE3dv4sfkXmDCfJU4CpJNM9pump",
};

const COMMON = {
  migration: {
    migrationOption:    MigrationOption.MET_DAMM_V2,
    migrationFeeOption: MigrationFeeOption.FixedBps25,
    migrationFee:       { feePercentage: 0, creatorFeePercentage: 0 },
    migratedPoolFee:    undefined,
  },
  liquidityDistribution: {
    partnerLiquidityPercentage:                0,
    partnerPermanentLockedLiquidityPercentage: 0,
    creatorLiquidityPercentage:                90,
    creatorPermanentLockedLiquidityPercentage: 10,
    partnerLiquidityVestingInfoParams:         undefined,
    creatorLiquidityVestingInfoParams:         undefined,
  },
  lockedVesting: {
    totalLockedVestingAmount: 0, numberOfVestingPeriod: 0,
    cliffUnlockAmount: 0, totalVestingDuration: 0,
    cliffDurationFromMigrationTime: 0,
  },
};

function buildStableCurve() {
  return buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.Token2022, tokenBaseDecimal: 9, tokenQuoteDecimal: 9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000, leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: 500, endingFeeBps: 100, numberOfPeriod: 10, totalDuration: 10 },
      },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
    },
    ...COMMON,
    activationType: ActivationType.Slot,
    initialMarketCap: 11, migrationMarketCap: 1100,
  });
}

function buildMemeCurve() {
  return buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.Token2022, tokenBaseDecimal: 9, tokenQuoteDecimal: 6,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000, leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: 1000, endingFeeBps: 100, numberOfPeriod: 20, totalDuration: 20 },
      },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
    },
    ...COMMON,
    activationType: ActivationType.Slot,
    initialMarketCap: 1_000, migrationMarketCap: 1_000_000_000,
  });
}

export async function POST(req: NextRequest) {
  try {
    const { payer, configType, configPubkey } = await req.json() as {
      payer:       string;
      configType:  "stable" | "meme";
      configPubkey: string;
    };

    if (!payer || !configType || !configPubkey) {
      return NextResponse.json({ error: "payer, configType, configPubkey required" }, { status: 400 });
    }
    if (!PLATFORM_FEE_RECEIVER) {
      return NextResponse.json({ error: "PLATFORM_FEE_RECEIVER env var not set" }, { status: 503 });
    }

    const conn       = new Connection(RPC, "confirmed");
    const client     = DynamicBondingCurveClient.create(conn, "confirmed");
    const quoteMint  = QUOTE_MINTS[configType];
    const curveParam = configType === "meme" ? buildMemeCurve() : buildStableCurve();

    // createConfig — platform is feeClaimer and leftoverReceiver (we earn partner share)
    const tx = await client.partner.createConfig({
      config:           configPubkey,
      feeClaimer:       PLATFORM_FEE_RECEIVER,
      leftoverReceiver: PLATFORM_FEE_RECEIVER,
      quoteMint,
      payer,
      ...curveParam,
    });

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer        = new PublicKey(payer);

    return NextResponse.json({
      txBase64:            tx.serialize({ requireAllSignatures: false }).toString("base64"),
      configAddress:       configPubkey,
      blockhash,
      lastValidBlockHeight,
    });
  } catch (err: unknown) {
    console.error("[/api/admin/config-tx]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
