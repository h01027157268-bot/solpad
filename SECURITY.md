# Security

This document is the honest state of the SolPad program: what is proven, what is
only argued, what is known to be imperfect, and what has **not** been done yet.

> **Status: not audited.** There has been no third-party review, no
> `solana-test-validator` integration run, and no mainnet deployment. Do not put
> user funds behind this program until the checklist at the bottom is complete.

## 1. What the tests actually prove

`cargo test --lib` runs 31 tests with no validator. They are property and
invariant tests over the exact code the chain runs (`programs/launchpad/src`):

| Invariant | Where |
| --- | --- |
| The curve raises ~85 SOL and graduates at ~411 SOL market cap | `curve.rs` |
| Migration lands within 1bp of the final curve price | `curve.rs` |
| `split_fees` never takes more than the advertised rate, for every amount, and the split always adds back up to the trade | `fees.rs` |
| The 3% seat slice is fully distributed: `share * seats + dust == slice`, dust to the treasury | `fees.rs` |
| The 6% pot is fully distributed: `prize * winners + dust == pot` | `fees.rs` |
| The dividend vault can never be over-subscribed, over 500 distributions (the signed `dividend_paid` is what makes this hold) | `dividends.rs` |
| A wallet that received tokens by plain transfer cannot claim history | `dividends.rs` |
| Selling everything keeps exactly what was accrued, and nothing more | `dividends.rs` |
| The board is always sorted, never stale, has no duplicates, and admits any wallet that grows past the smallest seat | `board.rs` |
| Every ticket... every holder in the pool has a non-zero chance: the draw is uniform, deterministic and distinct | `board.rs` |
| A round's commitment binds to the right slot per entropy source, and cannot be predicted from the seed | `round.rs`, `entropy.rs` |
| The Switchboard account layout, discriminator and reveal-slot rule match the official v0.13.0 crate | `entropy.rs` |

What they do **not** prove: anything about CPI behaviour, account substitution,
remaining-account ordering, compute budget, or the interaction between
instructions. Those need a validator (see checklist).

## 2. Economic model, bucket by bucket

### Dividend mode - 5% on every buy and sell

`1% vault + 4% accumulator`. The accumulator is spread over
`eligible_supply = total - curve_vault - pool_reserve`, which is exactly the
supply that can claim, so the sum of all pending claims always equals the
lamports paid in. Full derivation in `docs/economics.md`.

### Lottery mode - 10% on every buy and sell

`1% vault + 3% to the ten largest holders + 6% drawn by ten random holders`.

* **The 3% is pushed, not accrued.** Every trade pays the seated wallets in the
  same instruction. The seats arrive as typed optional accounts, each one is
  checked against the on-chain board (`require_keys_eq!`), so a caller can
  neither redirect the payout nor make the program pay a wallet of their
  choosing. Dust (from the integer division) goes to the treasury, never stuck.
* **The 6% accrues into the round pot** and is paid out when the round is drawn.
  A round closes at 10 SOL of volume (or on a permissionless early close once it
  has been quiet), publishes `sha256(seed || index || target_slot)`, and can only
  be drawn with entropy that did not exist while the round was trading.
* **Entropy.** `SlotHashes` reads a slot hash that had not happened yet;
  `Switchboard` consumes an On-Demand randomness account whose `seed_slot` is
  bound *before the round's first trade*, and whose value Switchboard only hands
  over in the slot it was revealed in. Both feed the same selection function.

## 3. Known limitations (by design, not bugs)

1. **The top ten is the ten largest *observed* positions.** On-chain order
   statistics over an unbounded holder set are impossible, so the board keeps at
   most ten wallets. A wallet that is pushed out stays out until it trades again,
   which means the 3% can sometimes reach a wallet that is no longer truly in the
   top ten. Money is still fully distributed and the vault cannot be drained -
   the only effect is *which* wallet receives a slice.
