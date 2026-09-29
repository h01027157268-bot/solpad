//! Program events (indexed by the frontend / indexer).

use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub creation_fee_lamports: u64,
}

#[event]
pub struct LaunchCreated {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub mode: u8,
    pub name: String,
    pub symbol: String,
    pub total_supply: u64,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub graduation_lamports: u64,
    pub created_at: i64,
}

#[event]
pub struct Trade {
    pub launch: Pubkey,
    pub trader: Pubkey,
    pub mint: Pubkey,
    pub is_buy: bool,
    /// Lamports paid or received by the trader (post-fee on buys, pre-fee on sells).
    pub sol_amount: u64,
    /// Tokens received or burned by the trader.
    pub token_amount: u64,
    pub price_before: u64,
    pub price_after: u64,
    pub vault_fee: u64,
    /// Share split across the seated top holders (lottery mode).
    pub top_fee: u64,
    /// Share added to the round pot (lottery mode).
    pub draw_fee: u64,
    /// Share folded into the pro-rata accumulator (dividend mode).
    pub dividend_fee: u64,
    pub trade_index: u64,
    pub slot: u64,
    pub top_seats: u64,
    pub round: u64,
}

#[event]
pub struct DividendsDistributed {
    pub launch: Pubkey,
    pub amount: u64,
    pub eligible_supply: u64,
    pub accumulator: u128,
}

#[event]
pub struct DividendsClaimed {
    pub launch: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct LotteryTickets {
    pub launch: Pubkey,
    pub owner: Pubkey,
    pub tickets: u64,
    pub total_tickets: u64,
    pub round: u64,
    pub lamports: u64,
}

#[event]
pub struct LotteryRoundClosed {
    pub launch: Pubkey,
    pub round: u64,
    pub target_slot: u64,
    pub commitment: [u8; 32],
    pub pot: u64,
    pub tickets: u64,
    pub participants: u64,
    pub reason: u8,
}

#[event]
pub struct LotteryResolved {
    pub launch: Pubkey,
    pub round: u64,
    pub winning_ticket: u64,
    pub total_tickets: u64,
    pub slot_hash: [u8; 32],
    pub target_slot: u64,
    pub winner: Pubkey,
    pub prize: u64,
    pub rollover: u64,
    /// 0 = slot hashes, 1 = Switchboard.
    pub entropy_source: u8,
    /// Slot the entropy came from (the reveal slot for Switchboard).
    pub reveal_slot: u64,
}

#[event]
pub struct LotteryPrizeClaimed {
    pub launch: Pubkey,
    pub round: u64,
    pub winner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Migrated {
    pub launch: Pubkey,
    pub sol_seeded: u64,
    pub tokens_seeded: u64,
    pub lp_amount: u64,
}

#[event]
pub struct Swapped {
    pub launch: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub sol_amount: u64,
    pub token_amount: u64,
    pub total_fee: u64,
}

#[event]
pub struct LotteryRoundOpened {
    pub launch: Pubkey,
    pub round: u64,
    pub slot: u64,
    /// 0 = slot hashes, 1 = Switchboard.
    pub entropy_source: u8,
    pub randomness_account: Pubkey,
    pub randomness_seed_slot: u64,
}

#[event]
pub struct PrizeRolledOver {
    pub launch: Pubkey,
    pub round: u64,
    pub amount: u64,
}

#[event]
pub struct ConfigUpdated {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub paused: bool,
}

#[event]
pub struct AuthorityTransferStarted {
    pub current: Pubkey,
    pub pending: Pubkey,
}

#[event]
pub struct AuthorityTransferred {
    pub previous: Pubkey,
    pub current: Pubkey,
}

#[event]
pub struct DividendsSwept {
    pub launch: Pubkey,
    pub amount: u64,
}

#[event]
pub struct MetadataAttached {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub metadata: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

#[event]
pub struct TopDistributed {
    pub launch: Pubkey,
    pub round: u64,
    pub amount: u64,
    pub seats: u64,
    pub per_seat: u64,
}

#[event]
pub struct HolderRegistered {
    pub launch: Pubkey,
    pub holder: Pubkey,
    pub holders: u64,
}

#[event]
pub struct RoundClosed {
    pub launch: Pubkey,
    pub index: u64,
    pub pot: u64,
    pub volume_lamports: u64,
    pub target_slot: u64,
    pub commitment: [u8; 32],
}

#[event]
pub struct RoundResolved {
    pub launch: Pubkey,
    pub index: u64,
    pub pot: u64,
    pub prize: u64,
    pub winners: [Pubkey; 10],
    pub winners_found: u8,
    pub entropy_source: u8,
    pub reveal_slot: u64,
    pub pool_size: u32,
}

