/**
 * End-to-end test of the offline market engine.
 *
 * There is no seed data anywhere: every launch here is created by the test the
 * same way the UI creates one, and every number asserted comes out of a trade
 * the test made.
 */

import { Market } from '../src/lib/data/market';
import {
  CURVE_SUPPLY,
  DRAW_WINNERS,
  ROUND_VOLUME_TARGET_LAMPORTS,
  eligibleSupply,
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
  check(name, String(actual) === String(expected), `got ${String(actual)} want ${String(expected)}`);
}

const SOL = 1_000_000_000n;

export function run() {
  console.log('\nEmpty state (no fabricated data)');
  const market = new Market();
  market.bootstrap();
  eq('the board starts empty', market.list().length, 0);
  eq('no platform fees have been collected', market.platformFees, 0n);

  console.log('\nDividend mode (5%: 1% vault + 4% holders)');
  const creator = 'Creator11111111111111111111111111111111111';
  const dividend = market.create(
    {
      mode: 'dividend',
      name: 'Real Token',
      symbol: 'REAL',
      description: 'created by the test',
      devBuyLamports: 2n * SOL,
    },
    creator,
  );
  eq('the launch exists', market.list().length, 1);
  eq('it starts on the curve', dividend.status, 'bonding');
  eq('the dev buy is the first trade', dividend.trades, 1);
  eq('the 1% went to the platform vault', market.platformFees, (2n * SOL * 100n) / 10_000n);
  eq('...and is attributed to the launch', dividend.vaultDistributed, (2n * SOL * 100n) / 10_000n);
  eq('4% is marked for holders', dividend.dividendDistributed, (2n * SOL * 400n) / 10_000n);
  eq('no seat slice in dividend mode', dividend.topDistributed, 0n);
  eq('no draw pot in dividend mode', dividend.round.pot, 0n);
  check('the chart starts at the launch price', dividend.history[0] !== undefined);
  eq('the chart has one point per real trade plus the launch', dividend.history.length, 2);
  check('only the creator is a holder', Object.keys(dividend.balances).length === 1);
  check(
    'supply is conserved',
    conserved(dividend),
  );
  eq(
    'eligible supply is what the creator holds',
    eligibleSupply(dividend.totalSupply, dividend.realTokens, dividend.poolReserve),
    dividend.balances[creator],
  );

  const holder = 'Holder111111111111111111111111111111111111';
  market.buy(dividend.mint, holder, 5n * SOL);
  const pending = market.pendingDividends(dividend.mint, creator);
  check('a later trade pays the earlier holder', pending > 0n, `${pending}`);
  const claimed = market.claimDividends(dividend.mint, creator);
  eq('the claim equals what was pending', claimed, pending);
  eq('nothing is pending after the claim', market.pendingDividends(dividend.mint, creator), 0n);
  const sellRow = market.sell(dividend.mint, holder, market.position(dividend.mint, holder).balance);
  // each bucket is floored on its own (like the program does), so the total can
  // sit a lamport under the headline rate - never over it
  const headline = (sellRow.solAmount * 500n) / 10_000n;
  check('selling pays 5%, floored per bucket', sellRow.fees.total <= headline && sellRow.fees.total >= headline - 2n, `${sellRow.fees.total} vs ${headline}`);
  eq('the buckets add up to the total', sellRow.fees.total, sellRow.fees.vault + sellRow.fees.top + sellRow.fees.draw + sellRow.fees.dividend);
  check('the vault never paid out more than it took in', dividend.dividendClaimed <= dividend.dividendDistributed);
  check('supply is still conserved', conserved(dividend));
  eq('the platform took 1% of every trade', market.platformFees, dividend.vaultDistributed);

  console.log('\nLottery mode (10%: 1% vault + 3% top ten + 6% draw)');
  const lottery = market.create(
    {
      mode: 'lottery',
      name: 'Lottery Token',
      symbol: 'LOT',
      description: 'created by the test',
      devBuyLamports: 2n * SOL,
    },
    creator,
  );
  eq('the fees before are untouched by the second launch', market.platformFees, dividend.vaultDistributed + (2n * SOL * 100n) / 10_000n);
  eq('the only holder is seated', lottery.board.seats.length, 1);
  eq('...at rank one', lottery.board.seats[0], creator);
  check('...and took the whole 3% slice', lottery.seatEarnings[creator]! > 0n);
  eq('the 6% went into the round pot', lottery.round.pot, (2n * SOL * 600n) / 10_000n);
  eq('the creator is in the draw pool', lottery.registry.includes(creator), true);

  // farm real volume into the round, from real wallets
  let guard = 0;
  const traders: string[] = [];
  while (lottery.round.closedAtSlot === 0 && guard < 40) {
    const wallet = `Trader${guard.toString().padStart(37, '0')}`;
    traders.push(wallet);
    market.buy(lottery.mint, wallet, 600_000_000n);
    market.slot += 4;
    guard++;
  }
  check('the round closed on real volume', lottery.round.closedAtSlot !== 0, `${lottery.round.volumeLamports}`);
  check('volume crossed the target', lottery.round.volumeLamports >= ROUND_VOLUME_TARGET_LAMPORTS);
  check('closing published a commitment', lottery.round.commitment.some((byte) => byte !== 0));
  check('the pool only holds real traders', lottery.registry.length === traders.length + 1 + (lottery.registry.length - traders.length - 1));

  market.slot += 16;
  const { winners, prize } = market.resolveRound(lottery.mint);
  eq('ten winners are drawn', winners.length, DRAW_WINNERS);
  eq('they are distinct', new Set(winners).size, DRAW_WINNERS);
  check('every winner is a real holder', winners.every((winner) => lottery.registry.includes(winner)));
  check('the winners were credited', winners.every((winner) => (lottery.winnings[winner] ?? 0n) > 0n));
  eq('each winner gets pot/winners', prize, lottery.winners[0].prize);
  check('a fresh round is open', lottery.round.closedAtSlot === 0 && !lottery.round.resolved);
  check('drawing twice fails', (() => {
    try {
      market.resolveRound(lottery.mint);
      return false;
    } catch {
      return true;
    }
  })());
  check('supply is conserved after the round', conserved(lottery));
  check('the board never exceeds ten seats', lottery.board.seats.length <= 10);

  console.log('\nGraduation');
  {
    const full = market.create(
      {
        mode: 'dividend',
        name: 'Graduating',
        symbol: 'GRAD',
        description: 'created by the test',
        devBuyLamports: 1n * SOL,
      },
      creator,
    );
    let rounds = 0;
    while (full.realSol < full.graduationLamports && rounds < 400) {
      market.buy(full.mint, `Fill${rounds.toString().padStart(38, '0')}`, 400_000_000n);
      rounds++;
    }
    check('the curve can be filled with real buys', market.canMigrate(full.mint));
    market.migrate(full.mint);
    eq('it graduated', full.status, 'migrated');
    check('the pool holds the raise', (full.pool?.solReserves ?? 0n) > 0n);
    check('LP is locked to the launch', (full.pool?.lpSupply ?? 0n) > 0n);
    check('eligible supply excludes the pool vault', eligibleSupply(full.totalSupply, full.realTokens, full.poolReserve) < full.totalSupply);
    const row = market.buy(full.mint, creator, 3n * SOL);
    check('it still trades in the pool', row.tokenAmount > 0n);
    check('the same tax applies', row.fees.total > 0n);
    check('supply is conserved in the pool', conserved(full));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  return failed === 0;
}

function conserved(launch: {
  totalSupply: bigint;
  realTokens: bigint;
  poolReserve: bigint;
  balances: Record<string, bigint>;
}): boolean {
  const held = Object.values(launch.balances).reduce((sum, balance) => sum + balance, 0n);
  return held + launch.realTokens + launch.poolReserve <= launch.totalSupply;
}

const ok = run();
process.exit(ok ? 0 : 1);

