import { useEffect, useMemo, useState } from 'react';
import { LogOut, Wallet2 } from 'lucide-react';
import { useConnectOrCreateWallet, usePrivy, useWallets } from '@privy-io/react-auth';

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
  disconnect?: () => Promise<void>;
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
 * Only call this hook inside the authenticated app wrapped in PrivyProvider.
 */
export function usePrivyAuth() {
  const privy = usePrivy();
  const { connectOrCreateWallet } = useConnectOrCreateWallet();
  return {
    ready: privy.ready,
    authenticated: privy.authenticated,
    login: privy.login,
    connectWallet: connectOrCreateWallet,
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
  const { ready, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [connectError, setConnectError] = useState('');
  const { connectOrCreateWallet } = useConnectOrCreateWallet({
    onSuccess: async () => setConnectError(''),
    onError: async (error) => setConnectError(
      error ? `Wallet connection failed (${String(error).replace(/_/g, ' ')}).` : 'We could not connect that wallet. Try again.'
    ),
  });

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
    return <div className="hf-wallet-pill hf-wallet-pill-muted">Preparing wallet…</div>;
  }

  if (!walletAddress) {
    return (
      <div className="hf-wallet-connect-wrap">
        <button
          onClick={() => {
            setConnectError('');
            connectOrCreateWallet();
          }}
          className="hf-wallet-pill hf-wallet-pill-action"
        >
          <Wallet2 size={14} />
          Connect
        </button>
        {connectError && <span role="alert">{connectError}</span>}
      </div>
    );
  }

  const connectedLabel = (
    <>
      <span className="hf-wallet-status-dot" aria-hidden="true" />
      {shortAddress(walletAddress)}
    </>
  );

  async function disconnectWallet() {
    setConnectError('');
    try {
      await activeWallet?.disconnect?.();
      await logout();
    } catch {
      setConnectError('We could not disconnect the wallet. Please try again.');
    }
  }

  return (
    <div className="hf-wallet-connect-wrap">
      <button
        type="button"
        onClick={() => void disconnectWallet()}
        className="hf-wallet-pill hf-wallet-pill-connected"
        aria-label={`Disconnect wallet ${shortAddress(walletAddress)}`}
        title="Disconnect wallet"
      >
        {connectedLabel}
        <span className="hf-wallet-disconnect-icon" aria-hidden="true">
          <LogOut size={14} />
        </span>
      </button>
      {connectError && <span role="alert">{connectError}</span>}
    </div>
  );
}

export function DemoWalletConnector() {
  return (
    <div className="hf-wallet-pill hf-wallet-pill-muted">
      <Wallet2 size={13} />
      Preview mode
    </div>
  );
}
