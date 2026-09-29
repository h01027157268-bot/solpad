/**
 * Economics tests for the launchpad maths.
 *
 *   npm test
 *
 * These mirror the Rust unit tests in
 * programs/launchpad/src/{curve,fees,dividends,board,round}.rs, so the numbers
 * the UI quotes and the numbers the program computes cannot drift apart.
 */

import {
  ACC_PRECISION,
  CURVE_SUPPLY,
  DIVIDEND_MODE_DIVIDEND_BPS,
  DIVIDEND_MODE_TAX_BPS,
  DRAW_SHARE_BPS,
  DRAW_WINNERS,
  GRADUATION_LAMPORTS,
  LOTTERY_MODE_TAX_BPS,
  POOL_RESERVE,
  TOP_SEATS,
  TOP_SHARE_BPS,
  TOTAL_SUPPLY,
  VAULT_BPS,
  VIRTUAL_SOL_RESERVES,
  VIRTUAL_TOKEN_RESERVES,
  accrued,
  addHolder,
  curveRaiseLamports,
  digest,
  digestToTicket,
  dividendIncrement,
  drawWinners,
  eligibleSupply,
  marketCapLamports,
  seatShare,
  settle,
  solOutCurve,
  splitFees,
  taxConfigFor,
  tokensOutCurve,
  upsertSeat,
  type TaxConfig,
} from '../src/lib/engine';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(name, actual === expected, `got ${String(actual)} want ${String(expected)}`);
}

