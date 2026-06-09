use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Config {
    /// The protocol operator's authority (can change matchmaker).
    pub authority: Pubkey,
    /// Offchain signer that executes swaps on behalf of delegators.
    pub matchmaker: Pubkey,
    /// Minimum roll fee in lamports the matchmaker will accept.
    pub min_roll_fee_lamports: u64,
    /// Lifetime swap counter (for audit trail).
    pub total_swaps: u64,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1 + 32; // +32 padding
}

/// One entry per delegated ATA in the gacha pool.
/// PDA seeds: ["delegate", owner, ata]
#[account]
#[derive(Default)]
pub struct DelegateEntry {
    pub owner: Pubkey,
    pub ata: Pubkey,
    pub mint: Pubkey,
    /// Amount visible at registration (snapshot; actual balance may differ).
    pub registered_amount: u64,
    pub registered_at: i64,
    pub is_active: bool,
    pub bump: u8,
}

impl DelegateEntry {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 30; // +30 padding
}
