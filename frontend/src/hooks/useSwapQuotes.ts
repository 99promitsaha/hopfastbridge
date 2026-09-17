import { useCallback, useEffect, useRef, useState } from 'react';
import { getSwapQuote, type QuoteResult } from '../services/quoteService';
import { isValidSwapInput } from '../lib/swap';
import { DEBOUNCE_MS, LIVE_PROVIDERS, QUOTE_REFRESH_INTERVAL_S } from '../constants';
import type { ProviderKey, SwapDraft } from '../types';

const RETRY_DELAY_MS = 3000;

export function useSwapQuotes(activeWalletAddress: string | null) {
  const [quotes, setQuotes] = useState<Partial<Record<ProviderKey, QuoteResult | null>>>({});
  const [quotingProviders, setQuotingProviders] = useState<Set<ProviderKey>>(new Set());
  const [retryingProviders, setRetryingProviders] = useState<Set<ProviderKey>>(new Set());
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey | null>(null);
  const [quoteCountdown, setQuoteCountdown] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const retryTimeoutRefs = useRef<Partial<Record<ProviderKey, ReturnType<typeof setTimeout>>>>({});
  const draftRef = useRef<SwapDraft | null>(null);
  const isExecutingRef = useRef(false);

  // Incremented on every fetchQuote call. Async callbacks check this to
  // discard results that belong to a superseded round.
  const roundRef = useRef(0);

  // How many provider fetches (initial + retries) are still in-flight for the
  // current round. Countdown starts when this reaches 0.
  const pendingRef = useRef(0);

  // Signature of the last draft we fired a fetch for. Used by the amount-change
  // debounce effect to detect "amount was changed programmatically by a path
  // that already called triggerFetchImmediate" and skip the otherwise-duplicate
  // debounced round. Without this, MAX / 50% / Fit gas / swap-direction each
  // fire *two* quote rounds across all 4 providers, which both wastes upstream
  // credit and trips Squid's 429 rate limiter.
  const lastFetchedAmountRef = useRef<string | null>(null);

  const isQuoting = quotingProviders.size > 0;

  const bestQuote = (() => {
    if (selectedProvider && quotes[selectedProvider]) return quotes[selectedProvider]!;
    const available = LIVE_PROVIDERS
      .map((p) => quotes[p])
      .filter((q): q is QuoteResult => q != null);
    if (!available.length) return null;
    return available.reduce((best, q) => (q.feeUsd < best.feeUsd ? q : best));
  })();

  const fetchQuote = useCallback(async (currentDraft: SwapDraft) => {
    if (!isValidSwapInput(currentDraft)) {
      setQuotes({});
      setSelectedProvider(null);
      return;
    }

    // Safety: never request a quote without a wallet. Backend guards against
    // zero-address recipients (Relay/LI.FI/Squid APIs can silently substitute
    // a fallback wallet when recipient=0x0), so pre-connect quoting would 400.
    // Show an empty quote panel and let the Connect button lead the UX instead.
    if (!activeWalletAddress) {
      setQuotes({});
      setSelectedProvider(null);
      setQuotingProviders(new Set());
      return;
    }

    // Cancel any pending retry timers from the previous round.
    // Note: if a retry's async fetch is already in-flight, the round guard below
    // will discard its result when it resolves.
    Object.values(retryTimeoutRefs.current).forEach((t) => t && clearTimeout(t));
    retryTimeoutRefs.current = {};

    // Bump the round so all in-flight ops from previous rounds become stale.
    const round = ++roundRef.current;

    // Record what we're fetching for, so the subsequent draft.amount useEffect
    // (which always fires when setDraft + triggerFetchImmediate are called
    // together) sees a match and bails instead of firing a duplicate round.
    lastFetchedAmountRef.current = currentDraft.amount;

    setQuotingProviders(new Set(LIVE_PROVIDERS));
    setRetryingProviders(new Set());
    setQuoteCountdown(null);

    const walletAddr = activeWalletAddress;
    pendingRef.current = LIVE_PROVIDERS.length;

    LIVE_PROVIDERS.forEach(async (provider) => {
      let initialDone = false;

      try {
        const result = await getSwapQuote({ ...currentDraft, walletAddress: walletAddr }, provider);

        // Discard if a newer round has started
        if (roundRef.current !== round) return;

        setQuotes((prev) => ({ ...prev, [provider]: result }));
        pendingRef.current--;
        if (pendingRef.current === 0) setQuoteCountdown(QUOTE_REFRESH_INTERVAL_S);

      } catch {
        // Discard if stale
        if (roundRef.current !== round) return;

        setRetryingProviders((prev) => new Set(prev).add(provider));

        retryTimeoutRefs.current[provider] = setTimeout(async () => {
          // Check again — a new round may have started during the 3s wait
          if (roundRef.current !== round) return;

          setRetryingProviders((prev) => { const s = new Set(prev); s.delete(provider); return s; });
          setQuotingProviders((prev) => new Set(prev).add(provider));

          try {
            const result = await getSwapQuote({ ...currentDraft, walletAddress: walletAddr }, provider);
            if (roundRef.current !== round) return;
            setQuotes((prev) => ({ ...prev, [provider]: result }));
          } catch {
            if (roundRef.current !== round) return;
            // Both attempts failed — definitively no route for this draft
            setQuotes((prev) => ({ ...prev, [provider]: null }));
          }

          // Cleanup for this provider's retry — only if still in our round
          if (roundRef.current !== round) return;
          setQuotingProviders((prev) => { const s = new Set(prev); s.delete(provider); return s; });
          pendingRef.current--;
          if (pendingRef.current === 0) setQuoteCountdown(QUOTE_REFRESH_INTERVAL_S);

        }, RETRY_DELAY_MS);

      } finally {
        // Only clean up quotingProviders for our own round.
        // Without this guard, a stale finally from a previous round would
        // incorrectly remove the provider from the *new* round's quoting set.
        if (roundRef.current === round && !initialDone) {
          initialDone = true;
          setQuotingProviders((prev) => { const s = new Set(prev); s.delete(provider); return s; });
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalletAddress]);

  const triggerFetchImmediate = useCallback((next: SwapDraft) => {
    setQuotes({});
    setSelectedProvider(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isValidSwapInput(next)) {
      fetchQuote(next);
    } else {
      // Reset the dedup guard. Otherwise, if a caller clears the amount
      // (e.g. updateFromChain / source-token change), the ref still holds the
      // previously-fetched value — and if the user types that same number again
      // for the new asset, setupAmountDebounce would bail and no quote would fire.
      lastFetchedAmountRef.current = null;
    }
  }, [fetchQuote]);

  const setupAmountDebounce = useCallback((draft: SwapDraft) => {
    draftRef.current = draft;
    if (!isValidSwapInput(draft)) {
      setQuotes({});
      setSelectedProvider(null);
      // Reset the dedup guard so that if the user re-enters the same amount,
      // a quote fires for it. Without this, typing "1.5" → backspace → "1.5"
      // would silently skip the second fetch.
      lastFetchedAmountRef.current = null;
      return;
    }
    // Skip when the amount is identical to the one we just fired a round for.
    // This is how programmatic setters (MAX/50%/Fit gas/swap direction) avoid
    // double-firing: they call triggerFetchImmediate synchronously, then the
    // React state update causes this effect to run — and we bail here because
    // lastFetchedAmountRef was just set by the synchronous fetchQuote call.
    // Normal typing still works: every keystroke produces a *different* amount,
    // so the debounce fires and the ref is updated on completion.
    if (draft.amount === lastFetchedAmountRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuote(draft), DEBOUNCE_MS);
  }, [fetchQuote]);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Re-quote when wallet connects so quotes include the wallet address
  useEffect(() => {
    if (activeWalletAddress && draftRef.current && isValidSwapInput(draftRef.current)) {
      fetchQuote(draftRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalletAddress]);

  // Kill countdown whenever all quotes are wiped (back nav, chain change, amount clear)
  useEffect(() => {
    const hasAnyQuote = LIVE_PROVIDERS.some((p) => quotes[p] != null);
    if (!hasAnyQuote) setQuoteCountdown(null);
  }, [quotes]);

  // Single stable interval — does NOT re-create every second.
  // Previously, having `quoteCountdown` in the deps caused the interval to be
  // cleared and re-created on every tick, which led to drift and unexpected resets.
  useEffect(() => {
    const id = setInterval(() => {
      setQuoteCountdown((prev) => {
        if (prev == null || prev <= 0) return prev; // not counting, no-op
        if (prev <= 1) {
          // Time's up — trigger a refresh
          if (draftRef.current && isValidSwapInput(draftRef.current) && !isExecutingRef.current) {
            fetchQuote(draftRef.current);
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  // Only re-create if fetchQuote changes (i.e. wallet address changed)
  }, [fetchQuote]);

  const setIsExecuting = (value: boolean) => {
    isExecutingRef.current = value;
  };

  const clearQuotes = useCallback(() => {
    setQuotes({});
    setSelectedProvider(null);
  }, []);

  return {
    quotes,
    quotingProviders,
    retryingProviders,
    selectedProvider,
    setSelectedProvider,
    quoteCountdown,
    isQuoting,
    bestQuote,
    fetchQuote,
    triggerFetchImmediate,
    setupAmountDebounce,
    clearDebounce,
    setIsExecuting,
    clearQuotes,
    draftRef,
  };
}
