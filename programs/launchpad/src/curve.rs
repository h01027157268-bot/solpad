//! Bonding-curve and AMM math (pump.fun / Raydium LaunchLab style).
//!
//! Both the pre-graduation curve and the post-graduation pool are constant
//! product, so the same helpers are used for both.

use anchor_lang::prelude::*;

use crate::errors::LaunchpadError;

/// Tokens received for `sol_in` lamports of curve inflow.
///
/// `out = v_tokens * sol_in / (v_sol + sol_in)`
pub fn tokens_out_curve(virtual_sol: u64, virtual_tokens: u64, sol_in: u64) -> Result<u64> {
    if sol_in == 0 {
        return Ok(0);
    }
    let denominator = (virtual_sol as u128)
        .checked_add(sol_in as u128)
        .ok_or(LaunchpadError::MathOverflow)?;
    let out = (virtual_tokens as u128)
        .checked_mul(sol_in as u128)
        .ok_or(LaunchpadError::MathOverflow)?
        .checked_div(denominator)
        .ok_or(LaunchpadError::MathOverflow)?;
    u64::try_from(out).map_err(|_| error!(LaunchpadError::MathOverflow))
}

/// Lamports received for `tokens_in` base units sold into the curve.
///
/// `out = v_sol * tokens_in / (v_tokens + tokens_in)`
pub fn sol_out_curve(virtual_sol: u64, virtual_tokens: u64, tokens_in: u64) -> Result<u64> {
    if tokens_in == 0 {
        return Ok(0);
    }
    let denominator = (virtual_tokens as u128)
        .checked_add(tokens_in as u128)
        .ok_or(LaunchpadError::MathOverflow)?;
    let out = (virtual_sol as u128)
        .checked_mul(tokens_in as u128)
        .ok_or(LaunchpadError::MathOverflow)?
        .checked_div(denominator)
        .ok_or(LaunchpadError::MathOverflow)?;
    u64::try_from(out).map_err(|_| error!(LaunchpadError::MathOverflow))
}

/// Constant-product swap: tokens out for `sol_in` lamports of pool inflow.
pub fn tokens_out_pool(sol_reserves: u64, token_reserves: u64, sol_in: u64) -> Result<u64> {
    tokens_out_curve(sol_reserves, token_reserves, sol_in)
}

/// Constant-product swap: lamports out for `tokens_in` base units of pool inflow.
pub fn sol_out_pool(sol_reserves: u64, token_reserves: u64, tokens_in: u64) -> Result<u64> {
    sol_out_curve(sol_reserves, token_reserves, tokens_in)
}

/// Initial market cap in lamports (price x total supply) at the virtual reserves.
pub fn market_cap_lamports(virtual_sol: u64, virtual_tokens: u64, total_supply: u64) -> Result<u64> {
    if virtual_tokens == 0 {
        return Ok(0);
    }
    let price = (virtual_sol as u128)
        .checked_mul(crate::constants::ACC_PRECISION)
        .ok_or(LaunchpadError::MathOverflow)?
        .checked_div(virtual_tokens as u128)
        .ok_or(LaunchpadError::MathOverflow)?;
    let mcap = price
        .checked_mul(total_supply as u128)
        .ok_or(LaunchpadError::MathOverflow)?
        .checked_div(crate::constants::ACC_PRECISION)
        .ok_or(LaunchpadError::MathOverflow)?;
    u64::try_from(mcap).map_err(|_| error!(LaunchpadError::MathOverflow))
}

/// Liquidity-pool shares minted for a deposit (geometric mean, Uniswap v2 style).
pub fn lp_tokens_for_deposit(
    sol_deposited: u64,
    token_deposited: u64,
    sol_reserves: u64,
    token_reserves: u64,
    lp_supply: u64,
) -> Result<u64> {
    if lp_supply == 0 || sol_reserves == 0 || token_reserves == 0 {
        // Initial liquidity: sqrt(sol * tokens), kept in lamport-base-unit space.
        return sqrt(sol_deposited as u128, token_deposited as u128);
    }
    let a = (sol_deposited as u128)
        .checked_mul(lp_supply as u128)
        .ok_or(LaunchpadError::MathOverflow)?
        .checked_div(sol_reserves as u128)
        .ok_or(LaunchpadError::MathOverflow)?;
    let b = (token_deposited as u128)
        .checked_mul(lp_supply as u128)
        .ok_or(LaunchpadError::MathOverflow)?
        .checked_div(token_reserves as u128)
        .ok_or(LaunchpadError::MathOverflow)?;
    u64::try_from(a.min(b)).map_err(|_| error!(LaunchpadError::MathOverflow))
}

