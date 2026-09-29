//! Graduation into a locked constant-product pool, and post-graduation swaps.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::board::{HolderRegistry, TopBoard};
use crate::constants::*;
use crate::curve;
use crate::dividends;
use crate::errors::LaunchpadError;
use crate::events;
use crate::instructions::{
    accrue_draw, distribute_dividends, register_holder, tax_breakdown,
    transfer_lamports,
};
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SwapDirection {
    Buy,
    Sell,
}

#[derive(Accounts)]
pub struct Migrate<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [LAUNCH_SEED, mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(address = launch.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut, seeds = [CURVE_VAULT_SEED, launch.key().as_ref()], bump)]
    pub curve_vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [POOL_RESERVE_SEED, launch.key().as_ref()], bump)]
    pub pool_reserve: Account<'info, TokenAccount>,

    /// CHECK: raise vault.
    #[account(mut, seeds = [SOL_VAULT_SEED, launch.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,

    #[account(init, payer = cranker, seeds = [POOL_SEED, launch.key().as_ref()], bump, space = 8 + Pool::INIT_SPACE)]
    pub pool: Account<'info, Pool>,

    /// CHECK: pool SOL reserves, a system PDA.
    #[account(mut, seeds = [POOL_SOL_SEED, launch.key().as_ref()], bump)]
    pub pool_sol: SystemAccount<'info>,

    #[account(
        init,
        payer = cranker,
        seeds = [POOL_TOKEN_SEED, launch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pool
    )]
    pub pool_tokens: Account<'info, TokenAccount>,

    #[account(init, payer = cranker, seeds = [LP_MINT_SEED, launch.key().as_ref()], bump, mint::decimals = TOKEN_DECIMALS, mint::authority = pool)]
    pub lp_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = cranker,
        seeds = [LP_LOCK_SEED, launch.key().as_ref()],
        bump,
        token::mint = lp_mint,
        token::authority = launch
    )]
    pub lp_lock: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn migrate_handler(ctx: Context<Migrate>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        ctx.accounts.launch.status == LaunchStatus::Bonding,
        LaunchpadError::AlreadyMigrated
    );
    require!(
        ctx.accounts.launch.real_sol_reserves >= ctx.accounts.launch.graduation_lamports
            || ctx.accounts.curve_vault.amount == 0,
        LaunchpadError::NotGraduated
    );

    let launch_key = ctx.accounts.launch.key();
    let mint_key = ctx.accounts.mint.key();
    let launch_bump = ctx.accounts.launch.bump;
    let pool_key = ctx.accounts.pool.key();
    let signer_seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[launch_bump]];

    let sol_seeded = ctx.accounts.sol_vault.lamports();
    let curve_tokens = ctx.accounts.curve_vault.amount;
    let reserve_tokens = ctx.accounts.pool_reserve.amount;
    let tokens_seeded = curve_tokens
        .checked_add(reserve_tokens)
        .ok_or(LaunchpadError::MathOverflow)?;
    require!(sol_seeded > 0 && tokens_seeded > 0, LaunchpadError::ZeroAmount);

    let vault_seeds: &[&[u8]] = &[SOL_VAULT_SEED, launch_key.as_ref(), &[ctx.bumps.sol_vault]];
    transfer_lamports(
        &ctx.accounts.sol_vault.to_account_info(),
        &ctx.accounts.pool_sol.to_account_info(),
        sol_seeded,
        Some(&[vault_seeds]),
    )?;

    let token_program = ctx.accounts.token_program.to_account_info();
    if curve_tokens > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program.clone(),
                Transfer {
                    from: ctx.accounts.curve_vault.to_account_info(),
                    to: ctx.accounts.pool_tokens.to_account_info(),
                    authority: ctx.accounts.launch.to_account_info(),
                },
                &[signer_seeds],
            ),
            curve_tokens,
        )?;
    }
    if reserve_tokens > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program.clone(),
                Transfer {
                    from: ctx.accounts.pool_reserve.to_account_info(),
                    to: ctx.accounts.pool_tokens.to_account_info(),
                    authority: ctx.accounts.launch.to_account_info(),
                },
                &[signer_seeds],
            ),
            reserve_tokens,
        )?;
    }

    let lp_supply = curve::lp_tokens_for_deposit(sol_seeded, tokens_seeded, 0, 0, 0)?;
    require!(lp_supply > 0, LaunchpadError::ZeroAmount);
    token::mint_to(
        CpiContext::new_with_signer(
            token_program,
            MintTo {
                mint: ctx.accounts.lp_mint.to_account_info(),
                to: ctx.accounts.lp_lock.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            &[&[POOL_SEED, launch_key.as_ref(), &[ctx.bumps.pool]]],
        ),
        lp_supply,
    )?;

    {
        let pool = &mut ctx.accounts.pool;
        pool.launch = launch_key;
        pool.sol_reserves = sol_seeded;
        pool.token_reserves = tokens_seeded;
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.lp_supply = lp_supply;
        pool.bump = ctx.bumps.pool;
    }
    {
        let launch = &mut ctx.accounts.launch;
        launch.status = LaunchStatus::Migrated;
        launch.migrated_at = clock.unix_timestamp;
        launch.pool = pool_key;
        launch.pool_reserve = tokens_seeded;
        launch.real_token_reserves = 0;
        launch.real_sol_reserves = 0;
        launch.virtual_sol_reserves = sol_seeded;
        launch.virtual_token_reserves = tokens_seeded;
        launch.market_cap_lamports = launch.market_cap();
    }

    emit!(events::Migrated {
        launch: launch_key,
        sol_seeded,
        tokens_seeded,
        lp_amount: lp_supply,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [LAUNCH_SEED, mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(address = launch.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut, seeds = [POOL_SEED, launch.key().as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    /// CHECK: pool SOL reserves.
    #[account(mut, seeds = [POOL_SOL_SEED, launch.key().as_ref()], bump)]
    pub pool_sol: SystemAccount<'info>,

    #[account(mut, seeds = [POOL_TOKEN_SEED, launch.key().as_ref()], bump)]
    pub pool_tokens: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = trader,
        associated_token::mint = mint,
        associated_token::authority = trader
    )]
    pub trader_token: Account<'info, TokenAccount>,

    /// CHECK: pending pro-rata dividends.
    #[account(mut, seeds = [DIVIDEND_VAULT_SEED, launch.key().as_ref()], bump)]
    pub dividend_vault: SystemAccount<'info>,

    /// CHECK: the round pot.
    #[account(mut, seeds = [DRAW_VAULT_SEED, launch.key().as_ref()], bump)]
    pub draw_vault: SystemAccount<'info>,

    /// CHECK: platform vault.
    #[account(mut, address = config.treasury)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, seeds = [TOP_BOARD_SEED, launch.key().as_ref()], bump = top_board.bump)]
    pub top_board: Account<'info, TopBoard>,

    #[account(mut, seeds = [HOLDER_REGISTRY_SEED, launch.key().as_ref()], bump = registry.bump)]
    pub registry: Account<'info, HolderRegistry>,

    #[account(mut, seeds = [ROUND_SEED, launch.key().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,

    #[account(
        init_if_needed,
        payer = trader,
        seeds = [POSITION_SEED, launch.key().as_ref(), trader.key().as_ref()],
        bump,
        space = 8 + Position::INIT_SPACE
    )]
    pub position: Account<'info, Position>,

    #[account(mut)]
    pub seat0: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub seat1: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub seat2: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub seat3: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub seat4: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub seat5: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub seat6: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub seat7: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub seat8: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub seat9: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn swap_handler(
    ctx: Context<Swap>,
    direction: SwapDirection,
    amount_in: u64,
    min_amount_out: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    require!(!ctx.accounts.config.paused, LaunchpadError::Paused);
    require!(amount_in > 0, LaunchpadError::ZeroAmount);
    require!(
        ctx.accounts.launch.status == LaunchStatus::Migrated,
        LaunchpadError::NotMigrated
    );

    let launch_key = ctx.accounts.launch.key();
    let trader_key = ctx.accounts.trader.key();
    let pool_bump = ctx.accounts.pool.bump;
    let pool_sol_bump = ctx.bumps.pool_sol;
    let trade_index = ctx.accounts.launch.trades;
    let supply_before = ctx.accounts.launch.eligible_supply();

    let is_buy = direction == SwapDirection::Buy;
    let (breakdown, out_amount, sol_in_net, sol_out_gross, volume) = if is_buy {
        let breakdown = tax_breakdown(&ctx.accounts.launch, amount_in)?;
        let tokens_out = curve::tokens_out_pool(
            ctx.accounts.pool.sol_reserves,
            ctx.accounts.pool.token_reserves,
            breakdown.net,
        )?;
        (breakdown, tokens_out, breakdown.net, 0u64, amount_in)
    } else {
        let gross = curve::sol_out_pool(
            ctx.accounts.pool.sol_reserves,
            ctx.accounts.pool.token_reserves,
            amount_in,
        )?;
        let breakdown = tax_breakdown(&ctx.accounts.launch, gross)?;
        (breakdown, breakdown.net, 0u64, gross, gross)
    };

    require!(out_amount > 0, LaunchpadError::ZeroAmount);
    require!(out_amount >= min_amount_out, LaunchpadError::SlippageExceeded);
    require!(
        sol_out_gross <= ctx.accounts.pool.sol_reserves,
        LaunchpadError::InsufficientCurveSol
    );
    if is_buy {
        require!(
            out_amount <= ctx.accounts.pool.token_reserves,
            LaunchpadError::SlippageExceeded
        );
    }

    let treasury = ctx.accounts.treasury.to_account_info();
    let dividend_vault = ctx.accounts.dividend_vault.to_account_info();
    let draw_vault = ctx.accounts.draw_vault.to_account_info();
    let pool_sol = ctx.accounts.pool_sol.to_account_info();
    let pool_seeds: &[&[u8]] = &[POOL_SOL_SEED, launch_key.as_ref(), &[pool_sol_bump]];

    if is_buy {
        let trader = ctx.accounts.trader.to_account_info();
        transfer_lamports(&trader, &pool_sol, sol_in_net, None)?;
        transfer_lamports(&trader, &treasury, breakdown.vault, None)?;
        transfer_lamports(&trader, &dividend_vault, breakdown.dividend, None)?;
        transfer_lamports(&trader, &draw_vault, breakdown.draw, None)?;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_tokens.to_account_info(),
                    to: ctx.accounts.trader_token.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[&[POOL_SEED, launch_key.as_ref(), &[pool_bump]]],
            ),
            out_amount,
        )?;
        let seats = ctx.accounts.top_board.count as u64;
        if breakdown.top > 0 {
            if seats == 0 {
                transfer_lamports(&trader, &treasury, breakdown.top, None)?;
            } else {
                let share = crate::fees::seat_share(breakdown.top, seats);
                let seats_accounts = [
                    ctx.accounts.seat0.as_ref(),
                    ctx.accounts.seat1.as_ref(),
                    ctx.accounts.seat2.as_ref(),
                    ctx.accounts.seat3.as_ref(),
                    ctx.accounts.seat4.as_ref(),
                    ctx.accounts.seat5.as_ref(),
                    ctx.accounts.seat6.as_ref(),
                    ctx.accounts.seat7.as_ref(),
                    ctx.accounts.seat8.as_ref(),
                    ctx.accounts.seat9.as_ref(),
                ];
                for i in 0..seats as usize {
                    let seat =
                        seats_accounts[i].ok_or(error!(LaunchpadError::MissingSeatAccounts))?;
                    require_keys_eq!(
                        seat.key(),
                        ctx.accounts.top_board.seats[i],
                        LaunchpadError::InvalidSeatAccount
                    );
                    let info = seat.to_account_info();
                    let destination = if info.lamports() > 0 { &info } else { &treasury };
                    transfer_lamports(&trader, destination, share, None)?;
                }
                let dust = breakdown.top.saturating_sub(share.saturating_mul(seats));
                if dust > 0 {
                    transfer_lamports(&trader, &treasury, dust, None)?;
                }
            }
        }
    } else {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.trader_token.to_account_info(),
                    to: ctx.accounts.pool_tokens.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            amount_in,
        )?;
        transfer_lamports(
            &pool_sol,
            &ctx.accounts.trader.to_account_info(),
            breakdown.net,
            Some(&[pool_seeds]),
        )?;
        transfer_lamports(&pool_sol, &treasury, breakdown.vault, Some(&[pool_seeds]))?;
        transfer_lamports(
            &pool_sol,
            &dividend_vault,
            breakdown.dividend,
            Some(&[pool_seeds]),
        )?;
        transfer_lamports(&pool_sol, &draw_vault, breakdown.draw, Some(&[pool_seeds]))?;
        let seats = ctx.accounts.top_board.count as u64;
        if breakdown.top > 0 {
            if seats == 0 {
                transfer_lamports(&pool_sol, &treasury, breakdown.top, Some(&[pool_seeds]))?;
            } else {
                let share = crate::fees::seat_share(breakdown.top, seats);
                let seats_accounts = [
                    ctx.accounts.seat0.as_ref(),
                    ctx.accounts.seat1.as_ref(),
                    ctx.accounts.seat2.as_ref(),
                    ctx.accounts.seat3.as_ref(),
                    ctx.accounts.seat4.as_ref(),
                    ctx.accounts.seat5.as_ref(),
                    ctx.accounts.seat6.as_ref(),
                    ctx.accounts.seat7.as_ref(),
                    ctx.accounts.seat8.as_ref(),
                    ctx.accounts.seat9.as_ref(),
                ];
                for i in 0..seats as usize {
                    let seat =
                        seats_accounts[i].ok_or(error!(LaunchpadError::MissingSeatAccounts))?;
                    require_keys_eq!(
                        seat.key(),
                        ctx.accounts.top_board.seats[i],
                        LaunchpadError::InvalidSeatAccount
                    );
                    let info = seat.to_account_info();
                    let destination = if info.lamports() > 0 { &info } else { &treasury };
                    transfer_lamports(&pool_sol, destination, share, Some(&[pool_seeds]))?;
                }
                let dust = breakdown.top.saturating_sub(share.saturating_mul(seats));
                if dust > 0 {
                    transfer_lamports(&pool_sol, &treasury, dust, Some(&[pool_seeds]))?;
                }
            }
        }
    }

    ctx.accounts.trader_token.reload()?;
    let balance_after = ctx.accounts.trader_token.amount;

    {
        let pool = &mut ctx.accounts.pool;
        if is_buy {
            pool.sol_reserves = pool
                .sol_reserves
                .checked_add(sol_in_net)
                .ok_or(LaunchpadError::MathOverflow)?;
            pool.token_reserves = pool
                .token_reserves
                .checked_sub(out_amount)
                .ok_or(LaunchpadError::MathUnderflow)?;
        } else {
            pool.token_reserves = pool
                .token_reserves
                .checked_add(amount_in)
                .ok_or(LaunchpadError::MathOverflow)?;
            pool.sol_reserves = pool
                .sol_reserves
                .checked_sub(sol_out_gross)
                .ok_or(LaunchpadError::MathUnderflow)?;
        }
    }

    let is_new_position = ctx.accounts.position.owner == Pubkey::default();
    let seats = ctx.accounts.top_board.count as u64;
    ctx.accounts.top_board.upsert(trader_key, balance_after);
    if is_new_position {
        register_holder(&mut ctx.accounts.registry, &trader_key)?;
    }

    {
        let launch = &mut ctx.accounts.launch;
        launch.pool_reserve = ctx.accounts.pool.token_reserves;
        launch.virtual_sol_reserves = ctx.accounts.pool.sol_reserves;
        launch.virtual_token_reserves = ctx.accounts.pool.token_reserves;
        launch.trades = launch.trades.saturating_add(1);
        if is_buy {
            launch.buys = launch.buys.saturating_add(1);
        } else {
            launch.sells = launch.sells.saturating_add(1);
        }
        launch.volume_lamports = launch.volume_lamports.saturating_add(volume as u128);
        launch.market_cap_lamports = launch.market_cap();
    }

    accrue_draw(
        &mut ctx.accounts.launch,
        &mut ctx.accounts.round,
        breakdown.draw,
        volume,
        clock.slot,
    )?;

    if breakdown.dividend > 0 && supply_before > 0 {
        distribute_dividends(&mut ctx.accounts.launch, breakdown.dividend, supply_before);
    }

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.launch = launch_key;
        position.owner = trader_key;
        position.bump = ctx.bumps.position;
        ctx.accounts.launch.positions = ctx.accounts.launch.positions.saturating_add(1);
    }
    position.trades = position.trades.saturating_add(1);
    position.volume_lamports = position.volume_lamports.saturating_add(volume as u128);
    dividends::settle(position, balance_after, ctx.accounts.launch.dividend_acc);

    ctx.accounts.config.total_volume_lamports = ctx
        .accounts
        .config
        .total_volume_lamports
        .saturating_add(volume as u128);
    ctx.accounts.config.total_fees_lamports = ctx
        .accounts
        .config
        .total_fees_lamports
        .saturating_add(breakdown.total_tax);

    emit!(events::Swapped {
        launch: launch_key,
        trader: trader_key,
        is_buy,
        sol_amount: volume,
        token_amount: if is_buy { out_amount } else { amount_in },
        total_fee: breakdown.total_tax,
    });
    let _ = (trade_index, seats);
    Ok(())
}



