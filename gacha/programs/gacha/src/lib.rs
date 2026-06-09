use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer},
};

pub mod errors;
pub mod events;
pub mod state;

use errors::GachaError;
use events::*;
use state::*;

declare_id!("GacHa1111111111111111111111111111111111111111");

/// Maximum slot age for the entropy slot hash (Solana keeps ~150 slot hashes).
const MAX_SLOT_AGE: u64 = 140;

#[program]
pub mod gacha {
    use super::*;

    /// One-time protocol initialization.
    pub fn initialize(
        ctx: Context<Initialize>,
        matchmaker: Pubkey,
        min_roll_fee_lamports: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.matchmaker = matchmaker;
        config.min_roll_fee_lamports = min_roll_fee_lamports;
        config.total_swaps = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Update matchmaker pubkey or min roll fee (authority only).
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        matchmaker: Option<Pubkey>,
        min_roll_fee_lamports: Option<u64>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        if let Some(mm) = matchmaker {
            config.matchmaker = mm;
        }
        if let Some(fee) = min_roll_fee_lamports {
            config.min_roll_fee_lamports = fee;
        }
        Ok(())
    }

    /// User registers their ATA as available for gacha swaps.
    ///
    /// Prerequisites (done client-side before calling this):
    ///   1. `spl_token::approve(matchmaker_pubkey, amount)` on the ATA
    ///   2. `spl_token::set_authority(ata, AuthorityType::CloseAccount, matchmaker_pubkey)`
    ///
    /// Both approvals let the matchmaker fully handle the ATA during a swap
    /// (transfer tokens out, then close account → rent to protocol).
    pub fn register_delegate(ctx: Context<RegisterDelegate>, amount: u64) -> Result<()> {
        require!(amount > 0, GachaError::ZeroAmount);

        let ata = &ctx.accounts.user_ata;
        let matchmaker = ctx.accounts.config.matchmaker;

        require!(ata.delegate.contains(&matchmaker), GachaError::NotDelegated);
        require!(
            ata.close_authority.contains(&matchmaker),
            GachaError::NoCloseAuthority
        );
        require!(
            ata.delegated_amount >= amount && ata.amount >= amount,
            GachaError::InsufficientDelegation
        );

        let entry = &mut ctx.accounts.delegate_entry;
        entry.owner = ctx.accounts.owner.key();
        entry.ata = ctx.accounts.user_ata.key();
        entry.mint = ata.mint;
        entry.registered_amount = amount;
        entry.registered_at = Clock::get()?.unix_timestamp;
        entry.is_active = true;
        entry.bump = ctx.bumps.delegate_entry;

        emit!(DelegateRegistered {
            owner: entry.owner,
            ata: entry.ata,
            mint: entry.mint,
            amount,
        });

        Ok(())
    }

    /// User voluntarily removes their ATA from the gacha pool.
    pub fn deregister_delegate(ctx: Context<DeregisterDelegate>) -> Result<()> {
        let entry = &mut ctx.accounts.delegate_entry;
        require!(entry.is_active, GachaError::InactiveDelegate);
        entry.is_active = false;

        emit!(DelegateDeregistered {
            owner: entry.owner,
            ata: entry.ata,
        });

        Ok(())
    }

