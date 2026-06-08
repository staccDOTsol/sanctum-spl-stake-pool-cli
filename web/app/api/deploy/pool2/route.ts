/**
 * POST /api/deploy/pool2
 *
 * Server-side transaction builder for Pool 2 (DontLeak / Leak).
 * Uses the @meteora-ag/dynamic-bonding-curve-sdk (correct Anchor discriminators).
 *
 * Body: {
 *   payer:           string  (user wallet pubkey, base58)
 *   configPubkey:    string  (pre-generated config account pubkey, base58)
 *   dontLeakPubkey:  string  (pre-generated DontLeak mint pubkey, base58)
 *   name:            string  (DontLeak token name)
 *   symbol:          string  (DontLeak token symbol)
 *   uri:             string  (metadata JSON URI)
 * }
 *
 * Response: {
 *   txBase64:     string   (unsigned combined tx — sign with [configKp, dontLeakKp, wallet])
 *   pool2Address: string   (derived pool address, for display)
 *   blockhash:    string
 *   lastValidBlockHeight: number
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  buildCurveWithMarketCap,
  CollectFeeMode, ActivationType, TokenType,
  MigrationOption, MigrationFeeOption, TokenAuthorityOption,
  BaseFeeMode, deriveDbcPoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

const RPC_URL   = process.env.SOLANA_RPC_URL ?? "https://mainnet.helius-rpc.com/?api-key=d1c96b01-1c06-4d46-9b69-57e7260fb9d8";
const LEAK_MINT = new PublicKey("GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS");

function buildPool2ConfigParam() {
  return buildCurveWithMarketCap({
    token: {
      tokenType:            TokenType.Token2022,
      tokenBaseDecimal:     9,
      tokenQuoteDecimal:    9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply:     1_000_000_000, // 1B DontLeak tokens
      leftover:             0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 500, // 5% starting fee
          endingFeeBps:   100, // 1% ending fee
          numberOfPeriod:  10,
          totalDuration:   10,
        },
      },
      dynamicFeeEnabled:           false,
      collectFeeMode:              CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee:             0,
      enableFirstSwapWithMinFee:   false,
    },
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
      totalLockedVestingAmount:       0,
      numberOfVestingPeriod:          0,
      cliffUnlockAmount:              0,
      totalVestingDuration:           0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType:     ActivationType.Slot,
    initialMarketCap:   11,
    migrationMarketCap: 1100, // ~1000 LEAK tokens binding target
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { payer, configPubkey, dontLeakPubkey, name, symbol, uri } = body as {
      payer:          string;
      configPubkey:   string;
      dontLeakPubkey: string;
      name:           string;
      symbol:         string;
      uri:            string;
    };

    if (!payer || !configPubkey || !dontLeakPubkey || !name || !symbol || !uri) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const conn    = new Connection(RPC_URL, "confirmed");
    const client  = DynamicBondingCurveClient.create(conn, "confirmed");
    const payerPk = new PublicKey(payer);

    const configParam = buildPool2ConfigParam();

    // createConfigAndPool combines config init + pool init into one transaction
    const tx = await client.partner.createConfigAndPool({
      config:           configPubkey,
      feeClaimer:       payer,
      leftoverReceiver: payer,
      quoteMint:        LEAK_MINT.toBase58(),
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

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer        = payerPk;

    // Derive pool address for display
    const pool2Address = deriveDbcPoolAddress(
      LEAK_MINT,
      new PublicKey(dontLeakPubkey),
      new PublicKey(configPubkey),
    );

    return NextResponse.json({
      txBase64:            tx.serialize({ requireAllSignatures: false }).toString("base64"),
      pool2Address:        pool2Address.toBase58(),
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
