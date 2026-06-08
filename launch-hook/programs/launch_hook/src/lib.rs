// launch_hook — Token-2022 transfer hook that, on every transfer of the hooked
// mint, skims excess lamports out of a System-owned vault PDA, wraps them to
// wSOL, round-trips wSOL->USDC->wSOL through a 0%-fee Orca whirlpool you own,
// and (optionally, as a separate teardown ix) closes wSOL back to the vault.
//
// IMPORTANT — this is a build-target for Solana Playground / `anchor build`.
// It has NOT been compiled in this environment. Verify on DEVNET before mainnet.
// The Orca `swap_v2` CPI account order + sqrt-price limits especially must be
// confirmed against a live pool first.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    pubkey,
    pubkey::Pubkey,
    system_instruction,
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};

declare_id!("3DHcCStU9T78en4cGXVmRanGRHFR8h7JgoQb8FWoR4kZ");

// ---- fixed program-level constants -------------------------------------------
pub const WHIRLPOOL_PROGRAM: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const VAULT_SEED: &[u8] = b"vault";

// anchor sighash of "global:swap_v2"
const SWAP_V2_DISC: [u8; 8] = [43, 4, 237, 11, 26, 201, 30, 98];
// Orca sqrt-price bounds
const MIN_SQRT_PRICE: u128 = 4295048016;
const MAX_SQRT_PRICE: u128 = 79226673515401279992447579055;

// remaining_accounts layout (must match the ExtraAccountMetaList the client writes)
//  0 vault (System-owned PDA, writable)         8  tick_array_1 (w)
//  1 owner_account_a (ATA, writable)            9  tick_array_2 (w)
//  2 owner_account_b (ATA, writable)           10  oracle (w)
//  3 whirlpool (writable)                       11 whirlpool_program
//  4 mint_a                                      12 token_program (classic SPL)
//  5 mint_b                                      13 memo_program
//  6 token_vault_a (w)  7 token_vault_b (w)      14 system_program
//  (tick_array_0 is index 7? -> see indices below)
const I_VAULT: usize = 0;
const I_OWNER_A: usize = 1;
const I_OWNER_B: usize = 2;
const I_WHIRLPOOL: usize = 3;
const I_MINT_A: usize = 4;
const I_MINT_B: usize = 5;
const I_VAULT_A: usize = 6;
const I_VAULT_B: usize = 7;
const I_TICK0: usize = 8;
const I_TICK1: usize = 9;
const I_TICK2: usize = 10;
const I_ORACLE: usize = 11;
const I_WP_PROG: usize = 12;
const I_TOKEN_PROG: usize = 13;
const I_MEMO_PROG: usize = 14;
const I_SYS_PROG: usize = 15;

#[program]
pub mod launch_hook {
    use super::*;

    /// One-time: write the ExtraAccountMetaList for this mint. The client passes
    /// the live pool accounts (in the order above) as remaining_accounts.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let ra = ctx.remaining_accounts;
        require!(ra.len() >= 16, HookError::BadAccounts);

        // vault is a PDA resolved from seeds; everything else is a literal pubkey.
        let mut metas: Vec<ExtraAccountMeta> = Vec::with_capacity(16);
        // 0: vault PDA, writable, not signer
        metas.push(ExtraAccountMeta::new_with_seeds(
            &[Seed::Literal { bytes: VAULT_SEED.to_vec() }],
            false,
            true,
        )?);
        // 1..=15: literal pubkeys, with writability matching swap_v2 needs
        let writable = [
            true,  // owner_a
            true,  // owner_b
            true,  // whirlpool
            false, // mint_a
            false, // mint_b
            true,  // vault_a
            true,  // vault_b
            true,  // tick0
            true,  // tick1
            true,  // tick2
            true,  // oracle
            false, // whirlpool_program
            false, // token_program
            false, // memo_program
            false, // system_program
        ];
        for (i, w) in writable.iter().enumerate() {
            metas.push(ExtraAccountMeta::new_with_pubkey(ra[i + 1].key, false, *w)?);
        }

