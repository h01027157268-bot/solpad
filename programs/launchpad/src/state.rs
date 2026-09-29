//! On-chain state.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::entropy::EntropySource;

/// How the trade tax is redistributed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum LaunchMode {
    /// 5% buy/sell tax: 1% platform vault, 4% pro-rata to every holder.
    Dividend,
    /// 10% buy/sell tax: 1% platform vault, 3% split evenly across the ten
    /// largest holders, 6% drawn by ten random holders from the registry.
    Lottery,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum LaunchStatus {
    Bonding,
    Migrated,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Platform authority (a multisig in production).
    pub authority: Pubkey,
    /// Two-step authority transfer.
    pub pending_authority: Pubkey,
    /// Platform vault: the 1% vault slice of every trade lands here.
    pub treasury: Pubkey,
    pub paused: bool,
    /// Flat fee charged when a token is launched (0.02 SOL by default).
    pub creation_fee_lamports: u64,
    /// Entropy source every new launch inherits.
    pub default_entropy_source: EntropySource,
    pub total_launches: u64,
    pub total_volume_lamports: u128,
    pub total_fees_lamports: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Launch {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub mode: LaunchMode,
    pub status: LaunchStatus,
    pub bump: u8,
    pub created_at: i64,

    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    #[max_len(MAX_URI_LEN)]
    pub uri: String,

    // ---------------------------------------------------------------- taxes (bps)
    pub buy_tax_bps: u16,
    pub sell_tax_bps: u16,
    /// Slice that always goes to the platform vault (1%).
    pub vault_bps: u16,
    /// Pro-rata slice: 4% in dividend mode, 3% in lottery mode.
    pub dividend_bps: u16,
    /// Slice split evenly across the seated top holders (3%, lottery only).
    pub top_bps: u16,
    /// Slice paid to the round's ten random winners (6%, lottery only).
    pub draw_bps: u16,
    /// How the lottery draw is seeded.
    pub entropy_source: EntropySource,

    // ---------------------------------------------------------------- curve
    /// The pump.fun curve, unchanged.
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub total_supply: u64,
    /// Tokens minted up front and locked for the migration pool.
    pub pool_reserve: u64,
    /// Real SOL raise at which the curve has sold out (~85 SOL).
    pub graduation_lamports: u64,
    pub market_cap_lamports: u64,

    // ---------------------------------------------------------------- stats
    pub trades: u64,
    pub buys: u64,
    pub sells: u64,
    pub volume_lamports: u128,
    pub positions: u64,
    pub migrated_at: i64,
    pub pool: Pubkey,

    // ---------------------------------------------------------------- dividends
    /// Lamports-per-token accumulator, 1e18 scaled.
    pub dividend_acc: u128,
    pub dividend_distributed: u64,
    pub dividend_claimed: u64,

    // ---------------------------------------------------------------- lottery
    /// Round currently open.
    pub round: u64,
    /// Lifetime SOL paid out to the seated top holders.
    pub top_distributed: u64,
    /// Lifetime SOL paid out to the draw winners.
    pub draw_distributed: u64,
}

impl Launch {
    /// Supply that is not locked in a program vault: everything that can hold,
    /// claim dividends and be drawn.
    pub fn eligible_supply(&self) -> u64 {
        self.total_supply
            .saturating_sub(self.real_token_reserves)
            .saturating_sub(self.pool_reserve)
    }

    /// Market cap in lamports = price x total supply.
    pub fn market_cap(&self) -> u64 {
        if self.virtual_token_reserves == 0 {
            return 0;
        }
        let price = (self.virtual_sol_reserves as u128)
            .saturating_mul(ACC_PRECISION)
            / self.virtual_token_reserves as u128;
        ((price.saturating_mul(self.total_supply as u128)) / ACC_PRECISION) as u64
    }

    /// Lamports per whole token, 1e6 scaled (display helper).
    pub fn price_e6(&self) -> u128 {
        if self.virtual_token_reserves == 0 {
            return 0;
        }
        self.virtual_sol_reserves as u128 * ONE_TOKEN as u128 * ONE_TOKEN as u128
            / self.virtual_token_reserves as u128
    }
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub launch: Pubkey,
    pub owner: Pubkey,
    /// Token balance the position keeps books for.
    pub tracked_balance: u64,
    /// Signed checkpoint marker: `balance * acc / 1e18 - pending` at the last settle.
    pub dividend_paid: i128,
    pub dividends_claimed: u64,
    pub volume_lamports: u128,
    pub trades: u64,
    pub bump: u8,
}

/// One lottery round: the 6% slice accrues here until it is drawn.
///
/// A round closes on volume, then publishes a commitment and can only be drawn
/// from entropy that did not exist while the round was still trading.
#[account]
#[derive(InitSpace)]
pub struct Round {
    pub launch: Pubkey,
    pub index: u64,
    /// Accrued 6% slice waiting to be drawn.
    pub pot: u64,
    /// Volume traded into the round.
    pub volume_lamports: u128,
    pub trades: u64,
    pub opened_at_slot: u64,
    /// `sha256(seed || index || target_slot)`, published when the round closes.
    pub commitment: [u8; 32],
    /// Creator supplied entropy, committed at launch.
    pub seed: [u8; 32],
    pub closed_at_slot: u64,
    pub target_slot: u64,
    /// Switchboard account this round is bound to (unset for slot hashes).
    pub randomness_account: Pubkey,
    /// Slot that account was committed at - always before the first trade.
    pub randomness_seed_slot: u64,
    pub resolved: bool,
    pub resolved_at_slot: u64,
    pub winners: [Pubkey; DRAW_WINNERS],
    /// How many seats of `winners` are filled (a small pool seats everybody).
    pub winners_found: u8,
    /// What each winner receives.
    pub prize: u64,
    /// Unclaimed shares (`prize - paid`) roll into the next pot.
    pub paid_out: bool,
    pub bump: u8,
}

impl Round {
    pub fn is_open(&self) -> bool {
        self.closed_at_slot == 0
    }
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub launch: Pubkey,
    pub sol_reserves: u64,
    pub token_reserves: u64,
    pub lp_mint: Pubkey,
    pub lp_supply: u64,
    pub bump: u8,
}

/// Arguments accepted by `create_launch`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateLaunchArgs {
    pub mode: LaunchMode,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    /// 32 random bytes, committed on-chain for the lottery draws.
    pub seed: [u8; 32],
}