/// Integer square root of `x * y`.
fn sqrt(x: u128, y: u128) -> Result<u64> {
    let n = x.checked_mul(y).ok_or(LaunchpadError::MathOverflow)?;
    if n == 0 {
        return Ok(0);
    }
    let mut z = n;
    let mut r: u128 = 1;
    if z >= 1 << 64 {
        z >>= 64;
        r <<= 32;
    }
    if z >= 1 << 32 {
        z >>= 32;
        r <<= 16;
    }
    if z >= 1 << 16 {
        z >>= 16;
        r <<= 8;
    }
    if z >= 1 << 8 {
        z >>= 8;
        r <<= 4;
    }
    if z >= 1 << 4 {
        z >>= 4;
        r <<= 2;
    }
    if z >= 1 << 2 {
        r <<= 1;
    }
    r = (r + n / r) >> 1;
    r = (r + n / r) >> 1;
    r = (r + n / r) >> 1;
    r = (r + n / r) >> 1;
    r = (r + n / r) >> 1;
    r = (r + n / r) >> 1;
    r = (r + n / r) >> 1;
    let r2 = r.min(n / r);
    u64::try_from(r2).map_err(|_| error!(LaunchpadError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::*;

    #[test]
    fn curve_sells_out_for_about_85_sol() {
        // 793.1M tokens sold out of a 1.073B virtual reserve.
        let virtual_sol = VIRTUAL_SOL_RESERVES;
        let virtual_tokens = VIRTUAL_TOKEN_RESERVES;
        let remaining = virtual_tokens - CURVE_SUPPLY;
        let tokens_to_sell = CURVE_SUPPLY;
        let sol_in = (virtual_sol as u128 * tokens_to_sell as u128 / remaining as u128) as u64;
        assert!(sol_in >= 84_000_000_000 && sol_in <= 86_000_000_000, "raise was {}", sol_in);

        // Buying that much SOL returns (almost) exactly the curve supply.
        let out = tokens_out_curve(virtual_sol, virtual_tokens, sol_in).unwrap();
        assert!(out <= CURVE_SUPPLY);
        assert!(CURVE_SUPPLY - out < 10_000_000, "dust {}", CURVE_SUPPLY - out);
        assert!(sol_in >= GRADUATION_LAMPORTS);
    }

    #[test]
    fn launch_market_cap_matches_pump() {
        let mcap = market_cap_lamports(VIRTUAL_SOL_RESERVES, VIRTUAL_TOKEN_RESERVES, TOTAL_SUPPLY).unwrap();
        // ~27.96 SOL
        assert!(mcap > 27_000_000_000 && mcap < 28_500_000_000, "mcap {}", mcap);
    }

    #[test]
    fn buy_then_sell_is_lossy() {
        let mut v_sol = VIRTUAL_SOL_RESERVES;
        let mut v_tok = VIRTUAL_TOKEN_RESERVES;
        let sol_in = 1_000_000_000u64; // 1 SOL
        let tokens = tokens_out_curve(v_sol, v_tok, sol_in).unwrap();
        v_sol += sol_in;
        v_tok -= tokens;
        let back = sol_out_curve(v_sol, v_tok, tokens).unwrap();
        assert!(back < sol_in);
    }

    #[test]
    fn sqrt_works() {
        assert_eq!(sqrt(4, 9).unwrap(), 6);
        assert_eq!(sqrt(1, 1).unwrap(), 1);
        assert_eq!(sqrt(0, 5).unwrap(), 0);
        let s = sqrt(30_000_000_000u128, 206_900_000u128 * ONE_TOKEN as u128).unwrap();
        assert!(s > 0);
    }
}