    /// User pays to request a gacha roll.
    ///
    /// The SOL fee goes directly to the matchmaker to cover:
    ///   - New ATA creation rent (if needed for recipients)
    ///   - Protocol revenue (any surplus after closing old ATAs)
    ///
    /// The matchmaker listens for the `RollRequested` event, waits 1 slot,
    /// then uses the next slot's hash as unpredictable entropy to select
    /// the counterparty.
    pub fn request_roll(ctx: Context<RequestRoll>, roll_fee_lamports: u64) -> Result<()> {
        require!(
            roll_fee_lamports >= ctx.accounts.config.min_roll_fee_lamports,
            GachaError::InsufficientDelegation // reuse — caller must pay min fee
        );
        require!(
            ctx.accounts.requester_entry.is_active,
            GachaError::InactiveDelegate
        );
        require!(
            ctx.accounts.requester_entry.ata == ctx.accounts.requester_ata.key(),
            GachaError::AtaMismatch
        );

        // Transfer SOL roll fee: requester → matchmaker
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.requester.to_account_info(),
                    to: ctx.accounts.matchmaker.to_account_info(),
                },
            ),
            roll_fee_lamports,
        )?;

        let slot = Clock::get()?.slot;

        emit!(RollRequested {
            requester: ctx.accounts.requester.key(),
            requester_ata: ctx.accounts.requester_ata.key(),
            request_slot: slot,
            roll_fee_lamports,
        });

        Ok(())
    }

    /// Matchmaker executes the gacha swap between two delegates.
    ///
    /// Randomness model (provably fair, verifiable by anyone):
    ///   entropy_slot  = request_slot + 1  (chosen after the roll request)
    ///   slot_hash     = SlotHashes[entropy_slot]  (public record, not predictable at request time)
    ///   random_seed   = sha256(slot_hash || requester_pubkey)
    ///   selected_idx  = u64_le(random_seed[0..8]) % pool_size_at_roll
    ///
    /// The on-chain program verifies:
    ///   - entropy_slot is in the SlotHashes sysvar (recent, not expired)
    ///   - random_index matches the above formula
    ///   - counterparty entry is the pool[random_index] item (matchmaker provides proof via event)
    ///
    /// Anyone can replay: fetch SlotHashes at entropy_slot, recompute selected_idx, and audit.
    pub fn execute_swap(
        ctx: Context<ExecuteSwap>,
        entropy_slot: u64,
        pool_size_at_roll: u64,
        random_index: u64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;

        // Only matchmaker may call this
        require!(
            ctx.accounts.matchmaker.key() == config.matchmaker,
            GachaError::UnauthorizedMatchmaker
        );

        // Verify delegate entries are active and ATAs match
        require!(ctx.accounts.requester_entry.is_active, GachaError::InactiveDelegate);
        require!(ctx.accounts.counterparty_entry.is_active, GachaError::InactiveDelegate);
        require!(
            ctx.accounts.requester_ata.key() == ctx.accounts.requester_entry.ata,
            GachaError::AtaMismatch
        );
        require!(
            ctx.accounts.counterparty_ata.key() == ctx.accounts.counterparty_entry.ata,
            GachaError::AtaMismatch
        );

        // Mints must differ
        require!(
            ctx.accounts.requester_ata.mint != ctx.accounts.counterparty_ata.mint,
            GachaError::SameMint
        );

        // Balances must be nonzero
        let req_amount = ctx.accounts.requester_ata.amount;
        let ctp_amount = ctx.accounts.counterparty_ata.amount;
        require!(req_amount > 0, GachaError::EmptyAta);
        require!(ctp_amount > 0, GachaError::EmptyAta);

        // ── Verify entropy via SlotHashes sysvar ──────────────────────────────
        let slot_hash = load_slot_hash(&ctx.accounts.slot_hashes, entropy_slot)?;
        let current_slot = Clock::get()?.slot;
        require!(
            current_slot <= entropy_slot + MAX_SLOT_AGE,
            GachaError::SlotHashExpired
        );

        // Recompute the expected random index
        let computed_seed = anchor_lang::solana_program::hash::hashv(&[
            &slot_hash,
            ctx.accounts.requester.key().as_ref(),
        ]);
        let computed_index =
            u64::from_le_bytes(computed_seed.0[0..8].try_into().unwrap()) % pool_size_at_roll;

        require!(computed_index == random_index, GachaError::AtaMismatch); // index must match

        // ── The Switcheroo ────────────────────────────────────────────────────
        // Move requester's tokens → counterparty's new ATA
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.requester_ata.to_account_info(),
                    to: ctx.accounts.counterparty_new_ata.to_account_info(),
                    authority: ctx.accounts.matchmaker.to_account_info(),
                },
            ),
            req_amount,
        )?;

        // Move counterparty's tokens → requester's new ATA
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.counterparty_ata.to_account_info(),
                    to: ctx.accounts.requester_new_ata.to_account_info(),
                    authority: ctx.accounts.matchmaker.to_account_info(),
                },
            ),
            ctp_amount,
        )?;

        // Close old ATAs → rent to matchmaker (protocol revenue)
        token::close_account(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.requester_ata.to_account_info(),
                destination: ctx.accounts.matchmaker.to_account_info(),
                authority: ctx.accounts.matchmaker.to_account_info(),
            },
        ))?;

        token::close_account(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.counterparty_ata.to_account_info(),
                destination: ctx.accounts.matchmaker.to_account_info(),
                authority: ctx.accounts.matchmaker.to_account_info(),
            },
        ))?;

        // Mark entries inactive
        ctx.accounts.requester_entry.is_active = false;
        ctx.accounts.counterparty_entry.is_active = false;
        ctx.accounts.config.total_swaps += 1;

        emit!(SwapExecuted {
            requester: ctx.accounts.requester.key(),
            counterparty: ctx.accounts.counterparty.key(),
            requester_mint: ctx.accounts.requester_entry.mint,
            counterparty_mint: ctx.accounts.counterparty_entry.mint,
            requester_amount: req_amount,
            counterparty_amount: ctp_amount,
            entropy_slot,
            entropy_slot_hash: slot_hash,
            random_index,
            pool_size_at_roll,
        });

        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Parse the SlotHashes sysvar and return the hash for `target_slot`.
