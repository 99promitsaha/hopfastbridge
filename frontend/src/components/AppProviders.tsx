import type { ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { defineChain } from 'viem';
import { mainnet, base, bsc, polygon, monad } from 'viem/chains';

const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
});

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

export function AppProviders({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['wallet'],
        defaultChain: base,
        supportedChains: [arc, mainnet, base, bsc, polygon, monad],
        appearance: {
          theme: 'light',
          accentColor: '#1B3158',
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