export function run() {
  console.log('\nCurve (pump.fun parameters, unchanged)');
  const raise = curveRaiseLamports();
  check(`selling the curve out raises ~85 SOL (${Number(raise) / 1e9})`, raise >= 84_000_000_000n && raise <= 86_000_000_000n);
  check('the raise clears the graduation target', raise >= BigInt(GRADUATION_LAMPORTS));
  const mcap = marketCapLamports(BigInt(VIRTUAL_SOL_RESERVES), BigInt(VIRTUAL_TOKEN_RESERVES));
  check(`opening market cap is ~27.96 SOL (${Number(mcap) / 1e9})`, mcap > 27_000_000_000n && mcap < 28_500_000_000n);
  const finalMcap = marketCapLamports(
    BigInt(VIRTUAL_SOL_RESERVES) + raise,
    BigInt(VIRTUAL_TOKEN_RESERVES) - BigInt(CURVE_SUPPLY),
  );
  check(`graduation market cap is ~411 SOL (${(Number(finalMcap) / 1e9).toFixed(1)})`, Number(finalMcap) / 1e9 > 400 && Number(finalMcap) / 1e9 < 420);
  const poolPrice = (raise * 10n ** 18n) / BigInt(POOL_RESERVE);
  const curvePrice = ((BigInt(VIRTUAL_SOL_RESERVES) + raise) * 10n ** 18n) / (BigInt(VIRTUAL_TOKEN_RESERVES) - BigInt(CURVE_SUPPLY));
  check('migration lands within 1bp of the curve', Math.abs(Number(((poolPrice - curvePrice) * 10_000n) / curvePrice)) < 1);
  const tokens = tokensOutCurve(BigInt(VIRTUAL_SOL_RESERVES), BigInt(VIRTUAL_TOKEN_RESERVES), 1_000_000_000n);
  check('a round trip is always lossy', solOutCurve(BigInt(VIRTUAL_SOL_RESERVES) + 1_000_000_000n, BigInt(VIRTUAL_TOKEN_RESERVES) - tokens, tokens) < 1_000_000_000n);

  console.log('\nTaxes');
  const dividendCfg = taxConfigFor('dividend');
  const dividend = splitFees(1_000_000_000n, dividendCfg);
  eq('dividend mode takes 5%', dividend.totalTax, 50_000_000n);
  eq('...1% to the vault', dividend.vault, 10_000_000n);
  eq('...4% to holders', dividend.dividend, 40_000_000n);
  eq('...nothing to the seats or the pot', dividend.top + dividend.draw, 0n);
  eq('dividend mode bps', DIVIDEND_MODE_TAX_BPS, 500);
  eq('dividend holder bps', DIVIDEND_MODE_DIVIDEND_BPS, 400);

  const lotteryCfg = taxConfigFor('lottery');
  const lottery = splitFees(1_000_000_000n, lotteryCfg);
  eq('lottery mode takes 10%', lottery.totalTax, 100_000_000n);
  eq('...1% to the vault', lottery.vault, 10_000_000n);
  eq('...3% across the ten largest holders', lottery.top, 30_000_000n);
  eq('...6% into the round pot', lottery.draw, 60_000_000n);
  eq('...no pro-rata slice in lottery mode', lottery.dividend, 0n);
  eq('lottery mode bps', LOTTERY_MODE_TAX_BPS, 1_000);
  eq('top share bps', TOP_SHARE_BPS, 300);
  eq('draw share bps', DRAW_SHARE_BPS, 600);
  eq('vault bps', VAULT_BPS, 100);

  let overcharged = 0;
  let unbalanced = 0;
  for (const cfg of [dividendCfg, lotteryCfg] as TaxConfig[]) {
    for (let amount = 0; amount < 20_000; amount++) {
      const f = splitFees(BigInt(amount), cfg);
      if (f.totalTax > BigInt(amount)) overcharged++;
      if (f.vault + f.top + f.draw + f.dividend + f.net !== BigInt(amount)) unbalanced++;
    }
  }
  eq('no amount is ever over charged', overcharged, 0);
  eq('every split adds back up to the trade', unbalanced, 0);

  console.log('\nPayouts');
  let seatLeak = 0;
  for (let seats = 1; seats <= TOP_SEATS; seats++) {
    for (const amount of [0n, 1n, 9n, 30_000_000n, 30_000_001n, 999_999_999n]) {
      const share = seatShare(amount, seats);
      if (share * BigInt(seats) > amount) seatLeak++;
    }
  }
  eq('the 3% slice is never over paid', seatLeak, 0);
  eq('the seats split their slice evenly', seatShare(30_000_000n, 10), 3_000_000n);
  eq('...and a short board splits the same slice', seatShare(30_000_000n, 3), 10_000_000n);
  eq('a full board of winners splits the pot', 60_000_000n / BigInt(DRAW_WINNERS), 6_000_000n);

  console.log('\nDividend accumulator');
  eq('nothing is eligible before the first buy', eligibleSupply(BigInt(TOTAL_SUPPLY), BigInt(CURVE_SUPPLY), BigInt(POOL_RESERVE)), 0n);
  const acc1 = dividendIncrement(1_000_000_000n, 1_000_000n);
  const whale = { trackedBalance: 750_000n, dividendPaid: 0n };
  const shrimp = { trackedBalance: 250_000n, dividendPaid: 0n };
  eq('a 75% holder gets 75%', accrued(whale, acc1), 750_000_000n);
  eq('a 25% holder gets 25%', accrued(shrimp, acc1), 250_000_000n);
  eq('claims never exceed what was paid in', accrued(whale, acc1) + accrued(shrimp, acc1), 1_000_000_000n);
  const fresh = settle({ trackedBalance: 0n, dividendPaid: 0n }, 1_000n, 5n * ACC_PRECISION);
  eq('a transferred-in balance has no history', accrued(fresh, 5n * ACC_PRECISION), 0n);
  eq('...but earns from the moment it is seen', accrued(fresh, 7n * ACC_PRECISION), 2_000n);
  const holder = { trackedBalance: 1_000n, dividendPaid: 0n };
  const acc = 10n * ACC_PRECISION;
  const pending = accrued(holder, acc);
  const sold = settle(holder, 400n, acc);
  eq('selling keeps what was accrued', accrued(sold, acc), pending);
  eq('...and keeps earning on what is left', accrued(sold, acc + ACC_PRECISION), pending + 400n);
  const emptied = settle(holder, 0n, acc);
  eq('selling everything still owes the accrued amount', accrued(emptied, acc), 10_000n);

  let paidIn = 0n;
  let claimed = 0n;
  let accumulator = 0n;
  const positions = [1_000n, 2_000n, 7_000n].map((balance) => ({ trackedBalance: balance, dividendPaid: 0n }));
  let rng = 123456789;
  for (let i = 0; i < 500; i++) {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    const amount = BigInt(1 + (rng % 5_000_000));
    const live = positions.reduce((sum, p) => sum + p.trackedBalance, 0n);
    accumulator += dividendIncrement(amount, live);
    paidIn += amount;
    const seat = i % positions.length;
    const payout = accrued(positions[seat], accumulator);
    claimed += payout;
    positions[seat] = { ...positions[seat], dividendPaid: positions[seat].dividendPaid + payout };
  }
  check(`the vault stays solvent over 500 distributions (${claimed} of ${paidIn})`, claimed <= paidIn);
  check('...with at most the latest slice unclaimed', paidIn - claimed < 6_000_000n, `${paidIn - claimed}`);

  console.log('\nTop board');
  let board = { seats: [] as string[], balances: [] as bigint[] };
  for (let i = 1; i <= 12; i++) board = upsertSeat(board, `w${i}`, BigInt(i * 100));
  eq('the board holds ten seats', board.seats.length, TOP_SEATS);
  eq('the largest is first', board.seats[0], 'w12');
  eq('the smallest seat is the tenth largest', board.balances[9], 300n);
  check('a wallet that fell out is not seated', !board.seats.includes('w1'));
  board = upsertSeat(board, 'w1', 9_999n);
  eq('a wallet that grows past the smallest seat is admitted', board.seats[0], 'w1');
  board = upsertSeat(board, 'w1', 0n);
  check('selling out leaves the board', !board.seats.includes('w1'));
  eq('the board shrinks', board.seats.length, TOP_SEATS - 1);
  let sorted = true;
  for (let i = 1; i < board.balances.length; i++) if (board.balances[i] > board.balances[i - 1]) sorted = false;
  check('the board stays sorted', sorted);
  check('no stale balances', board.seats.every((seat, i) => upsertSeat(board, seat, board.balances[i]).balances.includes(board.balances[i])));

  console.log('\nDraw');
  let registry: string[] = [];
  for (let i = 1; i <= 40; i++) registry = addHolder(registry, `h${i}`);
  registry = addHolder(registry, 'h1');
  eq('the registry appends once per wallet', registry.length, 40);
  const commitment = digest('round', 1, 1000);
  const entropy = digest('slot', 1008);
  const winners = drawWinners(registry, commitment, entropy);
  eq('ten winners are drawn', winners.length, DRAW_WINNERS);
  eq('they are distinct', new Set(winners).size, DRAW_WINNERS);
  eq('the draw is deterministic', drawWinners(registry, commitment, entropy).join(), winners.join());
  check('different entropy draws a different set', drawWinners(registry, commitment, digest('slot', 1009)).join() !== winners.join());
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 2_000; i++) buckets[digestToTicket(digest('e', i), 10)]++;
  check(`the ticket is uniform (${buckets.join('/')})`, buckets.every((b) => b > 120 && b < 280));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  return failed === 0;
}

const ok = run();
process.exit(ok ? 0 : 1);
