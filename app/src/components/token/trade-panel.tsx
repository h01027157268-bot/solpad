'use client';

import { FieldLabel, Pill } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { useStore } from '@/lib/data/store';
import type { LaunchState } from '@/lib/data/types';
import {
  DEFAULT_SLIPPAGE_BPS,
  quoteBuy,
  quoteSell,
  splitFees,
  taxConfigFor,
  type FeeBreakdown,
} from '@/lib/engine';
import { fmtSol, fmtTokens } from '@/lib/format';
import { ONE_TOKEN } from '@/lib/engine/constants';
import { useEffect, useMemo, useState } from 'react';

const SLIPPAGE = [50, 100, 300, 500];

export function TradePanel({ launch }: { launch: LaunchState }) {
  const session = useStore((s) => s.session);
  const program = useStore((s) => s.program);
  const buy = useStore((s) => s.buy);
  const sell = useStore((s) => s.sell);

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);

  const balance = session ? launch.balances[session.address] ?? 0n : 0n;
  const migrated = launch.status === 'migrated';

  useEffect(() => {
    setAmount('');
  }, [side, launch.mint]);

  const parsed = useMemo(() => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return 0n;
    return side === 'buy' ? BigInt(Math.floor(value * 1e9)) : BigInt(Math.floor(value * 1e6));
  }, [amount, side]);

  const preview = useMemo(() => {
    if (parsed <= 0n) return null;
    const state = {
      virtualSol: launch.virtualSol,
      virtualTokens: launch.virtualTokens,
      realSol: launch.realSol,
      realTokens: launch.realTokens,
    };
    if (side === 'buy') {
      const cfg = taxConfigFor(launch.mode);
      const fees = splitFees(parsed, cfg);
      const quote = quoteBuy(state, parsed, fees.net, launch.totalSupply);
      const pricePerToken =
        quote.tokensOut > 0n ? (parsed * BigInt(ONE_TOKEN)) / quote.tokensOut : 0n;
      return {
        fees,
        out: quote.tokensOut,
        minOut: (quote.tokensOut * BigInt(10_000 - slippageBps)) / 10_000n,
        pricePerToken,
        impactBps: quote.priceImpactBps,
        mcapAfter: quote.marketCapAfter,
      };
    }
    const quote = quoteSell(state, parsed, launch.totalSupply);
    const cfg = taxConfigFor(launch.mode);
    const fees = splitFees(quote.grossOut, cfg);
    const pricePerToken = parsed > 0n ? (quote.grossOut * BigInt(ONE_TOKEN)) / parsed : 0n;
    return {
      fees,
      out: fees.net,
      minOut: (fees.net * BigInt(10_000 - slippageBps)) / 10_000n,
      pricePerToken,
      impactBps: quote.priceImpactBps,
      mcapAfter: quote.marketCapAfter,
    };
  }, [parsed, side, launch, slippageBps]);

  const insufficient = side === 'sell' && parsed > balance;
  const disabled =
    !session || parsed <= 0n || insufficient || (side === 'buy' && launch.realTokens <= 0n);

  return (
    <div className="card p-5">
      <div className="flex items-center gap-1">
        {(['buy', 'sell'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setSide(item)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-[11px] font-light uppercase tracking-widest transition-colors',
              side === item
                ? item === 'buy'
                  ? 'bg-white text-black'
                  : 'bg-[#ffa2ae] text-black'
                : 'border border-white/[0.07] text-slate-500 hover:text-slate-200',
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <FieldLabel hint={migrated ? 'locked pool' : 'bonding curve'}>
          {side === 'buy' ? 'You pay' : 'You sell'}
        </FieldLabel>
        <div className="flex items-center rounded-lg border border-slate-800 bg-black focus-within:border-white/40">
          <input
            className="w-full bg-transparent px-3 py-2.5 text-sm font-extralight text-white placeholder-slate-700 focus:outline-none"
            value={amount}
            inputMode="decimal"
            placeholder="0.0"
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
          />
          <span className="pr-3 text-[11px] font-light uppercase tracking-widest text-slate-500">
            {side === 'buy' ? 'SOL' : launch.symbol}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {side === 'buy'
            ? ['0.1', '0.5', '1', '5'].map((preset) => (
                <Pill key={preset} onClick={() => setAmount(preset)}>
                  {preset} sol
                </Pill>
              ))
            : [25, 50, 75, 100].map((pct) => (
                <Pill
                  key={pct}
                  onClick={() =>
                    setAmount(((Number(balance) / 1e6) * (pct / 100)).toFixed(6))
                  }
                >
                  {pct}%
                </Pill>
              ))}
        </div>
      </div>

      <div className="mt-4 space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <Row
          label={side === 'buy' ? 'You receive' : 'You receive'}
          value={
            preview
              ? side === 'buy'
                ? `${fmtTokens(preview.out, 2)} ${launch.symbol}`
                : `${fmtSol(preview.out, 4)} SOL`
              : ''
          }
          strong
        />
        <Row
          label="Average price"
          value={preview ? `${fmtSol(preview.pricePerToken, 6)} SOL` : ''}
        />
        <Row
          label="Price impact"
          value={preview ? `${(preview.impactBps / 100).toFixed(2)}%` : ''}
        />
        {preview ? <FeeRows fees={preview.fees} amount={parsed} mode={launch.mode} /> : null}
        <Row label="Min received" value={preview ? fmtTokens(preview.minOut, 2) : ''} />
        <Row
          label="Market cap after"
          value={preview ? `${fmtSol(preview.mcapAfter)} SOL` : ''}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="label-xs">Slippage</span>
        <div className="flex gap-1">
          {SLIPPAGE.map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => setSlippageBps(bps)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-light tabular-nums transition-colors',
                slippageBps === bps ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-200',
              )}
            >
              {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => (side === 'buy' ? buy(launch.mint, parsed) : sell(launch.mint, parsed))}
        className={cn('mt-4 w-full', side === 'buy' ? 'btn-primary' : 'btn text-black')}
        style={side === 'sell' ? { background: '#ffa2ae' } : undefined}
      >
        {!session
          ? 'Connect to trade'
          : insufficient
            ? 'Not enough tokens'
            : side === 'buy'
              ? `Buy ${launch.symbol}`
              : `Sell ${launch.symbol}`}
      </button>

      <p className="mt-2 text-center text-[10px] font-extralight uppercase tracking-widest text-slate-600">
        {migrated
          ? 'taxed swap against the locked pool'
          : 'taxed trade against the bonding curve'}
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] font-light uppercase tracking-widest text-slate-500">
        {label}
      </span>
      <span
        className={cn(
          'text-right text-[11px] font-extralight tabular-nums',
          strong ? 'text-white' : 'text-slate-400',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function FeeRows({
  fees,
  amount,
  mode,
}: {
  fees: FeeBreakdown;
  amount: bigint;
  mode: 'dividend' | 'lottery';
}) {
  if (amount === 0n) return null;
  const pct = (value: bigint) => `${((Number(value) / Number(amount)) * 100).toFixed(2)}%`;
  return (
    <>
      <div className="my-1 border-t border-white/[0.06]" />
      <Row label={`Tax total (${pct(fees.totalTax)})`} value={fmtSol(fees.totalTax, 5)} />
      <Row label={` platform vault`} value={fmtSol(fees.vault, 5)} />
      {fees.dividend > 0n ? (
        <Row label=" holder dividends" value={fmtSol(fees.dividend, 5)} />
      ) : null}
      {fees.draw > 0n ? <Row label=" round pot (drawn by 10)" value={fmtSol(fees.draw, 5)} /> : null}
      {fees.top > 0n ? <Row label=" top ten holders" value={fmtSol(fees.top, 5)} /> : null}
    </>
  );
}


