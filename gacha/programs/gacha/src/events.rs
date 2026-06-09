use anchor_lang::prelude::*;

#[event]
pub struct DelegateRegistered {
    pub owner: Pubkey,
    pub ata: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DelegateDeregistered {
    pub owner: Pubkey,
    pub ata: Pubkey,
}

/// Emitted when a user pays to request a gacha roll.
/// The matchmaker listens for this event and executes the swap in a subsequent tx.
#[event]
pub struct RollRequested {
    pub requester: Pubkey,
    pub requester_ata: Pubkey,
    /// Slot at request time — matchmaker uses slot+1 hash as entropy seed.
    pub request_slot: u64,
    pub roll_fee_lamports: u64,
}

/// Emitted on every executed swap for full transparency / auditability.
/// Anyone can recompute random_index = sha256(slot_hash || requester)[0..8] % pool_size_at_roll
/// and verify the counterparty selection was not manipulated.
#[event]
pub struct SwapExecuted {
    pub requester: Pubkey,
    pub counterparty: Pubkey,
    pub requester_mint: Pubkey,
    pub counterparty_mint: Pubkey,
    pub requester_amount: u64,
    pub counterparty_amount: u64,
    /// Hash of the committed slot used as randomness seed (public record).
    pub entropy_slot: u64,
    pub entropy_slot_hash: [u8; 32],
    /// sha256(entropy_slot_hash || requester_pubkey)[0..8] % pool_size
    pub random_index: u64,
    pub pool_size_at_roll: u64,
}
