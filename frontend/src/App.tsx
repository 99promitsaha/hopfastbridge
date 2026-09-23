import { useCallback, useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DemoWalletConnector,
  PrivyWalletConnector,
  usePrivyAuth,
  type PrivyWalletBridge,
} from './components/WalletConnector';
import { parseUnits } from './lib/amount';
import { makeBalanceKey } from './lib/swap';
import { computeUsdValue } from './services/priceService';
import { PaymentReview } from './components/PaymentReview';
import {
  ArrowUpRight,
  ArrowLeftRight,
  BarChart3,
  WalletCards,
  X,
} from 'lucide-react';
import { Dialog } from './components/Dialog';
import { AgentView } from './components/AgentView';
import { ArchitectDeployment } from './components/ArchitectDeployment';
import { LandingView } from './components/LandingView';
import { SwapView } from './components/SwapView';
import { StatsView } from './components/StatsView';
import { TransactionHistoryModal } from './components/TransactionHistoryModal';
import { CHAIN_BY_KEY } from './lib/chains';
import { usePrices } from './hooks/usePrices';
import { useTokenBalances } from './hooks/useTokenBalances';
import { useSwapQuotes } from './hooks/useSwapQuotes';
import { useSwapExecution } from './hooks/useSwapExecution';
import { useTransactionHistory } from './hooks/useTransactionHistory';
import { DEFAULT_DRAFT, HAS_PRIVY } from './constants';
import type { EntryView, SwapDraft } from './types';

type AuthState = ReturnType<typeof usePrivyAuth>;

