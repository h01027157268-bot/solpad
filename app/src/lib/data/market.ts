/**
 * The offline market.
 *
 * A faithful in-memory re-implementation of the on-chain program: the same
 * curve, the same tax engine, the same top-holder board, the same round pot and
 * the same ten-winner draw.
 *
 * It contains **no seed data and no simulated activity**: it starts empty and
 * only ever holds launches that were created in this browser session, plus the
 * trades you actually make. When `NEXT_PUBLIC_PROGRAM_ID` is set the store reads
 * the real chain instead and this file is not used for state.
 */

import {
  CURVE_SUPPLY,
  MAX_HOLDERS,
  POOL_RESERVE,
  REVEAL_DELAY_SLOTS,
  ROUND_VOLUME_TARGET_LAMPORTS,
  TOTAL_SUPPLY,
  VIRTUAL_SOL_RESERVES,
  VIRTUAL_TOKEN_RESERVES,
  accrued as accruedDividend,
  addHolder,
  commitmentFor,
  digest,
  dividendIncrement,
  drawWinners,
  eligibleSupply as eligibleSupplyOf,
  graduationProgressBps,
  marketCapLamports,
  priceE6,
  quoteBuy,
  quoteSell,
  seatRank,
  seatShare,
  settle,
  solOutPool,
  splitFees,
  taxConfigFor,
  upsertSeat,
  type FeeBreakdown,
} from '@/lib/engine';
import type {
  CreateLaunchInput,
  HolderRow,
  LaunchState,
  PositionView,
  RoundState,
  TradeRow,
} from './types';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * A locally generated placeholder mint for launches created in the sandbox.
 * It is deliberately not a valid on-chain address: nothing here touches a
 * cluster, and the UI labels the source as local.
 */
function localMint(seed: string, length = 43): string {
  let h = 2166136261;
  let out = '';
  for (let i = 0; i < length; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h, 16777619);
    out += B58[Math.abs(h) % B58.length];
  }
  return out;
}

