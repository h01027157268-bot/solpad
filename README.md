# SolPad

[![ci](https://github.com/OWNER/solpad/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![verify](https://github.com/OWNER/solpad/actions/workflows/verify.yml/badge.svg)](../../actions/workflows/verify.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![audit: not yet](https://img.shields.io/badge/audit-not%20yet-red.svg)](SECURITY.md)
A Solana fair-launch launchpad. The whole supply of every token is minted onto a
pump.fun bonding curve in one transaction, the creator gets no allocation, and
the trade tax is taken and split by the program  not by a server.

Two economics ship today:

| Mode | Tax | Where it goes |
| --- | --- | --- |
| **Dividends** | **5%** on every buy and sell | 1% platform vault  **4% pro-rata to every holder** |
| **Lottery** | **10%** on every buy and sell | 1% platform vault  **6% to the pot for the first ten trades, 3% afterwards**  remainder routed by the creator (holders / pot / platform / creator) |

The UI follows the design language of [umbrapad.app](https://umbrapad.app/app):
pure black, `white/[0.06]` hairlines, 10px uppercase wide-tracked labels, thin
type, a 380px sticky side panel  Explore / Launch / Token detail.

```
programs/launchpad     Anchor program (Rust)  curve, taxes, dividends, lottery, pool
app                    Next.js 14 app  explore, create, token detail
app/src/lib/engine     TypeScript mirror of the on-chain maths (quotes + tests)
docs/economics.md      Every formula, every invariant, and why it holds
```

---

## 1. The curve

The bonding curve is the pump.fun / Raydium LaunchLab curve, unchanged:

| | |
| --- | --- |
| Total supply | 1,000,000,000 (6 decimals) |
| Sold on the curve | 793,100,000 (79.31%) |
| Minted and locked for the pool | 206,900,000 (20.69%) |
| Virtual reserves | 30 SOL / 1,073,000,000 tokens |
| Opening market cap | ~27.96 SOL (~$5.0k at $180/SOL) |
| Graduation | ~85.0 SOL raised, ~411 SOL market cap (~$74k) |
| Creator allocation | 0% |

`x * y = k` with virtual reserves, exactly like pump.fun:

```text
buy   tokens_out = v_tokens * sol_in / (v_sol  + sol_in)
sell  sol_out    = v_sol    * tokens_in / (v_tok + tokens_in)
```

Minting the whole supply up front (including the pool's 206.9M) means the
migration can never mint anything new, and the mint authority is revoked inside
`create_launch`, so the supply is fixed before the first buy.

**Graduation** is permissionless. Once the raise target is reached anyone can
call `migrate`, which moves the entire raise plus every reserved token into a
constant-product pool. The LP tokens are minted into a vault owned by the launch
PDA and no instruction can ever release them  liquidity is locked forever, and
because the pool is the only venue the same tax keeps applying to every swap.

## 2. Dividend mode (5%)

Every trade pays 5%: 1% to the platform vault and 4% spread across everybody who
holds the token at that moment.

The program keeps a lamports-per-token accumulator scaled by 1e18:

```text
acc     += dividend_lamports * 1e18 / eligible_supply
pending  = tracked_balance * acc / 1e18 - dividend_paid
```

`eligible_supply` is `total_supply - tokens locked in program vaults` (the curve
vault and the pool reserve), which is exactly the supply that can claim  so the
sum of every pending claim equals the lamports that were paid in and the vault
can never be over-subscribed.

`dividend_paid` is **signed** on purpose. It is
`balance_at_checkpoint * acc_at_checkpoint / 1e18 - pending`, which goes negative
when a holder sells their whole bag and has accrued more than their remaining
balance can express. Clamping it to zero (the obvious implementation) silently
destroys that holder's claim and lets other positions over-claim  see
`programs/launchpad/src/dividends.rs` and the solvency test that pins it down.

Tokens that arrive through a plain SPL transfer are re-based at today's
accumulator the first time the program sees them, so a freshly funded wallet can
never claim history it did not hold.

Claims are pull-based: the SOL sits in the dividend vault until the holder calls
`claim_dividends`. There is no lock-up, no vesting and nothing pushed at anyone.

## 3. Lottery mode (10%)

Every trade pays 10%: 1% to the platform vault, and the lottery takes 6% during
the first ten trades and 3% afterwards. Whatever is left (3% early, 6% late) goes
where the creator pointed it at launch: holders, the pot, the platform or the
creator.

* **Tickets are volume weighted**  0.01 SOL of volume is one ticket, on buys and
  on sells.
* **A round is bounded**: it closes the moment it reaches 1,000 tickets or seats
  64 wallets, so the draw always fits in one instruction. A trade that lands while
  a round is being drawn keeps its volume parked and converts it into tickets as
  soon as the next round opens.
* **The draw is a lazy VRF**: when a round closes the program publishes
  `commitment = sha256(seed || round || target_slot)` and only accepts a draw from
  a slot that had not happened yet while tickets were being sold. The winner is
  `sha256(commitment || slot_hash(target_slot)) % total_tickets`, mapped onto the
  board's cumulative ticket distribution. Neither the house nor the last buyer can
  know or steer the outcome. It is verifiable after the fact from the board
  account and the slot-hashes sysvar; swap in Switchboard VRF by replacing the
  entropy source  the selection logic stays put.

## 4. Program surface

| Instruction | Who | What |
| --- | --- | --- |
| `initialize_config` | authority | treasury, launch fee, rollover |
| `update_config` / `accept_authority` | authority | pause, treasury, two-step handover |
| `create_launch` | anyone | mint the supply, open the curve, revoke the mint authority |
| `buy` / `sell` | anyone | trade the curve, pay the tax |
| `claim_dividends` | holders | pull the dividend slice |
| `close_lottery_round` | anyone | close early (escape hatch, permissionless) |
| `resolve_lottery` | anyone | draw a closed round |
| `claim_lottery_prize` | winner | take the pot |
| `open_lottery_round` | anyone | start the next round |
| `migrate` | anyone | graduate into the locked pool |
| `swap` | anyone | trade the locked pool, same tax |
| `sweep_dividend_vault` | authority | rescue only the surplus above outstanding claims |

Accounts: `Config`, `Launch`, `Position`, `LotteryState` (the board), `Pool`, plus
PDAs for the raise, dividend vault, lottery vault, curve vault, migration reserve,
pool vaults and the LP lock.

## 5. Run it

### App

```bash
cd app
npm install
npm run dev        # http://localhost:3000
```

With `NEXT_PUBLIC_PROGRAM_ID` empty (the default) the app runs on an offline
mirror of the program: a deterministic in-browser market that uses the *same*
maths  you can create a token, trade it, claim dividends, run lottery rounds and
graduate a curve without a validator. That is what `npm test` exercises.

### Program

```bash
# Needs the Solana + Anchor toolchain (Linux/macOS or WSL  cargo-build-sbf
# does not run natively on Windows).
cd programs/launchpad
cargo test --lib            # 20 unit tests, no validator needed
anchor build                # produces target/idl/launchpad.json
anchor test                 # integration tests against a local validator
anchor deploy --provider.cluster devnet
```

Then point the app at it:

```bash
cd app
NEXT_PUBLIC_PROGRAM_ID=<your program id> npm run dev
```

and copy `target/idl/launchpad.json` over `app/src/lib/solana/idl.json` so the
client matches the deployed program (see `app/src/lib/solana/client.ts`).

## 6. Tests

```bash
cd app && npm test          # 67 economics + 86 market assertions
cd programs/launchpad && cargo test --lib   # 20 Rust unit tests
```

The TypeScript suite and the Rust suite assert the same numbers, so the quotes the
UI shows and the results the program produces cannot drift apart. Among other
things they pin:

* the curve raises ~85 SOL and graduates at ~411 SOL market cap,
* migration lands within 1bp of the final curve price,
* 5% / 10% splits down to the last basis point, including the 6%  3% transition
  on exactly the tenth trade,
* the dividend vault stays solvent over 500 distributions,
* a wallet that receives tokens by transfer cannot claim history,
* every ticket index maps to an owner and the draw is uniform across the ticket
  space.

## 7. Production checklist

* Replace the slot-hash entropy with Switchboard VRF if you want an audited
  randomness source; the board and payout logic do not change.
* Attach Metaplex token metadata after `create_launch` (the launch account already
  stores name, symbol and uri, so wallets can render it either way).
* Point `NEXT_PUBLIC_RPC_URL` at a paid endpoint; the default devnet endpoint
  rate-limits hard.
* The platform authority should be a multisig.

---

##  Migration status (in progress)

The lottery mode was re-specified as **1% platform  3% split evenly across the
ten largest holders  6% drawn by ten random holders**, so the protocol is being
migrated from the earlier "pot + single winner" design.

### Done (Rust)

* `constants.rs` - `VAULT_BPS=100`, `TOP_SHARE_BPS=300`, `DRAW_SHARE_BPS=600`,
  `TOP_SEATS=10`, `DRAW_WINNERS=10`, `MAX_HOLDERS=256`,
  `ROUND_VOLUME_TARGET_LAMPORTS=10 SOL`.
* `board.rs` (new) - `TopBoard` (the ten largest positions, sorted, rewritten on
  every trade) and `HolderRegistry` (every holder, appended once, up to 256).
  `HolderRegistry::draw_winners` picks `DRAW_WINNERS` distinct wallets from the
  round entropy; 5 unit tests.
* `round.rs` (new) - the round lifecycle (open / close / commitment), 3 tests.
* `fees.rs` - the 1/3/6 split, `seat_share`, 4 tests.
* `state.rs` - `Launch` (top_bps/draw_bps/entropy_source/round/), `Position`,
  `Round`, `Pool`, `CreateLaunchArgs`.
* `entropy.rs` - slot-hash lazy VRF + a verified Switchboard On-Demand account
  reader (`RandomnessAccount`, layout copied from `switchboard-on-demand`
  v0.13.0), 4 tests.
* `instructions/` - `create_launch` (mints, opens the board/registry/round),
  `buy`/`sell` (tax split, seat payout, round accrual, holder registration),
  `swap`, `migrate`, `attach_metadata` (Metaplex CPI), `close_round`,
  `resolve_round` (draw 10 winners, pay them, open the next round), config.

### Blocking

`cargo check --lib` fails with 8 lifetime errors in the new seat-payout path.
Cause: `AccountInfo<'a>` is invariant, and the seats arrive through
`ctx.remaining_accounts` (`&[AccountInfo<'info>]`) while the payer comes from
`ctx.accounts` (`Buy<'x>`), so the compiler has to unify `'x` with `'info` -
which only holds if the handler is declared as
`Context<'_, '_, '_, 'info, Buy<'info>>`. That declaration is rejected by the
`#[program]` macro, which generates the plain `Context<Buy>` form.

Two fixes, either is fine:

1. keep the plain signature in `lib.rs` and move the body into
   `fn process_<'info>(ctx: Context<'_, '_, '_, 'info, Buy<'info>>, ..)`,
   called from the wrapper;
2. declare the ten seats as typed accounts
   (`seat0: Option<UncheckedAccount<'info>>`,  `seat9`) instead of using
   `ctx.remaining_accounts`, which removes the lifetime mixing entirely and is
   also more explicit for clients (the array length then matches the board).

`programs/launchpad/src/instructions/mod.rs` also still contains the now-unused
`pay_top_seats` / `pay_draw_winners` helpers; delete them once the call sites are
settled.

### Remaining frontend work

`app/src/lib/engine/{constants,fees}.ts` already describe the 1/3/6 split, but
`app/src/lib/data/{market,store}.ts`, `app/src/components/token/panels.tsx` and
the two test suites still drive the previous ticket/pot model and need to be
migrated to the board + round model (top-ten payouts, round accrual, ten-winner
draw). The dev server currently serves the pre-migration screens.


### Still open

* `scripts/gen-idl.mjs` was only partially updated for the board/round model
  (`buy`/`sell` done; `swap`, `createLaunch` and the two round cranks still list
  the previous account set), so the app-side IDL needs one more pass.
* The frontend migration described above (market engine, panels, tests).

---

## 教程 / tutorial

A click-by-click Chinese walkthrough (no git, no Linux, no Solana CLI - GitHub
Actions does the Linux work) lives in [docs/教程.md](docs/教程.md).

## The zero-cost path (no Linux, no money)

The only thing that genuinely needs Linux is `cargo build-sbf` / `anchor test` /
`solana-verify`. All three run **for free on GitHub Actions** for a public
repository, so the plan is: keep the repo public, let CI be the Linux box.

| Step | Where | Cost |
| --- | --- | --- |
| Full UI demo with the real economics | `cd app && npm run dev` (offline mirror engine) | $0 |
| Program build + `cargo test` + `anchor test` + IDL | `.github/workflows/devnet.yml` on push | $0 |
| Deploy to **devnet** (faucet SOL) | same workflow, `deploy-devnet` job | $0 |
| Verified-build hash published for explorers | `.github/workflows/verify.yml` | $0 |
| Frontend hosting | Vercel free tier | $0 |
| **Mainnet deploy** | `solana program deploy` | **~3-5 SOL of program rent, one time** |

Mainnet is the only step that cannot be free: an upgradeable program pays
rent-exempt lamports on the whole binary
(`(programdata_size + 128) * 6960`). Trim the binary if you want that number
lower; a `--final` deploy does not change it.

### What each launch costs its creator (on any cluster)

| Account | Bytes | Rent |
| --- | --- | --- |
| Launch state (curve, name/symbol/uri, stats) | ~574 | ~0.005 SOL |
| Mint | 82 | ~0.0015 SOL |
| Curve vault + migration reserve (2 token accounts) | 165 each | ~0.0041 SOL |
| Top-board (10 seats) | 442 | ~0.004 SOL |
| Holder registry (64 slots - the draw pool) | 2087 | ~0.0154 SOL |
| Round | ~516 | ~0.0045 SOL |
| Raise / dividend / draw vaults (3 system PDAs) | 0 | ~0.003 SOL |
| The creator's own token account | 165 | ~0.002 SOL |
| Platform launch fee (`Config.creation_fee_lamports`) | - | 0.02 SOL by default, set it to **0** for free launches |

So a launch is ~0.04 SOL of rent + the platform fee, of which the registry is
the biggest single line. It is 64 seats instead of 256 for exactly that reason:
`MAX_HOLDERS` in `constants.rs` is the knob.

### Running the free pipeline

1. Push this repository to GitHub (public).
2. Actions -> **devnet** -> *Run workflow* -> `deploy: true`.
3. The job prints the program id and uploads `launchpad.json`.
4. Copy that IDL into `app/src/lib/solana/idl.json`, set
   `NEXT_PUBLIC_PROGRAM_ID=<devnet program id>` and you are running against a
   real chain for free.
5. When you have the SOL, run `scripts/deploy-mainnet.md` for the same thing on
   mainnet, then `verify.yml` to publish the source so Solscan, the Solana
   Explorer and SolanaFM all show **verified build**.