2. **The holder registry holds 256 wallets.** A launch that gathers more holders
   keeps drawing from the first 256 who arrived. This bounds the draw to one
   instruction, which is the price of not needing an off-chain crank.
3. **Balances only change through the program.** Tokens moved with a plain SPL
   transfer are invisible until the wallet trades or claims again; the position
   is then re-based at the current accumulator, so it can never claim history -
   but the sender keeps earning on a balance it no longer holds until it is
   re-based too. This can strand (never over-claim) lamports in the dividend
   vault; `sweep_dividend_vault` can only move the surplus above outstanding
   claims.
4. **The lottery draw is a committed-slot scheme, not a cryptographic VRF.**
   A Solana leader can in principle censor or reorder transactions to steer a
   slot hash. The cost is far above this pot size, but it is not zero. Switchboard
   removes that assumption and adds a liveness dependency (an oracle that never
   reveals leaves the pot waiting for the next round).
5. **Post-graduation taxes only exist on our own pool.** Liquidity is locked
   forever, so the program's pool is the only venue - but nothing stops somebody
   from creating a second, untaxed market for the same mint.

## 4. Attack surface review

| Vector | Verdict |
| --- | --- |
| Faking a seat, a winner, or reordering them | Blocked: every account is compared against `TopBoard.seats[i]` / `Round.winners[i]`. |
| Making a trade pay a wallet that is not on the board | Blocked: `seats_accounts[i]` must equal the stored seat. |
| Bricking every trade by closing a seat's wallet | Handled: a seat with zero lamports has its share routed to the treasury instead of failing the transfer. |
| Reusing a Switchboard value, or grinding across pre-committed accounts | `get_value` requires `clock.slot == reveal_slot`; a round binds one account chosen before its first trade. |
| Double-claiming dividends, or claiming history after a transfer | The accumulator is signed and re-based on the real SPL balance (tested). |
| Over-claiming by reviving a stale position | `settle` is called on every touch, and the vault balance is checked before paying. |
| Censoring the draw to keep the pot | Anyone can crank `resolve_round`; the round falls back to the oldest available slot hash so it can never be stuck. |
| Minting more supply | Authority revoked inside `create_launch` (CPI `SetAuthority` -> `None`). |
| Draining the raise or the LP | The raise is only spendable through `sell`/`swap`/`migrate`; LP is minted into a vault whose authority is the launch PDA and there is no instruction that releases it. |
| Sweeping user dividends | `sweep_dividend_vault` can only move `balance - (distributed - claimed)`. |
| Overflow / rounding | Every arithmetic path is `checked_*` (and `overflow-checks = true` in release), and rounding always favours the trader. |
| Admin rug | `update_config` cannot change a live launch's tax, curve, or vaults; the authority cannot pause a specific launch. |

## 5. Before mainnet: the checklist

- [ ] `anchor build` + `anchor test` on Linux/macOS (integration tests against
      `solana-test-validator`, not just unit tests).
- [ ] Run the app's end-to-end suite against the deployed devnet program.
- [ ] Independent audit of `board.rs`, `round.rs`, `fees.rs`,
      `instructions/{trade,round_ix,swap}.rs`.
- [ ] Fuzz `split_fees`/`seat_share` and the draw with a property-testing
      harness (proptest or trident).
- [ ] Confirm the Switchboard queue on the target cluster and pin
      `SWITCHBOARD_ON_DEMAND_*` to the deployed program id.
- [ ] Multisig the platform authority (Squads) and hand over `treasury`.
- [ ] Decide the launch fee, the round volume target and `MAX_HOLDERS` with real
      numbers, then re-run the cost table in `app/src/lib/create-costs.ts`.
- [ ] Freeze the repo, run `solana-verify build`, publish the hash, then deploy
      that exact binary.

## 6. Reporting

Open a private security advisory on the repository, or mail the maintainers.
Please do not open a public issue for anything that could move funds.
