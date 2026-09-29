'use client';

import { cn } from '@/lib/cn';
import { NETWORK } from '@/lib/const';
import { useStore } from '@/lib/data/store';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/', label: 'Explore' },
  { href: '/create', label: 'Launch' },
    { href: '/docs', label: 'Docs' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const session = useStore((s) => s.session);
  const program = useStore((s) => s.program);
  const setSession = useStore((s) => s.setSession);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // keep the store session in sync with a real wallet connection
  useEffect(() => {
    if (wallet.connected && wallet.publicKey) {
      const address = wallet.publicKey.toBase58();
      if (session?.address !== address) {
        setSession({ address, label: wallet.wallet?.adapter.name ?? 'Wallet' });
      }
    }
  }, [wallet.connected, wallet.publicKey, wallet.wallet, session, setSession]);

  const connected = mounted && session !== null;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 md:flex-nowrap md:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-xs font-extralight uppercase tracking-[0.3em] text-white transition-colors hover:text-slate-300"
          >
            SolPad
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((link) => {
              const active =
                link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'shrink-0 rounded-md px-3 py-1.5 text-[11px] font-light uppercase tracking-widest transition-colors',
                    active ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-200',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {program ? (
            <span className="hidden rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-light uppercase tracking-widest text-slate-400 md:inline">
              {NETWORK}
            </span>
          ) : null}
          {connected ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSession(null);
                  if (wallet.connected) void wallet.disconnect();
                }}
                className="rounded-md border border-white/10 px-3 py-1.5 text-[11px] font-light uppercase tracking-widest text-slate-300 transition-colors hover:border-white/30 hover:text-white"
              >
                {session ? `${session.address.slice(0, 4)}${session.address.slice(-4)}` : ''}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setVisible(true)}
                className="rounded-md border border-white/15 px-3 py-1.5 text-[11px] font-light uppercase tracking-widest text-white transition-colors hover:border-white/40"
              >
                Connect
              </button>
            </div>
          )}
        </div>
      </div>

      <nav className="mx-auto -mx-1 flex w-full max-w-7xl items-center gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {LINKS.map((link) => {
          const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-[11px] font-light uppercase tracking-widest transition-colors',
                active ? 'bg-white/[0.08] text-white' : 'text-slate-500',
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.04] bg-white/[0.02]">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4 md:px-6">
        <p className="text-[11px] font-extralight text-slate-500">
          Every launch, buy, sell and claim is a transaction on Solana. Taxes are
          enforced by the program, not by a server.
        </p>
        <div className="flex items-center gap-4 text-[11px] font-extralight text-slate-500">
          <a
            className="text-slate-300 underline underline-offset-4 hover:text-white"
            href="https://solscan.io"
            target="_blank"
            rel="noreferrer"
          >
            Solscan
          </a>
          <a
            className="text-slate-300 underline underline-offset-4 hover:text-white"
            href="https://explorer.solana.com"
            target="_blank"
            rel="noreferrer"
          >
            Explorer
          </a>
          <a
            className="text-slate-300 underline underline-offset-4 hover:text-white"
            href="https://solana.com/developers"
            target="_blank"
            rel="noreferrer"
          >
            Developer docs
          </a>
        </div>
      </div>
    </footer>
  );
}

/** The faint film grain the reference UI sits under. */
export function Grain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 opacity-[0.15]"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
      }}
    />
  );
}




