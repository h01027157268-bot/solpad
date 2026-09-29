/**
 * Holder dividend accumulator - mirrors `programs/launchpad/src/dividends.rs`.
 *
 * `acc` is a lamports-per-token accumulator scaled by 1e18:
 *
 *     acc += dividend_lamports * 1e18 / eligible_supply
 *     pending = tracked_balance * acc / 1e18 - dividend_paid
 *
 * `settle` moves a position to a new balance without losing what it accrued,
 * and - crucially - without back-dating tokens that showed up through a plain
 * SPL transfer: those are checkpointed at today's accumulator and only start
 * earning from the moment they are first seen.
 */

import { ACC_PRECISION } from './constants';

export interface DividendPosition {
  trackedBalance: bigint;
  dividendPaid: bigint;
}

export function checkpoint(balance: bigint, accumulator: bigint): bigint {
  return (balance * accumulator) / ACC_PRECISION;
}

export function accrued(position: DividendPosition, accumulator: bigint): bigint {
  const entitlement = checkpoint(position.trackedBalance, accumulator);
  const pending = entitlement - position.dividendPaid;
  return pending > 0n ? pending : 0n;
}

export function settle(
  position: DividendPosition,
  newBalance: bigint,
  accumulator: bigint,
): DividendPosition {
  const pending = accrued(position, accumulator);
  return {
    trackedBalance: newBalance,
    // Signed on purpose: it goes negative when a holder has accrued more than
    // their remaining balance can express (selling the whole bag). Keeping it
    // signed is what keeps the vault exactly solvent.
    dividendPaid: checkpoint(newBalance, accumulator) - pending,
  };
}

/**
 * Pay out everything accrued so far: returns the amount and the updated
 * position. Mirrors `mark_paid` in the program.
 */
export function markPaid(
  position: DividendPosition,
  accumulator: bigint,
): { position: DividendPosition; amount: bigint } {
  const amount = accrued(position, accumulator);
  return {
    amount,
    position: { ...position, dividendPaid: position.dividendPaid + amount },
  };
}

/** Supply that can claim: everything not locked in a program vault. */
export function eligibleSupply(
  totalSupply: bigint,
  realTokenReserves: bigint,
  poolReserve: bigint,
): bigint {
  const a = totalSupply - realTokenReserves;
  const b = a - poolReserve;
  return b > 0n ? b : 0n;
}

/** Accumulator increment for distributing `lamports` over `supply`. */
export function dividendIncrement(lamports: bigint, supply: bigint): bigint {
  if (supply <= 0n) return 0n;
  return (lamports * ACC_PRECISION) / supply;
}

/** Annualised yield of the dividend stream, in basis points of market cap. */
export function dividendApyBps(
  dividendLamportsPerDay: bigint,
  marketCapLamports: bigint,
): number {
  if (marketCapLamports === 0n) return 0;
  return Number((dividendLamportsPerDay * 365n * 10_000n) / marketCapLamports);
}



