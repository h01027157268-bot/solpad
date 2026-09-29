/**
 * Display helpers.
 *
 * Every one of these is total: it accepts anything (undefined, NaN, Infinity,
 * a negative, a value larger than Number.MAX_SAFE_INTEGER) and always returns
 * something a human can read. A dashboard that renders "NaN" next to a token is
 * worse than one that renders a dash.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const TOKEN_DECIMALS = 6;
export const ONE_TOKEN = 1_000_000;

const DASH = '';

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function sol(lamports: number | bigint): number {
  const n = safeNumber(lamports);
  return n === null ? 0 : n / LAMPORTS_PER_SOL;
}

export function fmtSol(lamports: number | bigint | null | undefined, digits = 2): string {
  const n = safeNumber(lamports);
  if (n === null) return DASH;
  const v = n / LAMPORTS_PER_SOL;
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs < 0.000001) return '<0.000001';
  if (abs < 0.01) return v.toFixed(6 - Math.min(3, Math.floor(Math.log10(abs) + 6)));
  const clamped = Math.max(0, Math.min(8, digits));
  return v.toLocaleString('en-US', {
    minimumFractionDigits: clamped,
    maximumFractionDigits: clamped,
  });
}

export function fmtTokens(baseUnits: number | bigint | null | undefined, digits = 2): string {
  const n = safeNumber(baseUnits);
  if (n === null) return DASH;
  const v = n / ONE_TOKEN;
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(digits)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(digits)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(digits)}K`;
  if (abs > 0 && abs < 0.01) return '<0.01';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function fmtUsd(lamports: number | bigint | null | undefined, solPrice: number): string {
  const n = safeNumber(lamports);
  const price = safeNumber(solPrice);
  if (n === null || price === null || price <= 0) return DASH;
  const v = (n / LAMPORTS_PER_SOL) * price;
  if (v === 0) return '$0';
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  if (abs < 0.0001) return '<$0.0001';
  return `$${v.toFixed(4)}`;
}

export function fmtPct(bps: number | null | undefined, digits = 1): string {
  const n = safeNumber(bps);
  if (n === null) return DASH;
  return `${(n / 100).toFixed(digits)}%`;
}

export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address || typeof address !== 'string') return DASH;
  const trimmed = address.trim();
  if (trimmed.length === 0) return DASH;
  if (trimmed.length <= size * 2 + 1) return trimmed;
  return `${trimmed.slice(0, size)}${trimmed.slice(-size)}`;
}

export function fmtAgo(unixSeconds: number | null | undefined): string {
  const n = safeNumber(unixSeconds);
  if (n === null || n <= 0) return DASH;
  const seconds = Math.floor(Date.now() / 1000) - Math.floor(n);
  if (seconds < 0) return 'now';
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  const days = Math.floor(seconds / 86_400);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

export function fmtClock(seconds: number | null | undefined): string {
  const n = safeNumber(seconds);
  if (n === null || n <= 0) return '0s';
  const total = Math.floor(n);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtNumber(value: number | null | undefined, digits = 2): string {
  const n = safeNumber(value);
  if (n === null) return DASH;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Lamports per whole token -> SOL per token, 1e6 scaled input. */
export function priceFromE6(priceE6: bigint | number | null | undefined): number {
  const n = safeNumber(priceE6);
  if (n === null) return 0;
  return n / 1e6 / LAMPORTS_PER_SOL;
}

/** Guards a division that would otherwise render NaN. */
export function ratio(part: bigint, whole: bigint): number {
  if (!whole || whole === 0n) return 0;
  return Number(part) / Number(whole);
}