function AppContent({ privyAuth }: { privyAuth: AuthState }) {
  const [view, setView] = useState<EntryView>(() =>
    new URLSearchParams(window.location.search).get('deploy')==='architects' && ['localhost','127.0.0.1'].includes(window.location.hostname) ? 'deployment' : new URLSearchParams(window.location.search).has('payment')
      ? 'payment'
      : 'human'
  );
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBridge, setWalletBridge] = useState<PrivyWalletBridge | null>(
    null
  );
  const [draft, setDraft] = useState<SwapDraft>(DEFAULT_DRAFT);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(() =>
    new URLSearchParams(window.location.search).has('envelope') ||
    new URLSearchParams(window.location.search).has('claimError')
  );
  const [envelopeHandle, setEnvelopeHandle] = useState('');
  const [fundingNudge, setFundingNudge] = useState(false);
  const nudgedHash = useRef<string | null>(null);

  const activeWalletAddress = walletBridge?.address ?? walletAddress;
  const fromChain = CHAIN_BY_KEY[draft.fromChain];
  const selectedFromToken =
    fromChain.tokens.find((t) => t.symbol === draft.fromTokenSymbol) ??
    fromChain.tokens[0];

  // ── Hooks ──
  const prices = usePrices(draft.fromTokenSymbol, draft.toTokenSymbol);

  const {
    tokenBalances,
    isRefreshingBalances,
    balanceError,
    formattedSourceBalances,
    refreshBalancesNow,
    scheduleBalanceRefresh,
  } = useTokenBalances(activeWalletAddress, draft.fromChain, selectedFromToken);

  const {
    quotes,
    quotingProviders,
    retryingProviders,
    selectedProvider,
    setSelectedProvider,
    quoteCountdown,
    autoRefreshEnabled,
    setAutoRefresh,
    isQuoting,
    bestQuote,
    fetchQuote,
    triggerFetchImmediate,
    setupAmountDebounce,
    clearDebounce,
    setIsExecuting: setQuoteIsExecuting,
    clearQuotes,
    draftRef,
  } = useSwapQuotes(activeWalletAddress);

  const onPostSwap = useCallback(() => {
    setDraft((c) => ({ ...c, amount: '' }));
    clearQuotes();
    scheduleBalanceRefresh();
  }, [clearQuotes, scheduleBalanceRefresh]);

  const {
    isExecuting,
    txStatus,
    error,
    executeSwap: doExecuteSwap,
    clearTxStatus,
    clearError,
  } = useSwapExecution(walletBridge, fromChain.chainId, onPostSwap);

  // Keep quote hook aware of execution state (prevents auto-refresh during swap)
  useEffect(() => {
    setQuoteIsExecuting(isExecuting);
  }, [isExecuting, setQuoteIsExecuting]);

  // Immediately refresh balances when a swap reaches a terminal state.
  // The 'completed' signal means the source-chain tx is confirmed, so the
  // deducted amount is already settled. 'failed' also refreshes in case gas
  // was consumed by a reverted on-chain tx.
  useEffect(() => {
    if (txStatus?.stage === 'completed' || txStatus?.stage === 'failed') {
      refreshBalancesNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txStatus?.stage]);

  // Keep draftRef in sync for countdown auto-refresh
  useEffect(() => {
    draftRef.current = draft;
  }, [draft, draftRef]);

  const { historyRecords, historyLoading, historyError } =
    useTransactionHistory(historyOpen, activeWalletAddress, txStatus?.hash);

  useEffect(() => {
    if (
      txStatus?.stage === 'completed' &&
      txStatus.toChain === 'arc' &&
      txStatus.fromChain !== 'arc' &&
      nudgedHash.current !== txStatus.hash
    ) {
      nudgedHash.current = txStatus.hash;
      setFundingNudge(true);
    }
  }, [txStatus]);

  // ── Amount debounce ──
  useEffect(() => {
    setupAmountDebounce(draft);
    return () => clearDebounce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.amount]);

  // ── Scroll to top on view change ──
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [view]);

  // ── Swap execution wrapper ──
  const handleExecuteSwap = useCallback(() => {
    if (!bestQuote) return;
    const requestedAmountRaw = (() => {
      const amount = draft.amount.trim();
      if (!amount) return null;
      try {
        return parseUnits(amount, selectedFromToken.decimals);
      } catch {
        return null;
      }
    })();
    const selectedSourceBalanceRaw =
      tokenBalances[makeBalanceKey(draft.fromChain, selectedFromToken.address)];
    const isAmountInsufficient =
      Boolean(activeWalletAddress) &&
      requestedAmountRaw != null &&
      selectedSourceBalanceRaw != null &&
      requestedAmountRaw > selectedSourceBalanceRaw;

    const volumeUsd = computeUsdValue(
      prices,
      draft.fromTokenSymbol,
      draft.amount
    )?.value;

    doExecuteSwap(
      draft,
      bestQuote,
      selectedFromToken,
      requestedAmountRaw,
      () => privyAuth.connectWallet(),
      HAS_PRIVY,
      Boolean(walletBridge),
      isAmountInsufficient,
      volumeUsd
    );
  }, [
    draft,
    bestQuote,
    selectedFromToken,
    tokenBalances,
    activeWalletAddress,
    prices,
    doExecuteSwap,
    privyAuth,
  ]);

  const closeSwap = useCallback(() => {
    setSwapOpen(false);
    clearDebounce();
    draftRef.current = DEFAULT_DRAFT;
    setDraft({ ...DEFAULT_DRAFT });
    clearQuotes();
    clearError();
  }, [clearDebounce, draftRef, clearQuotes, clearError]);

  const handleBack = useCallback(() => {
    window.history.replaceState(null, '', window.location.pathname);
    setView('human');
    setSupportOpen(false);
    closeSwap();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [closeSwap]);

  return (
    <div className="hf-app">
      <a className="hf-skip-link" href="#main-content">
        Skip to content
      </a>
      {/* Header */}
      <header className="hf-header">
        <button
          className="hf-logo"
          onClick={handleBack}
          aria-label="Hopfast home"
        >
          <img src="/brand/hopfast-mark.svg" alt="" className="hf-logo-icon" />
          <span className="hf-logo-text">
            hopfast<span className="hf-logo-dot">.</span>
          </span>
        </button>
        <nav className="hf-nav" aria-label="Main navigation">
          <button
            className={view === 'human' && !supportOpen ? 'active' : ''}
            aria-label="Bridge (live)"
            aria-current={view === 'human' && !supportOpen ? 'page' : undefined}
            onClick={() => {
              setView('human');
              setSupportOpen(false);
              closeSwap();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <ArrowLeftRight size={15} />
            <span>Bridge</span>
          </button>
          <button
            className={supportOpen ? 'active' : ''}
            aria-current={supportOpen ? 'page' : undefined}
            onClick={() => {
              setView('human');
              setSupportOpen(true);
            }}
          >
            <WalletCards size={15} />
            <span>Pay on Arc</span>
          </button>
          <button
            className={view === 'stats' ? 'active' : ''}
            aria-current={view === 'stats' ? 'page' : undefined}
            onClick={() => setView('stats')}
          >
            <BarChart3 size={15} />
            <span>Stats</span>
          </button>
        </nav>
        {HAS_PRIVY ? (
          <PrivyWalletConnector
            onWalletAddress={setWalletAddress}
            onWalletBridge={setWalletBridge}
          />
        ) : (
          <DemoWalletConnector />
        )}
      </header>

      {/* Main Content */}
      <AnimatePresence mode="wait">
        {view === 'deployment' && <ArchitectDeployment wallet={walletBridge} onConnect={privyAuth.connectWallet} />}
        {view === 'payment' && (
          <PaymentReview
            walletBridge={walletBridge}
            onConnect={HAS_PRIVY ? privyAuth.connectWallet : undefined}
            onBack={handleBack}
          />
        )}

        {view === 'stats' && <StatsView onBack={() => setView('human')} />}

        {view === 'human' && (
          <motion.main
            key="human"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.24 }}
            className="hf-content"
            id="main-content"
          >
            <LandingView
              onBridge={() => setSwapOpen(true)}
              onPayAnyone={() => setSupportOpen(true)}
            />
          </motion.main>
        )}
      </AnimatePresence>

      {swapOpen && (
        <Dialog
          className="hf-swap-modal"
          title="Bridge USDC"
          onClose={closeSwap}
        >
          <SwapView
            draft={draft}
            setDraft={setDraft}
            quotes={quotes}
            quotingProviders={quotingProviders}
            retryingProviders={retryingProviders}
            selectedProvider={selectedProvider}
            setSelectedProvider={setSelectedProvider}
            quoteCountdown={quoteCountdown}
            autoRefreshEnabled={autoRefreshEnabled}
            onAutoRefreshChange={setAutoRefresh}
            isQuoting={isQuoting}
            bestQuote={bestQuote}
            fetchQuote={fetchQuote}
            triggerFetchImmediate={triggerFetchImmediate}
            prices={prices}
            tokenBalances={tokenBalances}
            formattedSourceBalances={formattedSourceBalances}
            balanceError={balanceError}
            isRefreshingBalances={isRefreshingBalances}
            walletBridge={walletBridge}
            activeWalletAddress={activeWalletAddress}
            isExecuting={isExecuting}
            txStatus={txStatus}
            error={error}
            executeSwap={handleExecuteSwap}
            onConnect={privyAuth.connectWallet}
            onToggleHistory={() => setHistoryOpen((prev) => !prev)}
            onTxStatusClear={clearTxStatus}
          />
        </Dialog>
      )}

      {supportOpen && (
        <Dialog
          className="hf-support-modal"
          title="Pay someone on Arc"
          onClose={() => {
            setSupportOpen(false);
            setView('human');
            if (new URLSearchParams(window.location.search).has('envelope')) {
              window.history.replaceState(null, '', window.location.pathname);
            }
          }}
        >
          <AgentView
            onBack={() => {
              setSupportOpen(false);
              setSwapOpen(true);
            }}
            initialHandle={envelopeHandle}
            wallet={walletBridge}
            onConnect={HAS_PRIVY ? privyAuth.connectWallet : undefined}
          />
        </Dialog>
      )}

      {fundingNudge && !swapOpen && (
        <aside className="hf-funding-nudge" aria-label="Pay someone on Arc">
          <button
            type="button"
            className="hf-nudge-dismiss"
            onClick={() => setFundingNudge(false)}
            aria-label="Dismiss funding suggestion"
          >
            <X size={15} />
          </button>
          <p>Your USDC is now on Arc.</p>
          <h3>Ready to pay someone?</h3>
          <button
            type="button"
            onClick={() => {
              setFundingNudge(false);
              setSupportOpen(true);
            }}
          >
            Create a payment <ArrowUpRight size={14} />
          </button>
          <small>Send by X username. They claim on Arc.</small>
        </aside>
      )}

      {/* Transaction History Modal */}
      {historyOpen && (
        <TransactionHistoryModal
          activeWalletAddress={activeWalletAddress}
          historyRecords={historyRecords}
          historyLoading={historyLoading}
          historyError={historyError}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* Privacy Policy Modal */}
      {privacyOpen && (
        <Dialog
          className="hf-privacy-card"
          title="Privacy policy"
          onClose={() => setPrivacyOpen(false)}
        >
          <p className="hf-privacy-updated">Last updated: April 9, 2026</p>

          <div className="hf-privacy-body">
            <h3>Wallets and transactions</h3>
            <p>
              Hopfastbridge uses public wallet addresses to prepare swaps and
              Arc payments. Your wallet signs transactions. We never ask for a
              seed phrase or private key.
            </p>
            <h3>Off-chain records</h3>
            <p>
              We store swap records and payment requests to provide history and
              tracking. Payment links contain a private access token. Share a
              link only with the intended payer.
            </p>
            <h3>Service providers</h3>
            <p>
              Quotes, wallet connections, RPC requests, and hosting use
              third-party services. Those services may process network and
              session data under their own policies. Our API logs requests for
              operation and troubleshooting.
            </p>
            <h3>Public blockchain data</h3>
            <p>
              Wallet transactions are public and cannot be deleted. Contact{' '}
              <a
                href="https://t.me/promitsaha"
                target="_blank"
                rel="noopener noreferrer"
              >
                @promitsaha
              </a>{' '}
              about off-chain records.
            </p>
          </div>
        </Dialog>
      )}

      {/* Footer */}
      <footer className="hf-footer">
        <div className="hf-footer-brand">
          <img className="hf-footer-hopfast" src="/brand/hopfast-mark.svg" alt="" />
          <div><strong>hopfast.</strong><span>USDC in. Payments out. Built on Arc.</span></div>
        </div>
        <div className="hf-footer-arc" aria-label="Built on Arc">
          <span>BUILT ON</span><img src="/brand/arc-logo.svg" alt="Arc" />
        </div>
        <div className="hf-footer-links">
          <a
            href="https://t.me/promitsaha"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get in touch <ArrowUpRight size={12} />
          </a>
          <button onClick={() => setPrivacyOpen(true)}>Privacy</button>
          <span>© {new Date().getFullYear()} Hopfast</span>
        </div>
      </footer>
    </div>
  );
}

function AuthenticatedApp() {
  const privyAuth = usePrivyAuth();
  return <AppContent privyAuth={privyAuth} />;
}

export default function App() {
  return HAS_PRIVY ? (
    <AuthenticatedApp />
  ) : (
    <AppContent
      privyAuth={{
        ready: true,
        authenticated: false,
        login: () => {},
        connectWallet: () => {},
        logout: async () => {},
      }}
    />
  );
}
