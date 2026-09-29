//! Round lifecycle.
//!
//! A round is nothing but the 6% slice accruing until it is drawn, so the
//! lifecycle is short: it opens, it accumulates, it closes on volume (or when
//! anyone closes it because it went quiet), and then one instruction draws ten
//! winners and pays them in the same transaction.

use anchor_lang::prelude::*;
use solana_program::hash::{hashv, Hash};

use crate::constants::*;
use crate::state::Round;

/// Commit a round to a slot: the draw can only use entropy that did not exist
/// while the round was still trading.
pub fn close_round(round: &mut Round, slot: u64, target_slot: u64) {
    if !round.is_open() {
        return;
    }
    round.closed_at_slot = slot;
    round.target_slot = target_slot;
    round.commitment = commitment_for(&round.seed, round.index, target_slot);
}

pub fn commitment_for(seed: &[u8; 32], index: u64, target_slot: u64) -> [u8; 32] {
    let digest: Hash = hashv(&[
        seed.as_ref(),
        &index.to_le_bytes(),
        &target_slot.to_le_bytes(),
    ]);
    digest.to_bytes()
}

/// Start a fresh round in place, carrying `carry` lamports of rollover.
pub fn open_round(round: &mut Round, slot: u64, carry: u64) {
    round.index = round.index.saturating_add(1);
    round.pot = carry;
    round.volume_lamports = 0;
    round.trades = 0;
    round.opened_at_slot = slot;
    round.closed_at_slot = 0;
    round.target_slot = 0;
    round.randomness_account = Pubkey::default();
    round.randomness_seed_slot = 0;
    round.commitment = [0u8; 32];
    round.resolved = false;
    round.resolved_at_slot = 0;
    round.winners = [Pubkey::default(); DRAW_WINNERS];
    round.winners_found = 0;
    round.prize = 0;
    round.paid_out = false;
}

/// Extract `slot` out of the slot-hashes sysvar data.
/// Layout: `u64` length followed by `(u64 slot, [u8; 32] hash)` entries, newest first.
pub fn slot_hash_at(data: &[u8], slot: u64) -> Option<[u8; 32]> {
    if data.len() < 8 {
        return None;
    }
    let mut len_bytes = [0u8; 8];
    len_bytes.copy_from_slice(&data[..8]);
    let declared = u64::from_le_bytes(len_bytes) as usize;
    let available = data.len().checked_sub(8)? / 40;
    for i in 0..declared.min(available) {
        let offset = 8 + i * 40;
        let entry = data.get(offset..offset + 40)?;
        let mut slot_bytes = [0u8; 8];
        slot_bytes.copy_from_slice(&entry[..8]);
        if u64::from_le_bytes(slot_bytes) == slot {
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&entry[8..40]);
            return Some(hash);
        }
    }
    None
}

/// Oldest slot hash still inside the sysvar window (newest first layout).
///
/// Used when the draw is late enough that the committed slot has fallen out of
/// the window: the oldest hash still available is *newer* than the slot the
/// round closed in, so it was equally unknowable while the round was trading.
pub fn oldest_slot_hash(data: &[u8]) -> Option<[u8; 32]> {
    if data.len() < 8 + 40 {
        return None;
    }
    let mut len_bytes = [0u8; 8];
    len_bytes.copy_from_slice(&data[..8]);
    let declared = u64::from_le_bytes(len_bytes) as usize;
    let available = data.len().checked_sub(8)? / 40;
    let count = declared.min(available).checked_sub(1)?;
    let offset = 8 + count * 40;
    let entry = data.get(offset..offset + 40)?;
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&entry[8..40]);
    Some(hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round() -> Round {
        Round {
            launch: Default::default(),
            index: 1,
            pot: 0,
            volume_lamports: 0,
            trades: 0,
            opened_at_slot: 100,
            commitment: [0u8; 32],
            seed: [3u8; 32],
            closed_at_slot: 0,
            target_slot: 0,
            randomness_account: Default::default(),
            randomness_seed_slot: 0,
            resolved: false,
            resolved_at_slot: 0,
            winners: [Pubkey::default(); DRAW_WINNERS],
            winners_found: 0,
            prize: 0,
            paid_out: false,
            bump: 0,
        }
    }

    #[test]
    fn closing_commits_the_round_to_a_future_or_past_slot() {
        let mut r = round();
        close_round(&mut r, 5_000, 5_000 + REVEAL_DELAY_SLOTS);
        assert!(!r.is_open());
        assert_eq!(r.target_slot, 5_008);
        assert_eq!(r.commitment, commitment_for(&r.seed, 1, 5_008));
        assert_ne!(r.commitment, [0u8; 32]);
        // closing twice does not move the commitment
        close_round(&mut r, 6_000, 6_008);
        assert_eq!(r.closed_at_slot, 5_000);
        assert_eq!(r.target_slot, 5_008);
    }

    #[test]
    fn opening_carries_the_rollover() {
        let mut r = round();
        close_round(&mut r, 5_000, 5_008);
        r.pot = 1_000;
        open_round(&mut r, 5_100, 250);
        assert_eq!(r.index, 2);
        assert_eq!(r.pot, 250);
        assert!(r.is_open());
        assert_eq!(r.commitment, [0u8; 32]);
        assert_eq!(r.winners_found, 0);
    }

    #[test]
    fn slot_hash_lookup() {
        let mut data = Vec::new();
        data.extend_from_slice(&2u64.to_le_bytes());
        data.extend_from_slice(&100u64.to_le_bytes());
        data.extend_from_slice(&[1u8; 32]);
        data.extend_from_slice(&99u64.to_le_bytes());
        data.extend_from_slice(&[2u8; 32]);
        assert_eq!(slot_hash_at(&data, 100).unwrap(), [1u8; 32]);
        assert_eq!(slot_hash_at(&data, 99).unwrap(), [2u8; 32]);
        assert!(slot_hash_at(&data, 98).is_none());
        assert_eq!(oldest_slot_hash(&data).unwrap(), [2u8; 32]);
    }
}

