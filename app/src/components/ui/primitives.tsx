'use client';

import { cn } from '@/lib/cn';
import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '@/lib/data/store';

/** Tonal pill used for filters, modes and statuses. */
export function Pill({
  children,
  active = false,
  tone = 'neutral',
  className,
  onClick,
  title,
}: {
  children: ReactNode;
  active?: boolean;
  tone?: 'neutral' | 'accent' | 'down' | 'up';
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  const tones = {
    neutral: active
      ? 'border-white/40 text-white'
      : 'border-white/[0.08] text-slate-500 hover:text-slate-200',
    accent: active ? 'border-white/50 text-white' : 'border-white/20 text-slate-300',
    down: 'border-[#ffa2ae]/30 text-[#ffa2ae]',
    up: 'border-[#c8f7d4]/30 text-[#c8f7d4]',
  } as const;
  const Comp = onClick ? 'button' : 'span';
  return (
    <Comp
      title={title}
      onClick={onClick}
      className={cn('pill', tones[tone], onClick && 'cursor-pointer', className)}
    >
      {children}
    </Comp>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('label-eyebrow', className)}>{children}</p>;
}

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="label-xs">{children}</span>
      {hint ? <span className="text-[10px] font-extralight text-slate-600">{hint}</span> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'up' | 'down';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="label-xs truncate">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-sm font-extralight tabular-nums',
          tone === 'up' ? 'text-[#c8f7d4]' : tone === 'down' ? 'text-[#ffa2ae]' : 'text-white',
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 truncate text-[10px] font-extralight text-slate-600">{sub}</p>
      ) : null}
    </div>
  );
}

export function Bar({
  value,
  className,
  segments,
}: {
  value: number;
  className?: string;
  segments?: { value: number; className?: string }[];
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-white/[0.06]', className)}>
      {segments ? (
        <div className="flex h-full w-full">
          {segments.map((segment, index) => (
            <div
              key={index}
              className={cn('h-full', segment.className)}
              style={{ width: `${Math.max(0, Math.min(100, segment.value))}%` }}
            />
          ))}
        </div>
      ) : (
        <div className="h-full rounded-full bg-white/70" style={{ width: `${clamped}%` }} />
      )}
    </div>
  );
}

/** Renders children only after hydration - keeps market data out of the SSR pass. */
export function ClientOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback ?? null}</>;
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]', className)} />
  );
}

export function Copyable({
  value,
  label,
  href,
  className,
  short,
}: {
  value: string;
  label?: string;
  href?: string;
  className?: string;
  short?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const shown = useMemo(
    () => (short ? `${value.slice(0, 4)}${value.slice(-4)}` : value),
    [value, short],
  );
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] font-light text-slate-400 underline underline-offset-4 transition-colors hover:text-white"
        >
          {label ?? shown}
        </a>
      ) : (
        <span className="font-mono text-[11px] font-light text-slate-400">{label ?? shown}</span>
      )}
      <button
        type="button"
        onClick={() => {
          if (typeof navigator !== 'undefined') {
            void navigator.clipboard?.writeText(value);
          }
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_400);
        }}
        className="text-slate-600 transition-colors hover:text-white"
        aria-label="Copy"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          onClick={() => dismiss(toast.id)}
          className={cn(
            'pointer-events-auto rounded-xl border px-3.5 py-2.5 text-left text-[11px] font-light backdrop-blur-md transition-colors',
            toast.tone === 'error'
              ? 'border-[#ffa2ae]/30 bg-[#2a1418]/90 text-[#ffa2ae]'
              : toast.tone === 'ok'
                ? 'border-[#c8f7d4]/25 bg-[#0f1a13]/90 text-[#c8f7d4]'
                : 'border-white/10 bg-black/85 text-slate-300',
          )}
        >
          {toast.text}
        </button>
      ))}
    </div>
  );
}

/** Sparkline built from a price history - no dependency, pure SVG. */
export function Sparkline({
  points,
  className,
  positive = true,
}: {
  points: number[];
  className?: string;
  positive?: boolean;
}) {
  const path = useMemo(() => {
    if (points.length < 2) return { line: '', area: '' };
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const step = 100 / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = i * step;
      const y = 30 - ((p - min) / span) * 26 - 2;
      return [x, y] as const;
    });
    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const area = `${line} L100,30 L0,30 Z`;
    return { line, area };
  }, [points]);

  const stroke = positive ? 'rgba(255,255,255,0.75)' : 'rgba(255,162,174,0.85)';
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn('h-8 w-full', className)}>
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path.area} fill="url(#spark)" />
      <path d={path.line} fill="none" stroke={stroke} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
