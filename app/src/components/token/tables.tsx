'use client';

import { Pill } from '@/components/ui/primitives';
import { SOL_PRICE_USD, explorerAddress } from '@/lib/const';
import { useStore } from '@/lib/data/store';
import type { LaunchState, TradeRow } from '@/lib/data/types';
import { priceE6 } from '@/lib/engine';
import { fmtAgo, fmtSol, fmtTokens, fmtUsd, shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';

export function TradesTable({
  launch,
  mode,
  limit = 30,
}: {
  launch: LaunchState;
  mode: 'bonding' | 'migrated';
  limit?: number;
}) {
  const version = useStore((s) => s.version);
  const market = useStore((s) => s.market);
  const session = useStore((s) => s.session);
  const rows = [...launch.tradeLog].reverse().slice(0, limit);

  if (launch.tradeLog.length === 0) {
    return (
      <p className="py-8 text-center text-[11px] font-extralight text-slate-500">
        No trades yet. The first buy sets the price.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {['Time', 'Type', 'Wallet', 'SOL', 'Tokens', 'Price', 'Tax'].map((header) => (
              <th
                key={header}
                className="px-2 py-2 text-left text-[10px] font-light uppercase tracking-widest text-slate-500"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TradeLine
              key={row.id}
              row={row}
              symbol={launch.symbol}
              you={session?.address === row.owner}
              mode={mode}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradeLine({
  row,
  symbol,
  you,
  mode,
}: {
  row: TradeRow;
  symbol: string;
  you: boolean;
  mode: 'bonding' | 'migrated';
}) {
  const price = Number(row.priceE6) / 1e6 / 1e9;
  return (
    <tr className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]">
      <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-500">
        {fmtAgo(row.ts)} ago
      </td>
      <td className="px-2 py-2.5">
        <span
          className={cn(
            'text-[11px] font-light uppercase tracking-widest',
            row.isBuy ? 'text-[#c8f7d4]' : 'text-[#ffa2ae]',
          )}
        >
          {row.isBuy ? 'buy' : 'sell'}
        </span>
      </td>
      <td className="px-2 py-2.5">
        <span className="flex items-center gap-1.5">
          {you ? <Pill tone="accent">you</Pill> : null}
          <a
            href={explorerAddress(row.owner)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] font-light text-slate-400 hover:text-white"
          >
            {shortAddress(row.owner, 5)}
          </a>
        </span>
      </td>
      <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-300">
        {fmtSol(row.solAmount, 4)}
      </td>
      <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-300">
        {fmtTokens(row.tokenAmount)}
      </td>
      <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-400">
        {price.toPrecision(3)}
      </td>
      <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-500">
        {fmtSol(row.fees.total, 5)}
        <span className="ml-1 text-slate-700">
          {mode === 'migrated' ? 'pool' : ''}
        </span>
      </td>
    </tr>
  );
}

export function HoldersTable({ launch, limit = 25 }: { launch: LaunchState; limit?: number }) {
  const version = useStore((s) => s.version);
  const market = useStore((s) => s.market);
  const session = useStore((s) => s.session);
  const holders = market.holders(launch.mint, limit);

  if (holders.length === 0) {
    return (
      <p className="py-8 text-center text-[11px] font-extralight text-slate-500">
        Nobody holds {launch.symbol} yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {['#', 'Wallet', 'Balance', 'Share', 'Value', 'Dividends'].map((header) => (
              <th
                key={header}
                className="px-2 py-2 text-left text-[10px] font-light uppercase tracking-widest text-slate-500"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {holders.map((holder, index) => (
            <tr
              key={holder.owner}
              className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]"
            >
              <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-600">
                {index + 1}
              </td>
              <td className="px-2 py-2.5">
                <span className="flex items-center gap-1.5">
                  {session?.address === holder.owner ? <Pill tone="accent">you</Pill> : null}
                  <a
                    href={explorerAddress(holder.owner)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] font-light text-slate-400 hover:text-white"
                  >
                    {shortAddress(holder.owner, 5)}
                  </a>
                </span>
              </td>
              <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-300">
                {fmtTokens(holder.balance)}
              </td>
              <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-400">
                {(holder.shareBps / 100).toFixed(3)}%
              </td>
              <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-400">
                {fmtUsd(holder.valueLamports, SOL_PRICE_USD)}
              </td>
              <td className="px-2 py-2.5 text-[11px] font-extralight tabular-nums text-slate-500">
                {fmtSol(market.pendingDividends(launch.mint, holder.owner), 5)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[10px] font-extralight text-slate-600">
        {limit} largest positions of{' '}
        {Object.values(launch.balances).filter((b) => b > 0n).length} wallets. Shares are
        computed against the circulating supply - tokens sitting in the curve or the pool
        vault do not count.
      </p>
      <span className="hidden">{version}</span>
    </div>
  );
}

export function AboutTab({ launch }: { launch: LaunchState }) {
  const price = priceE6(launch.virtualSol, launch.virtualTokens);
  return (
    <div className="space-y-4 text-[11px] font-extralight leading-relaxed text-slate-400">
      <p>{launch.description || 'No description was attached to this launch.'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Detail label="Mint" value={launch.mint} />
        <Detail label="Creator" value={launch.creator} />
        <Detail label="Metadata uri" value={launch.uri} />
        <Detail label="Mode" value={launch.mode} />
        <Detail
          label="Tax split"
          value={`${launch.vaultBps / 100}% vault  ${launch.topBps / 100}% top ten  ${launch.drawBps / 100}% draw  ${launch.dividendBps / 100}% dividends`}
        />
        <Detail label="Spot price" value={`${price.toLocaleString('en-US')} lamports`} />
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
      <p className="label-xs">{label}</p>
      <p className="mt-1 break-all font-mono text-[10px] font-light text-slate-400">{value}</p>
    </div>
  );
}

