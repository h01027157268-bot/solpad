# Economics

Everything below is implemented in `programs/launchpad/src` and mirrored
1:1 in `app/src/lib/engine`. The numbers the UI quotes are produced by the same
formulas the program runs on-chain.

## 1. The curve

Constant product with virtual reserves (pump.fun / Raydium LaunchLab, unchanged):

```text
v_sol  = 30 SOL            v_tok = 1,073,000,000 tokens
curve  = 793,100,000       pool  = 206,900,000      total = 1,000,000,000
```

```text
buy   tokens_out = v_tok * net_sol / (v_sol + net_sol)
sell  gross_sol  = v_sol * tokens_in / (v_tok + tokens_in)
```

Selling the curve out costs the buyer side

```text
sol_in = v_sol * curve / (v_tok - curve) = 30 * 793.1 / 279.9 = 85.005 SOL
```

so graduation is set at **85 SOL raised**. Market cap is `price * total_supply`,
which is **27.96 SOL** at the floor and **410.9 SOL** at graduation.

## 2. Taxes

`split_fees(amount, cfg)` floors every slice, so rounding dust always stays with
the trader or the seller, never with the platform.

### Dividend mode

```text
total   500 bps   5.00%
vault   100 bps   1.00%
holders 400 bps   4.00%
net     9,500 bps 95.00%
```

### Lottery mode

```text
total     1,000 bps  10.00%
vault       100 bps   1.00%
pot           600 bps  6.00%  trades 0..9
pot           300 bps  3.00%  trade 10 onwards
remainder     300 bps  3.00%  while the pot takes 6%
remainder     600 bps  6.00%  while the pot takes 3%
net         9,000 bps 90.00%
```

The remainder is routed to whichever bucket the creator picked at launch:
`dividends`, `lottery`, `treasury` or `creator`. `remainder` in the breakdown
only carries the amount that needs its own transfer, which keeps the identity
`vault + dividend + lottery + remainder == total_tax` exact.

On a buy the trader pays `amount_in` and the curve receives `net`; on a sell the
curve pays out `gross` and the trader receives `net`. The tax is therefore
symmetric  you pay it leaving the curve as well as entering it.

## 3. Dividends: the accumulator

```text
acc     += dividend_lamports * 1e18 / eligible_supply
pending  = tracked_balance * acc / 1e18 - dividend_paid
```

`eligible_supply = total_supply - real_token_reserves - pool_reserve`, i.e.
everything that is not sitting in a program vault (the curve vault and the pool
reserve). Every token is in one of three places  the curve, the pool or a wallet
 so this is exactly the supply that can claim.

### Why the vault is always solvent

Take a distribution `D` over the eligible supply `S` at the moment of the trade.
Every position that was checkpointed *before* the increment and settled *after*
it gains `balance * (D/S)`. The trade that triggered the distribution is settled
*after* the increment, so the supply used for `S` is the pre-trade supply: on a
buy the new tokens are excluded, on a sell the returning tokens are still
included (the seller keeps earning for the period they held them).

That makes the sum of all gains exactly `D`, which is exactly what was moved into
the vault.

### Why `dividend_paid` is signed

```text
dividend_paid = balance_at_checkpoint * acc_at_checkpoint / 1e18 - pending
```

If a holder sells everything, `balance` drops to zero while `pending` is still
positive, so the marker must go negative. The tempting alternative  clamping it
at zero  throws the claim away and makes the books treat the position as if it
had already been paid, which lets the same position claim again later. The test
`the_vault_stays_solvent_over_a_long_run` (Rust) and its mirror in
`app/scripts/economics.test.ts` both fail if the clamp is introduced.

### Transfers

The program re-bases a position on the *real* SPL balance every time it touches
it. Units that arrived through a plain transfer are checkpointed at the
accumulator of the moment they are first seen, so they earn from then on and
never from history. The sender keeps what they accrued while they held  which is
correct, and cannot double-count, because the two positions share the same
`eligible_supply` denominator.

## 4. Lottery

```text
tickets        = volume_lamports / 0.01 SOL        (floor, on buys and sells)
round closes   = 1,000 tickets  or  64 wallets  or  manually when quiet
commitment     = sha256(seed || round || target_slot)      published at close
winning ticket = sha256(commitment || slot_hash(target_slot)) % total_tickets
owner          = the seat whose cumulative ticket range contains the winner
```

Bounding a round to 64 wallets is what makes the draw a single instruction: the
board is a fixed 64-seat account, and the program walks it linearly to find the
winning seat.

Entropy: `target_slot` is fixed when the round closes and lies in the future, so
the slot hash cannot be known while tickets are still being sold. If the draw is
delayed past the 512-slot slot-hashes window the program falls back to the oldest
hash still available  which is still newer than the slot the round closed in, so
it remains unknowable in advance. A round whose prize is never claimed rolls back
into the next pot after 150,000 slots (~17h), so a lost key can never freeze the
lottery.

Rollover is `Config.lottery_rollover_bps`, default `0`: the winner takes the
whole pot.

## 5. Graduation

```text
sol_seeded    = the whole raise (real_sol_reserves + the rent buffer)
tokens_seeded = curve remainder + 206,900,000 reserved
lp_supply     = sqrt(sol_seeded * tokens_seeded)
```

Both the pool price and the final curve price are ~`4.109e-4` lamports per base
unit, so migration is price continuous to well under one basis point. LP tokens
are minted into a vault whose authority is the launch PDA and there is no
instruction anywhere that can release them.

Because the pool is the only venue, `swap` charges the same tax the curve did,
forever. `launch.pool_reserve` keeps mirroring the pool's token reserves after
migration, so `eligible_supply` stays exact for dividend accounting too.

## 6. Fee caps enforced on-chain

| Constant | Value |
| --- | --- |
| `MAX_TOTAL_TAX_BPS` | 1,500 (15%) |
| `MAX_VAULT_FEE_BPS` | 200 (2%) |
| `MAX_DIVIDEND_BPS` | 1,000 (10%) |
| `MAX_LOTTERY_BPS` | 1,000 (10%) |
| `MAX_CREATION_FEE_LAMPORTS` | 0.1 SOL |
| `MAX_ROLLOVER_BPS` | 5,000 (50%) |
