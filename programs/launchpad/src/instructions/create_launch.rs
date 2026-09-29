//! `create_launch`: mint the whole supply straight onto the curve.
//!
//! The creator gets no allocation - the entire 1B supply is minted in this
//! instruction, 793.1M of it onto the bonding curve and 206.9M locked for the
//! migration pool. The mint authority is revoked before the instruction
//! returns, so the supply can never grow.
//!
//! The launch also creates the bounded membership sets the lottery mode needs:
//! the ten seat top-holder board, the 256 slot holder registry the draw picks
//! from, and the first round.

use anchor_lang::prelude::*;
use anchor_spl::token::spl_token::instruction::AuthorityType;
use anchor_spl::token::{self, Mint, MintTo, SetAuthority, Token, TokenAccount};

use crate::board::{HolderRegistry, TopBoard};
use crate::constants::*;
use crate::curve;
use crate::entropy::{self, EntropySource, RandomnessAccount};
use crate::errors::LaunchpadError;
use crate::events;
use crate::instructions::transfer_lamports;
use crate::state::*;

/// Rent for an empty PDA (dividend / draw / raise vaults).
const PDA_RENT_LAMPORTS: u64 = 1_000_000;

#[derive(Accounts)]
pub struct CreateLaunch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: the platform vault, pinned by the config and pre-funded.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        seeds = [LAUNCH_SEED, mint.key().as_ref()],
        bump,
        space = 8 + Launch::INIT_SPACE
    )]
    pub launch: Account<'info, Launch>,

    #[account(
        init,
        payer = creator,
        seeds = [MINT_SEED, creator.key().as_ref(), &config.total_launches.to_le_bytes()],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = launch
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        seeds = [CURVE_VAULT_SEED, launch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = launch
    )]
    pub curve_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        seeds = [POOL_RESERVE_SEED, launch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = launch
    )]
    pub pool_reserve: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        seeds = [TOP_BOARD_SEED, launch.key().as_ref()],
        bump,
        space = 8 + TopBoard::INIT_SPACE
    )]
    pub top_board: Account<'info, TopBoard>,

    #[account(
        init,
        payer = creator,
        seeds = [HOLDER_REGISTRY_SEED, launch.key().as_ref()],
        bump,
        space = 8 + HolderRegistry::INIT_SPACE
    )]
    pub registry: Account<'info, HolderRegistry>,

    #[account(
        init,
        payer = creator,
        seeds = [ROUND_SEED, launch.key().as_ref()],
        bump,
        space = 8 + Round::INIT_SPACE
    )]
    pub round: Account<'info, Round>,

    /// CHECK: raise vault.
    #[account(mut, seeds = [SOL_VAULT_SEED, launch.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,

    /// CHECK: pending pro-rata dividends.
    #[account(mut, seeds = [DIVIDEND_VAULT_SEED, launch.key().as_ref()], bump)]
    pub dividend_vault: SystemAccount<'info>,

    /// CHECK: the round pot.
    #[account(mut, seeds = [DRAW_VAULT_SEED, launch.key().as_ref()], bump)]
    pub draw_vault: SystemAccount<'info>,

    /// CHECK: the Switchboard account the first round is bound to. Only read
    /// when the platform runs on `EntropySource::Switchboard`; pass any account
    /// (the slot hashes sysvar is the usual choice) otherwise.
    #[account(mut)]
    pub randomness_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn create_launch_handler(ctx: Context<CreateLaunch>, args: CreateLaunchArgs) -> Result<()> {
    let clock = Clock::get()?;
    let system_program = ctx.accounts.system_program.to_account_info();

    // ------------------------------------------------------------- validation
    require!(!ctx.accounts.config.paused, LaunchpadError::Paused);
    require!(!args.name.is_empty(), LaunchpadError::InvalidCurveConfig);
    require!(args.name.as_bytes().len() <= MAX_NAME_LEN, LaunchpadError::MetadataTooLong);
    require!(!args.symbol.is_empty(), LaunchpadError::InvalidCurveConfig);
    require!(args.symbol.as_bytes().len() <= MAX_SYMBOL_LEN, LaunchpadError::MetadataTooLong);
    require!(args.uri.as_bytes().len() <= MAX_URI_LEN, LaunchpadError::MetadataTooLong);

    // ------------------------------------------------------------------ taxes
    let cfg = crate::fees::TaxConfig::for_mode(args.mode);
    require!(
        cfg.total_bps <= MAX_TOTAL_TAX_BPS,
        LaunchpadError::InvalidFeeConfig
    );
    require!(cfg.vault_bps <= MAX_VAULT_FEE_BPS, LaunchpadError::VaultFeeTooHigh);
    require!(
        cfg.dividend_bps <= MAX_DIVIDEND_BPS,
        LaunchpadError::DividendFeeTooHigh
    );
    require!(
        cfg.top_bps + cfg.draw_bps <= MAX_LOTTERY_BPS,
        LaunchpadError::LotteryFeeTooHigh
    );

    // ------------------------------------------------------------ launch fee
    transfer_lamports(
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
        ctx.accounts.config.creation_fee_lamports,
        None,
    )?;

    // ------------------------------------------- keep the vaults rent-exempt
    for vault in [
        &ctx.accounts.sol_vault,
        &ctx.accounts.dividend_vault,
        &ctx.accounts.draw_vault,
    ] {
        if vault.lamports() < PDA_RENT_LAMPORTS {
            transfer_lamports(
                &ctx.accounts.creator.to_account_info(),
                &vault.to_account_info(),
                PDA_RENT_LAMPORTS - vault.lamports(),
                None,
            )?;
        }
    }

    // ------------------------------------------------------------- the curve
    let launch_key = ctx.accounts.launch.key();
    let mint_key = ctx.accounts.mint.key();
    let creator_key = ctx.accounts.creator.key();
    let entropy_source = ctx.accounts.config.default_entropy_source;
    let market_cap =
        curve::market_cap_lamports(VIRTUAL_SOL_RESERVES, VIRTUAL_TOKEN_RESERVES, TOTAL_SUPPLY)?;
    {
        let launch = &mut ctx.accounts.launch;
        launch.set_inner(Launch {
            creator: creator_key,
            mint: mint_key,
            mode: args.mode,
            status: LaunchStatus::Bonding,
            bump: ctx.bumps.launch,
            created_at: clock.unix_timestamp,
            name: args.name.clone(),
            symbol: args.symbol.clone(),
            uri: args.uri.clone(),
            buy_tax_bps: cfg.total_bps,
            sell_tax_bps: cfg.total_bps,
            vault_bps: cfg.vault_bps,
            dividend_bps: cfg.dividend_bps,
            top_bps: cfg.top_bps,
            draw_bps: cfg.draw_bps,
            entropy_source,
            virtual_sol_reserves: VIRTUAL_SOL_RESERVES,
            virtual_token_reserves: VIRTUAL_TOKEN_RESERVES,
            real_sol_reserves: 0,
            real_token_reserves: CURVE_SUPPLY,
            total_supply: TOTAL_SUPPLY,
            pool_reserve: POOL_RESERVE,
            graduation_lamports: GRADUATION_LAMPORTS,
            market_cap_lamports: market_cap,
            trades: 0,
            buys: 0,
            sells: 0,
            volume_lamports: 0,
            positions: 0,
            migrated_at: 0,
            pool: Pubkey::default(),
            dividend_acc: 0,
            dividend_distributed: 0,
            dividend_claimed: 0,
            round: 1,
            top_distributed: 0,
            draw_distributed: 0,
        });
    }

    // -------------------------------------------------- mint the whole supply
    let launch_authority = ctx.accounts.launch.to_account_info();
    let signer_seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[ctx.bumps.launch]];
    let token_program = ctx.accounts.token_program.to_account_info();

    token::mint_to(
        CpiContext::new_with_signer(
            token_program.clone(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.curve_vault.to_account_info(),
                authority: launch_authority.clone(),
            },
            &[signer_seeds],
        ),
        CURVE_SUPPLY,
    )?;
    token::mint_to(
        CpiContext::new_with_signer(
            token_program.clone(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.pool_reserve.to_account_info(),
                authority: launch_authority.clone(),
            },
            &[signer_seeds],
        ),
        POOL_RESERVE,
    )?;

    // The supply is finished: nobody can ever mint again.
    token::set_authority(
        CpiContext::new_with_signer(
            token_program,
            SetAuthority {
                current_authority: launch_authority,
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
            &[signer_seeds],
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    // ------------------------------------------------------ membership sets
    ctx.accounts
        .top_board
        .init(launch_key, ctx.bumps.top_board);
    ctx.accounts.registry.init(launch_key, ctx.bumps.registry);

    // Round one is bound to its entropy before it can trade.
    let (randomness_account, randomness_seed_slot) = if entropy_source
        == EntropySource::Switchboard
    {
        let info = ctx.accounts.randomness_account.to_account_info();
        require!(
            entropy::is_switchboard_program(&info.owner),
            LaunchpadError::InvalidRandomnessSource
        );
        let data = info.try_borrow_data()?;
        let account = RandomnessAccount::parse(&data)?;
        drop(data);
        require!(
            account.seed_slot >= clock.slot.saturating_sub(REVEAL_DELAY_SLOTS),
            LaunchpadError::InvalidRandomnessSource
        );
        (info.key(), account.seed_slot)
    } else {
        (Pubkey::default(), 0)
    };

    {
        let round = &mut ctx.accounts.round;
        round.launch = launch_key;
        round.index = 1;
        round.seed = args.seed;
        round.opened_at_slot = clock.slot;
        round.randomness_account = randomness_account;
        round.randomness_seed_slot = randomness_seed_slot;
        round.target_slot = randomness_seed_slot;
        round.bump = ctx.bumps.round;
    }

    ctx.accounts.config.total_launches = ctx.accounts.config.total_launches.saturating_add(1);

    emit!(events::LaunchCreated {
        launch: launch_key,
        mint: mint_key,
        creator: creator_key,
        mode: args.mode as u8,
        name: args.name,
        symbol: args.symbol,
        total_supply: TOTAL_SUPPLY,
        virtual_sol_reserves: VIRTUAL_SOL_RESERVES,
        virtual_token_reserves: VIRTUAL_TOKEN_RESERVES,
        graduation_lamports: GRADUATION_LAMPORTS,
        created_at: clock.unix_timestamp,
    });
    let _ = system_program;
    Ok(())
}
