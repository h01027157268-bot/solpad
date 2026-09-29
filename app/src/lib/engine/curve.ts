/**
 * Bonding curve and pool math.
 *
 * Mirrors `programs/launchpad/src/curve.rs` exactly, in bigint so the numbers
 * are identical to what the program will compute on-chain.
 */

import {
  CURVE_SUPPLY,
  GRADUATION_LAMPORTS,
  TOTAL_SUPPLY,
  VIRTUAL_SOL_RESERVES,
  VIRTUAL_TOKEN_RESERVES,
} from './constants';

/** `out = v_tokens * sol_in / (v_sol + sol_in)` */
export function tokensOutCurve(virtualSol: bigint, virtualTokens: bigint, solIn: bigint): bigint {
  if (solIn <= 0n) return 0n;
  return (virtualTokens * solIn) / (virtualSol + solIn);
}

/** `out = v_sol * tokens_in / (v_tokens + tokens_in)` */
export function solOutCurve(virtualSol: bigint, virtualTokens: bigint, tokensIn: bigint): bigint {
  if (tokensIn <= 0n) return 0n;
  return (virtualSol * tokensIn) / (virtualTokens + tokensIn);
}

export const tokensOutPool = tokensOutCurve;
export const solOutPool = solOutCurve;

/** Market cap in lamports = price x total supply. */
export function marketCapLamports(
  virtualSol: bigint,
  virtualTokens: bigint,
  totalSupply = BigInt(TOTAL_SUPPLY),
): bigint {
  if (virtualTokens === 0n) return 0n;
  const price = (virtualSol * 10n ** 18n) / virtualTokens;
  return (price * totalSupply) / 10n ** 18n;
}

/** Lamports per whole token, 1e6 scaled (the program stores this shape too). */
export function priceE6(virtualSol: bigint, virtualTokens: bigint): bigint {
  if (virtualTokens === 0n) return 0n;
  return (virtualSol * 1_000_000n * 1_000_000n) / virtualTokens;
}

/** Lamports raised when the curve sells out - ~85 SOL for the pump.fun curve. */
export function curveRaiseLamports(): bigint {
  const remaining = BigInt(VIRTUAL_TOKEN_RESERVES) - BigInt(CURVE_SUPPLY);
  return (BigInt(VIRTUAL_SOL_RESERVES) * BigInt(CURVE_SUPPLY)) / remaining;
}

export interface CurveState {
  virtualSol: bigint;
  virtualTokens: bigint;
  realSol: bigint;
  realTokens: bigint;
}

export interface CurveQuote {
  /** Tokens the buyer receives. */
  tokensOut: bigint;
  /** SOL that actually reaches the curve (after tax). */
  netIn: bigint;
  /** Price before / after, lamports per whole token (1e6 scaled). */
  priceBefore: bigint;
  priceAfter: bigint;
  /** Price impact in basis points. */
  priceImpactBps: number;
  marketCapBefore: bigint;
  marketCapAfter: bigint;
}

export interface SellQuote {
  /** Lamports the curve pays out before tax. */
  grossOut: bigint;
  priceBefore: bigint;
  priceAfter: bigint;
  priceImpactBps: number;
  marketCapBefore: bigint;
  marketCapAfter: bigint;
}

export function quoteBuy(
  state: CurveState,
  amountIn: bigint,
  netIn: bigint,
  totalSupply = BigInt(TOTAL_SUPPLY),
): CurveQuote {
  const tokensOut = tokensOutCurve(state.virtualSol, state.virtualTokens, netIn);
  const priceBefore = priceE6(state.virtualSol, state.virtualTokens);
  const priceAfter = priceE6(state.virtualSol + netIn, state.virtualTokens - tokensOut);
  return {
    tokensOut,
    netIn,
    priceBefore,
    priceAfter,
    priceImpactBps: impactBps(priceBefore, priceAfter),
    marketCapBefore: marketCapLamports(state.virtualSol, state.virtualTokens, totalSupply),
    marketCapAfter: marketCapLamports(
      state.virtualSol + netIn,
      state.virtualTokens - tokensOut,
      totalSupply,
    ),
  };
}

export function quoteSell(
  state: CurveState,
  tokensIn: bigint,
  totalSupply = BigInt(TOTAL_SUPPLY),
): SellQuote {
  const grossOut = solOutCurve(state.virtualSol, state.virtualTokens, tokensIn);
  const priceBefore = priceE6(state.virtualSol, state.virtualTokens);
  const priceAfter = priceE6(state.virtualSol - grossOut, state.virtualTokens + tokensIn);
  return {
    grossOut,
    priceBefore,
    priceAfter,
    priceImpactBps: impactBps(priceBefore, priceAfter),
    marketCapBefore: marketCapLamports(state.virtualSol, state.virtualTokens, totalSupply),
    marketCapAfter: marketCapLamports(
      state.virtualSol - grossOut,
      state.virtualTokens + tokensIn,
      totalSupply,
    ),
  };
}

function impactBps(before: bigint, after: bigint): number {
  if (before === 0n) return 0;
  const diff = after > before ? after - before : before - after;
  return Number((diff * 10_000n) / before);
}

/** Progress towards graduation, in basis points of the raise. */
export function graduationProgressBps(realSol: bigint, target = BigInt(GRADUATION_LAMPORTS)): number {
  if (target === 0n) return 0;
  const bps = (realSol * 10_000n) / target;
  return Number(bps > 10_000n ? 10_000n : bps);
}

/** Uniswap-v2 style LP shares for a deposit. */
export function lpTokensForDeposit(
  solDeposited: bigint,
  tokenDeposited: bigint,
  solReserves: bigint,
  tokenReserves: bigint,
  lpSupply: bigint,
): bigint {
  if (lpSupply === 0n || solReserves === 0n || tokenReserves === 0n) {
    return isqrt(solDeposited * tokenDeposited);
  }
  const a = (solDeposited * lpSupply) / solReserves;
  const b = (tokenDeposited * lpSupply) / tokenReserves;
  return a < b ? a : b;
}

export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('isqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
