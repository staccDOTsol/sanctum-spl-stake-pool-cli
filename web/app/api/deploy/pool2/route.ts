/**
 * POST /api/deploy/pool2
 *
 * Builds ONE unsigned DBC createConfigAndPool transaction — called twice
 * per launch:
 *   Pool A: base = net-new LEAK_content,    quote = rfreestacc | GNcib | stacccana
 *   Pool B: base = net-new DONTLEAK_content, quote = THAT LEAK_content mint
 * (Pool B is built after Pool A confirms, because its quote mint must
 * exist on-chain for the SDK to read decimals/program.)
 *
 * Body: { payer, configPubkey, basePubkey, quoteMintAddress, name, symbol,
 *         uri, curve: "stable" | "meme" }
 * Response: { txBase64, poolAddress, quoteMint, blockhash, lastValidBlockHeight }
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

const RPC_URL = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";

// Market caps are in QUOTE TOKENS. buildCurveWithMarketCap loses precision
// beyond certain raw magnitudes (threshold × 10^decimals ≳ 2^55 throws
// "Not enough liquidity … amountLeft: <dust>"), so these combos are the
// EMPIRICALLY VERIFIED set — change decimals/MCs together or builds break:
//   pool A  base 6 dec, quote 6 dec → 1M/1B   (thr ≈ 30.65M quote)
//   pool A  base 6 dec, quote 9 dec → 1k/1M   (thr ≈ 30.65k quote)
//   pool B  base 9 dec, quote 6 dec → 16M/16B (thr ≈ 490M LEAK ≈ half supply)
function marketCaps(kind: "stable" | "meme" | "dontleak", quoteDecimals: number): { initial: number; migration: number } {
  if (kind === "dontleak") return { initial: 16_000_000, migration: 16_000_000_000 };
  if (quoteDecimals >= 9)  return { initial: 1_000,      migration: 1_000_000 };
  return { initial: 1_000_000, migration: 1_000_000_000 };
}

// SDK hardcodes TOKEN_PROGRAM_ID for tokenQuoteProgram — patch when the
// quote is actually Token-2022.
function patchIfT22(tx: Transaction, quoteIsT22: boolean): Transaction {
  if (!quoteIsT22) return tx;
  for (const ix of tx.instructions) {
    for (const key of ix.keys) {
      if (key.pubkey.equals(TOKEN_PROGRAM_ID)) key.pubkey = TOKEN_2022_PROGRAM_ID;
    }
  }
  return tx;
}

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

function buildCurve(kind: "stable" | "meme" | "dontleak", quoteDecimals: number, baseDecimals: number) {
  const fee = kind === "meme"
    ? { startingFeeBps: 1000, endingFeeBps: 100, numberOfPeriod: 20, totalDuration: 20 }
    : { startingFeeBps: 500,  endingFeeBps: 100, numberOfPeriod: 10, totalDuration: 10 };
  const { initial: initialMC, migration: migrationMC } = marketCaps(kind, quoteDecimals);
  return buildCurveWithMarketCap({
    token: {
      tokenType:            TokenType.Token2022,
      tokenBaseDecimal:     baseDecimals,
      tokenQuoteDecimal:    quoteDecimals, // read from the chain
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply:     1_000_000_000,
      leftover:             0,
    },
    fee: {
      baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: fee },
      dynamicFeeEnabled:           false,
      collectFeeMode:              CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee:             0,
      enableFirstSwapWithMinFee:   false,
    },
    ...COMMON,
    activationType:     ActivationType.Slot,
    initialMarketCap:   initialMC,
    migrationMarketCap: migrationMC,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      payer:            string;
      configPubkey:     string;
      basePubkey:       string;
      quoteMintAddress: string;
      name:             string;
      symbol:           string;
      uri:              string;
      curve?:           "stable" | "meme" | "dontleak";
      baseDecimals?:    number;
      feeClaimer?:      string; // bounty mode: route fees to the secret wallet
    };
    const { payer, configPubkey, basePubkey, quoteMintAddress, name, symbol, uri, curve = "stable", baseDecimals = 6, feeClaimer } = body;

    if (!payer || !configPubkey || !basePubkey || !quoteMintAddress || !name || !symbol || !uri) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Partner fees (and migration leftover) accrue to feeClaimer. Bounty
    // launches point this at the generated secret wallet so the pot the
    // crowd pays into is claimable only by whoever cracks the key.
    const feeReceiver = feeClaimer || payer;

    const quoteMint = new PublicKey(quoteMintAddress);
    const conn      = new Connection(RPC_URL, "confirmed");
    const client    = DynamicBondingCurveClient.create(conn, "confirmed");
    const payerPk   = new PublicKey(payer);

    // Read the quote mint once: token program + actual decimals
    const quoteInfo  = await conn.getParsedAccountInfo(quoteMint);
    if (!quoteInfo.value) {
      return NextResponse.json({ error: `Quote mint ${quoteMintAddress} not found on-chain (deploy its pool first)` }, { status: 400 });
    }
    const quoteData  = quoteInfo.value.data;
    const quoteIsT22 = quoteInfo.value.owner.equals(TOKEN_2022_PROGRAM_ID);
    const quoteDecimals =
      (quoteData && "parsed" in quoteData ? quoteData.parsed?.info?.decimals : undefined) ?? 9;

    const rawTx = await client.partner.createConfigAndPool({
      config:           configPubkey,
      feeClaimer:       feeReceiver,
      leftoverReceiver: feeReceiver,
      quoteMint:        quoteMint.toBase58(),
      payer,
      preCreatePoolParam: {
        baseMint:    new PublicKey(basePubkey),
        poolCreator: payerPk,
        name,
        symbol,
        uri,
      },
      ...buildCurve(curve, quoteDecimals, baseDecimals),
    });

    const tx = patchIfT22(rawTx, quoteIsT22);

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer        = payerPk;

    const poolAddress = deriveDbcPoolAddress(
      quoteMint, new PublicKey(basePubkey), new PublicKey(configPubkey),
    );

    return NextResponse.json({
      txBase64:    tx.serialize({ requireAllSignatures: false }).toString("base64"),
      poolAddress: poolAddress.toBase58(),
      quoteMint:   quoteMint.toBase58(),
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
