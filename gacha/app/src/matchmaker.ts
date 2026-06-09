/**
 * Matchmaker: listens for RollRequested events, selects a counterparty using
 * provable slot-hash randomness, prices both ATAs via Jupiter, and executes
 * the swap on-chain.
 *
 * Revenue model (zero house edge):
 *   - Rolling user pays `roll_fee` SOL (covers new ATA rent + matchmaker profit)
 *   - Matchmaker closes both old ATAs → receives ~0.00408 SOL rent each swap
 *   - New ATAs funded via init_if_needed (cost = 0 if already exists)
 *
 * Odds range:
 *   Users can win 0.86x–10000x their deposited USD value, determined purely by
 *   who else is in the pool at roll time. No odds manipulation by the protocol.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMint,
} from "@solana/spl-token";
import { computeEntropy } from "./randomness.js";
import { GachaPool } from "./pool.js";
import { getSwapBasedUsdValue } from "./jupiter.js";
import { RollRequest, SwapResult } from "./types.js";

const PROGRAM_ID = new PublicKey(
  process.env.GACHA_PROGRAM_ID ??
    "GacHa1111111111111111111111111111111111111111"
);

const SLOT_HASHES_SYSVAR = new PublicKey(
  "SysvarS1otHashes111111111111111111111111111"
);

const CONFIG_SEED = Buffer.from("config");
const DELEGATE_SEED = Buffer.from("delegate");

function deriveConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];
}

function deriveDelegateEntryPda(owner: PublicKey, ata: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [DELEGATE_SEED, owner.toBuffer(), ata.toBuffer()],
    PROGRAM_ID
  )[0];
}

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

export class Matchmaker {
  private pool: GachaPool;
  private processing = new Set<string>(); // deduplicate concurrent rolls

  constructor(
    private connection: Connection,
    private keypair: Keypair
  ) {
    this.pool = new GachaPool(connection);
  }

  /** Start the matchmaker event loop. */
  async run(): Promise<void> {
    console.log(`[matchmaker] starting, pubkey=${this.keypair.publicKey.toBase58()}`);
    await this.pool.sync();

    // Subscribe to program logs for RollRequested events
    this.connection.onLogs(PROGRAM_ID, async (logs) => {
      const roll = parseRollRequestedLog(logs.logs);
      if (!roll) return;

      const key = roll.requesterAta.toBase58();
      if (this.processing.has(key)) return;
      this.processing.add(key);

      try {
        await this.handleRoll(roll);
      } catch (err) {
        console.error(`[matchmaker] swap failed for ${key}:`, err);
      } finally {
        this.processing.delete(key);
      }
    });

    // Periodic pool resync
    setInterval(() => this.pool.sync().catch(console.error), 30_000);

    console.log("[matchmaker] listening for rolls…");
    await new Promise(() => {}); // keep alive
  }

  private async handleRoll(roll: RollRequest): Promise<SwapResult> {
    console.log(
      `[matchmaker] roll from ${roll.requester.toBase58()} ` +
        `at slot ${roll.requestSlot}`
    );

    await this.pool.syncIfStale();
    const poolSize = BigInt(this.pool.size);
    if (poolSize === 0n) throw new Error("pool is empty");

    // Wait for entropy slot (request_slot + 1) and derive selection
    const entropy = await computeEntropy(
      this.connection,
      roll.requestSlot,
      roll.requester,
      poolSize
    );

    const counterparty = this.pool.get(entropy.randomIndex);
    if (!counterparty) throw new Error("no counterparty at index");

    // Avoid self-match
    if (counterparty.ata.equals(roll.requesterAta)) {
      console.warn("[matchmaker] self-match avoided, re-selecting +1");
      const altIndex = (entropy.randomIndex + 1n) % poolSize;
      const alt = this.pool.get(altIndex);
      if (!alt || alt.ata.equals(roll.requesterAta)) {
        throw new Error("no valid counterparty (pool too small?)");
      }
      return this.executeSwap(roll, alt, entropy.entropySlot, altIndex, poolSize);
    }

    return this.executeSwap(
      roll,
      counterparty,
      entropy.entropySlot,
      entropy.randomIndex,
      poolSize
    );
  }

  private async executeSwap(
    roll: RollRequest,
    counterparty: ReturnType<GachaPool["get"]> & {},
    entropySlot: bigint,
    randomIndex: bigint,
    poolSize: bigint
  ): Promise<SwapResult> {
    // Fetch mint decimals for USD pricing
    const [reqMintInfo, ctpMintInfo] = await Promise.all([
      getMint(this.connection, counterparty.mint), // requester's mint comes from their ATA
      getMint(this.connection, counterparty.mint),
    ]);

    // Get current balances
    const [reqAtaInfo, ctpAtaInfo] = await Promise.all([
      this.connection.getTokenAccountBalance(roll.requesterAta),
      this.connection.getTokenAccountBalance(counterparty.ata),
    ]);

    const reqAmountRaw = BigInt(reqAtaInfo.value.amount);
    const ctpAmountRaw = BigInt(ctpAtaInfo.value.amount);

    // USD values for logging
    const [reqUsd, ctpUsd] = await Promise.all([
      getSwapBasedUsdValue(
        reqAtaInfo.value.uiAmountString ? counterparty.mint.toBase58() : counterparty.mint.toBase58(),
        reqAmountRaw,
        reqAtaInfo.value.decimals
      ),
      getSwapBasedUsdValue(
        counterparty.mint.toBase58(),
        ctpAmountRaw,
        ctpAtaInfo.value.decimals
      ),
    ]);

    console.log(
      `[matchmaker] swap: requester $${reqUsd?.toFixed(2) ?? "?"} ` +
        `↔ counterparty $${ctpUsd?.toFixed(2) ?? "?"}`
    );

    // Derive all needed pubkeys
    const config = deriveConfigPda();
    const requesterEntry = deriveDelegateEntryPda(roll.requester, roll.requesterAta);
    const counterpartyEntry = deriveDelegateEntryPda(counterparty.owner, counterparty.ata);

    // Fetch mint pubkeys from ATAs
    const reqMint = new PublicKey(reqAtaInfo.value.uiAmount !== null
      ? (await this.connection.getAccountInfo(roll.requesterAta))!.owner
      : SystemProgram.programId
    );
    // Proper mint derivation: read from token account
    const reqAcc = await this.connection.getParsedAccountInfo(roll.requesterAta);
    const ctpAcc = await this.connection.getParsedAccountInfo(counterparty.ata);

    const requesterMint = new PublicKey(
      (reqAcc.value?.data as any).parsed.info.mint
    );
    const counterpartyMint = new PublicKey(
      (ctpAcc.value?.data as any).parsed.info.mint
    );

    // New ATAs (may already exist — init_if_needed handles it on-chain)
    const requesterNewAta = deriveAta(roll.requester, counterpartyMint);
    const counterpartyNewAta = deriveAta(counterparty.owner, requesterMint);

    // Build execute_swap instruction
    // Instruction discriminator: sha256("global:execute_swap")[0..8]
    const disc = Buffer.from([0x32, 0x5b, 0x06, 0x95, 0x41, 0x6a, 0x37, 0x6e]);
    const data = Buffer.alloc(8 + 8 + 8 + 8);
    disc.copy(data, 0);
    data.writeBigUInt64LE(entropySlot, 8);
    data.writeBigUInt64LE(poolSize, 16);
    data.writeBigUInt64LE(randomIndex, 24);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.keypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: true },
        { pubkey: roll.requester, isSigner: false, isWritable: false },
        { pubkey: counterparty.owner, isSigner: false, isWritable: false },
        { pubkey: roll.requesterAta, isSigner: false, isWritable: true },
        { pubkey: counterparty.ata, isSigner: false, isWritable: true },
        { pubkey: requesterEntry, isSigner: false, isWritable: true },
        { pubkey: counterpartyEntry, isSigner: false, isWritable: true },
        { pubkey: requesterNewAta, isSigner: false, isWritable: true },
        { pubkey: counterpartyNewAta, isSigner: false, isWritable: true },
        { pubkey: requesterMint, isSigner: false, isWritable: false },
        { pubkey: counterpartyMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SLOT_HASHES_SYSVAR, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      tx,
      [this.keypair],
      { commitment: "confirmed" }
    );

    console.log(`[matchmaker] swap confirmed: ${signature}`);

    // Remove both from local pool index
    this.pool.remove(roll.requesterAta);
    this.pool.remove(counterparty.ata);

    return {
      signature,
      requester: roll.requester,
      counterparty: counterparty.owner,
      requesterMint,
      counterpartyMint,
      requesterAmount: reqAmountRaw,
      counterpartyAmount: ctpAmountRaw,
      requesterUsd: reqUsd ?? 0,
      counterpartyUsd: ctpUsd ?? 0,
      entropySlot,
      randomIndex,
      poolSizeAtRoll: poolSize,
    };
  }
}

/** Parse a RollRequested event from program logs. */
function parseRollRequestedLog(logs: string[]): RollRequest | null {
  for (const log of logs) {
    if (!log.includes("RollRequested")) continue;
    try {
      // Anchor emits events as base64 in "Program data: <b64>" lines
      const match = log.match(/Program data: (.+)/);
      if (!match) continue;
      const buf = Buffer.from(match[1], "base64");
      // Skip 8-byte discriminator, then parse fields
      // requester: 32, requester_ata: 32, request_slot: 8, roll_fee: 8
      let off = 8;
      const requester = new PublicKey(buf.subarray(off, off + 32));
      off += 32;
      const requesterAta = new PublicKey(buf.subarray(off, off + 32));
      off += 32;
      const requestSlot = buf.readBigUInt64LE(off);
      off += 8;
      const rollFeeLamports = buf.readBigUInt64LE(off);
      return { requester, requesterAta, requestSlot, rollFeeLamports };
    } catch {
      continue;
    }
  }
  return null;
}
