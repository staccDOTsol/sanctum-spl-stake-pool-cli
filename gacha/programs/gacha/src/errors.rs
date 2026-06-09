use anchor_lang::prelude::*;

#[error_code]
pub enum GachaError {
    #[msg("ATA has not been delegated to the matchmaker")]
    NotDelegated,
    #[msg("ATA close authority is not the matchmaker")]
    NoCloseAuthority,
    #[msg("Delegated amount is less than requested amount")]
    InsufficientDelegation,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Delegate entry is not active")]
    InactiveDelegate,
    #[msg("ATA does not match the delegate entry")]
    AtaMismatch,
    #[msg("ATA owner does not match the expected user")]
    AtaOwnerMismatch,
    #[msg("ATA has zero balance")]
    EmptyAta,
    #[msg("Only the matchmaker may execute swaps")]
    UnauthorizedMatchmaker,
    #[msg("The committed slot hash was not found in SlotHashes sysvar")]
    SlotHashNotFound,
    #[msg("The committed slot is too old (> 150 slots ago)")]
    SlotHashExpired,
    #[msg("Both ATAs must be for different mints")]
    SameMint,
    #[msg("Requester ATA mint does not match the entry")]
    MintMismatch,
}
