//! Platform configuration, admin actions and dividend payouts.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

use crate::constants::*;
use crate::dividends;
use crate::entropy::EntropySource;
use crate::errors::LaunchpadError;
use crate::events;
use crate::instructions::transfer_lamports;
use crate::state::*;

/// A platform vault that is not rent exempt cannot receive the 1% slices of a
/// small first trade, so it is checked once at initialisation.
const MIN_VAULT_LAMPORTS: u64 = 1_000_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitConfigArgs {
    pub treasury: Pubkey,
    pub creation_fee_lamports: u64,
    /// `slotHashes` is the dependency-free default; `switchboard` consumes an
    /// On-Demand randomness account per round.
    pub default_entropy_source: EntropySource,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, payer = authority, seeds = [CONFIG_SEED], bump, space = 8 + Config::INIT_SPACE)]
    pub config: Account<'info, Config>,

    /// CHECK: platform vault, checked below.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_config_handler(ctx: Context<InitializeConfig>, args: InitConfigArgs) -> Result<()> {
    require!(
        ctx.accounts.treasury.key() == args.treasury,
        LaunchpadError::Unauthorized
    );
    require!(
        ctx.accounts.treasury.lamports() >= MIN_VAULT_LAMPORTS,
        LaunchpadError::InvalidCurveConfig
    );
    require!(
        args.creation_fee_lamports <= MAX_CREATION_FEE_LAMPORTS,
        LaunchpadError::InvalidFeeConfig
    );

    let config = &mut ctx.accounts.config;
    config.set_inner(Config {
        authority: ctx.accounts.authority.key(),
        pending_authority: Pubkey::default(),
        treasury: args.treasury,
        paused: false,
        creation_fee_lamports: args.creation_fee_lamports,
        default_entropy_source: args.default_entropy_source,
        total_launches: 0,
        total_volume_lamports: 0,
        total_fees_lamports: 0,
        bump: ctx.bumps.config,
    });

    emit!(events::ConfigInitialized {
        authority: config.authority,
        treasury: config.treasury,
        creation_fee_lamports: config.creation_fee_lamports,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateConfigArgs {
    pub treasury: Option<Pubkey>,
    pub creation_fee_lamports: Option<u64>,
    pub lottery_rollover_bps: Option<u16>,
    pub default_entropy_source: Option<EntropySource>,
    pub paused: Option<bool>,
    /// Starts a two-step authority handover.
    pub new_authority: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,

    #[account(mut, has_one = authority @ LaunchpadError::Unauthorized, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn update_config_handler(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(treasury) = args.treasury {
        require!(treasury != Pubkey::default(), LaunchpadError::InvalidCurveConfig);
        config.treasury = treasury;
    }
    if let Some(fee) = args.creation_fee_lamports {
        require!(fee <= MAX_CREATION_FEE_LAMPORTS, LaunchpadError::InvalidFeeConfig);
        config.creation_fee_lamports = fee;
    }
    if let Some(source) = args.default_entropy_source {
        config.default_entropy_source = source;
    }
    if let Some(paused) = args.paused {
        config.paused = paused;
    }
    if let Some(new_authority) = args.new_authority {
        require!(
            new_authority != config.authority,
            LaunchpadError::SameAuthority
        );
        config.pending_authority = new_authority;
        emit!(events::AuthorityTransferStarted {
            current: config.authority,
            pending: new_authority,
        });
    }

    emit!(events::ConfigUpdated {
        authority: config.authority,
        treasury: config.treasury,
        paused: config.paused,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    pub pending_authority: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn accept_authority_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(
        config.pending_authority != Pubkey::default(),
        LaunchpadError::NoPendingAuthority
    );
    require!(
        config.pending_authority == ctx.accounts.pending_authority.key(),
        LaunchpadError::Unauthorized
    );
    let previous = config.authority;
    config.authority = config.pending_authority;
    config.pending_authority = Pubkey::default();
    emit!(events::AuthorityTransferred {
        previous,
        current: config.authority,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClaimDividends<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [LAUNCH_SEED, mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(address = launch.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [POSITION_SEED, launch.key().as_ref(), owner.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,

    /// CHECK: dividend vault, a system PDA and therefore a signer of this program.
    #[account(mut, seeds = [DIVIDEND_VAULT_SEED, launch.key().as_ref()], bump)]
    pub dividend_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn claim_dividends_handler(ctx: Context<ClaimDividends>) -> Result<()> {
    let balance = ctx.accounts.owner_token.amount;
    let accumulator = ctx.accounts.launch.dividend_acc;

    // Re-basing on the real SPL balance is what stops a wallet that received
    // tokens through a plain transfer from claiming history it never held.
    let position = &mut ctx.accounts.position;
    dividends::settle(position, balance, accumulator);
    let pending = dividends::accrued(position, accumulator);
    require!(pending > 0, LaunchpadError::NothingToClaim);

    let vault = ctx.accounts.dividend_vault.to_account_info();
    require!(vault.lamports() >= pending, LaunchpadError::NothingToClaim);

    position.dividend_paid = dividends::checkpoint(balance, accumulator);
    position.dividends_claimed = position.dividends_claimed.saturating_add(pending);

    let launch_key = ctx.accounts.launch.key();
    let vault_bump = ctx.bumps.dividend_vault;
    let vault_seeds: &[&[u8]] = &[DIVIDEND_VAULT_SEED, launch_key.as_ref(), &[vault_bump]];

    transfer_lamports(
        &vault,
        &ctx.accounts.owner.to_account_info(),
        pending,
        Some(&[vault_seeds]),
    )?;

    ctx.accounts.launch.dividend_claimed = ctx
        .accounts
        .launch
        .dividend_claimed
        .saturating_add(pending);

    emit!(events::DividendsClaimed {
        launch: launch_key,
        owner: ctx.accounts.owner.key(),
        amount: pending,
    });
    Ok(())
}

/// Rescue lamports that can never be attributed to a holder (positions that
/// were closed outside the program, rounding dust, ...).
///
/// Only the surplus above the outstanding obligations can ever be touched.
#[derive(Accounts)]
pub struct SweepDividendVault<'info> {
    #[account(mut, address = config.authority)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(seeds = [LAUNCH_SEED, mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(address = launch.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut, address = config.treasury)]
    pub treasury: SystemAccount<'info>,

    /// CHECK: dividend vault.
    #[account(mut, seeds = [DIVIDEND_VAULT_SEED, launch.key().as_ref()], bump)]
    pub dividend_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn sweep_dividend_vault_handler(ctx: Context<SweepDividendVault>, amount: u64) -> Result<()> {
    require!(amount > 0, LaunchpadError::ZeroAmount);

    let obligations = ctx
        .accounts
        .launch
        .dividend_distributed
        .saturating_sub(ctx.accounts.launch.dividend_claimed);
    let vault = ctx.accounts.dividend_vault.to_account_info();
    let surplus = vault.lamports().saturating_sub(obligations);
    require!(amount <= surplus, LaunchpadError::Unauthorized);

    let launch_key = ctx.accounts.launch.key();
    let vault_bump = ctx.bumps.dividend_vault;
    let vault_seeds: &[&[u8]] = &[DIVIDEND_VAULT_SEED, launch_key.as_ref(), &[vault_bump]];

    transfer_lamports(
        &vault,
        &ctx.accounts.treasury.to_account_info(),
        amount,
        Some(&[vault_seeds]),
    )?;

    emit!(events::DividendsSwept {
        launch: launch_key,
        amount,
    });
    Ok(())
}



