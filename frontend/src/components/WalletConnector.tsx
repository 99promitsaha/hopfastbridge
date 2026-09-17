import { useEffect, useMemo } from 'react';
import { LogOut, Wallet2 } from 'lucide-react';
import { usePrivy, useWallets } from '@privy-io/react-auth';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export interface PrivyWalletBridge {
  address: string;
  chainId: string;
  switchChain: (targetChainId: `0x${string}` | number) => Promise<void>;
  getEthereumProvider: () => Promise<EthereumProvider>;
}

interface PrivyWalletLike {
  address: string;
  chainId: string;
  switchChain: (targetChainId: `0x${string}` | number) => Promise<void>;
  getEthereumProvider: () => Promise<EthereumProvider>;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function getWalletAddress(user: unknown): string | null {
  const maybeUser = user as {
    wallet?: { address?: string };
    linkedAccounts?: Array<{ address?: string; type?: string }>;
  };

  const direct = maybeUser?.wallet?.address;
  if (direct) return direct;

  const linked = maybeUser?.linkedAccounts?.find((account) => Boolean(account.address));
  return linked?.address ?? null;
}

/**
 * Hook to access Privy auth state.
 * Always call unconditionally (React rules of hooks).
 * When Privy is not configured, the PrivyProvider still wraps the app,
 * so usePrivy() is always safe to call.
 */
export function usePrivyAuth() {
  const privy = usePrivy();
  return {
    ready: privy.ready,
    authenticated: privy.authenticated,
    login: privy.login,
    logout: privy.logout
  };
}

export function PrivyWalletConnector({
  onWalletAddress,
  onWalletBridge
}: {
  onWalletAddress: (address: string | null) => void;
  onWalletBridge?: (wallet: PrivyWalletBridge | null) => void;
}) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const activeWallet = useMemo<PrivyWalletLike | null>(() => {
    if (!wallets.length) return null;

    const fallback = wallets[0] as unknown as PrivyWalletLike;
    const userAddress = getWalletAddress(user);

    if (!userAddress) return fallback;

    const matched = wallets.find((w) => w.address.toLowerCase() === userAddress.toLowerCase());
    return (matched as unknown as PrivyWalletLike | undefined) ?? fallback;
  }, [wallets, user]);

  const walletAddress = activeWallet?.address ?? getWalletAddress(user);

  useEffect(() => {
    onWalletAddress(walletAddress ?? null);

    if (walletAddress) {
      const base = import.meta.env.VITE_HOPFAST_API_BASE_URL?.replace(/\/$/, '')
        || (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'http://localhost:8080/api' : '');
      if (base) {
        fetch(`${base}/wallets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: walletAddress })
        }).catch(() => {});
      }
    }
  }, [walletAddress, onWalletAddress]);

  useEffect(() => {
    if (!onWalletBridge) return;

    if (!activeWallet) {
      onWalletBridge(null);
      return;
    }

    onWalletBridge({
      address: activeWallet.address,
      chainId: activeWallet.chainId,
      switchChain: activeWallet.switchChain,
      getEthereumProvider: activeWallet.getEthereumProvider
    });
  }, [activeWallet, onWalletBridge]);

  if (!ready) {
    return <div className="hf-wallet-pill hf-wallet-pill-muted">Loading…</div>;
  }

  if (!authenticated || !walletAddress) {
    return (
      <button onClick={login} className="hf-wallet-pill hf-wallet-pill-action">
        <Wallet2 size={14} />
        Connect
      </button>
    );
  }

  return (
    <button onClick={logout} className="hf-wallet-pill">
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '999px',
        background: '#22c55e',
        display: 'inline-block',
        flexShrink: 0
      }} />
      {shortAddress(walletAddress)}
      <LogOut size={13} />
    </button>
  );
}

export function DemoWalletConnector() {
  return (
    <div className="hf-wallet-pill hf-wallet-pill-muted">
      <Wallet2 size={13} />
      Demo Mode
    </div>
  );
}
