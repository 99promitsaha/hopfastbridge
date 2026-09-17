import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowUpDown, Check, CheckCircle2, ChevronDown, ExternalLink,
  History, Info, Loader2, Radio, RefreshCw, X, Zap
} from 'lucide-react';
import { TokenSelector } from './TokenSelector';
import { formatUnits, formatUsd, parseUnits } from '../lib/amount';
import { CHAINS, CHAIN_BY_KEY, getDefaultToken, type ChainKey } from '../lib/chains';
import { computeUsdValue } from '../services/priceService';
import { isNativeToken } from '../lib/erc20';
import { isValidSwapInput, makeBalanceKey, getDifferentToken, resolveToken } from '../lib/swap';
import {
  BLOCK_EXPLORER, LIVE_PROVIDERS, PROVIDER_META,
  QUOTE_REFRESH_INTERVAL_S, TX_STAGES
} from '../constants';
import type { ProviderKey, SwapDraft, TxStatus, TxStage } from '../types';
import type { QuoteResult } from '../services/quoteService';
import type { PrivyWalletBridge } from './WalletConnector';

interface SwapViewProps {
  draft: SwapDraft;
  setDraft: React.Dispatch<React.SetStateAction<SwapDraft>>;
  quotes: Partial<Record<ProviderKey, QuoteResult | null>>;
  quotingProviders: Set<ProviderKey>;
  retryingProviders: Set<ProviderKey>;
  selectedProvider: ProviderKey | null;
  setSelectedProvider: (p: ProviderKey) => void;
  quoteCountdown: number | null;
  isQuoting: boolean;
  bestQuote: QuoteResult | null;
  fetchQuote: (draft: SwapDraft) => void;
  triggerFetchImmediate: (draft: SwapDraft) => void;
  prices: Record<string, number>;
  tokenBalances: Record<string, bigint>;
  formattedSourceBalances: Record<string, string>;
  balanceError: string;
  isRefreshingBalances: boolean;
  walletBridge: PrivyWalletBridge | null;
  activeWalletAddress: string | null;
  isExecuting: boolean;
  txStatus: TxStatus | null;
  error: string;
  executeSwap: () => void;
  onBack: () => void;
  onToggleHistory: () => void;
  onTxStatusClear: () => void;
}

