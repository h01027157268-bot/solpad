/**
 * Tax engine - mirrors `programs/launchpad/src/fees.rs`.
 *
 * Dividend mode  5%  = 1% vault + 4% pro-rata to every holder
 * Lottery mode  10%  = 1% vault + 3% across the ten largest holders
 *                      + 6% across ten random holders
 *
 * The 3% never touches an accumulator: the program pays the seated wallets in
 * the same instruction that fills the order. The 6% accrues into the round pot
 * and is paid out when the round is drawn.
 */

import {
  BPS_DENOMINATOR,
  DIVIDEND_MODE_DIVIDEND_BPS,
  DIVIDEND_MODE_TAX_BPS,
  DRAW_SHARE_BPS,
  DRAW_WINNERS,
  LOTTERY_MODE_TAX_BPS,
  TOP_SEATS,
  TOP_SHARE_BPS,
  VAULT_BPS,
} from './constants';

export type LaunchMode = 'dividend' | 'lottery';

export interface FeeBreakdown {
  totalTax: bigint;
  /** To the platform vault. */
  vault: bigint;
  /** Split evenly across the seated top holders (lottery mode only). */
  top: bigint;
  /** Into the round pot (lottery mode only). */
  draw: bigint;
  /** Into the pro-rata accumulator (dividend mode only). */
  dividend: bigint;
  /** What is left for the curve / the seller. */
  net: bigint;
}

export interface TaxConfig {
  totalBps: number;
  vaultBps: number;
  topBps: number;
  drawBps: number;
  dividendBps: number;
}

export function bpsOf(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / BigInt(BPS_DENOMINATOR);
}

export function splitFees(amount: bigint, cfg: TaxConfig): FeeBreakdown {
  const vault = bpsOf(amount, cfg.vaultBps);
  const top = bpsOf(amount, cfg.topBps);
  const draw = bpsOf(amount, cfg.drawBps);
  const dividend = bpsOf(amount, cfg.dividendBps);
  const tax = vault + top + draw + dividend;
  if (tax > amount) throw new Error('tax configuration overflows the trade');
  return { totalTax: tax, vault, top, draw, dividend, net: amount - tax };
}

export function taxConfigFor(mode: LaunchMode): TaxConfig {
  return mode === 'dividend'
    ? {
        totalBps: DIVIDEND_MODE_TAX_BPS,
        vaultBps: VAULT_BPS,
        topBps: 0,
        drawBps: 0,
        dividendBps: DIVIDEND_MODE_DIVIDEND_BPS,
      }
    : {
        totalBps: LOTTERY_MODE_TAX_BPS,
        vaultBps: VAULT_BPS,
        topBps: TOP_SHARE_BPS,
        drawBps: DRAW_SHARE_BPS,
        dividendBps: 0,
      };
}

/** Human readable summary of a mode's tax split, used across the UI. */
export function describeTaxes(mode: LaunchMode) {
  if (mode === 'dividend') {
    return [
      { label: 'Platform vault', bps: VAULT_BPS, tone: 'muted' as const },
      { label: 'Holder dividends', bps: DIVIDEND_MODE_DIVIDEND_BPS, tone: 'accent' as const },
    ];
  }
  return [
    { label: 'Platform vault', bps: VAULT_BPS, tone: 'muted' as const },
    { label: `Top ${TOP_SEATS} holders, split evenly`, bps: TOP_SHARE_BPS, tone: 'accent' as const },
    { label: `${DRAW_WINNERS} random holders, split evenly`, bps: DRAW_SHARE_BPS, tone: 'accent' as const },
  ];
}

export const MODE_TAX_BPS: Record<LaunchMode, number> = {
  dividend: DIVIDEND_MODE_TAX_BPS,
  lottery: LOTTERY_MODE_TAX_BPS,
};
