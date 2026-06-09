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
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { computeEntropy } from "./randomness.js";
import { GachaPool } from "./pool.js";
import { getSwapBasedUsdValue } from "./jupiter.js";
import { startHealthServer } from "./health.js";
import { DividendLedger } from "./dividend.js";
import { SwapHistory, rarityForMult } from "./history.js";
import { JackpotPot } from "./jackpot.js";
import { classifyMint, loadTierLists, TIER_LABEL, TokenTier } from "./tiers.js";

const MIN_ROLL_FEE = parseFloat(process.env.MIN_ROLL_FEE_SOL ?? "0.003") * LAMPORTS_PER_SOL;
/** One payment of N× the roll fee buys N swaps (the 10-pull), capped here. */
const MAX_ROLLS_PER_PAYMENT = parseInt(process.env.MAX_ROLLS_PER_PAYMENT ?? "10");
/** Tier matching (blue-chip↔blue-chip etc.) — disable to bootstrap liquidity
 *  pre-PMF so any delegated token can swap with any other. */
const TIER_MATCHING = (process.env.DISABLE_TIER_MATCHING ?? "false").toLowerCase() !== "true";

export class Matchmaker {
  private pool: GachaPool;
  private ledger: DividendLedger;
  private history: SwapHistory;
  private jackpot: JackpotPot;
  private processing = new Set<string>();
  private lastBalance = 0n;

  constructor(
    private connection: Connection,
    private keypair: Keypair
  ) {
    this.pool = new GachaPool(connection, keypair.publicKey);
    this.ledger = new DividendLedger();
    this.history = new SwapHistory();
    this.jackpot = new JackpotPot();
  }

  getLedger(): DividendLedger { return this.ledger; }
  getHistory(): SwapHistory { return this.history; }
  getPool(): GachaPool { return this.pool; }
  getJackpot(): JackpotPot { return this.jackpot; }

