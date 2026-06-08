/**
 * Creates the two Token-2022 mints required by the protocol:
 *   - Leak token  (pro-decrypt vote, base of Pool 1)
 *   - DontLeak token (anti-decrypt vote, base of Pool 2)
 *
 * Both mints use Token-2022 extensions (TransferFeeConfig left at zero for
 * vanilla behaviour; add extensions as desired before `initializeMint2`).
 */
import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMint2Instruction,
  getMintLen,
  ExtensionType,
  createInitializeNonTransferableMintInstruction,
} from "@solana/spl-token";
import type { TokenMintConfig } from "../types.js";

/** Allocate and initialise a Token-2022 mint. Returns the mint Keypair. */
async function createToken2022Mint(
  connection: Connection,
  payer: Keypair,
  mintAuthority: Keypair,
  decimals: number,
  mintKeypair?: Keypair
): Promise<Keypair> {
  const kp = mintKeypair ?? Keypair.generate();
  const extensions: ExtensionType[] = [];
  const mintLen = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: kp.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      kp.publicKey,
      decimals,
      mintAuthority.publicKey,
      /* freezeAuthority */ null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer, kp], {
    commitment: "confirmed",
  });

  console.log(
    `Mint created: ${kp.publicKey.toBase58()} (decimals=${decimals}, sig=${sig})`
  );
  return kp;
}

/**
 * Create both the Leak and DontLeak Token-2022 mints.
 *
 * @returns Object containing both mint keypairs.
 */
export async function createLeakAndDontLeakMints(opts: {
  connection: Connection;
  payer: Keypair;
  mintAuthority: Keypair;
  config: TokenMintConfig;
}): Promise<{ leakMintKp: Keypair; dontLeakMintKp: Keypair }> {
  const { connection, payer, mintAuthority, config } = opts;

  console.log("Minting Leak token (Token-2022)...");
  const leakMintKp = await createToken2022Mint(
    connection, payer, mintAuthority, config.decimals
  );

  console.log("Minting DontLeak token (Token-2022)...");
  const dontLeakMintKp = await createToken2022Mint(
    connection, payer, mintAuthority, config.decimals
  );

  return { leakMintKp, dontLeakMintKp };
}
