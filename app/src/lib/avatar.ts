/**
 * Local avatar helpers.
 *
 * Nothing here is stored on-chain: a Solana account can only hold ~10 KB and
 * rent costs ~0.008 SOL per KB, so an image never lives in the launch account.
 * What goes on-chain is the *link* to permanent storage (plus the name, symbol
 * and description). These helpers only draw a placeholder for wallets that have
 * no image yet.
 */

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Two letters to show when there is no image at all. */
export function initials(symbol: string | null | undefined): string {
  const clean = String(symbol ?? '').replace(/[^a-zA-Z0-9]/g, '');
  return (clean.slice(0, 2) || '').toUpperCase();
}

/** A deterministic two-stop gradient, drawn locally, for the placeholder. */
export function avatarGradient(seed: string | null | undefined): string {
  const h = hash(String(seed ?? 'solpad'));
  const hue = h % 360;
  const hue2 = (hue + 30 + (h % 40)) % 360;
  return `linear-gradient(135deg, hsl(${hue} 16% 12%), hsl(${hue2} 18% ${20 + (h % 10)}%))`;
}

/** True when a string is something an <img> can actually load. */
export function isRenderableImage(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;
  if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)/i.test(trimmed)) return true;
  return /^https?:\/\/\S+$/i.test(trimmed);
}
