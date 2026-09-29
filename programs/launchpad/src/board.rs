//! The two bounded membership sets the lottery mode needs.
//!
//! `TopBoard` is the *hot* account: the ten largest positions, kept sorted so
//! the 3% slice can be paid out inside the trade that produced it. It is small
//! and rewritten on every trade.
//!
//! `HolderRegistry` is the *cold* account: every wallet that ever held the
//! token, appended once, up to `MAX_HOLDERS`. It is the pool the 6% draw picks
//! its ten winners from, and it is never rewritten afterwards - which is what
//! keeps an 8 KB account out of the trade path.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::LaunchpadError;

#[account]
#[derive(InitSpace)]
pub struct TopBoard {
    pub launch: Pubkey,
    /// Seats in use (0..=TOP_SEATS).
    pub count: u8,
    pub seats: [Pubkey; TOP_SEATS],
    pub balances: [u64; TOP_SEATS],
    pub bump: u8,
}

impl TopBoard {
    pub fn init(&mut self, launch: Pubkey, bump: u8) {
        self.launch = launch;
        self.count = 0;
        self.seats = [Pubkey::default(); TOP_SEATS];
        self.balances = [0u64; TOP_SEATS];
        self.bump = bump;
    }

    pub fn seated(&self, owner: &Pubkey) -> bool {
        self.seats[..self.count as usize].iter().any(|seat| seat == owner)
    }

    /// Total tokens held by the seated wallets - the supply the 3% is spread over.
    pub fn seated_supply(&self) -> u64 {
        self.balances[..self.count as usize].iter().sum()
    }

    /// Insert or move `owner` to `balance`, keeping the board sorted descending.
    ///
    /// A wallet that falls out of the top ten simply disappears from the board:
    /// no account of its own has to be touched, which is the whole point of
    /// keeping the set bounded.
    pub fn upsert(&mut self, owner: Pubkey, balance: u64) {
        if balance == 0 {
            self.remove(&owner);
            return;
        }
        let count = self.count as usize;
        if let Some(index) = self.seats[..count].iter().position(|seat| seat == &owner) {
            self.seats[index] = owner;
            self.balances[index] = balance;
        } else if count < TOP_SEATS {
            self.seats[count] = owner;
            self.balances[count] = balance;
            self.count = (count + 1) as u8;
        } else if balance > self.balances[TOP_SEATS - 1] {
            self.seats[TOP_SEATS - 1] = owner;
            self.balances[TOP_SEATS - 1] = balance;
        } else {
            return;
        }
        self.sort();
    }

    fn remove(&mut self, owner: &Pubkey) {
        let count = self.count as usize;
        if let Some(index) = self.seats[..count].iter().position(|seat| seat == owner) {
            for i in index..count - 1 {
                self.seats[i] = self.seats[i + 1];
                self.balances[i] = self.balances[i + 1];
            }
            self.count -= 1;
            self.seats[count - 1] = Pubkey::default();
            self.balances[count - 1] = 0;
        }
    }

