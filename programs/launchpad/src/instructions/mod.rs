//! Instruction handlers and the helpers they share.

use anchor_lang::prelude::*;

use crate::board::TopBoard;
use crate::constants::*;
use crate::dividends;
use crate::errors::LaunchpadError;
use crate::events;
use crate::fees::{self, FeeBreakdown};
use crate::round as round_lifecycle;
use crate::state::{Launch, LaunchMode, Position, Round};

pub mod create_launch;
pub mod metadata;
pub mod round_ix;
pub mod swap;
pub mod trade;
pub mod vault;

pub use create_launch::*;
pub use metadata::*;
pub use round_ix::*;
pub use swap::*;
pub use trade::*;
pub use vault::*;

// ---------------------------------------------------------------------------
// SOL plumbing
// ---------------------------------------------------------------------------

/// Move lamports, optionally signing with PDA seeds.
pub fn transfer_lamports<'a, 'info>(
    from: &'a AccountInfo<'info>,
    to: &'a AccountInfo<'info>,
    amount: u64,
    signer_seeds: Option<&[&[&[u8]]]>,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    if from.lamports() < amount {
        return Err(error!(LaunchpadError::InsufficientCurveSol));
    }
    let ix = anchor_lang::solana_program::system_instruction::transfer(from.key, to.key, amount);
    let accounts = [from.clone(), to.clone()];
    match signer_seeds {
        Some(seeds) => anchor_lang::solana_program::program::invoke_signed(&ix, &accounts, seeds)?,
        None => anchor_lang::solana_program::program::invoke(&ix, &accounts)?,
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tax plumbing
// ---------------------------------------------------------------------------

pub fn tax_breakdown(launch: &Launch, amount: u64) -> Result<FeeBreakdown> {
    fees::split_fees(amount, fees::TaxConfig::for_mode(launch.mode))
}

/// Pay the seated top holders their share of the 3% slice.
///
/// The seats come in as `remaining_accounts` in board order; each one is
/// checked against the on-chain board, so a caller cannot redirect the payout.
/// A seat whose wallet has been closed out simply has its share routed to the
/// treasury instead of bricking every trade.
pub fn pay_top_seats<'info>(
    board: &TopBoard,
    top_lamports: u64,
    source: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    signer_seeds: Option<&[&[&[u8]]]>,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<u64> {
    if top_lamports == 0 {
        return Ok(0);
    }
    let seats = board.count as u64;
    if seats == 0 {
        // Nobody is seated yet: the slice stays with the platform rather than
        // being stranded in a vault.
        transfer_lamports(source, treasury, top_lamports, signer_seeds)?;
        return Ok(top_lamports);
    }
    require!(
        remaining_accounts.len() >= board.count as usize,
        LaunchpadError::MissingSeatAccounts
    );

    let share = fees::seat_share(top_lamports, seats);
    let mut paid: u64 = 0;
    for i in 0..board.count as usize {
        let seat = &remaining_accounts[i];
        require_keys_eq!(
            seat.key(),
            board.seats[i],
            LaunchpadError::InvalidSeatAccount
        );
        require!(seat.is_writable, LaunchpadError::InvalidSeatAccount);
        let destination: &AccountInfo<'info> = if seat.lamports() > 0 { seat } else { treasury };
        transfer_lamports(source, destination, share, signer_seeds)?;
        paid = paid.saturating_add(share);
    }

    // Rounding dust never sits in a vault.
    let dust = top_lamports.saturating_sub(paid);
    if dust > 0 {
        transfer_lamports(source, treasury, dust, signer_seeds)?;
    }
    Ok(top_lamports)
}

/// Pay out the round's pot: one equal share per drawn winner.
///
/// `remaining_accounts` must carry the winners in the order the draw produced
/// them, which is exactly what the on-chain draw recomputes - so a caller can
/// neither redirect a prize nor skip a winner.
pub fn pay_draw_winners<'info>(
    round: &Round,
    source: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    signer_seeds: Option<&[&[&[u8]]]>,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<u64> {
    let found = round.winners_found as usize;
    if found == 0 || round.prize == 0 {
        transfer_lamports(source, treasury, round.pot, signer_seeds)?;
        return Ok(round.pot);
    }
    require!(
        remaining_accounts.len() >= found,
        LaunchpadError::MissingSeatAccounts
    );

    let mut paid: u64 = 0;
    for i in 0..found {
        let winner = &remaining_accounts[i];
        require_keys_eq!(
            winner.key(),
            round.winners[i],
            LaunchpadError::InvalidSeatAccount
        );
        require!(winner.is_writable, LaunchpadError::InvalidSeatAccount);
        let destination: &AccountInfo<'info> = if winner.lamports() > 0 { winner } else { treasury };
        transfer_lamports(source, destination, round.prize, signer_seeds)?;
        paid = paid.saturating_add(round.prize);
    }
    let dust = round.pot.saturating_sub(paid);
    if dust > 0 {
        transfer_lamports(source, treasury, dust, signer_seeds)?;
    }
    Ok(round.pot)
}

// ---------------------------------------------------------------------------
// Dividends (the pro-rata slice)
// ---------------------------------------------------------------------------

/// Fold `lamports` into the accumulator and return the supply it was spread over.
pub fn distribute_dividends(
    launch: &mut Account<Launch>,
    lamports: u64,
    supply: u64,
) -> u64 {
    if lamports == 0 || supply == 0 {
        return 0;
    }
    let increment = (lamports as u128).saturating_mul(ACC_PRECISION) / supply as u128;
    launch.dividend_acc = launch.dividend_acc.saturating_add(increment);
    launch.dividend_distributed = launch.dividend_distributed.saturating_add(lamports);
    emit!(events::DividendsDistributed {
        launch: launch.key(),
        amount: lamports,
        eligible_supply: supply,
        accumulator: launch.dividend_acc,
    });
    supply
}

// ---------------------------------------------------------------------------
// Lottery accrual
// ---------------------------------------------------------------------------

/// Add the 6% slice to the round and close the round once it has seen enough volume.
pub fn accrue_draw(
    launch: &mut Account<Launch>,
    round: &mut Account<Round>,
    lamports: u64,
    volume_lamports: u64,
    slot: u64,
) -> Result<()> {
    launch.draw_distributed = launch.draw_distributed.saturating_add(lamports);
    if !round.is_open() {
        // A closed round stops accumulating: the slice waits for the draw.
        return Ok(());
    }
    round.pot = round.pot.saturating_add(lamports);
    round.volume_lamports = round.volume_lamports.saturating_add(volume_lamports as u128);
    round.trades = round.trades.saturating_add(1);

    if round.volume_lamports >= ROUND_VOLUME_TARGET_LAMPORTS as u128 {
        let target = match launch.entropy_source {
            crate::entropy::EntropySource::SlotHashes => slot.saturating_add(REVEAL_DELAY_SLOTS),
            crate::entropy::EntropySource::Switchboard => round.randomness_seed_slot,
        };
        round_lifecycle::close_round(round, slot, target);
        emit!(events::RoundClosed {
            launch: launch.key(),
            index: round.index,
            pot: round.pot,
            volume_lamports: round.volume_lamports as u64,
            target_slot: round.target_slot,
            commitment: round.commitment,
        });
    }
    Ok(())
}

/// Append a wallet to the registry the first time it holds tokens.
pub fn register_holder(
    registry: &mut Account<crate::board::HolderRegistry>,
    owner: &Pubkey,
) -> Result<()> {
    if registry.count as usize >= MAX_HOLDERS {
        return Ok(());
    }
    if registry.add(owner) {
        emit!(events::HolderRegistered {
            launch: registry.launch,
            holder: *owner,
            holders: registry.count as u64,
        });
    }
    Ok(())
}

pub fn settle_holder(position: &mut Position, balance: u64, accumulator: u128) {
    dividends::settle(position, balance, accumulator);
}

pub fn refresh_market(launch: &mut Launch) {
    launch.market_cap_lamports = launch.market_cap();
}

pub fn margin_of(launch: &Launch) -> u64 {
    match launch.mode {
        LaunchMode::Dividend => launch.eligible_supply(),
        LaunchMode::Lottery => launch.eligible_supply(),
    }
}

pub fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}








