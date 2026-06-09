/**
 * User-facing helpers — no program, pure SPL token instructions.
 *
 * To enter the pool:
 *   1. approve(matchmaker, u64::MAX) on the ATA
 *   2. set_authority(CloseAccount, matchmaker) on the ATA
 *
 * To roll:
 *   Send MIN_ROLL_FEE_SOL directly to the matchmaker pubkey.
 *   Matchmaker sees the payment, finds your delegated ATAs, executes the swap.
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createSetAuthorityInstruction,
  createRevokeInstruction,
} from "@solana/spl-token";

/** Delegate an ATA to the matchmaker so it can execute swaps on your behalf. */
export async function delegateAta(
  connection: Connection,
  user: Keypair,
  ata: PublicKey,
  matchmaker: PublicKey
): Promise<string> {
  const tx = new Transaction().add(
    // Approve matchmaker to transfer all tokens
    createApproveInstruction(
      ata,
      matchmaker,
      user.publicKey,
      BigInt("18446744073709551615"), // u64::MAX
      [],
      TOKEN_PROGRAM_ID
    ),
    // Grant matchmaker close authority so it can reclaim rent
    createSetAuthorityInstruction(
      ata,
      user.publicKey,
      AuthorityType.CloseAccount,
      matchmaker,
      [],
      TOKEN_PROGRAM_ID
    )
  );
  return sendAndConfirmTransaction(connection, tx, [user], { commitment: "confirmed" });
}

/** Revoke matchmaker delegation (exits the pool). */
export async function revokeAta(
  connection: Connection,
  user: Keypair,
  ata: PublicKey,
  matchmaker: PublicKey
): Promise<string> {
  const tx = new Transaction().add(
    createRevokeInstruction(ata, user.publicKey, [], TOKEN_PROGRAM_ID),
    createSetAuthorityInstruction(
      ata,
      matchmaker,     // current close authority holder must sign
      AuthorityType.CloseAccount,
      user.publicKey, // set back to user
      [],
      TOKEN_PROGRAM_ID
    )
  );
  // Note: revoking close authority requires matchmaker signature
  // In practice users should call this with matchmaker cooperation,
  // or the matchmaker can provide a revoke service.
  return sendAndConfirmTransaction(connection, tx, [user], { commitment: "confirmed" });
}

/** Pay the roll fee to trigger the matchmaker. */
export async function payToRoll(
  connection: Connection,
  user: Keypair,
  matchmaker: PublicKey,
  feeLamports: bigint = BigInt(Math.floor(0.003 * LAMPORTS_PER_SOL))
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: user.publicKey,
      toPubkey: matchmaker,
      lamports: feeLamports,
    })
  );
  return sendAndConfirmTransaction(connection, tx, [user], { commitment: "confirmed" });
}
