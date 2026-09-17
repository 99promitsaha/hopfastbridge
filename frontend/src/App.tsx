import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DemoWalletConnector, PrivyWalletConnector, usePrivyAuth,
  type PrivyWalletBridge
} from './components/WalletConnector';
import { parseUnits } from './lib/amount';
import { makeBalanceKey } from './lib/swap';
import { computeUsdValue } from './services/priceService';
import { LandingView } from './components/LandingView';
import { AgentView } from './components/AgentView';
import { SwapView } from './components/SwapView';
import { EarnView } from './components/EarnView';
import { StatsView } from './components/StatsView';
import { TransactionHistoryModal } from './components/TransactionHistoryModal';
import { CHAIN_BY_KEY } from './lib/chains';
import { usePrices } from './hooks/usePrices';
import { useTokenBalances } from './hooks/useTokenBalances';
import { useSwapQuotes } from './hooks/useSwapQuotes';
import { useSwapExecution } from './hooks/useSwapExecution';
import { useTransactionHistory } from './hooks/useTransactionHistory';
import { DEFAULT_DRAFT, HAS_PRIVY } from './constants';
import type { EntryView, HumanTab, SwapDraft } from './types';

function App() {
  const [view, setView] = useState<EntryView>('landing');
  const [humanTab, setHumanTab] = useState<HumanTab>('swap');
  const pendingLogin = useRef(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBridge, setWalletBridge] = useState<PrivyWalletBridge | null>(null);
  const [draft, setDraft] = useState<SwapDraft>(DEFAULT_DRAFT);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [swapPrefillNote, setSwapPrefillNote] = useState(false);

  const privyAuth = usePrivyAuth();
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
            {/* Tab switcher */}
            <div className="hf-human-tabs-wrap">
              <div className="hf-tabs">
                <button
                  className={`hf-tab ${humanTab === 'swap' ? 'hf-tab-active' : ''}`}
                  onClick={() => setHumanTab('swap')}
                >
                  Swap
                </button>
                <button
                  className={`hf-tab ${humanTab === 'earn' ? 'hf-tab-active' : ''}`}
                  onClick={() => setHumanTab('earn')}
                >
                  Earn
                </button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {humanTab === 'swap' && (
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
                  prefillNote={swapPrefillNote}
                  onPrefillNoteDismiss={() => setSwapPrefillNote(false)}
                />
              )}

              {humanTab === 'earn' && (
                <EarnView
                  walletBridge={walletBridge}
                  activeWalletAddress={activeWalletAddress}
                  onBack={handleBack}
                  onGetMore={(toChain, toTokenSymbol) => {
                    setDraft((prev) => ({ ...prev, toChain, toTokenSymbol, amount: '' }));
                    setSwapPrefillNote(true);
                    setHumanTab('swap');
                  }}
                />
              )}
            </AnimatePresence>
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
            <button className="hf-earn-detail-close" onClick={() => setPrivacyOpen(false)}>✕</button>
            <h2 className="hf-privacy-title">Privacy Policy</h2>
            <p className="hf-privacy-updated">Last updated: April 9, 2026</p>

            <div className="hf-privacy-body">
              <h3>1. Introduction</h3>
              <p>
                HopFast (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is a decentralized finance (DeFi) aggregator interface
                that enables users to swap tokens across blockchains and deposit into yield-bearing vaults.
                This Privacy Policy explains how we handle information when you use our application at hopfast.xyz.
              </p>

              <h3>2. Information We Collect</h3>
              <p><strong>Wallet Addresses:</strong> When you connect your wallet, we receive your public blockchain address. This is inherently public on-chain data and is used solely to facilitate transactions and display your positions.</p>
              <p><strong>Transaction Data:</strong> We store records of earn deposits you execute through our platform (vault address, token, amount, and transaction hash) in our database to display your position history. This data is also publicly available on the blockchain.</p>
              <p><strong>No Personal Data:</strong> We do not collect names, email addresses, phone numbers, IP addresses, or any personally identifiable information (PII). We do not require account registration.</p>

              <h3>3. How We Use Your Information</h3>
              <p>The limited data we collect is used exclusively to:</p>
              <ul>
                <li>Display your earn positions and transaction history within the app</li>
                <li>Facilitate token swaps and earn deposits through third-party protocols</li>
                <li>Improve the functionality and reliability of our service</li>
              </ul>

              <h3>4. Third-Party Services</h3>
              <p>
                HopFast integrates with third-party DeFi protocols and aggregators including but not limited to
                LI.FI, Squid Router, and deBridge. When you execute a swap or deposit, your transaction is routed
                through these services. Each has its own privacy policy and terms of service. We encourage you to
                review them independently.
              </p>
              <p>
                We also use Privy for wallet authentication. Privy may collect certain device and session data
                in accordance with their own privacy policy.
              </p>

              <h3>5. Data Storage &amp; Security</h3>
              <p>
                Position records are stored in a MongoDB database. We do employ security measures
                to protect stored user data. However, no system is 100% secure, and we cannot guarantee absolute security.
                You can delete your position records from our database at any time via the &quot;Your Positions&quot; tab.
              </p>

              <h3>6. Cookies &amp; Tracking</h3>
              <p>
                We do not use cookies, analytics trackers, or any third-party tracking scripts.
                We do not serve advertisements.
              </p>

              <h3>7. Blockchain Data</h3>
              <p>
                All transactions executed through HopFast are recorded on public blockchains.
                Blockchain transactions are permanent and publicly visible. We have no ability to modify
                or delete on-chain data.
              </p>

              <h3>8. Your Rights</h3>
              <p>You have the right to:</p>
              <ul>
                <li>Disconnect your wallet at any time</li>
                <li>Delete your position records from our database</li>
                <li>Use the application without providing any personal information</li>
              </ul>

              <h3>9. Children&apos;s Privacy</h3>
              <p>
                HopFast is not intended for use by individuals under the age of 18.
                We do not knowingly collect data from minors.
              </p>

              <h3>10. Changes to This Policy</h3>
              <p>
                We may update this Privacy Policy from time to time. Changes will be reflected on this page
                with an updated revision date. Continued use of the application constitutes acceptance
                of the revised policy.
              </p>

              <h3>11. Contact</h3>
              <p>
                For questions or concerns about this Privacy Policy, reach out via
                Telegram: <a href="https://t.me/promitsaha" target="_blank" rel="noopener noreferrer">@promitsaha</a>
              </p>
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

export default App;
