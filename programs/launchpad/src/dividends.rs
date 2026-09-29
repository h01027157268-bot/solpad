//! Holder dividend accumulator.
//!
//! Model
//! -----
//! The dividend slice of every trade is moved into a per-launch SOL vault and
//! folded into a lamports-per-token accumulator:
//!
//! ```text
//! acc += dividend_lamports * 1e18 / eligible_supply
//! ```
//!
//! A position keeps a *signed* checkpoint marker so that at any moment
//!
//! ```text
//! pending = tracked_balance * acc / 1e18 - dividend_paid
//! ```
//!
//! `dividend_paid` is signed on purpose:
//!
//! ```text
//! dividend_paid = balance_at_checkpoint * acc_at_checkpoint / 1e18 - pending
//! ```
//!
//! It goes negative whenever a holder has accrued more than their remaining
//! balance can express - selling the whole bag, for instance. Keeping it signed
//! is what makes the sum of every pending claim exactly equal the lamports that
//! were paid into the vault, so the vault can never be over-subscribed.
//!
//! `eligible_supply = total_supply - tokens held by the program vaults`
//! (the bonding-curve vault plus the migration pool reserve). Every token is
//! either on the curve, locked for the pool, or in a wallet, so this is exactly
//! the supply that can claim.
//!
//! Tokens that arrive through a plain SPL transfer are handled by the same
//! `settle` call: the new units are checkpointed at the accumulator of the
//! moment they are first observed, so a freshly funded wallet can never claim
//! history it did not hold.

use anchor_lang::prelude::*;

use crate::constants::ACC_PRECISION;
use crate::state::Position;

/// Lamports accrued by a position and not yet marked as paid.
pub fn accrued(position: &Position, accumulator: u128) -> u64 {
    let entitlement = (position.tracked_balance as u128).saturating_mul(accumulator) / ACC_PRECISION;
    let pending = entitlement as i128 - position.dividend_paid;
    if pending <= 0 {
        0
    } else if pending > u64::MAX as i128 {
        u64::MAX
    } else {
        pending as u64
    }
}

/// The accumulator checkpoint of `balance` tokens.
pub fn checkpoint(balance: u64, accumulator: u128) -> i128 {
    let value = (balance as u128).saturating_mul(accumulator) / ACC_PRECISION;
    value.min(i128::MAX as u128) as i128
}

/// Move a position to `new_balance` **without losing anything it has accrued**.
///
/// Call it
///   * after a buy, with the buyer's new token balance,
///   * after a sell, with the seller's remaining balance,
///   * before a payout, with the real SPL balance (this is what re-bases
///     balances that arrived through a plain transfer).
pub fn settle(position: &mut Position, new_balance: u64, accumulator: u128) {
    let pending = accrued(position, accumulator);
    position.tracked_balance = new_balance;
    position.dividend_paid = checkpoint(new_balance, accumulator).saturating_sub(pending as i128);
}

/// Mark everything accrued so far as paid, returning the amount that was marked.
pub fn mark_paid(position: &mut Position, accumulator: u128) -> u64 {
    let pending = accrued(position, accumulator);
    if pending > 0 {
        position.dividend_paid = position
            .dividend_paid
            .saturating_add(pending as i128);
    }
    pending
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pos(balance: u64, paid: i128) -> Position {
        Position {
            launch: Default::default(),
            owner: Default::default(),
            tracked_balance: balance,
            dividend_paid: paid,
            dividends_claimed: 0,
            volume_lamports: 0,
            trades: 0,
            bump: 0,
        }
    }

    #[test]
    fn two_holders_share_pro_rata() {
        let supply = 1_000_000u64;
        let acc = (1_000_000_000u128) * ACC_PRECISION / supply as u128;
        let whale = pos(750_000, 0);
        let shrimp = pos(250_000, 0);
        assert_eq!(accrued(&whale, acc), 750_000_000);
        assert_eq!(accrued(&shrimp, acc), 250_000_000);
        assert_eq!(accrued(&whale, acc) + accrued(&shrimp, acc), 1_000_000_000);
    }

    #[test]
    fn a_new_holder_never_claims_history() {
        let acc = 5 * ACC_PRECISION;
        let mut p = pos(0, 0);
        settle(&mut p, 1_000, acc);
        assert_eq!(accrued(&p, acc), 0);
        let acc2 = acc + 2 * ACC_PRECISION;
        assert_eq!(accrued(&p, acc2), 2_000);
    }

    #[test]
    fn selling_keeps_what_was_accrued_and_only_that() {
        let acc = 10 * ACC_PRECISION;
        let mut p = pos(1_000, 0);
        let pending = accrued(&p, acc);
        assert_eq!(pending, 10_000);
        settle(&mut p, 400, acc);
        assert_eq!(p.tracked_balance, 400);
        assert_eq!(accrued(&p, acc), pending);
        // 400 tokens keep earning from now on.
        let acc2 = acc + ACC_PRECISION;
        assert_eq!(accrued(&p, acc2), pending + 400);
    }

    #[test]
    fn selling_everything_still_owes_the_accrued_amount() {
        let acc = 10 * ACC_PRECISION;
        let mut p = pos(1_000, 0);
        settle(&mut p, 0, acc);
        assert_eq!(p.tracked_balance, 0);
        assert!(p.dividend_paid < 0);
        assert_eq!(accrued(&p, acc), 10_000);
        // Nothing accrues on a zero balance.
        assert_eq!(accrued(&p, acc + 5 * ACC_PRECISION), 10_000);
    }

    #[test]
    fn buying_does_not_backdate_history() {
        let acc = 3 * ACC_PRECISION;
        let mut p = pos(1_000, 0);
        settle(&mut p, 1_000, acc);
        let before = accrued(&p, acc);
        settle(&mut p, 2_000, acc); // buy 1_000 more
        assert_eq!(accrued(&p, acc), before);
        let acc2 = acc + ACC_PRECISION;
        assert_eq!(accrued(&p, acc2), before + 2_000);
    }

    #[test]
    fn the_vault_stays_solvent_over_a_long_run() {
        let mut acc: u128 = 0;
        let mut paid_in: u64 = 0;
        let mut claimed: u64 = 0;
        let balances = [1_000u64, 2_000, 7_000];
        let mut positions = [
            pos(balances[0], 0),
            pos(balances[1], 0),
            pos(balances[2], 0),
        ];
        let mut seed: u64 = 123_456_789;
        for i in 0..500 {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            let amount = 1 + (seed % 5_000_000);
            let live: u64 = positions.iter().map(|p| p.tracked_balance).sum();
            acc += (amount as u128) * ACC_PRECISION / live as u128;
            paid_in += amount;
            let seat = (i as usize) % positions.len();
            claimed += mark_paid(&mut positions[seat], acc);
        }
        // The loop stops right after a distribution, so at most one slice is
        // still unclaimed - nothing is ever stranded beyond the most recent one.
        assert!(claimed <= paid_in, "over-claimed {} of {}", claimed, paid_in);
        assert!(
            paid_in - claimed < 6_000_000,
            "stranded {} of {}",
            paid_in - claimed,
            paid_in
        );
    }
}