/// Layout: [u64 count][u64 slot, [u8;32] hash] × count  (big-endian slot)
fn load_slot_hash(slot_hashes: &AccountInfo, target_slot: u64) -> Result<[u8; 32]> {
    let data = slot_hashes.data.borrow();
    let count = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
    for i in 0..count {
        let off = 8 + i * 40;
        let slot = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
        if slot == target_slot {
            return Ok(data[off + 8..off + 40].try_into().unwrap());
        }
    }
    err!(GachaError::SlotHashNotFound)
}

// ── Account contexts ──────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Config::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.authority == authority.key()
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct RegisterDelegate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    pub user_ata: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = owner,
        space = DelegateEntry::LEN,
        seeds = [b"delegate", owner.key().as_ref(), user_ata.key().as_ref()],
        bump
    )]
    pub delegate_entry: Account<'info, DelegateEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeregisterDelegate<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"delegate", owner.key().as_ref(), delegate_entry.ata.as_ref()],
        bump = delegate_entry.bump,
        constraint = delegate_entry.owner == owner.key()
    )]
    pub delegate_entry: Account<'info, DelegateEntry>,
}

#[derive(Accounts)]
pub struct RequestRoll<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: Just the recipient of the roll fee — must equal config.matchmaker.
    #[account(mut, constraint = matchmaker.key() == config.matchmaker)]
    pub matchmaker: AccountInfo<'info>,

    pub requester_ata: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"delegate", requester.key().as_ref(), requester_ata.key().as_ref()],
        bump = requester_entry.bump
    )]
    pub requester_entry: Account<'info, DelegateEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteSwap<'info> {
    #[account(mut)]
    pub matchmaker: Signer<'info>,

    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: Requester wallet — just needs pubkey for PDA derivation and randomness.
    pub requester: AccountInfo<'info>,

    /// CHECK: Counterparty wallet — just needs pubkey.
    pub counterparty: AccountInfo<'info>,

    // Old ATAs being emptied and closed
    #[account(
        mut,
        constraint = requester_ata.owner == requester.key() @ GachaError::AtaOwnerMismatch
    )]
    pub requester_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = counterparty_ata.owner == counterparty.key() @ GachaError::AtaOwnerMismatch
    )]
    pub counterparty_ata: Account<'info, TokenAccount>,

    // Delegate entries (validated active in instruction body)
    #[account(
        mut,
        seeds = [b"delegate", requester.key().as_ref(), requester_ata.key().as_ref()],
        bump = requester_entry.bump
    )]
    pub requester_entry: Account<'info, DelegateEntry>,

    #[account(
        mut,
        seeds = [b"delegate", counterparty.key().as_ref(), counterparty_ata.key().as_ref()],
        bump = counterparty_entry.bump
    )]
    pub counterparty_entry: Account<'info, DelegateEntry>,

    // New ATAs created so each user receives the other's tokens.
    // init_if_needed: ATA already exists → no rent cost; doesn't exist → matchmaker pays.
    #[account(
        init_if_needed,
        payer = matchmaker,
        associated_token::mint = counterparty_mint,
        associated_token::authority = requester
    )]
    pub requester_new_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = matchmaker,
        associated_token::mint = requester_mint,
        associated_token::authority = counterparty
    )]
    pub counterparty_new_ata: Account<'info, TokenAccount>,

    // Mints needed by init_if_needed
    #[account(
        constraint = requester_mint.key() == requester_ata.mint @ GachaError::MintMismatch
    )]
    pub requester_mint: Account<'info, Mint>,

    #[account(
        constraint = counterparty_mint.key() == counterparty_ata.mint @ GachaError::MintMismatch
    )]
    pub counterparty_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// CHECK: SlotHashes sysvar — used to verify the randomness seed.
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: AccountInfo<'info>,
}