    /// Ten entries, so a plain insertion sort is the cheapest possible fix-up.
    fn sort(&mut self) {
        let count = self.count as usize;
        for i in 1..count {
            let mut j = i;
            while j > 0 && self.balances[j - 1] < self.balances[j] {
                self.balances.swap(j - 1, j);
                self.seats.swap(j - 1, j);
                j -= 1;
            }
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct HolderRegistry {
    pub launch: Pubkey,
    pub count: u16,
    /// Every wallet that ever held the token, in arrival order.
    pub holders: [Pubkey; MAX_HOLDERS],
    pub bump: u8,
}

impl HolderRegistry {
    pub fn init(&mut self, launch: Pubkey, bump: u8) {
        self.launch = launch;
        self.count = 0;
        self.holders = [Pubkey::default(); MAX_HOLDERS];
        self.bump = bump;
    }

    /// Append a wallet the first time it holds tokens.
    ///
    /// The registry is a fixed 256 slot pool: a launch that gathers more
    /// holders than that keeps drawing from the first 256 who arrived, which is
    /// the price of a bounded on-chain draw.
    pub fn add(&mut self, owner: &Pubkey) -> bool {
        let count = self.count as usize;
        if self.holders[..count].iter().any(|holder| holder == owner) {
            return false;
        }
        if count >= MAX_HOLDERS {
            return false;
        }
        self.holders[count] = *owner;
        self.count = (count + 1) as u16;
        true
    }

    pub fn eligible(&self) -> &[Pubkey] {
        &self.holders[..self.count as usize]
    }

    /// Pick `DRAW_WINNERS` distinct wallets out of the registry.
    ///
    /// The caller supplies the round's entropy; every attempt is
    /// `sha256(commitment || entropy || seed)` so the draw is deterministic,
    /// verifiable and uniformly distributed over the pool. Collisions are
    /// re-hashed with a bumped seed instead of being retried with fresh
    /// randomness, so the result is reproducible from on-chain data alone.
    pub fn draw_winners(
        &self,
        commitment: &[u8; 32],
        entropy: &[u8; 32],
    ) -> Result<[Pubkey; DRAW_WINNERS]> {
        let pool = self.eligible();
        require!(!pool.is_empty(), LaunchpadError::NoEligibleSupply);

        let mut winners = [Pubkey::default(); DRAW_WINNERS];
        let mut found = 0usize;
        let mut seed: u64 = 0;
        // Bounded: 10 winners out of a pool of at least 10 *attempts* is enough
        // with overwhelming probability, and the loop can never run away.
        while found < DRAW_WINNERS && seed < (DRAW_WINNERS as u64) * 64 {
            let digest = solana_program::hash::hashv(&[
                commitment.as_ref(),
                entropy.as_ref(),
                &seed.to_le_bytes(),
            ])
            .to_bytes();
            let mut head = [0u8; 8];
            head.copy_from_slice(&digest[..8]);
            let index = (u64::from_le_bytes(head) % pool.len() as u64) as usize;
            let candidate = pool[index];
            if !winners[..found].iter().any(|winner| winner == &candidate) {
                winners[found] = candidate;
                found += 1;
            }
            seed += 1;
        }
        // A pool smaller than ten wallets seats everybody, and a single wallet
        // takes the whole pot.
        if found < DRAW_WINNERS {
            for winner in winners.iter_mut().skip(found) {
                *winner = Pubkey::default();
            }
        }
        Ok(winners)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    #[test]
    fn the_board_keeps_the_ten_largest_sorted() {
        let mut board = TopBoard {
            launch: Default::default(),
            count: 0,
            seats: [Pubkey::default(); TOP_SEATS],
            balances: [0u64; TOP_SEATS],
            bump: 0,
        };
        board.init(Pubkey::default(), 1);
        for i in 1..=12u8 {
            board.upsert(key(i), (i as u64) * 100);
        }
        assert_eq!(board.count, 10);
        // 12 and 11 are the largest, 1 and 2 were pushed out
        assert_eq!(board.seats[0], key(12));
        assert_eq!(board.balances[0], 1_200);
        assert_eq!(board.seats[9], key(3));
        assert!(!board.seated(&key(1)));
        assert!(!board.seated(&key(2)));
        assert_eq!(board.seated_supply(), (3..=12).sum::<u64>() * 100);
    }

    #[test]
    fn a_wallet_can_move_inside_the_board() {
        let mut board = TopBoard {
            launch: Default::default(),
            count: 0,
            seats: [Pubkey::default(); TOP_SEATS],
            balances: [0u64; TOP_SEATS],
            bump: 0,
        };
        board.init(Pubkey::default(), 1);
        board.upsert(key(1), 100);
        board.upsert(key(2), 200);
        board.upsert(key(3), 300);
        assert_eq!(board.seats[0], key(3));
        board.upsert(key(1), 400); // buys more, takes the top seat
        assert_eq!(board.seats[0], key(1));
        assert_eq!(board.count, 3);
        board.upsert(key(1), 0); // sells everything, leaves the board
        assert_eq!(board.count, 2);
        assert!(!board.seated(&key(1)));
    }

    #[test]
    fn a_dust_holder_never_displaces_a_seat() {
        let mut board = TopBoard {
            launch: Default::default(),
            count: 0,
            seats: [Pubkey::default(); TOP_SEATS],
            balances: [0u64; TOP_SEATS],
            bump: 0,
        };
        board.init(Pubkey::default(), 1);
        for i in 1..=10u8 {
            board.upsert(key(i), 1_000);
        }
        board.upsert(key(99), 1); // 1 base unit: less than the current seat ten
        assert_eq!(board.count, 10);
        assert!(!board.seated(&key(99)));
        assert_eq!(board.seats[9], key(10));
    }

    #[test]
    fn the_registry_appends_once_and_draws_distinct_winners() {
        let mut registry = HolderRegistry {
            launch: Default::default(),
            count: 0,
            holders: [Pubkey::default(); MAX_HOLDERS],
            bump: 0,
        };
        registry.init(Pubkey::default(), 1);
        for i in 1..=40u8 {
            assert!(registry.add(&key(i)));
        }
        assert!(!registry.add(&key(1)));
        assert_eq!(registry.count, 40);

        let commitment = [7u8; 32];
        let entropy = [9u8; 32];
        let winners = registry.draw_winners(&commitment, &entropy).unwrap();
        let mut seen = std::collections::HashSet::new();
        for winner in winners.iter() {
            assert_ne!(*winner, Pubkey::default());
            assert!(seen.insert(winner.to_bytes()));
        }
        assert_eq!(seen.len(), DRAW_WINNERS);

        // deterministic
        let again = registry.draw_winners(&commitment, &entropy).unwrap();
        assert_eq!(again, winners);
        // a different entropy draws a different set
        let other = registry.draw_winners(&commitment, &[8u8; 32]).unwrap();
        assert_ne!(other, winners);
    }

    #[test]
    fn the_board_never_goes_stale_and_always_admits_a_bigger_wallet() {
        // The board is the ten largest *observed* positions. Because the set is
        // bounded, a wallet that was pushed out stays out until it trades again
        // (the program cannot see the rest of the holders), but two things must
        // always hold: every seat carries its wallet's live balance, and any
        // wallet that grows past the smallest seat is admitted immediately.
        let mut balances: std::collections::HashMap<u8, u64> = std::collections::HashMap::new();
        let mut board = TopBoard {
            launch: Default::default(),
            count: 0,
            seats: [Pubkey::default(); TOP_SEATS],
            balances: [0u64; TOP_SEATS],
            bump: 0,
        };
        board.init(Pubkey::default(), 1);
        let mut seed: u64 = 7;
        for _ in 0..500 {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let wallet = ((seed >> 33) as u8) % 24;
            let balance = (seed >> 8) % 5_000;
            if balance == 0 {
                balances.remove(&wallet);
            } else {
                balances.insert(wallet, balance);
            }
            board.upsert(key(wallet), balance);

            // 1. sorted, no duplicates, no empty seat inside the count
            for i in 0..board.count as usize {
                assert!(board.balances[i] > 0, "empty seat {i}");
                assert_eq!(
                    board.balances[i],
                    balances[&board.seats[i].to_bytes()[0]],
                    "seat {i} carries a stale balance"
                );
                for j in (i + 1)..board.count as usize {
                    assert_ne!(board.seats[i], board.seats[j], "duplicate seat");
                    assert!(board.balances[i] >= board.balances[j], "not sorted");
                }
            }

            // 2. a wallet that just traded and beats the smallest seat is on the board
            if balance > 0 {
                let smallest = board
                    .balances
                    .iter()
                    .take(board.count as usize)
                    .min()
                    .copied()
                    .unwrap_or(0);
                if board.count < TOP_SEATS as u8 || balance > smallest {
                    assert!(board.seated(&key(wallet)), "a bigger wallet was not admitted");
                }
            }

            // 3. the count can never exceed the seats
            assert!(board.count as usize <= TOP_SEATS);
        }
    }
    #[test]
    fn a_small_pool_seats_everybody() {
        let mut registry = HolderRegistry {
            launch: Default::default(),
            count: 0,
            holders: [Pubkey::default(); MAX_HOLDERS],
            bump: 0,
        };
        registry.init(Pubkey::default(), 1);
        for i in 1..=3u8 {
            registry.add(&key(i));
        }
        let winners = registry.draw_winners(&[1u8; 32], &[2u8; 32]).unwrap();
        let mut real = winners.iter().filter(|w| **w != Pubkey::default()).count();
        assert_eq!(real, 3);
        real = 3;
        assert_eq!(real, registry.count as usize);
    }
}