export function SwapView({
  draft, setDraft,
  quotes, quotingProviders, retryingProviders, selectedProvider, setSelectedProvider,
  quoteCountdown, isQuoting, bestQuote,
  fetchQuote, triggerFetchImmediate,
  prices, tokenBalances, formattedSourceBalances, balanceError, isRefreshingBalances,
  walletBridge, activeWalletAddress,
  isExecuting, txStatus, error,
  executeSwap, onBack, onToggleHistory, onTxStatusClear,
}: SwapViewProps) {
  const [showFromChainModal, setShowFromChainModal] = useState(false);
  const [showToChainModal, setShowToChainModal] = useState(false);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);

  const fromChain = CHAIN_BY_KEY[draft.fromChain];
  const toChain = CHAIN_BY_KEY[draft.toChain];
  const fromTokenOptions = useMemo(() => fromChain.tokens, [fromChain]);
  const toTokenOptions = useMemo(() => toChain.tokens, [toChain]);

  const sortedFromTokenOptions = useMemo(() => {
    const indexedTokens = fromTokenOptions.map((token, index) => ({
      token,
      index,
      balance: tokenBalances[makeBalanceKey(draft.fromChain, token.address)] ?? null
    }));
    indexedTokens.sort((left, right) => {
      const leftHasNonZero = left.balance != null && left.balance > 0n;
      const rightHasNonZero = right.balance != null && right.balance > 0n;
      if (leftHasNonZero !== rightHasNonZero) return leftHasNonZero ? -1 : 1;
      return left.index - right.index;
    });
    return indexedTokens.map((entry) => entry.token);
  }, [draft.fromChain, fromTokenOptions, tokenBalances]);

  const selectedFromToken = fromTokenOptions.find((t) => t.symbol === draft.fromTokenSymbol) ?? fromTokenOptions[0];
  const selectedToToken = toTokenOptions.find((t) => t.symbol === draft.toTokenSymbol) ?? toTokenOptions[0];
  const hasConnectedWallet = Boolean(activeWalletAddress);

  const selectedBalanceKey = makeBalanceKey(draft.fromChain, selectedFromToken.address);
  const selectedSourceBalanceRaw = tokenBalances[selectedBalanceKey];
  const selectedSourceBalance = selectedSourceBalanceRaw != null
    ? formatUnits(selectedSourceBalanceRaw, selectedFromToken.decimals, 6)
    : null;

  const requestedAmountRaw = useMemo(() => {
    const amount = draft.amount.trim();
    if (!amount) return null;
    try {
      return parseUnits(amount, selectedFromToken.decimals);
    } catch {
      return null;
    }
  }, [draft.amount, selectedFromToken.decimals]);

  const isAmountInsufficient =
    hasConnectedWallet
    && requestedAmountRaw != null
    && selectedSourceBalanceRaw != null
    && requestedAmountRaw > selectedSourceBalanceRaw;

  const isBalanceUnknown = hasConnectedWallet && selectedSourceBalanceRaw == null;
  const shouldGateForBalanceCheck = hasConnectedWallet && !balanceError && (isRefreshingBalances || isBalanceUnknown);

  // ─── Fit Gas ──────────────────────────────────────────────────────────
  // Use the MAX gas cost observed across all returned quotes (safest — if the
  // user ends up routing through the most expensive provider, we still have
  // enough left for gas). Only considered when the source token IS the
  // native asset — gas is paid in native, so for ERC-20 swaps there's no
  // "fit gas" problem (user still has native balance separately).
  const maxGasCostWei = useMemo<bigint | null>(() => {
    if (!isNativeToken(selectedFromToken.address)) return null;
    let max = 0n;
    for (const provider of LIVE_PROVIDERS) {
      const q = quotes[provider];
      const tx = q?.transactionRequest;
      if (!tx?.gasLimit) continue;
      try {
        const limit = BigInt(tx.gasLimit);
        const price = tx.maxFeePerGas
          ? BigInt(tx.maxFeePerGas)
          : tx.gasPrice
            ? BigInt(tx.gasPrice)
            : 0n;
        if (price === 0n) continue;
        const cost = limit * price;
        if (cost > max) max = cost;
      } catch { /* malformed numeric string — skip */ }
    }
    return max > 0n ? max : null;
  }, [quotes, selectedFromToken.address]);

  // Warn when the user is spending enough of their native balance that gas
  // might not fit. Heuristic (≥95 %) is used before any quote arrives — once
  // quotes come back, we replace it with the exact `amount + maxGas > balance`
  // check. That way, after the user hits "Fit gas", the entered amount =
  // balance − (maxGas * 1.15), so the precise check returns false and the
  // warning auto-dismisses on the next render.
  const isGasTokenRisk =
    hasConnectedWallet
    && isNativeToken(selectedFromToken.address)
    && requestedAmountRaw != null
    && selectedSourceBalanceRaw != null
    && selectedSourceBalanceRaw > 0n
    && (
      maxGasCostWei != null
        // Precise check once we have quote gas data.
        ? requestedAmountRaw + maxGasCostWei > selectedSourceBalanceRaw
        // Fallback before any quote arrives.
        : requestedAmountRaw * 100n >= selectedSourceBalanceRaw * 95n
    );

  // Show the "Fit gas" chip only when: native source token, balance known,
  // amount entered, at least one quote returned (so gas math is real), and
  // the current entry would leave no headroom for gas. Hide when we'd have
  // to reduce the amount to ≤0 after accounting for gas (unfittable).
  const canFitGas =
    hasConnectedWallet
    && isNativeToken(selectedFromToken.address)
    && selectedSourceBalanceRaw != null
    && selectedSourceBalanceRaw > 0n
    && requestedAmountRaw != null
    && requestedAmountRaw > 0n
    && maxGasCostWei != null
    && requestedAmountRaw + maxGasCostWei > selectedSourceBalanceRaw
    // 15% buffer applied on click; only offer the chip if a positive amount
    // would remain after the buffered gas reserve.
    && (maxGasCostWei * 115n) / 100n < selectedSourceBalanceRaw;

  const handleFitGas = () => {
    if (!canFitGas || selectedSourceBalanceRaw == null || maxGasCostWei == null) return;
    // 15% safety cushion on top of the worst observed gas — native prices can
    // drift between quote fetch and signature, and the user's wallet may
    // bump gasPrice slightly on submission.
    const reserve = (maxGasCostWei * 115n) / 100n;
    if (reserve >= selectedSourceBalanceRaw) return;
    const fitted = selectedSourceBalanceRaw - reserve;
    const amount = formatUnits(fitted, selectedFromToken.decimals, selectedFromToken.decimals);
    const next = { ...draft, amount };
    setDraft(next);
    triggerFetchImmediate(next);
    onTxStatusClear();
  };

  const fromUsd = computeUsdValue(prices, draft.fromTokenSymbol, draft.amount);
  const toUsd = bestQuote?.destinationAmount
    ? computeUsdValue(prices, draft.toTokenSymbol, bestQuote.destinationAmount)
    : null;

  const swapDirections = () => {
    const next: SwapDraft = {
      ...draft,
      fromChain: draft.toChain,
      toChain: draft.fromChain,
      fromTokenSymbol: resolveToken(draft.toChain, draft.toTokenSymbol),
      toTokenSymbol: resolveToken(draft.fromChain, draft.fromTokenSymbol),
    };
    setDraft(next);
    onTxStatusClear();
    triggerFetchImmediate(next);
  };

  // If the user's current token is the native coin of the chain they're leaving,
  // map it to the native coin of the destination chain instead of preserving the
  // symbol. Without this, switching to BNB Chain resolves "ETH" to Binance-pegged
  // ETH (which exists on BSC) rather than defaulting to BNB.
  const mapNativeAcrossChains = (
    currentChain: ChainKey,
    nextChain: ChainKey,
    symbol: string
  ): string => {
    const currentNative = getDefaultToken(currentChain).symbol;
    const nextNative = getDefaultToken(nextChain).symbol;
    if (symbol === currentNative && currentNative !== nextNative) return nextNative;
    return resolveToken(nextChain, undefined, symbol);
  };

  const updateFromChain = (chain: ChainKey) => {
    const isSameChain = draft.toChain === chain;
    const fromTokenSymbol = mapNativeAcrossChains(draft.fromChain, chain, draft.fromTokenSymbol);
    const toTokenSymbol = isSameChain
      ? getDifferentToken(chain, fromTokenSymbol)
      : resolveToken(draft.toChain, undefined, draft.toTokenSymbol);
    // Reset amount: the numeric value only made sense for the previous source
    // asset (e.g. "100" means something very different for ETH vs UNI). Forcing
    // the user to re-enter prevents accidentally quoting a wildly wrong size.
    const next: SwapDraft = { ...draft, fromChain: chain, fromTokenSymbol, toTokenSymbol, amount: '' };
    setDraft(next);
    triggerFetchImmediate(next);
  };

  const updateToChain = (chain: ChainKey) => {
    const isSameChain = draft.fromChain === chain;
    const fromTokenSymbol = resolveToken(draft.fromChain, undefined, draft.fromTokenSymbol);
    const toTokenSymbol = isSameChain
      ? getDifferentToken(chain, fromTokenSymbol)
      : mapNativeAcrossChains(draft.toChain, chain, draft.toTokenSymbol);
    const next: SwapDraft = { ...draft, toChain: chain, fromTokenSymbol, toTokenSymbol };
    setDraft(next);
    triggerFetchImmediate(next);
  };

  const CLOSE_AFTER_S = 8;
  const [closeCountdown, setCloseCountdown] = useState<number | null>(null);
  const closeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const isTerminal = txStatus?.stage === 'completed' || txStatus?.stage === 'failed';
    if (!isTerminal) {
      if (closeIntervalRef.current) { clearInterval(closeIntervalRef.current); closeIntervalRef.current = null; }
      setCloseCountdown(null);
      return;
    }
    setCloseCountdown(CLOSE_AFTER_S);
    closeIntervalRef.current = setInterval(() => {
      setCloseCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (closeIntervalRef.current) clearInterval(closeIntervalRef.current);
          onTxStatusClear();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (closeIntervalRef.current) { clearInterval(closeIntervalRef.current); closeIntervalRef.current = null; }
    };
  }, [txStatus?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Truncate a decimal string to at most 5 places for display only.
   *  The underlying value in state is never touched. */
  const truncateDisplay = (value: string, places = 5): string => {
    if (!value) return value;
    const dot = value.indexOf('.');
    if (dot === -1) return value;
    return value.slice(0, dot + places + 1);
  };

  const stageIdx = (stage: TxStage | undefined) =>
    TX_STAGES.findIndex((s) => s.key === stage);

  /** Map LI.FI substatus codes to a user-facing explanation. */
  const humanSubstatus = (sub?: string): string => {
    if (!sub) return 'The transaction failed. Check the explorer link for details.';
    const key = sub.toUpperCase();
    switch (key) {
      case 'NOT_PROCESSABLE_REFUND_NEEDED':
        return 'The swap couldn\'t complete on the destination and a refund is needed.';
      case 'OUT_OF_GAS':
        return 'The transaction ran out of gas. Try again with a higher gas limit.';
      case 'SLIPPAGE_EXCEEDED':
        return 'Price moved beyond your slippage tolerance. Try again — we\'ll refresh the quote.';
      case 'INSUFFICIENT_ALLOWANCE':
        return 'Token allowance was too low. Please re-approve and retry.';
      case 'INSUFFICIENT_BALANCE':
        return 'Your wallet balance wasn\'t enough to complete the swap.';
      case 'EXPIRED':
        return 'The quote expired before the transaction confirmed. Try again.';
      case 'REFUNDED':
        return 'Tokens were refunded to your wallet.';
      case 'UNKNOWN_ERROR':
        return 'The swap failed for an unknown reason. Check the explorer link for details.';
      default:
        // Already-humanised message (from LI.FI substatusMessage or our own fallback)
        return sub;
    }
  };

  // ── Quote panel state ──
  const anyQuote = PROVIDER_META.some(({ key }) => quotes[key] != null);
  const showLoadingCard = isQuoting && !anyQuote && isValidSwapInput(draft);
  const showQuotesPanel = showLoadingCard || anyQuote;

  /** ID of the quote with the lowest fee — independent of user selection. */
  const objectivelyBestId = useMemo(() => {
    const available = PROVIDER_META
      .map(({ key }) => quotes[key])
      .filter((q): q is QuoteResult => q != null);
    if (!available.length) return null;
    return available.reduce((best, q) => q.feeUsd < best.feeUsd ? q : best).id;
  }, [quotes]);

  const sortedRoutes = useMemo(() => [...PROVIDER_META]
    .map(({ key, label, logo }) => ({
      key, label, logo,
      pQuote: quotes[key],
      pLoading: quotingProviders.has(key) || retryingProviders.has(key),
      definitivelyFailed: !(quotingProviders.has(key) || retryingProviders.has(key)) && key in quotes && quotes[key] === null,
    }))
    .sort((a, b) => {
      const aIsBest = objectivelyBestId != null && a.pQuote?.id === objectivelyBestId;
      const bIsBest = objectivelyBestId != null && b.pQuote?.id === objectivelyBestId;
      if (aIsBest) return -1;
      if (bIsBest) return 1;
      // Non-best routes: lowest fee first
      return (a.pQuote?.feeUsd ?? Infinity) - (b.pQuote?.feeUsd ?? Infinity);
    })
  , [quotes, quotingProviders, objectivelyBestId]);

  return (
    <motion.div
      key="swap"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
    >
      <div className="hf-fadeup hf-swap-wrap">
        <div className="hf-swap-column">
        <div className="hf-swap-card">
          {/* Back — top-left */}
          <button
            className="hf-card-corner-btn"
            onClick={onBack}
            type="button"
            aria-label="Back to home"
            title="Back"
          >
            <X size={15} strokeWidth={2.5} />
          </button>

          {/* History — top-right */}
          <button
            className="hf-card-corner-btn hf-card-corner-btn--right"
            onClick={onToggleHistory}
            type="button"
            aria-label="Transaction history"
            title="Transaction History"
          >
            <History size={15} strokeWidth={2} />
          </button>

          <h3 className="hf-swap-title">Hop. <span>At Light Speed 🐰</span></h3>
          <div className="hf-provider-powered">
            Powered by
            <img src="/providers/lifi.png" alt="LI.FI" className="hf-provider-powered-logo" />
            <img src="/providers/squid.ico" alt="Squid" className="hf-provider-powered-logo" />
          </div>

          {/* Quote Refresh Countdown */}
          <AnimatePresence>
            {quoteCountdown != null && quoteCountdown > 0 && !isQuoting && (
              <motion.div
                className="hf-quote-island"
                initial={{ opacity: 0, y: -8, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              >
                <svg className="hf-quote-island-ring" viewBox="0 0 24 24">
                  <circle
                    className="hf-quote-island-ring-track"
                    cx="12" cy="12" r="10"
                    fill="none" strokeWidth="2"
                  />
                  <circle
                    className="hf-quote-island-ring-fill"
                    cx="12" cy="12" r="10"
                    fill="none" strokeWidth="2.5"
                    strokeDasharray={2 * Math.PI * 10}
                    strokeDashoffset={2 * Math.PI * 10 * (1 - quoteCountdown / QUOTE_REFRESH_INTERVAL_S)}
                    strokeLinecap="round"
                  />
                </svg>
                <RefreshCw size={10} className="hf-quote-island-icon" />
                <span className="hf-quote-island-text">
                  Quotes refresh in <strong>{quoteCountdown}s</strong>
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Unified swap fields card */}
          <div className="hf-swap-fields">

            {/* You Pay */}
            <div className="hf-field-group hf-field-group--top">
              <div className="hf-field-header">
                <span className="hf-field-kicker">You pay</span>
                <button
                  className="hf-chain-btn"
                  onClick={() => setShowFromChainModal(true)}
                  aria-label="Select source network"
                >
                  <img
                    src={fromChain.logoURI}
                    alt={fromChain.name}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {fromChain.name}
                  <ChevronDown size={11} />
                </button>
              </div>
              <div className="hf-field-row">
                <input
                  className="hf-amount-input"
                  value={truncateDisplay(draft.amount)}
                  onChange={(e) => {
                    setDraft((c) => ({ ...c, amount: e.target.value }));
                    onTxStatusClear();
                  }}
                  inputMode="decimal"
                  placeholder="0.0"
                />
                <TokenSelector
                  label="source"
                  selectedToken={selectedFromToken}
                  tokens={sortedFromTokenOptions}
                  chain={fromChain}
                  chains={CHAINS}
                  onSelectToken={(s) => {
                    // Reset amount — the number only made sense for the previous
                    // source token. Keeping "100" when swapping ETH→UNI would
                    // quote ~$325 worth instead of ~$325k (or vice versa).
                    const next = { ...draft, fromTokenSymbol: s, amount: '' };
                    setDraft(next);
                    triggerFetchImmediate(next);
                    onTxStatusClear();
                  }}
                  onSelectChain={(k) => updateFromChain(k as ChainKey)}
                  chainModalOpen={showFromChainModal}
                  onChainModalClose={() => setShowFromChainModal(false)}
                  balances={formattedSourceBalances}
                />
              </div>
              <div className="hf-field-foot">
                {fromUsd ? (
                  <span className="hf-field-usd-main">≈ ${fromUsd.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                ) : <span />}
                {hasConnectedWallet && selectedSourceBalance == null && isBalanceUnknown && (
                  <span className="hf-skeleton hf-balance-skeleton" aria-hidden="true">&nbsp;</span>
                )}
                {hasConnectedWallet && selectedSourceBalance != null && (
                  <div className="hf-balance-actions">
                    {isAmountInsufficient && <span className="hf-balance-alert">Insufficient</span>}
                    <span className="hf-balance-hint">{selectedSourceBalance} {selectedFromToken.symbol}</span>
                    <button type="button" className="hf-pct-btn" onClick={() => {
                      if (selectedSourceBalanceRaw == null) return;
                      const next = { ...draft, amount: formatUnits(selectedSourceBalanceRaw / 2n, selectedFromToken.decimals, selectedFromToken.decimals) };
                      setDraft(next); triggerFetchImmediate(next); onTxStatusClear();
                    }}>50%</button>
                    <button type="button" className="hf-pct-btn" onClick={() => {
                      if (selectedSourceBalanceRaw == null) return;
                      const next = { ...draft, amount: formatUnits(selectedSourceBalanceRaw, selectedFromToken.decimals, selectedFromToken.decimals) };
                      setDraft(next); triggerFetchImmediate(next); onTxStatusClear();
                    }}>MAX</button>
                    {canFitGas && (
                      <button
                        type="button"
                        className="hf-pct-btn hf-fit-gas-btn"
                        onClick={handleFitGas}
                        title={`Deduct the highest observed gas estimate (${formatUnits(maxGasCostWei!, selectedFromToken.decimals, 6)} ${selectedFromToken.symbol}) + 15% buffer from your input so the tx has enough native balance left for gas.`}
                      >
                        Fit gas
                      </button>
                    )}
                  </div>
                )}
              </div>
              {isGasTokenRisk && (
                <p className="hf-gas-warning">
                  ⚠ You're spending nearly all your {selectedFromToken.symbol}.{' '}
                  {canFitGas
                    ? <>Tap <strong>Fit gas</strong> to auto-reserve enough for the transaction fee.</>
                    : <>Keep some for gas or this transaction will fail.</>}
                </p>
              )}
            </div>

            {/* Swap Direction — sits on the divider between the two fields */}
            <div className="hf-switch-anchor">
              <button className="hf-switch-btn" onClick={swapDirections} aria-label="Switch direction">
                <ArrowUpDown size={14} />
              </button>
            </div>

            {/* You Receive */}
            <div className="hf-field-group hf-field-group--bottom">
              <div className="hf-field-header">
                <span className="hf-field-kicker">You receive</span>
                <button
                  className="hf-chain-btn"
                  onClick={() => setShowToChainModal(true)}
                  aria-label="Select destination network"
                >
                  <img
                    src={toChain.logoURI}
                    alt={toChain.name}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {toChain.name}
                  <ChevronDown size={11} />
                </button>
              </div>
              <div className="hf-field-row">
                <input
                  className="hf-amount-input"
                  readOnly
                  value={truncateDisplay(bestQuote?.destinationAmount ?? '')}
                  placeholder={isQuoting ? 'Fetching...' : '0.0'}
                  style={isQuoting ? { opacity: 0.5 } : undefined}
                />
                <TokenSelector
                  label="destination"
                  selectedToken={selectedToToken}
                  tokens={toTokenOptions}
                  chain={toChain}
                  chains={CHAINS}
                  onSelectToken={(s) => {
                    const next = { ...draft, toTokenSymbol: s };
                    setDraft(next);
                    triggerFetchImmediate(next);

                  }}
                  onSelectChain={(k) => updateToChain(k as ChainKey)}
                  chainModalOpen={showToChainModal}
                  onChainModalClose={() => setShowToChainModal(false)}
                />
              </div>
              <div className="hf-field-foot">
                {toUsd ? (
                  <span className="hf-field-usd-main">≈ ${toUsd.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                ) : <span />}
              </div>
            </div>

          </div>{/* end .hf-swap-fields */}

          {/* Action button — always in the card */}
          <button
            className="hf-btn hf-btn-primary hf-btn-wide"
            onClick={bestQuote && !isQuoting ? executeSwap : () => fetchQuote(draft)}
            disabled={
              isExecuting || isAmountInsufficient || shouldGateForBalanceCheck ||
              (!(bestQuote && !isQuoting) && (isQuoting || !isValidSwapInput(draft)))
            }
          >
            {isExecuting ? (
              <><Loader2 size={14} className="hf-spin" /> Bridging…</>
            ) : bestQuote && !isQuoting && !walletBridge ? (
              <>Connect wallet to bridge</>
            ) : bestQuote && !isQuoting ? (
              <><Zap size={14} /> Bridge now</>
            ) : isQuoting ? (
              <><Loader2 size={14} className="hf-spin" /> Finding best route…</>
            ) : (
              <><Zap size={14} /> Get quote</>
            )}
          </button>

          {/* Transaction Progress */}
          {txStatus && (() => {
            const isCrossChain = draft.fromChain !== draft.toChain;
            const destChainLabel = CHAIN_BY_KEY[draft.toChain].name;
            const srcChainLabel = CHAIN_BY_KEY[draft.fromChain].name;
            const bridgingHint =
              isCrossChain && txStatus.stage === 'bridging'
                ? `Bridging to ${destChainLabel} — this usually takes 1–3 minutes.`
                : isCrossChain && txStatus.stage === 'confirming'
                ? `Waiting for ${srcChainLabel} confirmations…`
                : null;

            return (
            <div className="hf-tx-progress hf-fadeup">
              <div className="hf-tx-progress-header">
                <span className="hf-tx-progress-title">
                  {txStatus.stage === 'completed' ? '✅ Swap Complete' :
                   txStatus.stage === 'failed' ? '❌ Swap Failed' :
                   '⏳ In-progress'}
                </span>
                <a
                  href={`${BLOCK_EXPLORER[draft.fromChain]}${txStatus.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hf-tx-hash"
                >
                  {txStatus.hash.slice(0, 8)}…{txStatus.hash.slice(-6)}
                  <ExternalLink size={9} style={{ marginLeft: '0.2rem', verticalAlign: 'middle' }} />
                </a>
              </div>

              <div className="hf-progress-track">
                <div
                  className={`hf-progress-fill ${
                    txStatus.stage === 'failed' ? 'hf-progress-fill-failed' :
                    txStatus.stage !== 'completed' ? 'hf-progress-fill-animated' : ''
                  }`}
                  style={{ width: `${txStatus.progress}%` }}
                />
              </div>

              {txStatus.stage === 'failed' && (
                <p className="hf-tx-failure-note">
                  {humanSubstatus(txStatus.substatus)}
                </p>
              )}

              {bridgingHint && (
                <p className="hf-tx-info-note">{bridgingHint}</p>
              )}

              {/* Cross-chain: show destination tx link once it lands, plus LI.FI explorer */}
              {isCrossChain && (txStatus.receivingTxHash || txStatus.lifiExplorerLink) && (
                <div className="hf-tx-links">
                  {txStatus.receivingTxHash && BLOCK_EXPLORER[draft.toChain] && (
                    <a
                      href={`${BLOCK_EXPLORER[draft.toChain]}${txStatus.receivingTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hf-tx-link-pill"
                    >
                      Destination tx on {destChainLabel}
                      <ExternalLink size={10} />
                    </a>
                  )}
                  {txStatus.lifiExplorerLink && txStatus.lifiExplorerLink.startsWith('https://scan.li.fi/') && (
                    <a
                      href={txStatus.lifiExplorerLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hf-tx-link-pill"
                    >
                      LI.FI Explorer
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}

              <div className="hf-tx-steps">
                {TX_STAGES.map((step, i) => {
                  const currentIdx = stageIdx(txStatus.stage);
                  const isDone = i < currentIdx || txStatus.stage === 'completed';
                  const isActive = i === currentIdx && txStatus.stage !== 'completed';
                  return (
                    <div key={step.key} className="hf-tx-step">
                      <div className={`hf-tx-step-dot ${
                        isDone ? 'hf-tx-step-dot-done' :
                        isActive ? 'hf-tx-step-dot-active' :
                        'hf-tx-step-dot-pending'
                      }`}>
                        {isDone ? <CheckCircle2 size={10} /> :
                         isActive ? <Radio size={10} /> :
                         <span>{i + 1}</span>}
                      </div>
                      <span className={`hf-tx-step-label ${isActive ? 'hf-tx-step-label-active' : ''}`}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {closeCountdown != null && (
                <div className="hf-tx-close-row">
                  <svg width="16" height="16" viewBox="0 0 18 18">
                    <circle cx="9" cy="9" r="7" fill="none" stroke="var(--hf-border)" strokeWidth="1.5" />
                    <circle
                      cx="9" cy="9" r="7" fill="none"
                      stroke="var(--hf-text-muted)" strokeWidth="1.5"
                      strokeDasharray={2 * Math.PI * 7}
                      strokeDashoffset={2 * Math.PI * 7 * (1 - closeCountdown / CLOSE_AFTER_S)}
                      strokeLinecap="round"
                      transform="rotate(-90 9 9)"
                      style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                    />
                  </svg>
                  <span>Closes in {closeCountdown}s</span>
                </div>
              )}
            </div>
            );
          })()}

          {bestQuote?.warning && (
            <p className="hf-note hf-note-warning">{bestQuote.warning}</p>
          )}
          {balanceError && (
            <p className="hf-note hf-note-warning">Balance check: {balanceError}</p>
          )}
          {error && (
            <p className="hf-note hf-note-error">{error}</p>
          )}
        </div>

        <div className="hf-beta-notice" role="note">
          <span>⚠ Safety Disclosure: Unaudited Beta Product. Use At Your Own Risk.</span>
        </div>
        </div>

        {/* ── Quotes panel — routes + fee detail ── */}
        <AnimatePresence>
          {showQuotesPanel && (
            <motion.div
              className="hf-quotes-panel"
              key="quotes-panel"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            >
              <p className="hf-routes-panel-label">Routes</p>

              <div className="hf-routes-section">
                {showLoadingCard ? (
                  <div className="hf-route-loading-card">
                    <Loader2 size={12} className="hf-spin" />
                    <span>Finding best route…</span>
                  </div>
                ) : (
                  sortedRoutes.map(({ key, label, logo, pQuote, pLoading, definitivelyFailed }) => {
                    if (definitivelyFailed || (!pQuote && !pLoading)) return null;
                    const isBest = objectivelyBestId != null && pQuote?.id === objectivelyBestId;
                    const isSelected = selectedProvider === key;
                    // Allow selection whenever a quote is displayed. Previously
                    // `!pLoading` gated this, which silently dropped clicks on
                    // whichever provider was still re-quoting during the 60 s
                    // refresh.
                    // resolves last. A background refresh shouldn't block the
                    // user's intent to pick a provider they can already see.
                    const canSelect = pQuote != null;
                    const isExpanded = expandedRoute === key;
                    const exchangeRate = pQuote && parseFloat(draft.amount || '0') > 0
                      ? (parseFloat(pQuote.destinationAmount) / parseFloat(draft.amount)).toFixed(6)
                      : null;
                    return (
                      <div
                        key={key}
                        className={`hf-route-card ${isBest ? 'hf-route-card--best' : 'hf-route-card--alt'}${isSelected && !isBest ? ' hf-route-card--selected' : ''}${canSelect ? ' hf-route-card--clickable' : ''}`}
                      >
                        {isBest && <span className="hf-route-best-badge">Best</span>}
                        {isSelected && !isBest && <span className="hf-route-selected-badge">Selected</span>}
                        {/* Main row */}
                        <div
                          className="hf-route-main-row"
                          onClick={() => {
                            if (canSelect) setSelectedProvider(key);
                            if (pQuote) setExpandedRoute(isExpanded ? null : key);
                          }}
                        >
                          <div className="hf-route-left">
                            <img src={logo} alt={label} className="hf-route-logo" />
                            <div className="hf-route-provider-wrap">
                              <span className="hf-route-provider-name">{label}</span>
                              {pLoading && <Loader2 size={9} className="hf-spin hf-route-spinner" />}
                            </div>
                          </div>
                          <div className="hf-route-right">
                            {pQuote ? (
                              <>
                                <div className="hf-route-right-top">
                                  <span className="hf-route-amount">{truncateDisplay(pQuote.destinationAmount)} {selectedToToken.symbol}</span>
                                  <ChevronDown
                                    size={13}
                                    className="hf-route-chevron"
                                    style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
                                  />
                                </div>
                                <span className="hf-route-meta">{formatUsd(pQuote.feeUsd)} fee · ~{pQuote.etaSeconds}s</span>
                              </>
                            ) : (
                              <span className="hf-skeleton hf-route-skeleton">&nbsp;</span>
                            )}
                          </div>
                        </div>

                        {/* Expandable detail drawer */}
                        <AnimatePresence>
                          {isExpanded && pQuote && (
                            <motion.div
                              className="hf-route-detail"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2, ease: 'easeInOut' }}
                            >
                              <div className="hf-route-detail-rows">
                                <div className="hf-route-detail-row">
                                  <span>Fee</span>
                                  <span>{formatUsd(pQuote.feeUsd)} ({pQuote.feePercent > 0 ? `${pQuote.feePercent.toFixed(2)}%` : '<0.01%'})</span>
                                </div>
                                {pQuote.destinationAmountMin && (
                                  <div className="hf-route-detail-row">
                                    <span>Min. received</span>
                                    <span>{truncateDisplay(pQuote.destinationAmountMin)} {selectedToToken.symbol}</span>
                                  </div>
                                )}
                                {exchangeRate && (
                                  <div className="hf-route-detail-row">
                                    <span>Rate</span>
                                    <span>1 {selectedFromToken.symbol} ≈ {exchangeRate} {selectedToToken.symbol}</span>
                                  </div>
                                )}
                                <div className="hf-route-detail-row">
                                  <span>Est. time</span>
                                  <span>~{pQuote.etaSeconds}s</span>
                                </div>
                                {pQuote.route && !/^[A-Z0-9][A-Z0-9_.]*[_][A-Z0-9]/.test(pQuote.route) && (
                                  <div className="hf-route-detail-row">
                                    <span>Via</span>
                                    <span className="hf-route-detail-route">{pQuote.route}</span>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })
                )}
              </div>

              {bestQuote && !isQuoting && (
                <div className="hf-fee-summary hf-fadeup">
                  <div className="hf-fee-row">
                    <span className="hf-fee-label">Service fees</span>
                    <span className="hf-fee-value">Included in route estimate</span>
                  </div>
                  <div className="hf-fee-row">
                    <span className="hf-fee-label">Min. received</span>
                    <span className="hf-fee-value">{truncateDisplay(bestQuote.destinationAmountMin ?? bestQuote.destinationAmount)} · ~{bestQuote.etaSeconds}s</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
  );
}
