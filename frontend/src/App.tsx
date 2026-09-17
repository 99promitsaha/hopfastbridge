import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DemoWalletConnector, PrivyWalletConnector, usePrivyAuth,
  type PrivyWalletBridge
} from './components/WalletConnector';
import { parseUnits } from './lib/amount';
import { makeBalanceKey } from './lib/swap';
import { computeUsdValue } from './services/priceService';
import { PaymentReview } from './components/PaymentReview';
import { LandingView } from './components/LandingView';
import { AgentView } from './components/AgentView';
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
  const [view, setView] = useState<EntryView>(() => new URLSearchParams(window.location.search).has('payment') ? 'payment' : 'landing');
  const pendingLogin = useRef(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBridge, setWalletBridge] = useState<PrivyWalletBridge | null>(null);
  const [draft, setDraft] = useState<SwapDraft>(DEFAULT_DRAFT);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const activeWalletAddress = walletBridge?.address ?? walletAddress;
  const fromChain = CHAIN_BY_KEY[draft.fromChain];
  const selectedFromToken = fromChain.tokens.find((t) => t.symbol === draft.fromTokenSymbol) ?? fromChain.tokens[0];

  // ── Hooks ──
  const prices = usePrices(draft.fromTokenSymbol, draft.toTokenSymbol);

  const {
    tokenBalances, isRefreshingBalances, balanceError,
    formattedSourceBalances, refreshBalancesNow, scheduleBalanceRefresh,
  } = useTokenBalances(activeWalletAddress, draft.fromChain, selectedFromToken);

  const {
    quotes, quotingProviders, retryingProviders, selectedProvider, setSelectedProvider,
    quoteCountdown, isQuoting, bestQuote,
    fetchQuote, triggerFetchImmediate, setupAmountDebounce, clearDebounce,
    setIsExecuting: setQuoteIsExecuting, clearQuotes, draftRef,
  } = useSwapQuotes(activeWalletAddress);

  const onPostSwap = useCallback(() => {
    setDraft((c) => ({ ...c, amount: '' }));
    clearQuotes();
    scheduleBalanceRefresh();
  }, [clearQuotes, scheduleBalanceRefresh]);

  const {
    isExecuting, txStatus, error,
    executeSwap: doExecuteSwap, clearTxStatus, clearError,
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

  // ── Amount debounce ──
  useEffect(() => {
    setupAmountDebounce(draft);
    return () => clearDebounce();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.amount]);

  // ── Gate navigation: require Privy login before entering Human view ──
  const handleHumanClick = () => {
    if (HAS_PRIVY && !privyAuth.authenticated) {
      pendingLogin.current = true;
      privyAuth.login();
      return;
    }
    setView('human');
  };

  useEffect(() => {
    if (HAS_PRIVY && privyAuth.authenticated && pendingLogin.current) {
      pendingLogin.current = false;
      setView('human');
    }
  }, [privyAuth.authenticated]);

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
    const selectedSourceBalanceRaw = tokenBalances[makeBalanceKey(draft.fromChain, selectedFromToken.address)];
    const isAmountInsufficient =
      Boolean(activeWalletAddress)
      && requestedAmountRaw != null
      && selectedSourceBalanceRaw != null
      && requestedAmountRaw > selectedSourceBalanceRaw;

    const volumeUsd = computeUsdValue(prices, draft.fromTokenSymbol, draft.amount)?.value;

    doExecuteSwap(
      draft, bestQuote, selectedFromToken,
      requestedAmountRaw,
      () => privyAuth.login(),
      HAS_PRIVY, privyAuth.authenticated,
      isAmountInsufficient,
      volumeUsd
    );
  }, [draft, bestQuote, selectedFromToken, tokenBalances, activeWalletAddress, prices, doExecuteSwap, privyAuth]);

  const handleBack = useCallback(() => {
    window.history.replaceState(null, '', window.location.pathname);
    setView('landing');
    setDraft(DEFAULT_DRAFT);
    clearQuotes();
    clearTxStatus();
    clearError();
  }, [clearQuotes, clearTxStatus, clearError]);

  return (
    <div className="hf-app">
      {/* Header */}
      <header className="hf-header">
        <div className="hf-logo" onClick={handleBack} style={{ cursor: 'pointer' }}>
          <img src="/favicon.svg" alt="" className="hf-logo-icon" />
          <span className="hf-logo-text">HopFast</span>
        </div>
        {HAS_PRIVY ? (
          <PrivyWalletConnector onWalletAddress={setWalletAddress} onWalletBridge={setWalletBridge} />
        ) : (
          <DemoWalletConnector />
        )}
      </header>

      {/* Main Content */}
      <AnimatePresence mode="wait">
        {view === 'payment' && <PaymentReview walletBridge={walletBridge} onConnect={HAS_PRIVY ? privyAuth.login : undefined} onBack={handleBack} />}

        {view === 'landing' && (
          <LandingView
            onHumanClick={handleHumanClick}
            onAgentClick={() => setView('agent')}
          />
        )}

        {view === 'agent' && (
          <AgentView onBack={() => setView('landing')} />
        )}

        {view === 'stats' && (
          <StatsView onBack={() => setView('landing')} />
        )}

        {view === 'human' && (
          <motion.main
            key="human"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.24 }}
            className="hf-content"
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
                  onBack={handleBack}
                  onToggleHistory={() => setHistoryOpen((prev) => !prev)}
                  onTxStatusClear={clearTxStatus}
                />
          </motion.main>
        )}
      </AnimatePresence>

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
        <div className="hf-privacy-overlay" onClick={() => setPrivacyOpen(false)}>
          <div className="hf-privacy-card" onClick={(e) => e.stopPropagation()}>
            <button className="hf-panel-close" onClick={() => setPrivacyOpen(false)}>✕</button>
            <h2 className="hf-privacy-title">Privacy Policy</h2>
            <p className="hf-privacy-updated">Last updated: April 9, 2026</p>

            <div className="hf-privacy-body">
              <h3>Wallets and transactions</h3>
              <p>Hopfastbridge uses public wallet addresses to prepare swaps and Arc payments. Your wallet signs transactions. We never ask for a seed phrase or private key.</p>
              <h3>Off-chain records</h3>
              <p>We store swap records and payment requests to provide history and tracking. Payment links contain a private access token. Share a link only with the intended payer.</p>
              <h3>Service providers</h3>
              <p>Quotes, wallet connections, RPC requests, and hosting use third-party services. Those services may process network and session data under their own policies. Our API logs requests for operation and troubleshooting.</p>
              <h3>Public blockchain data</h3>
              <p>Wallet transactions are public and cannot be deleted. Contact <a href="https://t.me/promitsaha" target="_blank" rel="noopener noreferrer">@promitsaha</a> about off-chain records.</p>

            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="hf-footer">
        <div>
          <button className="hf-footer-link" onClick={() => setView('stats')}>All-Stats</button>
          <a href="https://t.me/promitsaha" target="_blank" rel="noopener noreferrer">Help</a>
          <button className="hf-footer-link" onClick={() => setPrivacyOpen(true)}>Privacy Policy</button>
        </div>
        <p>© 2026 HopFast. All Rights Reserved.</p>
      </footer>
    </div>
  );
}

function AuthenticatedApp() {
  const privyAuth = usePrivyAuth();
  return <AppContent privyAuth={privyAuth} />;
}

export default function App() {
  return HAS_PRIVY ? <AuthenticatedApp /> : <AppContent privyAuth={{ ready: true, authenticated: false, login: () => {}, logout: async () => {} }} />;
}
