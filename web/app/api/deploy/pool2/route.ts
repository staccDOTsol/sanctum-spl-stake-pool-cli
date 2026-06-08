/**
 * POST /api/deploy/pool2
 *
 * Builds and returns an unsigned DBC createConfigAndPool transaction.
 * Supports two pool types:
 *   "stable"  — quote = LEAK (Token-2022, yield/rfreestacc curve)
 *   "meme"    — quote = GNcibpKH7dyMux4JEYE3dv4sfkXmDCfJU4CpJNM9pump, 1B migration cap
 *
 * Body: { payer, configPubkey, dontLeakPubkey, name, symbol, uri, poolType? }
 * Response: { txBase64, pool2Address, quoteMint, blockhash, lastValidBlockHeight }
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  buildCurveWithMarketCap,
  CollectFeeMode, ActivationType, TokenType,
  MigrationOption, MigrationFeeOption, TokenAuthorityOption,
  BaseFeeMode, deriveDbcPoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const runtime = "nodejs";

const RPC_URL   = process.env.SOLANA_RPC_URL
  ?? "https://mainnet.helius-rpc.com/?api-key=d1c96b01-1c06-4d46-9b69-57e7260fb9d8";

// stable quote = rfreestacc (set RFREESTACC_QUOTE_MINT env var once deployed)
// meme   quote = GNcibpKH7dyMux4JEYE3dv4sfkXmDCfJU4CpJNM9pump
const RFREESTACC = process.env.RFREESTACC_QUOTE_MINT ?? "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS";
const QUOTE_MINTS = {
  stable: new PublicKey(RFREESTACC),
  meme:   new PublicKey("GNcibpKH7dyMux4JEYE3dv4sfkXmDCfJU4CpJNM9pump"),
};

// Detect if a mint uses Token-2022 or legacy SPL Token at runtime.
// SDK hardcodes TOKEN_PROGRAM_ID for tokenQuoteProgram in initializeToken2022Pool —
// only patch when the quote is actually Token-2022.
function patchIfT22(tx: Transaction, quoteIsT22: boolean): Transaction {
  if (!quoteIsT22) return tx;
  for (const ix of tx.instructions) {
    for (const key of ix.keys) {
      if (key.pubkey.equals(TOKEN_PROGRAM_ID)) key.pubkey = TOKEN_2022_PROGRAM_ID;
    }
  }
  return tx;
}

const COMMON_LOCKED_VESTING = {
  totalLockedVestingAmount:       0,
  numberOfVestingPeriod:          0,
  cliffUnlockAmount:              0,
  totalVestingDuration:           0,
  cliffDurationFromMigrationTime: 0,
};

const COMMON_LIQUIDITY = {
  partnerLiquidityPercentage:                0,
  partnerPermanentLockedLiquidityPercentage: 0,
  creatorLiquidityPercentage:                90,
  creatorPermanentLockedLiquidityPercentage: 10,
  partnerLiquidityVestingInfoParams:         undefined,
  creatorLiquidityVestingInfoParams:         undefined,
};

const COMMON_MIGRATION = {
  migrationOption:    MigrationOption.MET_DAMM_V2,
  migrationFeeOption: MigrationFeeOption.FixedBps25,
  migrationFee:       { feePercentage: 0, creatorFeePercentage: 0 },
  migratedPoolFee:    undefined,
};

function buildStableConfig() {
  return buildCurveWithMarketCap({
    token: {
      tokenType:            TokenType.Token2022,
      tokenBaseDecimal:     9,
      tokenQuoteDecimal:    9, // LEAK = 9 decimals
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply:     1_000_000_000,
      leftover:             0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: 500, endingFeeBps: 100, numberOfPeriod: 10, totalDuration: 10 },
      },
      dynamicFeeEnabled:           false,
      collectFeeMode:              CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee:             0,
      enableFirstSwapWithMinFee:   false,
    },
    migration:             COMMON_MIGRATION,
    liquidityDistribution: COMMON_LIQUIDITY,
    lockedVesting:         COMMON_LOCKED_VESTING,
    activationType:        ActivationType.Slot,
    initialMarketCap:      11,
    migrationMarketCap:    1100,
  });
}

function buildMemeConfig() {
  return buildCurveWithMarketCap({
    token: {
      tokenType:            TokenType.Token2022,
      tokenBaseDecimal:     9,
      tokenQuoteDecimal:    6, // pump.fun = 6 decimals
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply:     1_000_000_000,
      leftover:             0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: 1000, endingFeeBps: 100, numberOfPeriod: 20, totalDuration: 20 },
      },
      dynamicFeeEnabled:           false,
      collectFeeMode:              CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee:             0,
      enableFirstSwapWithMinFee:   false,
    },
    migration:             COMMON_MIGRATION,
    liquidityDistribution: COMMON_LIQUIDITY,
    lockedVesting:         COMMON_LOCKED_VESTING,
    activationType:        ActivationType.Slot,
    initialMarketCap:      1_000,
    migrationMarketCap:    1_000_000_000, // 1B quote tokens to bond
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      payer, configPubkey, dontLeakPubkey,
      name, symbol, uri,
      poolType = "stable",
    } = body as {
      payer:          string;
      configPubkey:   string;
      dontLeakPubkey: string;
      name:           string;
      symbol:         string;
      uri:            string;
      poolType?:      "stable" | "meme";
    };

    if (!payer || !configPubkey || !dontLeakPubkey || !name || !symbol || !uri) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const quoteMint   = QUOTE_MINTS[poolType] ?? QUOTE_MINTS.stable;
    const configParam = poolType === "meme" ? buildMemeConfig() : buildStableConfig();

    const conn    = new Connection(RPC_URL, "confirmed");
    const client  = DynamicBondingCurveClient.create(conn, "confirmed");
    const payerPk = new PublicKey(payer);

    // Detect quote mint program — patch only if Token-2022
    const quoteInfo  = await conn.getAccountInfo(quoteMint);
    const quoteIsT22 = quoteInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ?? false;

    const rawTx = await client.partner.createConfigAndPool({
      config:           configPubkey,
      feeClaimer:       payer,
      leftoverReceiver: payer,
      quoteMint:        quoteMint.toBase58(),
      payer,
      preCreatePoolParam: {
        baseMint:    new PublicKey(dontLeakPubkey),
        poolCreator: payerPk,
        name,
        symbol,
        uri,
      },
      ...configParam,
    });

    const tx = patchIfT22(rawTx, quoteIsT22);

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer        = payerPk;

    const pool2Address = deriveDbcPoolAddress(
      quoteMint,
      new PublicKey(dontLeakPubkey),
      new PublicKey(configPubkey),
    );

    return NextResponse.json({
      txBase64:            tx.serialize({ requireAllSignatures: false }).toString("base64"),
      pool2Address:        pool2Address.toBase58(),
      quoteMint:           quoteMint.toBase58(),
      blockhash,
      lastValidBlockHeight,
    });
  } catch (err: unknown) {
    console.error("[/api/deploy/pool2]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
