//! Buying and selling on the bonding curve.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

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

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [LAUNCH_SEED, mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(address = launch.mint)]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_token: Account<'info, TokenAccount>,

    #[account(mut, seeds = [CURVE_VAULT_SEED, launch.key().as_ref()], bump)]
    pub curve_vault: Account<'info, TokenAccount>,

    /// CHECK: raise vault, a system PDA.
    #[account(mut, seeds = [SOL_VAULT_SEED, launch.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,

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
        payer = buyer,
        seeds = [POSITION_SEED, launch.key().as_ref(), buyer.key().as_ref()],
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

pub fn buy_handler(ctx: Context<Buy>, amount_in: u64, min_tokens_out: u64) -> Result<()> {
    let clock = Clock::get()?;
    require!(!ctx.accounts.config.paused, LaunchpadError::Paused);
    require!(amount_in >= MIN_TRADE_LAMPORTS, LaunchpadError::AmountTooSmall);
    require!(
        ctx.accounts.launch.status == LaunchStatus::Bonding,
        LaunchpadError::AlreadyMigrated
    );

    let trade_index = ctx.accounts.launch.trades;
    let breakdown = tax_breakdown(&ctx.accounts.launch, amount_in)?;
    let tokens_out = curve::tokens_out_curve(
        ctx.accounts.launch.virtual_sol_reserves,
        ctx.accounts.launch.virtual_token_reserves,
        breakdown.net,
    )?;
    require!(tokens_out > 0, LaunchpadError::ZeroAmount);
    require!(tokens_out >= min_tokens_out, LaunchpadError::SlippageExceeded);
    require!(
        tokens_out <= ctx.accounts.launch.real_token_reserves,
        LaunchpadError::CurveSoldOut
    );

    let supply_before = ctx.accounts.launch.eligible_supply();
    let market_cap_before = ctx.accounts.launch.market_cap_lamports;
    let launch_bump = ctx.accounts.launch.bump;
    let mint_key = ctx.accounts.mint.key();
    let launch_key = ctx.accounts.launch.key();
    let buyer_key = ctx.accounts.buyer.key();

    let buyer = ctx.accounts.buyer.to_account_info();
    let treasury = ctx.accounts.treasury.to_account_info();
    let sol_vault = ctx.accounts.sol_vault.to_account_info();
    let dividend_vault = ctx.accounts.dividend_vault.to_account_info();
    let draw_vault = ctx.accounts.draw_vault.to_account_info();

    transfer_lamports(&buyer, &sol_vault, breakdown.net, None)?;
    transfer_lamports(&buyer, &treasury, breakdown.vault, None)?;
    transfer_lamports(&buyer, &dividend_vault, breakdown.dividend, None)?;
    transfer_lamports(&buyer, &draw_vault, breakdown.draw, None)?;

    let signer_seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[launch_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.curve_vault.to_account_info(),
                to: ctx.accounts.buyer_token.to_account_info(),
                authority: ctx.accounts.launch.to_account_info(),
            },
            &[signer_seeds],
        ),
        tokens_out,
    )?;
    ctx.accounts.buyer_token.reload()?;
    let balance_after = ctx.accounts.buyer_token.amount;

    {
        let launch = &mut ctx.accounts.launch;
        launch.virtual_sol_reserves = launch
            .virtual_sol_reserves
            .checked_add(breakdown.net)
            .ok_or(LaunchpadError::MathOverflow)?;
        launch.virtual_token_reserves = launch
            .virtual_token_reserves
            .checked_sub(tokens_out)
            .ok_or(LaunchpadError::MathUnderflow)?;
        launch.real_sol_reserves = launch
            .real_sol_reserves
            .checked_add(breakdown.net)
            .ok_or(LaunchpadError::MathOverflow)?;
        launch.real_token_reserves = launch
            .real_token_reserves
            .checked_sub(tokens_out)
            .ok_or(LaunchpadError::MathUnderflow)?;
        launch.trades = launch.trades.saturating_add(1);
        launch.buys = launch.buys.saturating_add(1);
        launch.volume_lamports = launch.volume_lamports.saturating_add(amount_in as u128);
        launch.market_cap_lamports = launch.market_cap();
    }

    let is_new_position = ctx.accounts.position.owner == Pubkey::default();
    ctx.accounts.top_board.upsert(buyer_key, balance_after);
    if is_new_position {
        register_holder(&mut ctx.accounts.registry, &buyer_key)?;
    }
    let seats = ctx.accounts.top_board.count as u64;
    if breakdown.top > 0 {
        if seats == 0 {
            transfer_lamports(&buyer, &treasury, breakdown.top, None)?;
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
                let seat = seats_accounts[i].ok_or(error!(LaunchpadError::MissingSeatAccounts))?;
                require_keys_eq!(
                    seat.key(),
                    ctx.accounts.top_board.seats[i],
                    LaunchpadError::InvalidSeatAccount
                );
                let info = seat.to_account_info();
                let destination = if info.lamports() > 0 { &info } else { &treasury };
                transfer_lamports(&buyer, destination, share, None)?;
            }
            let dust = breakdown.top.saturating_sub(share.saturating_mul(seats));
            if dust > 0 {
                transfer_lamports(&buyer, &treasury, dust, None)?;
            }
        }
    }

    accrue_draw(
        &mut ctx.accounts.launch,
        &mut ctx.accounts.round,
        breakdown.draw,
        amount_in,
        clock.slot,
    )?;

    if breakdown.dividend > 0 && supply_before > 0 {
        distribute_dividends(&mut ctx.accounts.launch, breakdown.dividend, supply_before);
    }

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.launch = launch_key;
        position.owner = buyer_key;
        position.bump = ctx.bumps.position;
        ctx.accounts.launch.positions = ctx.accounts.launch.positions.saturating_add(1);
    }
    position.trades = position.trades.saturating_add(1);
    position.volume_lamports = position.volume_lamports.saturating_add(amount_in as u128);
    dividends::settle(position, balance_after, ctx.accounts.launch.dividend_acc);

    ctx.accounts.config.total_volume_lamports = ctx
        .accounts
        .config
        .total_volume_lamports
        .saturating_add(amount_in as u128);
    ctx.accounts.config.total_fees_lamports = ctx
        .accounts
        .config
        .total_fees_lamports
        .saturating_add(breakdown.total_tax);

    emit!(events::Trade {
        launch: launch_key,
        trader: buyer_key,
        mint: mint_key,
        is_buy: true,
        sol_amount: amount_in,
        token_amount: tokens_out,
        price_before: market_cap_before,
        price_after: ctx.accounts.launch.market_cap_lamports,
        vault_fee: breakdown.vault,
        top_fee: breakdown.top,
        draw_fee: breakdown.draw,
        dividend_fee: breakdown.dividend,
        trade_index,
        slot: clock.slot,
        top_seats: seats,
        round: ctx.accounts.round.index,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [LAUNCH_SEED, mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(address = launch.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = seller)]
    pub seller_token: Account<'info, TokenAccount>,

    #[account(mut, seeds = [CURVE_VAULT_SEED, launch.key().as_ref()], bump)]
    pub curve_vault: Account<'info, TokenAccount>,

    /// CHECK: raise vault, a system PDA and therefore a signer of this program.
    #[account(mut, seeds = [SOL_VAULT_SEED, launch.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,

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
        mut,
        seeds = [POSITION_SEED, launch.key().as_ref(), seller.key().as_ref()],
        bump = position.bump
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
    pub system_program: Program<'info, System>,
}

pub fn sell_handler(ctx: Context<Sell>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
    let clock = Clock::get()?;
    require!(!ctx.accounts.config.paused, LaunchpadError::Paused);
    require!(tokens_in > 0, LaunchpadError::ZeroAmount);
    require!(
        ctx.accounts.launch.status == LaunchStatus::Bonding,
        LaunchpadError::AlreadyMigrated
    );
    require!(
        ctx.accounts.seller_token.amount >= tokens_in,
        LaunchpadError::InsufficientTokens
    );

    let trade_index = ctx.accounts.launch.trades;
    let gross = curve::sol_out_curve(
        ctx.accounts.launch.virtual_sol_reserves,
        ctx.accounts.launch.virtual_token_reserves,
        tokens_in,
    )?;
    require!(gross >= MIN_TRADE_LAMPORTS, LaunchpadError::AmountTooSmall);
    require!(
        gross <= ctx.accounts.launch.real_sol_reserves,
        LaunchpadError::InsufficientCurveSol
    );
    let breakdown = tax_breakdown(&ctx.accounts.launch, gross)?;
    require!(breakdown.net >= min_sol_out, LaunchpadError::SlippageExceeded);

    let supply_before = ctx.accounts.launch.eligible_supply();
    let market_cap_before = ctx.accounts.launch.market_cap_lamports;
    let sol_vault_bump = ctx.bumps.sol_vault;
    let mint_key = ctx.accounts.mint.key();
    let launch_key = ctx.accounts.launch.key();
    let seller_key = ctx.accounts.seller.key();

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.seller_token.to_account_info(),
                to: ctx.accounts.curve_vault.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        tokens_in,
    )?;
    ctx.accounts.seller_token.reload()?;
    let balance_after = ctx.accounts.seller_token.amount;

    {
        let launch = &mut ctx.accounts.launch;
        launch.virtual_sol_reserves = launch
            .virtual_sol_reserves
            .checked_sub(gross)
            .ok_or(LaunchpadError::MathUnderflow)?;
        launch.virtual_token_reserves = launch
            .virtual_token_reserves
            .checked_add(tokens_in)
            .ok_or(LaunchpadError::MathOverflow)?;
        launch.real_sol_reserves = launch
            .real_sol_reserves
            .checked_sub(gross)
            .ok_or(LaunchpadError::MathUnderflow)?;
        launch.real_token_reserves = launch
            .real_token_reserves
            .checked_add(tokens_in)
            .ok_or(LaunchpadError::MathOverflow)?;
        launch.trades = launch.trades.saturating_add(1);
        launch.sells = launch.sells.saturating_add(1);
        launch.volume_lamports = launch.volume_lamports.saturating_add(gross as u128);
        launch.market_cap_lamports = launch.market_cap();
    }

    ctx.accounts.top_board.upsert(seller_key, balance_after);

    let sol_vault = ctx.accounts.sol_vault.to_account_info();
    let treasury = ctx.accounts.treasury.to_account_info();
    let dividend_vault = ctx.accounts.dividend_vault.to_account_info();
    let draw_vault = ctx.accounts.draw_vault.to_account_info();
    let vault_seeds: &[&[u8]] = &[SOL_VAULT_SEED, launch_key.as_ref(), &[sol_vault_bump]];

    transfer_lamports(
        &sol_vault,
        &ctx.accounts.seller.to_account_info(),
        breakdown.net,
        Some(&[vault_seeds]),
    )?;
    transfer_lamports(&sol_vault, &treasury, breakdown.vault, Some(&[vault_seeds]))?;
    transfer_lamports(
        &sol_vault,
        &dividend_vault,
        breakdown.dividend,
        Some(&[vault_seeds]),
    )?;
    transfer_lamports(&sol_vault, &draw_vault, breakdown.draw, Some(&[vault_seeds]))?;

    let seats = ctx.accounts.top_board.count as u64;
    if breakdown.top > 0 {
        if seats == 0 {
            transfer_lamports(&sol_vault, &treasury, breakdown.top, Some(&[vault_seeds]))?;
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
                let seat = seats_accounts[i].ok_or(error!(LaunchpadError::MissingSeatAccounts))?;
                require_keys_eq!(
                    seat.key(),
                    ctx.accounts.top_board.seats[i],
                    LaunchpadError::InvalidSeatAccount
                );
                let info = seat.to_account_info();
                let destination = if info.lamports() > 0 { &info } else { &treasury };
                transfer_lamports(&sol_vault, destination, share, Some(&[vault_seeds]))?;
            }
            let dust = breakdown.top.saturating_sub(share.saturating_mul(seats));
            if dust > 0 {
                transfer_lamports(&sol_vault, &treasury, dust, Some(&[vault_seeds]))?;
            }
        }
    }

    accrue_draw(
        &mut ctx.accounts.launch,
        &mut ctx.accounts.round,
        breakdown.draw,
        gross,
        clock.slot,
    )?;

    if breakdown.dividend > 0 && supply_before > 0 {
        distribute_dividends(&mut ctx.accounts.launch, breakdown.dividend, supply_before);
    }

    let position = &mut ctx.accounts.position;
    position.trades = position.trades.saturating_add(1);
    position.volume_lamports = position.volume_lamports.saturating_add(gross as u128);
    dividends::settle(position, balance_after, ctx.accounts.launch.dividend_acc);

    ctx.accounts.config.total_volume_lamports = ctx
        .accounts
        .config
        .total_volume_lamports
        .saturating_add(gross as u128);
    ctx.accounts.config.total_fees_lamports = ctx
        .accounts
        .config
        .total_fees_lamports
        .saturating_add(breakdown.total_tax);

    emit!(events::Trade {
        launch: launch_key,
        trader: seller_key,
        mint: mint_key,
        is_buy: false,
        sol_amount: gross,
        token_amount: tokens_in,
        price_before: market_cap_before,
        price_after: ctx.accounts.launch.market_cap_lamports,
        vault_fee: breakdown.vault,
        top_fee: breakdown.top,
        draw_fee: breakdown.draw,
        dividend_fee: breakdown.dividend,
        trade_index,
        slot: clock.slot,
        top_seats: seats,
        round: ctx.accounts.round.index,
    });
    let _ = mint_key;
    Ok(())
}