        let acc = ctx.accounts.extra_account_meta_list.to_account_info();
        let mut data = acc.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
        Ok(())
    }

    /// Transfer-hook Execute. Fires on every transfer of the hooked mint.
    pub fn transfer_hook<'info>(
        ctx: Context<'_, '_, 'info, 'info, TransferHook<'info>>,
        _amount: u64,
    ) -> Result<()> {
        let ra = ctx.remaining_accounts;
        require!(ra.len() >= 16, HookError::BadAccounts);

        let vault = &ra[I_VAULT];
        let (vault_pda, bump) = Pubkey::find_program_address(&[VAULT_SEED], ctx.program_id);
        require_keys_eq!(*vault.key, vault_pda, HookError::BadAccounts);
        let signer: &[&[&[u8]]] = &[&[VAULT_SEED, &[bump]]];

        // which ATA is the wSOL side?
        let a_is_wsol = *ra[I_MINT_A].key == WSOL_MINT;
        let wsol_ata = if a_is_wsol { &ra[I_OWNER_A] } else { &ra[I_OWNER_B] };
        let usdc_ata = if a_is_wsol { &ra[I_OWNER_B] } else { &ra[I_OWNER_A] };

        // 1) skim everything above the dataless rent floor out of the vault -> wSOL ATA
        let floor = Rent::get()?.minimum_balance(0);
        let skim = vault.lamports().saturating_sub(floor);
        if skim == 0 {
            return Ok(()); // nothing to do; never fail the underlying transfer
        }
        invoke_signed(
            &system_instruction::transfer(vault.key, wsol_ata.key, skim),
            &[vault.clone(), wsol_ata.clone(), ra[I_SYS_PROG].clone()],
            signer,
        )?;

        // 2) sync_native so the lamports become spendable wrapped SOL
        invoke(
            &spl_token_sync_native(ra[I_TOKEN_PROG].key, wsol_ata.key)?,
            &[wsol_ata.clone(), ra[I_TOKEN_PROG].clone()],
        )?;

        // 3) buy USDC: sell `skim` wSOL.  a_to_b is true iff wSOL is mint A.
        whirlpool_swap(ctx.program_id, ra, skim, a_is_wsol, signer)?;

        // 4) sell USDC back to wSOL: input = all USDC we just received.
        let usdc_amount = read_token_amount(usdc_ata)?;
        if usdc_amount > 0 {
            whirlpool_swap(ctx.program_id, ra, usdc_amount, !a_is_wsol, signer)?;
        }

        // NOTE: we intentionally do NOT close the wSOL ATA here. Closing per-transfer
        // would destroy the ATA and require funded recreation on the next transfer.
        // Use the separate `sweep_home` ix (top-level) to unwrap back to the vault.
        Ok(())
    }

    /// Teardown (call top-level, not via the hook): close the wSOL ATA, sending
    /// rent + wrapped SOL back to the vault.
    pub fn sweep_home<'info>(
        ctx: Context<'_, '_, 'info, 'info, SweepHome<'info>>,
    ) -> Result<()> {
        let (vault_pda, bump) = Pubkey::find_program_address(&[VAULT_SEED], ctx.program_id);
        require_keys_eq!(ctx.accounts.vault.key(), vault_pda, HookError::BadAccounts);
        let signer: &[&[&[u8]]] = &[&[VAULT_SEED, &[bump]]];
        invoke_signed(
            &spl_token_close(
                ctx.accounts.token_program.key,
                ctx.accounts.wsol_ata.key,
                ctx.accounts.vault.key,
                ctx.accounts.vault.key,
            )?,
            &[
                ctx.accounts.wsol_ata.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            signer,
        )?;
        Ok(())
    }

    /// SPL transfer-hook interface dispatch for the `Execute` discriminator.
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        match TransferHookInstruction::unpack(data)? {
            TransferHookInstruction::Execute { amount } => {
                let bytes = amount.to_le_bytes();
                __private::__global::transfer_hook(program_id, accounts, &bytes)
            }
            _ => Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}

fn whirlpool_swap<'info>(
    _program_id: &Pubkey,
    ra: &'info [AccountInfo<'info>],
    amount: u64,
    a_to_b: bool,
    signer: &[&[&[u8]]],
) -> Result<()> {
    let sqrt_limit: u128 = if a_to_b { MIN_SQRT_PRICE + 1 } else { MAX_SQRT_PRICE - 1 };

    let mut data = SWAP_V2_DISC.to_vec();
    data.extend_from_slice(&amount.to_le_bytes()); // amount
    data.extend_from_slice(&0u64.to_le_bytes()); // other_amount_threshold = 0 (demo)
    data.extend_from_slice(&sqrt_limit.to_le_bytes()); // sqrt_price_limit (u128)
    data.push(1); // amount_specified_is_input = true
    data.push(a_to_b as u8); // a_to_b

    let tp = ra[I_TOKEN_PROG].key;
    let metas = vec![
        AccountMeta::new_readonly(*tp, false),                 // token_program_a
        AccountMeta::new_readonly(*tp, false),                 // token_program_b
        AccountMeta::new_readonly(*ra[I_MEMO_PROG].key, false),
        AccountMeta::new_readonly(*ra[I_VAULT].key, true),     // token_authority (vault PDA, signer)
        AccountMeta::new(*ra[I_WHIRLPOOL].key, false),
        AccountMeta::new_readonly(*ra[I_MINT_A].key, false),
        AccountMeta::new_readonly(*ra[I_MINT_B].key, false),
        AccountMeta::new(*ra[I_OWNER_A].key, false),
        AccountMeta::new(*ra[I_VAULT_A].key, false),
        AccountMeta::new(*ra[I_OWNER_B].key, false),
        AccountMeta::new(*ra[I_VAULT_B].key, false),
        AccountMeta::new(*ra[I_TICK0].key, false),
        AccountMeta::new(*ra[I_TICK1].key, false),
        AccountMeta::new(*ra[I_TICK2].key, false),
        AccountMeta::new(*ra[I_ORACLE].key, false),
    ];
    let ix = Instruction { program_id: *ra[I_WP_PROG].key, accounts: metas, data };
    invoke_signed(
        &ix,
        &[
            ra[I_TOKEN_PROG].clone(),
            ra[I_MEMO_PROG].clone(),
            ra[I_VAULT].clone(),
            ra[I_WHIRLPOOL].clone(),
            ra[I_MINT_A].clone(),
            ra[I_MINT_B].clone(),
            ra[I_OWNER_A].clone(),
            ra[I_VAULT_A].clone(),
            ra[I_OWNER_B].clone(),
            ra[I_VAULT_B].clone(),
            ra[I_TICK0].clone(),
            ra[I_TICK1].clone(),
            ra[I_TICK2].clone(),
            ra[I_ORACLE].clone(),
            ra[I_WP_PROG].clone(),
        ],
        signer,
    )?;
    Ok(())
}

