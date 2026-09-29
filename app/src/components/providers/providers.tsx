'use client';

import { RPC_URL } from '@/lib/const';
import { useStore } from '@/lib/data/store';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { useStandardWalletAdapters } from '@solana/wallet-standard-wallet-adapter-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useMemo, type ReactNode } from 'react';

import '@solana/wallet-adapter-react-ui/styles.css';

export function Providers({ children }: { children: ReactNode }) {
  const standard = useStandardWalletAdapters([]);
  const wallets = useMemo(
    () => [...standard, new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [standard],
  );

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Bootstrap />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/** Replays the local action log, hands the wallet to the chain layer and lets
 *  the mirror market tick while there is no deployed program. */
function Bootstrap() {
  const hydrate = useStore((s) => s.hydrate);
  const syncChain = useStore((s) => s.syncChain);
  const program = useStore((s) => s.program);
  const attachWallet = useStore((s) => s.attachWallet);
  const wallet = useWallet();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // keep the on-chain state fresh: 15s is enough for a bonding curve and kind
  // to a public RPC
  useEffect(() => {
    if (!program) return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void syncChain();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [syncChain, program]);

  useEffect(() => {
    attachWallet({
      publicKey: wallet.publicKey ?? null,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
    });
  }, [attachWallet, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

  return null;
}



