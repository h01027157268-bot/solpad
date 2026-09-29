import { Grain, SiteFooter, SiteHeader } from '@/components/layout/site-chrome';
import { Providers } from '@/components/providers/providers';
import { Toasts } from '@/components/ui/primitives';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SolPad | Launch and trade on the curve',
  description:
    'Fair launch bonding curves on Solana. Mints onto the curve, tax enforced on-chain: 5% dividend mode or 10% lottery mode, graduating into a locked pool.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-black text-slate-300 antialiased selection:bg-slate-700 selection:text-white">
        <Providers>
          <div className="relative flex min-h-screen flex-col bg-black">
            <Grain />
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
          <Toasts />
        </Providers>
      </body>
    </html>
  );
}
