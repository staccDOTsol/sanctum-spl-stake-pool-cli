/**
 * Deploys the two Meteora Dynamic Bonding Curve (DBC) pools:
 *
 *   Pool 1 (Leak DBC):     base = Leak token,     quote = r-fstacc LST
 *   Pool 2 (DontLeak DBC): base = DontLeak token,  quote = Leak token
 *
 * The DBC program (dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN) uses an
 * Anchor IDL.  Pool creation requires an existing PoolConfig account that
 * encodes the bonding-curve shape and FeeScheduler.  We derive a fresh Pool
 * PDA for each call.
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
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { METEORA_DBC_PROGRAM_ID } from "../constants.js";
import type { PoolConfig } from "../types.js";

// Anchor discriminators (sha256("global:<instruction>")[0..8])
// Computed offline and hardcoded for determinism.
const DISCRIMINATORS = {
  // sha256("global:initialize_pool_with_config")[0..8]
  INITIALIZE_POOL: Buffer.from([
    0x11, 0x37, 0x20, 0x9a, 0x4e, 0x85, 0x9f, 0x1d,
  ]),
} as const;

/** Derive the Meteora DBC pool PDA for a given base/quote mint pair + config. */
export function deriveDbcPoolAddress(
  baseMint: PublicKey,
  quoteMint: PublicKey,
  config: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      config.toBuffer(),
      baseMint.toBuffer(),
      quoteMint.toBuffer(),
    ],
    METEORA_DBC_PROGRAM_ID
  );
}

/** Derive the Meteora DBC event authority PDA. */
function deriveEventAuthority(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    METEORA_DBC_PROGRAM_ID
  );
}

/**
 * Build the `initialize_pool_with_config` instruction for Meteora DBC.
 *
 * Accounts (matching the DBC IDL v0.5):
 *   0  pool             (PDA, writable, signer=false)
 *   1  config           (readonly)
 *   2  creator          (signer, writable)
 *   3  baseMint         (readonly)
 *   4  quoteMint        (readonly)
 *   5  baseVault        (ATA pool←baseMint, writable)
 *   6  quoteVault       (ATA pool←quoteMint, writable)
 *   7  eventAuthority   (PDA)
 *   8  systemProgram
 *   9  tokenProgram2022
 *  10  associatedTokenProgram
 */
function buildInitializePoolInstruction(opts: {
  pool: PublicKey;
  config: PublicKey;
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  eventAuthority: PublicKey;
}): TransactionInstruction {
  const keys = [
    { pubkey: opts.pool,                  isSigner: false, isWritable: true  },
    { pubkey: opts.config,                isSigner: false, isWritable: false },
    { pubkey: opts.creator,               isSigner: true,  isWritable: true  },
    { pubkey: opts.baseMint,              isSigner: false, isWritable: false },
    { pubkey: opts.quoteMint,             isSigner: false, isWritable: false },
    { pubkey: opts.baseVault,             isSigner: false, isWritable: true  },
    { pubkey: opts.quoteVault,            isSigner: false, isWritable: true  },
    { pubkey: opts.eventAuthority,        isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId,    isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID,      isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,isSigner: false, isWritable: false },
  ];

  // No extra instruction data beyond the discriminator for basic pool init.
  return new TransactionInstruction({
    keys,
    programId: METEORA_DBC_PROGRAM_ID,
    data: DISCRIMINATORS.INITIALIZE_POOL,
  });
}

/**
 * Deploy a single Meteora DBC pool.
 *
 * @param connection  Active Solana connection.
 * @param creator     Wallet that pays and signs.
 * @param baseMint    Base token mint (the token being bonded).
 * @param quoteMint   Quote token mint (the token used to buy base).
 * @param configAddress Pre-existing Meteora DBC PoolConfig account.
 * @returns           Address of the newly created pool.
 */
async function deployPool(
  connection: Connection,
  creator: Keypair,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  configAddress: PublicKey
): Promise<PublicKey> {
  const [pool] = deriveDbcPoolAddress(baseMint, quoteMint, configAddress);
  const [eventAuthority] = deriveEventAuthority();

  // ATAs owned by the pool PDA, using Token-2022
  const baseVault = getAssociatedTokenAddressSync(
    baseMint, pool, /* allowOwnerOffCurve */ true, TOKEN_2022_PROGRAM_ID
  );
  const quoteVault = getAssociatedTokenAddressSync(
    quoteMint, pool, /* allowOwnerOffCurve */ true, TOKEN_2022_PROGRAM_ID
  );

  const tx = new Transaction();

  // Create vault ATAs if they don't exist yet
  const [baseInfo, quoteInfo] = await Promise.all([
    connection.getAccountInfo(baseVault),
    connection.getAccountInfo(quoteVault),
  ]);

  if (!baseInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        creator.publicKey, baseVault, pool, baseMint, TOKEN_2022_PROGRAM_ID
      )
    );
  }
  if (!quoteInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        creator.publicKey, quoteVault, pool, quoteMint, TOKEN_2022_PROGRAM_ID
      )
    );
  }

  tx.add(
    buildInitializePoolInstruction({
      pool,
      config: configAddress,
      creator: creator.publicKey,
      baseMint,
      quoteMint,
      baseVault,
      quoteVault,
      eventAuthority,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [creator], {
    commitment: "confirmed",
  });

  console.log(`Pool deployed: ${pool.toBase58()} (sig: ${sig})`);
  return pool;
}

/**
 * Deploy both pools per the spec and return their addresses + mint addresses.
 *
 * Pool 1 (Leak DBC):     base=leakMint,     quote=rfstaccMint
 * Pool 2 (DontLeak DBC): base=dontLeakMint, quote=leakMint
 *
 * @param configAddress  A pre-existing Meteora DBC PoolConfig account.
 *                       Create one via the Meteora UI or `create_config` ix.
 */
export async function deployBothPools(opts: {
  connection: Connection;
  creator: Keypair;
  leakMint: PublicKey;
  dontLeakMint: PublicKey;
  rfstaccMint: PublicKey;
  configAddress: PublicKey;
}): Promise<PoolConfig> {
  const { connection, creator, leakMint, dontLeakMint, rfstaccMint, configAddress } = opts;

  console.log("Deploying Pool 1 (Leak / rfstacc)...");
  const leakPool = await deployPool(
    connection, creator, leakMint, rfstaccMint, configAddress
  );

  console.log("Deploying Pool 2 (DontLeak / Leak)...");
  const dontLeakPool = await deployPool(
    connection, creator, dontLeakMint, leakMint, configAddress
  );

  return {
    leakPoolAddress: leakPool.toBase58(),
    dontLeakPoolAddress: dontLeakPool.toBase58(),
    leakMint: leakMint.toBase58(),
    dontLeakMint: dontLeakMint.toBase58(),
    poolConfigAddress: configAddress.toBase58(),
  };
}