// classic SPL token account layout: mint[0..32] owner[32..64] amount[64..72]
fn read_token_amount(ai: &AccountInfo) -> Result<u64> {
    let d = ai.try_borrow_data()?;
    require!(d.len() >= 72, HookError::BadAccounts);
    Ok(u64::from_le_bytes(d[64..72].try_into().unwrap()))
}

fn spl_token_sync_native(token_program: &Pubkey, account: &Pubkey) -> Result<Instruction> {
    // SyncNative = instruction 17, no data args
    Ok(Instruction {
        program_id: *token_program,
        accounts: vec![AccountMeta::new(*account, false)],
        data: vec![17],
    })
}

fn spl_token_close(
    token_program: &Pubkey,
    account: &Pubkey,
    dest: &Pubkey,
    authority: &Pubkey,
) -> Result<Instruction> {
    // CloseAccount = instruction 9
    Ok(Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*account, false),
            AccountMeta::new(*dest, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data: vec![9],
    })
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA ["extra-account-metas", mint], created here
    #[account(mut)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    /// CHECK: the hooked mint
    pub mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: the 15 pool accounts (see layout above)
}

#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: source token account (read-only here)
    pub source_token: UncheckedAccount<'info>,
    /// CHECK: hooked mint
    pub mint: UncheckedAccount<'info>,
    /// CHECK: destination token account
    pub destination_token: UncheckedAccount<'info>,
    /// CHECK: owner/authority of the transfer
    pub owner: UncheckedAccount<'info>,
    /// CHECK: validation account (ExtraAccountMetaList PDA)
    pub extra_account_meta_list: UncheckedAccount<'info>,
    // remaining_accounts: the 15 pool accounts + vault (see layout above)
}

#[derive(Accounts)]
pub struct SweepHome<'info> {
    /// CHECK: vault PDA (System-owned)
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: wSOL ATA owned by vault
    #[account(mut)]
    pub wsol_ata: UncheckedAccount<'info>,
    /// CHECK: classic SPL token program
    pub token_program: UncheckedAccount<'info>,
}

#[error_code]
pub enum HookError {
    #[msg("unexpected accounts")]
    BadAccounts,
}