function newRound(index: number, slot: number): RoundState {
  return {
    index,
    pot: 0n,
    volumeLamports: 0n,
    trades: 0,
    openedAtSlot: slot,
    closedAtSlot: 0,
    targetSlot: 0,
    commitment: new Uint8Array(32),
    resolved: false,
    winners: [],
    prize: 0n,
  };
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

interface NewLaunch {
  mint: string;
  creator: string;
  mode: 'dividend' | 'lottery';
  name: string;
  symbol: string;
  description: string;
  imageUrl?: string;
  createdAt: number;
}

export class Market {
  launches = new Map<string, LaunchState>();
  /** Every 1% vault slice this sandbox has collected, in lamports. */
  platformFees = 0n;
  /** Local clock, advanced by the lottery panel or by the chain when connected. */
  slot = 240_000_000;

  /** Read-only container: syncChain() writes into it, nothing else does. */
  bootstrap(): void {
    return;
  }

  private newLaunch(input: NewLaunch): LaunchState {
    return {
      mint: input.mint,
      creator: input.creator,
      mode: input.mode,
      status: 'bonding',
      name: input.name,
      symbol: input.symbol,
      uri: input.imageUrl ?? '',
      description: input.description,
      imageUrl: input.imageUrl,
      createdAt: input.createdAt,
      virtualSol: BigInt(VIRTUAL_SOL_RESERVES),
      virtualTokens: BigInt(VIRTUAL_TOKEN_RESERVES),
      realSol: 0n,
      realTokens: BigInt(CURVE_SUPPLY),
      totalSupply: BigInt(TOTAL_SUPPLY),
      poolReserve: BigInt(POOL_RESERVE),
      graduationLamports: 85_000_000_000n,
      marketCapLamports: marketCapLamports(
        BigInt(VIRTUAL_SOL_RESERVES),
        BigInt(VIRTUAL_TOKEN_RESERVES),
      ),
      trades: 0,
      buys: 0,
      sells: 0,
      volumeLamports: 0n,
      positions: 0,
      migratedAt: 0,
      vaultBps: 100,
      topBps: input.mode === 'lottery' ? 300 : 0,
      drawBps: input.mode === 'lottery' ? 600 : 0,
      dividendBps: input.mode === 'dividend' ? 400 : 0,
      dividendAcc: 0n,
      dividendDistributed: 0n,
      dividendClaimed: 0n,
      board: { seats: [], balances: [] },
      registry: [],
      round: newRound(1, this.slot),
      topDistributed: 0n,
      drawDistributed: 0n,
      vaultDistributed: 0n,
      pool: null,
      balances: {},
      dividendPaid: {},
      dividendsClaimed: {},
      seatEarnings: {},
      winnings: {},
      volumeByOwner: {},
      tradeLog: [],
      // the first real data point is the launch itself
      history: [
        {
          t: input.createdAt,
          mcap: Number(
            marketCapLamports(BigInt(VIRTUAL_SOL_RESERVES), BigInt(VIRTUAL_TOKEN_RESERVES)),
          ) / 1e9,
          price: Number(priceE6(BigInt(VIRTUAL_SOL_RESERVES), BigInt(VIRTUAL_TOKEN_RESERVES))) / 1e6 / 1e9,
        },
      ],
      winners: [],
      nameRegistry: {},
    };
  }

  // -- trading ------------------------------------------------------------

  buy(mint: string, owner: string, lamports: bigint, minTokensOut = 0n, ts = now()): TradeRow {
    const launch = this.require(mint);
    if (launch.status !== 'bonding') return this.swap(launch, owner, true, lamports, minTokensOut, ts);
    if (launch.realTokens <= 0n) throw new Error('The curve is sold out - it needs to graduate first.');
    if (lamports < 1_000_000n) throw new Error('Trades below 0.001 SOL are rejected on-chain.');
    const breakdown = splitFees(lamports, taxConfigFor(launch.mode));
    const quote = quoteBuy(
      {
        virtualSol: launch.virtualSol,
        virtualTokens: launch.virtualTokens,
        realSol: launch.realSol,
        realTokens: launch.realTokens,
      },
      lamports,
      breakdown.net,
      launch.totalSupply,
    );
    if (quote.tokensOut <= 0n) throw new Error('Trade too small for the curve.');
    if (quote.tokensOut > launch.realTokens) throw new Error('Not enough tokens left on the curve.');
    if (quote.tokensOut < minTokensOut) throw new Error('Slippage tolerance exceeded.');
    return this.execute(launch, owner, true, lamports, ts, { fees: breakdown });
  }

  sell(mint: string, owner: string, tokensIn: bigint, minSolOut = 0n, ts = now()): TradeRow {
    const launch = this.require(mint);
    const balance = launch.balances[owner] ?? 0n;
    if (balance < tokensIn) throw new Error('Not enough tokens in this wallet.');
    if (launch.status !== 'bonding') return this.swap(launch, owner, false, tokensIn, minSolOut, ts);
    const gross = quoteSell(
      {
        virtualSol: launch.virtualSol,
        virtualTokens: launch.virtualTokens,
        realSol: launch.realSol,
        realTokens: launch.realTokens,
      },
      tokensIn,
      launch.totalSupply,
    ).grossOut;
    if (gross > launch.realSol) throw new Error('The curve does not hold that much SOL.');
    const breakdown = splitFees(gross, taxConfigFor(launch.mode));
    if (breakdown.net < minSolOut) throw new Error('Slippage tolerance exceeded.');
    // hand the exact gross the quote produced to execute, so the fee breakdown
    // and the reported trade size can never disagree by a lamport
    return this.execute(launch, owner, false, tokensIn, ts, { fees: breakdown, volume: gross });
  }

  private swap(
    launch: LaunchState,
    owner: string,
    isBuy: boolean,
    amountIn: bigint,
    minOut: bigint,
    ts: number,
  ): TradeRow {
    if (!launch.pool) throw new Error('Launch has not graduated yet.');
    const volume = isBuy
      ? amountIn
      : solOutPool(launch.pool.solReserves, launch.pool.tokenReserves, amountIn);
    const breakdown = splitFees(volume, taxConfigFor(launch.mode));
    const out = isBuy
      ? (launch.pool.tokenReserves * breakdown.net) / (launch.pool.solReserves + breakdown.net)
      : breakdown.net;
    if (out < minOut) throw new Error('Slippage tolerance exceeded.');

    if (isBuy) {
      launch.pool.solReserves += breakdown.net;
      launch.pool.tokenReserves -= out;
    } else {
      launch.pool.tokenReserves += amountIn;
      launch.pool.solReserves -= volume;
    }
    launch.poolReserve = launch.pool.tokenReserves;
    launch.virtualSol = launch.pool.solReserves;
    launch.virtualTokens = launch.pool.tokenReserves;
    launch.marketCapLamports = marketCapLamports(
      launch.virtualSol,
      launch.virtualTokens,
      launch.totalSupply,
    );
    const previous = launch.balances[owner] ?? 0n;
    if (isBuy) launch.balances[owner] = previous + out;
    else launch.balances[owner] = previous - amountIn;

    launch.trades += 1;
    if (isBuy) launch.buys += 1;
    else launch.sells += 1;
    launch.volumeLamports += volume;
    this.applyTaxes(launch, owner, volume, breakdown, previous);
    return this.logTrade(launch, owner, isBuy, volume, isBuy ? out : amountIn, breakdown, ts);
  }

  private execute(
    launch: LaunchState,
    owner: string,
    isBuy: boolean,
    amountIn: bigint,
    ts: number,
    opts: { fees?: FeeBreakdown; volume?: bigint } = {},
  ): TradeRow {
    const breakdown = opts.fees ?? splitFees(amountIn, taxConfigFor(launch.mode));
    const previous = launch.balances[owner] ?? 0n;
    let tokensOut = 0n;
    let volume = 0n;

    if (isBuy) {
      tokensOut = (launch.virtualTokens * breakdown.net) / (launch.virtualSol + breakdown.net);
      volume = amountIn;
      launch.virtualSol += breakdown.net;
      launch.virtualTokens -= tokensOut;
      launch.realSol += breakdown.net;
      launch.realTokens -= tokensOut;
      if (previous === 0n) launch.positions += 1;
      launch.balances[owner] = previous + tokensOut;
    } else {
      const gross = opts.volume ?? (launch.virtualSol * amountIn) / (launch.virtualTokens + amountIn);
      volume = gross;
      launch.virtualSol -= gross;
      launch.virtualTokens += amountIn;
      launch.realSol -= gross;
      launch.realTokens += amountIn;
      launch.balances[owner] = previous - amountIn;
    }

    launch.trades += 1;
    if (isBuy) launch.buys += 1;
    else launch.sells += 1;
    launch.volumeLamports += volume;
    launch.marketCapLamports = marketCapLamports(
      launch.virtualSol,
      launch.virtualTokens,
      launch.totalSupply,
    );
    this.applyTaxes(launch, owner, volume, breakdown, previous);
    return this.logTrade(launch, owner, isBuy, volume, isBuy ? tokensOut : amountIn, breakdown, ts);
  }

  /** The three buckets: the 1% vault, the 3% seat slice, the 6% round pot. */
  private applyTaxes(
    launch: LaunchState,
    owner: string,
    volume: bigint,
    breakdown: FeeBreakdown,
    previousBalance: bigint,
  ): void {
    const supplyBefore = eligibleSupplyOf(launch.totalSupply, launch.realTokens, launch.poolReserve);

    this.platformFees += breakdown.vault;
    launch.vaultDistributed += breakdown.vault;

    if (breakdown.dividend > 0n && supplyBefore > 0n) {
      launch.dividendAcc += dividendIncrement(breakdown.dividend, supplyBefore);
      launch.dividendDistributed += breakdown.dividend;
    }

    if (launch.mode === 'lottery') {
      const balance = launch.balances[owner] ?? 0n;
      const isNew = !launch.registry.includes(owner);
      launch.board = upsertSeat(launch.board, owner, balance);
      launch.registry = isNew ? addHolder(launch.registry, owner) : launch.registry;

      if (breakdown.top > 0n) {
        const seats = launch.board.seats.length;
        if (seats === 0) {
          launch.topDistributed += breakdown.top;
        } else {
          const share = seatShare(breakdown.top, seats);
          for (const seat of launch.board.seats) {
            launch.seatEarnings[seat] = (launch.seatEarnings[seat] ?? 0n) + share;
          }
          launch.topDistributed += share * BigInt(seats);
        }
      }

      const round = launch.round;
      if (round.closedAtSlot === 0) {
        round.pot += breakdown.draw;
        round.volumeLamports += volume;
        round.trades += 1;
        if (round.volumeLamports >= ROUND_VOLUME_TARGET_LAMPORTS) this.closeRound(launch);
      } else {
        round.pot += breakdown.draw;
      }
      launch.drawDistributed += breakdown.draw;
    }

    // `settle` needs the balance the position was checkpointed at *before* this
    // trade, which the caller captured for us.
    const next = settle(
      { trackedBalance: previousBalance, dividendPaid: launch.dividendPaid[owner] ?? 0n },
      launch.balances[owner] ?? 0n,
      launch.dividendAcc,
    );
    launch.dividendPaid[owner] = next.dividendPaid;
    launch.volumeByOwner[owner] = (launch.volumeByOwner[owner] ?? 0n) + volume;
  }

  private logTrade(
    launch: LaunchState,
    owner: string,
    isBuy: boolean,
    volume: bigint,
    tokens: bigint,
    breakdown: FeeBreakdown,
    ts: number,
  ): TradeRow {
    const row: TradeRow = {
      id: `${launch.mint}-${launch.tradeLog.length + 1}`,
      ts,
      owner,
      isBuy,
      solAmount: volume,
      tokenAmount: tokens,
      priceE6: priceE6(launch.virtualSol, launch.virtualTokens),
      marketCapLamports: launch.marketCapLamports,
      fees: {
        vault: breakdown.vault,
        top: breakdown.top,
        draw: breakdown.draw,
        dividend: breakdown.dividend,
        total: breakdown.totalTax,
      },
      slot: this.slot,
      round: launch.round.index,
    };
    launch.tradeLog.push(row);
    launch.tradeLog = launch.tradeLog.slice(-160);
    launch.history.push({
      t: ts,
      mcap: Number(launch.marketCapLamports) / 1e9,
      price: Number(priceE6(launch.virtualSol, launch.virtualTokens)) / 1e6 / 1e9,
    });
    launch.history = launch.history.slice(-400);
    return row;
  }

  // -- the round ----------------------------------------------------------

  closeRound(launch: LaunchState): void {
    const round = launch.round;
    if (round.closedAtSlot !== 0) return;
    round.closedAtSlot = this.slot;
    round.targetSlot = this.slot + REVEAL_DELAY_SLOTS;
    round.commitment = commitmentFor(`${launch.mint}:${launch.creator}`, round.index, round.targetSlot);
  }

  closeRoundEarly(mint: string): void {
    const launch = this.require(mint);
    if (launch.round.closedAtSlot !== 0) throw new Error('This round is already closed.');
    if (launch.round.volumeLamports === 0n) throw new Error('Nothing has traded into this round yet.');
    this.closeRound(launch);
  }

  resolveRound(mint: string): { winners: string[]; prize: bigint } {
    const launch = this.require(mint);
    const round = launch.round;
    if (round.closedAtSlot === 0) throw new Error('Close the round before drawing it.');
    if (round.resolved) throw new Error('This round has already been drawn.');
    if (this.slot < round.targetSlot) throw new Error('The entropy slot has not passed yet.');
    if (launch.registry.length === 0) throw new Error('Nobody is in the draw pool yet.');

    const entropy = digest(round.commitment, this.slot);
    const winners = drawWinners(launch.registry, round.commitment, entropy);
    const prize = winners.length > 0 ? round.pot / BigInt(winners.length) : 0n;
    for (const winner of winners) {
      launch.winnings[winner] = (launch.winnings[winner] ?? 0n) + prize;
    }
    round.winners = winners;
    round.prize = prize;
    round.resolved = true;
    launch.winners.unshift({ round: round.index, winners, prize, ts: now() });
    launch.winners = launch.winners.slice(0, 12);
    launch.round = newRound(round.index + 1, this.slot);
    return { winners, prize };
  }

  // -- dividends ----------------------------------------------------------

  pendingDividends(mint: string, owner: string): bigint {
    const launch = this.require(mint);
    return accruedDividend(
      {
        trackedBalance: launch.balances[owner] ?? 0n,
        dividendPaid: launch.dividendPaid[owner] ?? 0n,
      },
      launch.dividendAcc,
    );
  }

  claimDividends(mint: string, owner: string): bigint {
    const launch = this.require(mint);
    const pending = this.pendingDividends(mint, owner);
    if (pending <= 0n) throw new Error('Nothing to claim yet.');
    launch.dividendPaid[owner] = (launch.dividendPaid[owner] ?? 0n) + pending;
    launch.dividendsClaimed[owner] = (launch.dividendsClaimed[owner] ?? 0n) + pending;
    launch.dividendClaimed += pending;
    return pending;
  }

  // -- graduation ---------------------------------------------------------

  canMigrate(mint: string): boolean {
    const launch = this.require(mint);
    return (
      launch.status === 'bonding' &&
      (launch.realSol >= launch.graduationLamports || launch.realTokens <= 0n)
    );
  }

  migrate(mint: string): void {
    const launch = this.require(mint);
    if (!this.canMigrate(mint)) throw new Error('The curve has not sold out yet.');
    const sol = launch.realSol + 1_000_000n;
    const tokens = launch.realTokens + launch.poolReserve;
    launch.pool = { solReserves: sol, tokenReserves: tokens, lpSupply: isqrt(sol * tokens) };
    launch.status = 'migrated';
    launch.migratedAt = now();
    launch.poolReserve = tokens;
    launch.realSol = 0n;
    launch.realTokens = 0n;
    launch.virtualSol = sol;
    launch.virtualTokens = tokens;
    launch.marketCapLamports = marketCapLamports(sol, tokens, launch.totalSupply);
  }

  // -- creation -----------------------------------------------------------

  create(input: CreateLaunchInput, creator: string, ts = now()): LaunchState {
    const mint = localMint(`${creator}:${input.symbol}:${ts}`);
    const launch = this.newLaunch({
      mint,
      creator,
      mode: input.mode,
      name: input.name,
      symbol: input.symbol,
      description: input.description,
      imageUrl: input.imageUrl,
      createdAt: ts,
    });
    this.launches.set(mint, launch);
    if (input.devBuyLamports > 0n) this.execute(launch, creator, true, input.devBuyLamports, ts + 1);
    return launch;
  }

  // -- views --------------------------------------------------------------

  list(): LaunchState[] {
    return [...this.launches.values()].sort(
      (a, b) => Number(b.marketCapLamports - a.marketCapLamports),
    );
  }

  get(mint: string): LaunchState | undefined {
    return this.launches.get(mint);
  }

  require(mint: string): LaunchState {
    const launch = this.launches.get(mint);
    if (!launch) throw new Error(`Unknown launch ${mint}`);
    return launch;
  }

  position(mint: string, owner: string): PositionView {
    const launch = this.require(mint);
    const balance = launch.balances[owner] ?? 0n;
    const circulating = eligibleSupplyOf(launch.totalSupply, launch.realTokens, launch.poolReserve);
    return {
      owner,
      balance,
      pendingDividends: this.pendingDividends(mint, owner),
      dividendsClaimed: launch.dividendsClaimed[owner] ?? 0n,
      volumeLamports: launch.volumeByOwner[owner] ?? 0n,
      seatRank: launch.mode === 'lottery' ? seatRank(launch.board, owner) : null,
      seatEarnings: launch.seatEarnings[owner] ?? 0n,
      winnings: launch.winnings[owner] ?? 0n,
      shareBps: circulating > 0n ? Number((balance * 10_000n) / circulating) : 0,
    };
  }

  holders(mint: string, limit = 25): HolderRow[] {
    const launch = this.require(mint);
    const circulating = eligibleSupplyOf(launch.totalSupply, launch.realTokens, launch.poolReserve);
    return Object.entries(launch.balances)
      .filter(([, balance]) => balance > 0n)
      .sort((a, b) => Number(b[1] - a[1]))
      .slice(0, limit)
      .map(([owner, balance]) => ({
        owner,
        label: launch.nameRegistry[owner] ?? shortId(owner),
        balance,
        shareBps: circulating > 0n ? Number((balance * 10_000n) / circulating) : 0,
        valueLamports: (balance * launch.virtualSol) / (launch.virtualTokens || 1n),
        seated: launch.board.seats.includes(owner),
      }));
  }

  stats(mint: string) {
    const launch = this.require(mint);
    const eligible = eligibleSupplyOf(launch.totalSupply, launch.realTokens, launch.poolReserve);
    return {
      eligible,
      progressBps: graduationProgressBps(launch.realSol, launch.graduationLamports),
      priceE6: priceE6(launch.virtualSol, launch.virtualTokens),
      marketCapSol: Number(launch.marketCapLamports) / 1e9,
      holders: Object.values(launch.balances).filter((b) => b > 0n).length,
      raisedSol: Number(launch.realSol) / 1e9,
      seats: launch.board.seats.length,
      poolSize: launch.registry.length,
      pot: launch.round.pot,
      topDistributed: launch.topDistributed,
      drawDistributed: launch.drawDistributed,
      vaultDistributed: launch.vaultDistributed,
      maxHolders: MAX_HOLDERS,
    };
  }
}


function shortId(value: string): string {
  return `${value.slice(0, 4)}${value.slice(-4)}`;
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}



