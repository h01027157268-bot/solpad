//! Protocol-wide constants.
//!
//! The bonding curve is the *pump.fun / Raydium LaunchLab* curve, unchanged:
//!   * total supply 1_000_000_000 tokens (6 decimals)
//!   * 793_100_000 tokens sold on the curve
//!   * 206_900_000 tokens reserved to seed the post-graduation pool
//!   * virtual reserves 30 SOL / 1_073_000_000 tokens
//! Selling the curve out raises ~85 SOL and completes at a ~$73k market cap
//! (at the ~$5k launch market cap pump.fun/Umbra display).
//!
//! Taxes are the launchpad's own and are applied by the program on every
//! bonding-curve trade and every post-graduation pool swap.

use anchor_lang::prelude::*;

/// Basis points denominator (10_000 bps == 100%).
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Fixed point scale of the dividend accumulator (lamports-per-token, 1e18 scaled).
pub const ACC_PRECISION: u128 = 1_000_000_000_000_000_000;

pub const TOKEN_DECIMALS: u8 = 6;
pub const ONE_TOKEN: u64 = 1_000_000; // 10^6 base units

/// Total supply: 1_000_000_000 tokens.
pub const TOTAL_SUPPLY: u64 = 1_000_000_000 * ONE_TOKEN;
/// Tokens sold on the bonding curve: 793_100_000.
pub const CURVE_SUPPLY: u64 = 793_100_000 * ONE_TOKEN;
/// Tokens reserved for the migration pool: 206_900_000.
pub const POOL_RESERVE: u64 = 206_900_000 * ONE_TOKEN;

/// Virtual SOL reserves of the curve: 30 SOL.
pub const VIRTUAL_SOL_RESERVES: u64 = 30_000_000_000;
/// Virtual token reserves of the curve: 1_073_000_000 tokens.
pub const VIRTUAL_TOKEN_RESERVES: u64 = 1_073_000_000 * ONE_TOKEN;

/// Real SOL that must be raised before the curve can graduate: ~85 SOL.
/// (253_100_000 tokens left in the virtual reserves when the curve sells out.)
pub const GRADUATION_LAMPORTS: u64 = 85_000_000_000;

/// Platform vault share of the tax (1%) in both modes.
pub const VAULT_BPS: u16 = 100;
/// Dividend-mode total tax (5%).
pub const DIVIDEND_MODE_TAX_BPS: u16 = 500;
/// Dividend-mode holder dividend (4%).
pub const DIVIDEND_MODE_DIVIDEND_BPS: u16 = 400;
/// Lottery-mode total tax (10%).
pub const LOTTERY_MODE_TAX_BPS: u16 = 1_000;
/// Lottery mode: seats on the top-holder board (3% is split evenly here).
pub const TOP_SEATS: usize = 10;
/// Lottery mode: share split evenly across the seated top holders (3%).
pub const TOP_SHARE_BPS: u16 = 300;
/// Lottery mode: share paid to `DRAW_WINNERS` random holders each round (6%).
pub const DRAW_SHARE_BPS: u16 = 600;
/// Lottery mode: how many wallets win each round.
pub const DRAW_WINNERS: usize = 10;
/// Wallet slots in the holder registry the winners are drawn from.
///
/// This is the single most expensive account a creator pays for, so it is kept
/// small on purpose: 64 slots cost ~0.015 SOL of rent, 256 would cost ~0.058 SOL.
/// A launch that gathers more than 64 holders keeps drawing from the first 64.
pub const MAX_HOLDERS: usize = 64;

/// A round closes once this much volume has traded into it (10 SOL).
pub const ROUND_VOLUME_TARGET_LAMPORTS: u64 = 10_000_000_000;
/// Slots to wait between closing a round and drawing it (lazy VRF delay).
pub const REVEAL_DELAY_SLOTS: u64 = 8;
pub const ROUND_EXPIRY_SLOTS: u64 = 150_000;

/// Fee caps enforced on-chain (bps).
pub const MAX_TOTAL_TAX_BPS: u16 = 1_500; // 15%
pub const MAX_VAULT_FEE_BPS: u16 = 200; // 2%
pub const MAX_DIVIDEND_BPS: u16 = 1_000; // 10%
pub const MAX_LOTTERY_BPS: u16 = 1_000; // 10%

/// Minimum trade size (0.001 SOL) so a position/token account is always rent safe.
pub const MIN_TRADE_LAMPORTS: u64 = 1_000_000;

/// PDA seeds.
pub const CONFIG_SEED: &[u8] = b"config";
pub const LAUNCH_SEED: &[u8] = b"launch";
pub const MINT_SEED: &[u8] = b"mint";
pub const CURVE_VAULT_SEED: &[u8] = b"curve_vault";
pub const POOL_RESERVE_SEED: &[u8] = b"pool_reserve";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";
pub const DIVIDEND_VAULT_SEED: &[u8] = b"dividend_vault";
pub const LOTTERY_VAULT_SEED: &[u8] = b"lottery_vault";
pub const LOTTERY_STATE_SEED: &[u8] = b"lottery_state";
pub const POSITION_SEED: &[u8] = b"position";
pub const POOL_SEED: &[u8] = b"pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
pub const LP_MINT_SEED: &[u8] = b"lp_mint";
pub const LP_LOCK_SEED: &[u8] = b"lp_lock";

/// Metadata limits.
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;

/// Solana slot-hashes sysvar, used as the protocol's entropy source.
pub const SLOT_HASHES_ID: Pubkey = solana_program::sysvar::slot_hashes::ID;

/// Post-graduation AMM pool accounts.
pub const POOL_SOL_SEED: &[u8] = b"pool_sol";
pub const POOL_TOKEN_SEED: &[u8] = b"pool_tokens";

/// Lottery round bounds.
/// A round closes as soon as either bound is hit, so every participant of a
/// round is always represented on the on-chain board and the draw stays fair.
pub const MAX_PARTICIPANTS: usize = 64;
pub const ROLLOVER_BPS: u16 = 0; // 100% of the pot goes to the winner


/// Platform limits.
pub const MAX_CREATION_FEE_LAMPORTS: u64 = 100_000_000; // 0.1 SOL
pub const MAX_ROLLOVER_BPS: u16 = 5_000; // 50%

/// Metadata: royalties are capped at 5% and default to 0 for launchpad tokens.
pub const MAX_SELLER_FEE_BPS: u16 = 500;


/// PDAs for the lottery membership sets and the round.
pub const TOP_BOARD_SEED: &[u8] = b"top_board";
pub const HOLDER_REGISTRY_SEED: &[u8] = b"holder_registry";
pub const ROUND_SEED: &[u8] = b"round";
/// A round can be closed early once it has been quiet for this long.
pub const ROUND_QUIET_SLOTS: u64 = 43_200;

/// The round pot (the 6% draw slice) lives here between draws.
pub const DRAW_VAULT_SEED: &[u8] = b"draw_vault";



