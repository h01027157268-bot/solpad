'use client';

import { cn } from '@/lib/cn';
import { SOL_PRICE_USD } from '@/lib/const';
import type { PricePoint } from '@/lib/data/types';
import { fmtUsd } from '@/lib/format';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const RANGES = [
  { key: '5m', label: '5M', seconds: 300 },
  { key: '1h', label: '1H', seconds: 3_600 },
  { key: '6h', label: '6H', seconds: 21_600 },
  { key: '1d', label: '1D', seconds: 86_400 },
  { key: 'all', label: 'ALL', seconds: 0 },
] as const;

export function PriceChart({ history, mode }: { history: PricePoint[]; mode: 'dividend' | 'lottery' }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('1h');

  const data = useMemo(() => {
    const seconds = RANGES.find((item) => item.key === range)?.seconds ?? 0;
    const cutoff = seconds > 0 ? Math.floor(Date.now() / 1000) - seconds : 0;
    const points = history.filter((point) => point.t >= cutoff);
    const source = points.length >= 2 ? points : history.slice(-2);
    return source.map((point) => ({
      t: point.t,
      mcap: point.mcap,
      time: new Date(point.t * 1_000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));
  }, [history, range]);

  const first = data[0]?.mcap ?? 0;
  const last = data[data.length - 1]?.mcap ?? 0;
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const up = change >= 0;

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-xs">Market cap</p>
          <p className="mt-1 text-2xl font-thin tabular-nums text-white">
            {fmtUsd(BigInt(Math.round(last * 1e9)), SOL_PRICE_USD)}
          </p>
          <p
            className={cn(
              'mt-1 text-[11px] font-extralight tabular-nums',
              up ? 'text-[#c8f7d4]' : 'text-[#ffa2ae]',
            )}
          >
            {up ? '+' : ''}
            {change.toFixed(2)}%  {last.toFixed(2)} SOL
          </p>
        </div>
        <div className="flex items-center gap-1">
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setRange(item.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[10px] font-light uppercase tracking-widest transition-colors',
                range === item.key
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-500 hover:text-slate-200',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="mcapFill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={up ? 'rgba(255,255,255,0.28)' : 'rgba(255,162,174,0.28)'}
                />
                <stop offset="100%" stopColor="transparent" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.045)" strokeDasharray="2 6" />
            <XAxis dataKey="time" hide />
            <YAxis
              orientation="right"
              width={54}
              tick={{ fill: '#475569', fontSize: 9, fontWeight: 300 }}
              axisLine={false}
              tickLine={false}
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value: number) => `${value.toFixed(0)}`}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(255,255,255,0.2)', strokeDasharray: '2 4' }}
              contentStyle={{
                background: 'rgba(0,0,0,0.92)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 200,
                color: '#fff',
              }}
              labelStyle={{ color: '#64748b', fontSize: 10 }}
              formatter={(value: number) => [`${value.toFixed(2)} SOL`, 'mcap']}
            />
            <Area
              type="monotone"
              dataKey="mcap"
              stroke={up ? 'rgba(255,255,255,0.8)' : 'rgba(255,162,174,0.85)'}
              strokeWidth={1.2}
              fill="url(#mcapFill)"
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3 text-[10px] font-extralight uppercase tracking-widest text-slate-600">
        <span>
          {mode === 'dividend' ? '4% of every trade buys pressure' : 'the pot grows with volume'}
        </span>
        <span>{history.length} prints</span>
      </div>
    </div>
  );
}
