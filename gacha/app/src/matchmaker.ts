/**
 * Offchain matchmaker — pure SPL token crank, no on-chain program.
 *
 * Detection: watches for SOL transfers TO the matchmaker address.
 * When a payment arrives, the sender's delegated ATA(s) are looked up
 * via getProgramAccounts, a counterparty is selected with slot-hash
 * randomness, and the swap is executed with standard SPL token calls.
 *
 * Revenue: matchmaker collects ~0.00408 SOL rent per swap by closing
 * two old ATAs (it holds close_authority on both).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { computeEntropy } from "./randomness.js";
import { GachaPool } from "./pool.js";
import { getSwapBasedUsdValue } from "./jupiter.js";
import { startHealthServer } from "./health.js";

const MIN_ROLL_FEE = parseFloat(process.env.MIN_ROLL_FEE_SOL ?? "0.003") * LAMPORTS_PER_SOL;

export class Matchmaker {
  private pool: GachaPool;
  private processing = new Set<string>();
  private lastBalance = 0n;

  constructor(
    private connection: Connection,
    private keypair: Keypair
  ) {
    this.pool = new GachaPool(connection, keypair.publicKey);
  }

  async run(): Promise<void> {
    console.log(`[matchmaker] pubkey: ${this.keypair.publicKey.toBase58()}`);
    console.log(`[matchmaker] min roll fee: ${MIN_ROLL_FEE / LAMPORTS_PER_SOL} SOL`);

    await this.pool.sync();

    // Watch for incoming SOL transfers
    this.connection.onAccountChange(
      this.keypair.publicKey,
      async (info) => {
        const newBalance = BigInt(info.lamports);
        if (newBalance > this.lastBalance) {
          const received = newBalance - this.lastBalance;
          if (received >= BigInt(MIN_ROLL_FEE)) {
            // Find who sent it by scanning recent txs
            await this.handleIncomingPayment(received);
          }
        }
        this.lastBalance = newBalance;
      },
      "confirmed"
    );

    // Init balance
    this.lastBalance = BigInt(
      await this.connection.getBalance(this.keypair.publicKey)
    );

    // Periodic pool resync
    setInterval(() => this.pool.sync().catch(console.error), 30_000);

    console.log("[matchmaker] listening for roll payments…");
    await new Promise(() => {});
  }

  private async handleIncomingPayment(receivedLamports: bigint): Promise<void> {
    // Find the sender from the most recent tx to our address
    const sigs = await this.connection.getSignaturesForAddress(
      this.keypair.publicKey,
      { limit: 5 },
      "confirmed"
    );
    if (!sigs.length) return;

    const tx = await this.connection.getParsedTransaction(
      sigs[0].signature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
    );
    if (!tx) return;

    // Find the sender: a signer other than the matchmaker
    const sender = tx.transaction.message.accountKeys.find(
      k => k.signer && !k.pubkey.equals(this.keypair.publicKey)
    );
    if (!sender) return;

    const key = sender.pubkey.toBase58();
    if (this.processing.has(key)) return;
    this.processing.add(key);

    try {
      await this.executeRollForSender(sender.pubkey, sigs[0].slot);
    } catch (err) {
      console.error(`[matchmaker] roll failed for ${key}:`, err);
    } finally {
      this.processing.delete(key);
    }
  }

  private async executeRollForSender(
    sender: PublicKey,
    requestSlot: number
  ): Promise<void> {
    await this.pool.syncIfStale();

    // Find sender's delegated ATAs
    const senderEntries = this.pool.getByOwner(sender);
    if (senderEntries.length === 0) {
      console.warn(`[matchmaker] ${sender.toBase58()} has no delegated ATAs — ignoring payment`);
      return;
    }

    // Pick the highest-value ATA from the sender
    const requester = await this.pickHighestValueEntry(senderEntries);
    if (!requester) {
      console.warn(`[matchmaker] no priceable ATA for ${sender.toBase58()}`);
      return;
    }

    // Pool must have someone other than sender
    const poolExSender = this.pool.getAll().filter(e => !e.owner.equals(sender));
    if (poolExSender.length === 0) {
      console.warn("[matchmaker] no counterparty available (pool too small)");
      return;
    }

    // Provably fair counterparty selection
    const entropy = await computeEntropy(
      this.connection,
      BigInt(requestSlot),
      sender,
      BigInt(poolExSender.length)
    );
    const counterparty = poolExSender[Number(entropy.randomIndex)];

    // Get current token amounts directly from chain
    const [reqAcc, ctpAcc] = await Promise.all([
      getAccount(this.connection, requester.ata),
      getAccount(this.connection, counterparty.ata),
    ]);

    if (reqAcc.amount === 0n || ctpAcc.amount === 0n) {
      console.warn("[matchmaker] one of the ATAs is empty, skipping");
      return;
    }

    const [reqMint, ctpMint] = await Promise.all([
      getMint(this.connection, reqAcc.mint),
      getMint(this.connection, ctpAcc.mint),
    ]);

    // USD values for logging
    const [reqUsd, ctpUsd] = await Promise.all([
      getSwapBasedUsdValue(reqAcc.mint.toBase58(), reqAcc.amount, reqMint.decimals),
      getSwapBasedUsdValue(ctpAcc.mint.toBase58(), ctpAcc.amount, ctpMint.decimals),
    ]);
    console.log(
      `[matchmaker] THE SWITCHEROO: ` +
      `${sender.toBase58().slice(0,8)} ($${reqUsd?.toFixed(2) ?? "?"} ${reqAcc.mint.toBase58().slice(0,8)}) ` +
      `↔ ${counterparty.owner.toBase58().slice(0,8)} ($${ctpUsd?.toFixed(2) ?? "?"} ${ctpAcc.mint.toBase58().slice(0,8)})`
    );

    // Derive new ATAs
    const [requesterNewAta] = PublicKey.findProgramAddressSync(
      [sender.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), ctpAcc.mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [counterpartyNewAta] = PublicKey.findProgramAddressSync(
      [counterparty.owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), reqAcc.mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tx = new Transaction();

    // Create new ATAs (idempotent — no-op if they already exist)
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        this.keypair.publicKey, // payer
        requesterNewAta,
        sender,
        ctpAcc.mint
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        this.keypair.publicKey,
        counterpartyNewAta,
        counterparty.owner,
        reqAcc.mint
      )
    );

    // THE SWITCHEROO: swap all tokens
    tx.add(
      createTransferCheckedInstruction(
        requester.ata,         // from
        reqAcc.mint,
        requesterNewAta,       // to  (counterparty's token → sender's new ATA)  wait—
        this.keypair.publicKey, // authority (delegate)
        reqAcc.amount,
        reqMint.decimals
      ),
      createTransferCheckedInstruction(
        counterparty.ata,      // from
        ctpAcc.mint,
        counterpartyNewAta,    // to
        this.keypair.publicKey,
        ctpAcc.amount,
        ctpMint.decimals
      )
    );

    // Close old ATAs → rent to matchmaker
    tx.add(
      createCloseAccountInstruction(
        requester.ata,
        this.keypair.publicKey, // destination: us
        this.keypair.publicKey  // authority: close_authority we hold
      ),
      createCloseAccountInstruction(
        counterparty.ata,
        this.keypair.publicKey,
        this.keypair.publicKey
      )
    );

    const sig = await sendAndConfirmTransaction(
      this.connection,
      tx,
      [this.keypair],
      { commitment: "confirmed" }
    );

    console.log(`[matchmaker] swap confirmed: ${sig}`);
    console.log(`  requester got: ${ctpAcc.amount} of ${ctpAcc.mint.toBase58().slice(0,8)} (~$${ctpUsd?.toFixed(2)})`);
    console.log(`  counterparty got: ${reqAcc.amount} of ${reqAcc.mint.toBase58().slice(0,8)} (~$${reqUsd?.toFixed(2)})`);
    console.log(`  entropy slot: ${entropy.entropySlot}, index: ${entropy.randomIndex}/${poolExSender.length}`);

    this.pool.remove(requester.ata);
    this.pool.remove(counterparty.ata);
  }

  private async pickHighestValueEntry(
    entries: Awaited<ReturnType<GachaPool["getAll"]>>
  ) {
    let best = entries[0];
    let bestUsd = -1;
    for (const e of entries) {
      try {
        const acc = await getAccount(this.connection, e.ata);
        const mint = await getMint(this.connection, acc.mint);
        const usd = await getSwapBasedUsdValue(acc.mint.toBase58(), acc.amount, mint.decimals);
        if ((usd ?? 0) > bestUsd) {
          bestUsd = usd ?? 0;
          best = e;
        }
      } catch { /* skip unreadable ATAs */ }
    }
    return best;
  }
}
