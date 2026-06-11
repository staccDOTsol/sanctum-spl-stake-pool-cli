import { PublicKey } from "@solana/web3.js";

// Meteora Dynamic Bonding Curve program
export const METEORA_DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
);

// r-fstacc LST: quote asset for Pool 1 (Leak/rfstacc)
export const R_FSTACC_LST_MINT = new PublicKey(
  "pSYRpDqr847kB2nD5ZhjcPsHLV2ZpUxweXm1MwiSTcc"
);

// Lit Protocol v8 Naga Mainnet
export const LIT_NAGA_NETWORK = "naga" as const;
export const LIT_NAGA_RPC_URL = "https://naga.litgateway.com";

// Solana RPC used inside Lit Action TEE for pool state reads
export const SOLANA_RPC_URL_FOR_LIT_ACTION =
  "https://api.mainnet-beta.solana.com";

// Default Meteora DBC FeeScheduler params for Pool 1 (anti-snipe: 99 % → baseline)
export const POOL1_INITIAL_FEE_BPS = 9900;  // 99 %
export const POOL1_BASELINE_FEE_BPS = 100;  // 1 %
export const POOL1_FEE_DECAY_SLOTS = 500;   // ~200 s decay window

// Meteora DBC VirtualPool account layout (from the SDK's Anchor IDL):
//   discriminator      [0..8]
//   volatility_tracker [8..72]
//   config             [72..104]
//   creator            [104..136]
//   base_mint          [136..168]
//   base_vault         [168..200]
//   quote_vault        [200..232]
export const DBC_POOL_BASE_VAULT_OFFSET = 168;
export const DBC_POOL_QUOTE_VAULT_OFFSET = 200;

// ---- Pool 1 (Leak / rfstacc) bonding-curve params ----
// Binding target = 10 000 rfstacc (quote reserve at graduation).
// rfstacc has 9 decimals → 10 000 × 10^9 raw units.
export const POOL1_BINDING_TARGET_QUOTE_RAW = 10_000n * 1_000_000_000n; // 10 000 rfstacc

// ---- Don't Leak token supply ----
// Each DontLeak deployment mints exactly 1 000 000 000 tokens at 9 decimals.
export const DONT_LEAK_TOTAL_SUPPLY_RAW = 1_000_000_000n * 1_000_000_000n; // 1 B × 10^9
export const TOKEN_DECIMALS = 9;

// ---- Ratio formula ----
// r = leakReserve / (leakReserve + dontLeakReserve)
// leakReserve     = Pool1.baseReserve  (Leak tokens locked)
// dontLeakReserve = Pool2.baseReserve  (DontLeak tokens locked)
// Both measured in raw token units (same decimal normalisation applied).
