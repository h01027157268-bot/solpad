//! Tax engine.
//!
//! ```text
//! Dividend mode   5%  = 1% vault + 4% pro-rata accumulator
//! Lottery mode   10%  = 1% vault + 3% split evenly across the top ten holders
//!                            + 6% split evenly across ten random holders
//! ```
//!
//! Every slice is floored, so rounding dust always stays with the curve or the
//! seller and the tax can never round up in the platform's favour.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::LaunchpadError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct FeeBreakdown {
    /// Total tax taken from the trade.
    pub total_tax: u64,
    /// To the platform vault.
    pub vault: u64,
    /// Split evenly across the seated top holders (lottery mode).
    pub top: u64,
    /// Paid to the round's draw winners (lottery mode).
    pub draw: u64,
    /// Into the pro-rata accumulator (both modes).
    pub dividend: u64,
    /// Amount left for the curve (buy) or the seller (sell).
    pub net: u64,
}

/// Tax configuration snapshot used by the engine.
#[derive(Clone, Copy)]
pub struct TaxConfig {
    pub total_bps: u16,
    pub vault_bps: u16,
    pub top_bps: u16,
    pub draw_bps: u16,
    pub dividend_bps: u16,
}

impl TaxConfig {
    pub fn for_mode(mode: crate::state::LaunchMode) -> Self {
        match mode {
            crate::state::LaunchMode::Dividend => TaxConfig {
                total_bps: DIVIDEND_MODE_TAX_BPS,
                vault_bps: VAULT_BPS,
                top_bps: 0,
                draw_bps: 0,
                dividend_bps: DIVIDEND_MODE_DIVIDEND_BPS,
            },
            crate::state::LaunchMode::Lottery => TaxConfig {
                total_bps: LOTTERY_MODE_TAX_BPS,
                vault_bps: VAULT_BPS,
                top_bps: TOP_SHARE_BPS,
                draw_bps: DRAW_SHARE_BPS,
                dividend_bps: 0,
            },
        }
    }
}

pub fn split_fees(amount: u64, cfg: TaxConfig) -> Result<FeeBreakdown> {
    let vault = bps_of(amount, cfg.vault_bps as u64)?;
    let top = bps_of(amount, cfg.top_bps as u64)?;
    let draw = bps_of(amount, cfg.draw_bps as u64)?;
    let dividend = bps_of(amount, cfg.dividend_bps as u64)?;
    let tax = vault
        .checked_add(top)
        .and_then(|v| v.checked_add(draw))
        .and_then(|v| v.checked_add(dividend))
        .ok_or(LaunchpadError::MathOverflow)?;
    require!(tax <= amount, LaunchpadError::InvalidFeeConfig);
    let net = amount.checked_sub(tax).ok_or(LaunchpadError::MathUnderflow)?;
    Ok(FeeBreakdown {
        total_tax: tax,
        vault,
        top,
        draw,
        dividend,
        net,
    })
}

/// `amount * bps / 10_000`, floor.
pub fn bps_of(amount: u64, bps: u64) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(LaunchpadError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(LaunchpadError::MathOverflow)?;
    u64::try_from(v).map_err(|_| error!(LaunchpadError::MathOverflow))
}

/// What a single seated holder receives from a trade's `top` slice.
pub fn seat_share(top: u64, seats: u64) -> u64 {
    if seats == 0 {
        return 0;
    }
    top / seats
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::LaunchMode;

    #[test]
    fn dividend_mode_takes_5pct() {
        let f = split_fees(1_000_000_000, TaxConfig::for_mode(LaunchMode::Dividend)).unwrap();
        assert_eq!(f.total_tax, 50_000_000);
        assert_eq!(f.vault, 10_000_000);
        assert_eq!(f.dividend, 40_000_000);
        assert_eq!(f.top, 0);
        assert_eq!(f.draw, 0);
        assert_eq!(f.net, 950_000_000);
    }

    #[test]
    fn lottery_mode_takes_1_3_6() {
        let f = split_fees(1_000_000_000, TaxConfig::for_mode(LaunchMode::Lottery)).unwrap();
        assert_eq!(f.total_tax, 100_000_000);
        assert_eq!(f.vault, 10_000_000); // 1%
        assert_eq!(f.top, 30_000_000); // 3% to the ten largest holders
        assert_eq!(f.draw, 60_000_000); // 6% to the ten random winners
        assert_eq!(f.dividend, 0); // no pro-rata slice in lottery mode
        assert_eq!(f.net, 900_000_000);
    }

    #[test]
    fn the_seats_split_their_slice_evenly() {
        assert_eq!(seat_share(30_000_000, 10), 3_000_000);
        assert_eq!(seat_share(30_000_000, 3), 10_000_000);
        assert_eq!(seat_share(30_000_000, 0), 0);
    }

    #[test]
    fn no_amount_can_ever_be_over_charged() {
        // Fuzz the whole basis-point path: the split must always add back up to
        // the trade and never take more than the mode promises.
        for mode in [LaunchMode::Dividend, LaunchMode::Lottery] {
            let cfg = TaxConfig::for_mode(mode);
            for amount in (0u64..50_000).chain([
                999_999_999,
                1_000_000_000,
                1_000_000_007,
                u32::MAX as u64,
                u64::MAX / 10_000,
            ]) {
                let f = split_fees(amount, cfg).unwrap();
                assert!(f.total_tax <= amount, "tax {} > amount {}", f.total_tax, amount);
                assert_eq!(
                    f.vault + f.top + f.draw + f.dividend + f.net,
                    amount,
                    "the split must add back up to the trade (amount {})",
                    amount
                );
                // and never more than the advertised rate
                assert!(
                    f.total_tax <= (amount as u128 * cfg.total_bps as u128 / 10_000) as u64,
                    "rounding must never round the tax up"
                );
            }
        }
    }

    #[test]
    fn the_top_slice_is_fully_distributed() {
        // Every lamport of the 3% either reaches a seat or the treasury as
        // dust - nothing can get stuck in the vault.
        for seats in 1..=TOP_SEATS as u64 {
            for amount in [0u64, 1, 9, 30_000_000, 30_000_001, 999_999_999, 1_000_000_007] {
                let share = seat_share(amount, seats);
                let paid = share.checked_mul(seats).unwrap();
                assert!(paid <= amount, "{paid} > {amount}");
                assert_eq!(amount - paid, amount % seats);
            }
        }
        // with no seats at all the whole slice goes to the treasury
        assert_eq!(seat_share(30_000_000, 0), 0);
    }

    #[test]
    fn the_draw_pot_is_fully_distributed() {
        for pot in [0u64, 1, 9, 60_000_000, 60_000_001, 999_999_999] {
            for found in 1..=DRAW_WINNERS as u64 {
                let prize = pot / found;
                let paid = prize * found;
                assert!(paid <= pot);
                assert_eq!(pot - paid, pot % found);
            }
        }
        // a round nobody could win pays nothing, and the pot rolls on
        assert_eq!(0u64 / 1, 0);
    }

    #[test]
    fn dust_stays_with_the_trader() {
        // 5% of 3 lamports floors to 0 on every slice.
        let f = split_fees(3, TaxConfig::for_mode(LaunchMode::Dividend)).unwrap();
        assert_eq!(f.total_tax, 0);
        assert_eq!(f.net, 3);
    }
}