  async run(): Promise<void> {
    console.log(`[matchmaker] pubkey: ${this.keypair.publicKey.toBase58()}`);
    console.log(`[matchmaker] min roll fee: ${MIN_ROLL_FEE / LAMPORTS_PER_SOL} SOL`);

    // Initial sync — retry with backoff so 429s don't crash the process
    {
      let delay = 5_000;
      while (true) {
        try { await this.pool.sync(); break; }
        catch (err) {
          console.warn(`[matchmaker] initial pool sync failed, retry in ${delay / 1000}s:`, (err as Error).message);
          await new Promise(r => setTimeout(r, delay));
          delay = Math.min(delay * 2, 120_000);
        }
      }
    }

    // Load tier lists (non-fatal — falls back to UNKNOWN for all mints)
    await loadTierLists().catch(console.error);

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

    // Init balance — getBalance can also 429 briefly
    try {
      this.lastBalance = BigInt(await this.connection.getBalance(this.keypair.publicKey));
    } catch { /* will be corrected on first account-change event */ }

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
      // Multi-roll: a payment of N× the fee buys N swaps (the "10-pull")
      const rolls = Math.max(
        1,
        Math.min(MAX_ROLLS_PER_PAYMENT, Number(receivedLamports / BigInt(MIN_ROLL_FEE)))
      );
      const feePerRoll = receivedLamports / BigInt(rolls);
      if (rolls > 1) console.log(`[matchmaker] multi-roll: ${rolls} swaps for ${key.slice(0, 8)}`);

      for (let i = 0; i < rolls; i++) {
        // First roll is seeded by the payment slot; subsequent rolls use the
        // current slot so every pull in a 10-pull gets fresh entropy.
        const slot = i === 0 ? sigs[0].slot : await this.connection.getSlot("confirmed");
        try {
          await this.executeRollForSender(sender.pubkey, slot, feePerRoll);
        } catch (err) {
          console.error(`[matchmaker] roll ${i + 1}/${rolls} failed for ${key}:`, err);
          break;
        }
      }
    } catch (err) {
      console.error(`[matchmaker] roll failed for ${key}:`, err);
    } finally {
      this.processing.delete(key);
    }
  }

  private async executeRollForSender(
    sender: PublicKey,
    requestSlot: number,
    receivedLamports: bigint
  ): Promise<void> {
    // Auto-register + freshly load the payer's delegated accounts (registry-based
    // discovery — chain-wide scans aren't available on our RPC plan).
    await this.pool.refreshOwner(sender).catch(() => this.pool.syncIfStale());

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

    // Classify requester's mint to determine which tier bucket to match within
    const reqAccPrelim = await getAccount(this.connection, requester.ata, undefined, requester.programId);
    if (reqAccPrelim.amount === 0n) {
      console.warn("[matchmaker] requester ATA is empty, skipping");
      return;
    }
    const requesterTier = await classifyMint(reqAccPrelim.mint.toBase58(), this.connection);

    // Candidate counterparties: everyone in the pool but the sender. With tier
    // matching on, restrict to the same tier (anti-gaming); off (pre-PMF), open.
    let candidates: ReturnType<GachaPool["getAll"]>;
    if (TIER_MATCHING) {
      candidates = await Promise.all(
        this.pool.getAll()
          .filter(e => !e.owner.equals(sender))
          .map(async e => {
            const t = await classifyMint(e.mint.toBase58(), this.connection);
            return t === requesterTier ? e : null;
          })
      ).then(arr => arr.filter((e): e is NonNullable<typeof e> => e !== null));
    } else {
      candidates = this.pool.getAll().filter(e => !e.owner.equals(sender));
    }

    if (candidates.length === 0) {
      console.warn(
        `[matchmaker] no counterparty in pool for ${sender.toBase58().slice(0, 8)} ` +
        `(${TIER_MATCHING ? `tier ${TIER_LABEL[requesterTier]}` : "open matching"}) — pool needs another delegated wallet`
      );
      return;
    }

    // Hard pity: after PITY_HARD consecutive losing rolls the candidate set is
    // restricted to counterparties worth at least the requester's bag — a
    // guaranteed up-only roll. Selection within the set stays slot-hash random,
    // and the deterministic filter rule is itself auditable from the receipt.
    const pityTriggered = this.history.pityActive(sender.toBase58());
    if (pityTriggered) {
      const reqMintPrelim = await getMint(this.connection, reqAccPrelim.mint, undefined, requester.programId);
      const reqUsdPrelim = await getSwapBasedUsdValue(
        reqAccPrelim.mint.toBase58(), reqAccPrelim.amount, reqMintPrelim.decimals
      );
      if (reqUsdPrelim !== null) {
        const upOnly = (await Promise.all(
          candidates.map(async e => {
            try {
              const acc = await getAccount(this.connection, e.ata, undefined, e.programId);
              const mint = await getMint(this.connection, acc.mint, undefined, e.programId);
              const usd = await getSwapBasedUsdValue(acc.mint.toBase58(), acc.amount, mint.decimals);
              return (usd ?? 0) >= reqUsdPrelim ? e : null;
            } catch { return null; }
          })
        )).filter((e): e is NonNullable<typeof e> => e !== null);
        if (upOnly.length > 0) {
          console.log(`[matchmaker] PITY for ${sender.toBase58().slice(0, 8)}: up-only set ${upOnly.length}/${candidates.length}`);
          candidates = upOnly;
        } else {
          console.warn(`[matchmaker] pity active but no up-only counterparty — falling back to full tier set`);
        }
      }
    }

    console.log(`[matchmaker] ${TIER_MATCHING ? `tier ${TIER_LABEL[requesterTier]}` : "open matching"} — ${candidates.length} candidates`);

    // Provably fair counterparty selection within tier
    const entropy = await computeEntropy(
      this.connection,
      BigInt(requestSlot),
      sender,
      BigInt(candidates.length)
    );
    const counterparty = candidates[Number(entropy.randomIndex)];

    // Per-side token programs (a swap can cross TOKEN ↔ TOKEN_2022).
    const reqProgram = requester.programId;
    const ctpProgram = counterparty.programId;

    // Fetch current on-chain state (reqAccPrelim already fresh, just reuse)
    const [reqAcc, ctpAcc] = await Promise.all([
      Promise.resolve(reqAccPrelim),
      getAccount(this.connection, counterparty.ata, undefined, ctpProgram),
    ]);

    if (reqAcc.amount === 0n || ctpAcc.amount === 0n) {
      console.warn("[matchmaker] one of the ATAs is empty, skipping");
      return;
    }

    const [reqMint, ctpMint] = await Promise.all([
      getMint(this.connection, reqAcc.mint, undefined, reqProgram),
      getMint(this.connection, ctpAcc.mint, undefined, ctpProgram),
    ]);

    // USD values for logging
    const [reqUsd, ctpUsd] = await Promise.all([
      getSwapBasedUsdValue(reqAcc.mint.toBase58(), reqAcc.amount, reqMint.decimals),
      getSwapBasedUsdValue(ctpAcc.mint.toBase58(), ctpAcc.amount, ctpMint.decimals),
    ]);
    console.log(
      `[matchmaker] THE SWITCHEROO [${TIER_LABEL[requesterTier]}]: ` +
      `${sender.toBase58().slice(0,8)} ($${reqUsd?.toFixed(2) ?? "?"} ${reqAcc.mint.toBase58().slice(0,8)}) ` +
      `↔ ${counterparty.owner.toBase58().slice(0,8)} ($${ctpUsd?.toFixed(2) ?? "?"} ${ctpAcc.mint.toBase58().slice(0,8)})`
    );

    // Destination ATAs: sender RECEIVES the counterparty's mint; counterparty
    // RECEIVES the requester's mint. Each ATA is derived under the token program
    // that owns ITS mint (TOKEN vs TOKEN_2022).
    const requesterNewAta = getAssociatedTokenAddressSync(ctpAcc.mint, sender, true, ctpProgram);
    const counterpartyNewAta = getAssociatedTokenAddressSync(reqAcc.mint, counterparty.owner, true, reqProgram);

    const tx = new Transaction();

    // Create destination ATAs (idempotent — no-op if they already exist)
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        this.keypair.publicKey, requesterNewAta, sender, ctpAcc.mint, ctpProgram
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        this.keypair.publicKey, counterpartyNewAta, counterparty.owner, reqAcc.mint, reqProgram
      )
    );

    // THE SWITCHEROO: requester's token → counterparty's new ATA, and
    // counterparty's token → requester's (sender's) new ATA.
    tx.add(
      createTransferCheckedInstruction(
        requester.ata,          // from (reqMint)
        reqAcc.mint,
        counterpartyNewAta,     // to: counterparty's ATA for reqMint
        this.keypair.publicKey, // authority (delegate)
        reqAcc.amount,
        reqMint.decimals,
        [],
        reqProgram
      ),
      createTransferCheckedInstruction(
        counterparty.ata,       // from (ctpMint)
        ctpAcc.mint,
        requesterNewAta,        // to: sender's ATA for ctpMint
        this.keypair.publicKey,
        ctpAcc.amount,
        ctpMint.decimals,
        [],
        ctpProgram
      )
    );

    // Close old (now-empty) ATAs → rent to matchmaker (we hold close authority)
    tx.add(
      createCloseAccountInstruction(
        requester.ata, this.keypair.publicKey, this.keypair.publicKey, [], reqProgram
      ),
      createCloseAccountInstruction(
        counterparty.ata, this.keypair.publicKey, this.keypair.publicKey, [], ctpProgram
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
    console.log(`  entropy slot: ${entropy.entropySlot}, index: ${entropy.randomIndex}/${candidates.length} (${TIER_LABEL[requesterTier]})`);

    // USD-value-equivalent outcome: multiplier = what the requester's bag did
    // in USD terms. Streak, jackpot eligibility and rarity all ride on this.
    const multiplier = reqUsd && ctpUsd && reqUsd > 0
      ? Math.round((ctpUsd / reqUsd) * 100) / 100
      : null;

    // ── PROGRESSIVE JACKPOT ──────────────────────────────────────────────────
    // Rake a slice of this roll's fee into the pot, then draw a provably-fair
    // trigger off the same slot hash. A hot win-streak buys extra tickets.
    const streakBefore = this.history.streakOf(sender.toBase58());
    const tickets = this.history.ticketsFor(sender.toBase58());
    this.jackpot.contribute(Number(receivedLamports));
    let jackpotWonLamports = 0;
    if (this.jackpot.checkHit(entropy.slotHash, sender, tickets)) {
      const pot = this.jackpot.balance;
      try {
        const jpTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: this.keypair.publicKey,
            toPubkey: sender,
            lamports: pot,
          })
        );
        const jpSig = await sendAndConfirmTransaction(this.connection, jpTx, [this.keypair], { commitment: "confirmed" });
        this.jackpot.settleWin(sender.toBase58(), pot, jpSig);
        jackpotWonLamports = pot;
        console.log(`[matchmaker] 🎰 JACKPOT ${(pot / LAMPORTS_PER_SOL).toFixed(6)} SOL → ${sender.toBase58().slice(0, 8)} (${tickets} tickets)`);
      } catch (err) {
        // Payout failed — leave the pot intact and accounting untouched
        console.error("[matchmaker] jackpot payout failed, pot preserved:", err);
      }
    }
    const streakAfter = multiplier !== null && multiplier >= 1 ? streakBefore + 1 : 0;

    // Record the receipt trail — everything needed to re-derive the roll
    this.history.record({
      signature: sig,
      requester: sender.toBase58(),
      counterparty: counterparty.owner.toBase58(),
      requesterMint: reqAcc.mint.toBase58(),
      counterpartyMint: ctpAcc.mint.toBase58(),
      requesterAmount: reqAcc.amount.toString(),
      counterpartyAmount: ctpAcc.amount.toString(),
      requesterUsd: reqUsd,
      counterpartyUsd: ctpUsd,
      multiplier,
      rarity: multiplier !== null ? rarityForMult(multiplier) : null,
      tier: TIER_LABEL[requesterTier],
      requestSlot,
      entropySlot: Number(entropy.entropySlot),
      slotHash: entropy.slotHash.toString("hex"),
      randomIndex: Number(entropy.randomIndex),
      poolSize: Number(entropy.poolSize),
      pityTriggered,
      streak: streakAfter,
      jackpotTickets: tickets,
      jackpotWonLamports,
      ts: Date.now(),
    });

    // Distribute dividend share of roll fee to previous rollers, then register sender
    this.ledger.allocate(sender.toBase58(), Number(receivedLamports));
    // Fire-and-forget payout — failures accumulate and retry next roll
    this.ledger.payPendingDividends(this.connection, this.keypair).catch(console.error);

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
        const acc = await getAccount(this.connection, e.ata, undefined, e.programId);
        const mint = await getMint(this.connection, acc.mint, undefined, e.programId);
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
