/**
 * User-facing delegation helper.
 *
 * Flow to enter the gacha pool:
 *   1. `spl_token::approve(matchmaker, amount)` on the user's ATA
 *   2. `spl_token::set_authority(ata, AuthorityType::CloseAccount, matchmaker)`
 *   3. `gacha::register_delegate(amount)` — records on-chain
 *
 * All three are bundled into a single transaction for UX simplicity.
 *
 * To roll: call `request_roll` with a SOL fee. The matchmaker handles the rest.
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
  AuthorityType,
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createSetAuthorityInstruction,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey(
  process.env.GACHA_PROGRAM_ID ??
    "GacHa1111111111111111111111111111111111111111"
);

const CONFIG_SEED = Buffer.from("config");
const DELEGATE_SEED = Buffer.from("delegate");

function deriveConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID);
}

function deriveDelegateEntryPda(owner: PublicKey, ata: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DELEGATE_SEED, owner.toBuffer(), ata.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Build and send the three-instruction bundle to join the gacha pool.
 *
 * @param userAta     - The ATA to delegate (must be owned by `user`)
 * @param matchmaker  - The matchmaker's pubkey (from config or env)
 * @param amount      - Raw token amount to delegate (u64)
 */
export async function registerDelegate(
  connection: Connection,
  user: Keypair,
  userAta: PublicKey,
  matchmaker: PublicKey,
  amount: bigint
): Promise<string> {
  const [config] = deriveConfigPda();
  const [delegateEntry] = deriveDelegateEntryPda(user.publicKey, userAta);

  // 1. approve(matchmaker, amount)
  const approveIx = createApproveInstruction(
    userAta,
    matchmaker,
    user.publicKey,
    amount,
    [],
    TOKEN_PROGRAM_ID
  );

  // 2. set_authority(CloseAccount, matchmaker)
  const setCloseAuthIx = createSetAuthorityInstruction(
    userAta,
    user.publicKey,
    AuthorityType.CloseAccount,
    matchmaker,
    [],
    TOKEN_PROGRAM_ID
  );

  // 3. gacha::register_delegate(amount)
  // Discriminator for register_delegate: sha256("global:register_delegate")[0..8]
  const disc = Buffer.from([0x5b, 0x14, 0x47, 0x5f, 0x20, 0x38, 0x87, 0x1c]);
  const data = Buffer.alloc(8 + 8);
  disc.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  const registerIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: userAta, isSigner: false, isWritable: false },
      { pubkey: delegateEntry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(approveIx, setCloseAuthIx, registerIx);
  return sendAndConfirmTransaction(connection, tx, [user], {
    commitment: "confirmed",
  });
}

/**
 * Remove user's ATA from the gacha pool.
 * Note: does NOT revoke the token approval — user should call `spl_token::revoke`
 * separately if they want to fully revoke matchmaker access.
 */
export async function deregisterDelegate(
  connection: Connection,
  user: Keypair,
  userAta: PublicKey
): Promise<string> {
  const [delegateEntry] = deriveDelegateEntryPda(user.publicKey, userAta);

  const disc = Buffer.from([0xa8, 0x5a, 0xc3, 0x66, 0x43, 0x4a, 0x71, 0x2c]);
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user.publicKey, isSigner: true, isWritable: false },
      { pubkey: delegateEntry, isSigner: false, isWritable: true },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(connection, tx, [user], {
    commitment: "confirmed",
  });
}

/**
 * Pay the roll fee and emit a RollRequested event.
 * The matchmaker picks this up and executes the swap asynchronously.
 */
export async function requestRoll(
  connection: Connection,
  user: Keypair,
  userAta: PublicKey,
  matchmaker: PublicKey,
  rollFeeLamports: bigint
): Promise<string> {
  const [config] = deriveConfigPda();
  const [delegateEntry] = deriveDelegateEntryPda(user.publicKey, userAta);

  const disc = Buffer.from([0x0a, 0x44, 0xf0, 0x2c, 0x81, 0x33, 0x5d, 0x92]);
  const data = Buffer.alloc(8 + 8);
  disc.copy(data, 0);
  data.writeBigUInt64LE(rollFeeLamports, 8);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: matchmaker, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: false },
      { pubkey: delegateEntry, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(connection, tx, [user], {
    commitment: "confirmed",
  });
}
