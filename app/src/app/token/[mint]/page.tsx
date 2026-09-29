'use client';

import { Avatar } from '@/components/explore/token-card';
import { PriceChart } from '@/components/token/price-chart';
import {
  DividendPanel,
  EconomicsPanel,
  GraduationPanel,
  LotteryPanel,
  PositionPanel,
} from '@/components/token/panels';
import { AboutTab, HoldersTable, TradesTable } from '@/components/token/tables';
import { TradePanel } from '@/components/token/trade-panel';
import { ClientOnly, Copyable, Pill, Skeleton, Stat } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { SOL_PRICE_USD, explorerAddress } from '@/lib/const';
import { useStore } from '@/lib/data/store';
import { CURVE_SUPPLY, eligibleSupply, graduationProgressBps, priceE6 } from '@/lib/engine';
import { fmtAgo, fmtSol, fmtTokens, fmtUsd, shortAddress } from '@/lib/format';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

type Tab = 'trades' | 'holders' | 'about';

export default function TokenPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-8 md:px-6">
      <ClientOnly fallback={<TokenSkeleton />}>
        <Detail />
      </ClientOnly>
    </div>
  );
}

function TokenSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-10 w-56 animate-pulse rounded-lg bg-white/[0.04]" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Skeleton className="h-[380px]" />
          <Skeleton className="h-[220px]" />
        </div>
        <Skeleton className="h-[520px]" />
      </div>
    </div>
  );
}

function Detail() {
  const params = useParams<{ mint: string }>();
  const version = useStore((s) => s.version);
  const market = useStore((s) => s.market);
  const [tab, setTab] = useState<Tab>('trades');

  const launch = market.get(decodeURIComponent(params?.mint ?? ''));

  if (!launch) {
    return (
      <div className="py-20 text-center">
        <p className="label-eyebrow">Not found</p>
        <h1 className="mt-2 text-2xl font-thin uppercase tracking-tight text-white">
          No launch at that address
        </h1>
        <p className="mt-3 text-sm font-extralight text-slate-500">
          The mint you followed does not exist on this deployment. Browse the curves that do.
        </p>
        <Link href="/" className="btn-ghost mt-6">
          <ArrowLeft size={13} /> Back to explore
        </Link>
      </div>
    );
  }

  const price = priceE6(launch.virtualSol, launch.virtualTokens);
  const progress = graduationProgressBps(launch.realSol, launch.graduationLamports);
  const eligible = eligibleSupply(launch.totalSupply, launch.realTokens, launch.poolReserve);
  const holders = Object.values(launch.balances).filter((b) => b > 0n).length;
  const age = Math.floor(Date.now() / 1_000) - launch.createdAt;

  return (
    <>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[10px] font-light uppercase tracking-widest text-slate-500 transition-colors hover:text-white"
      >
        <ArrowLeft size={11} /> Explore
      </Link>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <Avatar launch={launch} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-thin tracking-tight text-white">
                {launch.name}
              </h1>
              <Pill tone="accent">
                {launch.mode === 'dividend' ? 'dividend 5%' : 'lottery 10%'}
              </Pill>
              <Pill>{launch.status === 'migrated' ? 'graduated' : 'on the curve'}</Pill>
            </div>
            <p className="mt-1 text-[11px] font-light uppercase tracking-widest text-slate-500">
              ${launch.symbol}  {age > 0 ? `${fmtAgo(launch.createdAt)} ago` : 'just launched'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <Copyable
                value={launch.mint}
                label={`${launch.mint.slice(0, 4)}${launch.mint.slice(-4)}`}
                href={explorerAddress(launch.mint)}
              />
              <span className="text-[11px] font-extralight text-slate-600">
                by {shortAddress(launch.creator, 5)}
              </span>
              <a
                href={explorerAddress(launch.creator)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-light uppercase tracking-widest text-slate-600 transition-colors hover:text-white"
              >
                Solscan <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Stat
            label="Market cap"
            value={fmtUsd(launch.marketCapLamports, SOL_PRICE_USD)}
            sub={`${fmtSol(launch.marketCapLamports)} SOL`}
          />
          <Stat label="Price" value={`${price.toLocaleString('en-US')} lamports`} sub="per token" />
          <Stat
            label="Holders"
            value={holders.toLocaleString('en-US')}
            sub={`${fmtTokens(eligible)} circulating`}
          />
          <Stat
            label="Volume"
            value={`${fmtSol(launch.volumeLamports)} SOL`}
            sub={fmtUsd(launch.volumeLamports, SOL_PRICE_USD)}
          />
        </div>
      </div>
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <PriceChart history={launch.history} mode={launch.mode} />

          <div className="grid grid-cols-2 gap-4 border-y border-white/[0.05] py-4 md:grid-cols-4">
            <Stat
              label={launch.status === 'migrated' ? 'In the pool' : 'Raised'}
              value={`${fmtSol(launch.realSol)} SOL`}
              sub={
                launch.status === 'migrated'
                  ? 'locked with the LP'
                  : `${(progress / 100).toFixed(1)}% to graduation`
              }
            />
            <Stat
              label="Tax on trades"
              value={launch.mode === 'dividend' ? '5%' : '10%'}
              sub={launch.mode === 'dividend' ? '1% vault  4% holders' : '1% vault  6 to 3% pot'}
            />
            <Stat
              label="On the curve"
              value={fmtTokens(launch.realTokens)}
              sub={`of ${fmtTokens(BigInt(CURVE_SUPPLY))}`}
            />
            <Stat
              label={launch.mode === 'dividend' ? 'Dividends paid' : 'Pot distributed'}
              value={`${fmtSol(
                launch.mode === 'dividend' ? launch.dividendDistributed : launch.drawDistributed,
              )} SOL`}
              sub={launch.mode === 'dividend' ? 'to holders' : 'to winners'}
            />
          </div>

          <div className="card p-6">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] pb-3">
              {(
                [
                  { key: 'trades', label: `Trades (${launch.tradeLog.length})` },
                  { key: 'holders', label: `Holders (${holders})` },
                  { key: 'about', label: 'About' },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-[11px] font-light uppercase tracking-widest transition-colors',
                    tab === item.key
                      ? 'bg-white/[0.08] text-white'
                      : 'text-slate-500 hover:text-slate-200',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="pt-4">
              {tab === 'trades' ? (
                <TradesTable
                  launch={launch}
                  mode={launch.status === 'migrated' ? 'migrated' : 'bonding'}
                />
              ) : null}
              {tab === 'holders' ? <HoldersTable launch={launch} /> : null}
              {tab === 'about' ? (
                <div className="space-y-6">
                  <AboutTab launch={launch} />
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <p className="label-xs">Tax mechanics</p>
                    <div className="mt-3">
                      <EconomicsPanel launch={launch} />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <TradePanel launch={launch} />
          <PositionPanel launch={launch} />
          {launch.mode === 'lottery' ? <LotteryPanel launch={launch} /> : null}
          {launch.mode === 'dividend' ? <DividendPanel launch={launch} /> : null}
          <GraduationPanel launch={launch} />
        </aside>
      </div>
    </>
  );
}


