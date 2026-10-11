import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrivyWalletBridge } from '../components/WalletConnector';
import type { QuoteResult } from '../services/quoteService';
import {
  pollTransactionStatus,
  stageToProgress,
  type TxStatusResult,
} from '../services/transactionStatusService';
import { parseUnits } from '../lib/amount';
import { ensureTokenApproval, isNativeToken } from '../lib/erc20';
import { toHexQuantity, validateTransactionRequest } from '../lib/swap';
import { appendBuilderCodeForChain } from '../lib/builderCode';
import { API_BASE_URL } from '../constants';
import { assertRelayExecution, relayExecutionPayload } from '../lib/relay';
import type { ChainKey } from '../lib/chains';
import type { SwapDraft, TxStatus } from '../types';

export function useSwapExecution(
  walletBridge: PrivyWalletBridge | null,
  fromChainId: number,
  onPostSwap: () => void
) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [error, setError] = useState('');

  const statusPollerRef = useRef<{ stop: () => void } | null>(null);
  const executionInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      statusPollerRef.current?.stop();
    };
  }, []);

  const startStatusPolling = useCallback(
    (
      hash: string,
      provider: string,
      fromChain: ChainKey,
      toChain: ChainKey,
      tracking?: { quoteId?: string; requestId?: string }
    ) => {
      statusPollerRef.current?.stop();

      setTxStatus({
        hash,
        fromChain,
        toChain,
        stage: 'submitted',
        progress: stageToProgress('submitted'),
      });

      statusPollerRef.current = pollTransactionStatus(
        hash,
        provider,
        fromChain,
        (result: TxStatusResult) => {
          setTxStatus((prev) => {
            if (!prev || prev.hash !== hash) return prev;
            return {
              ...prev,
              stage: result.status,
              progress: stageToProgress(result.status),
              substatus: result.substatus,
              substatusCode: result.substatusCode,
              sendingTxHash: result.sendingTxHash,
              receivingTxHash: result.receivingTxHash,
              explorerLink: result.explorerLink,
              lifiExplorerLink: result.lifiExplorerLink,
            };
          });
        },
        toChain,
        tracking
      );
    },
    []
  );

  const recordSwap = useCallback(
    async (
      txHash: string,
      address: string,
      quoteId: string,
      draft: SwapDraft,
      provider: string,
      volumeUsd?: number,
      tracking?: { quoteId?: string; requestId?: string }
    ) => {
      try {
        await fetch(`${API_BASE_URL}/swaps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: address,
            quoteId,
            fromChain: draft.fromChain,
            toChain: draft.toChain,
            fromTokenSymbol: draft.fromTokenSymbol,
            toTokenSymbol: draft.toTokenSymbol,
            amount: draft.amount,
            ...(volumeUsd != null && { volumeUsd }),
            status: 'submitted',
            txHash,
            provider,
            metadata: { txHash, provider, ...tracking },
          }),
        });
      } catch {
        /* non-critical */
      }
    },
    []
  );

  const executeSwap = useCallback(
    async (
      draft: SwapDraft,
      bestQuote: QuoteResult,
      selectedFromToken: { address: string; decimals: number; symbol: string },
      requestedAmountRaw: bigint | null,
      privyLogin: () => void,
      hasPrivy: boolean,
      isAuthenticated: boolean,
      isAmountInsufficient: boolean,
      volumeUsd?: number
    ) => {
      if (executionInFlightRef.current) return;
      if (!walletBridge) {
        if (hasPrivy && !isAuthenticated) {
          privyLogin();
        } else {
          setError('Please connect your wallet first.');
        }
        return;
      }

      if (isAmountInsufficient) {
        setError(
          `Insufficient ${selectedFromToken.symbol} balance for this swap amount.`
        );
        return;
      }

      if (!bestQuote.transactionRequest) {
        setError('No executable transaction found in this quote.');
        return;
      }

      const txValidationError = validateTransactionRequest(
        bestQuote.transactionRequest
      );
      if (txValidationError) {
        setError(txValidationError);
        return;
      }

      // Existing LI.FI/Squid recipient guard. Relay's recipient is committed
      // in the settlement-order hash and uses the stronger checks below.
      const data = (bestQuote.transactionRequest.data ?? '').toLowerCase();
      const walletNeedle = walletBridge.address
        .toLowerCase()
        .replace(/^0x/, '');
      if (bestQuote.provider !== 'relay-api' && data.length > 10 && walletNeedle && !data.includes(walletNeedle)) {
        setError(
          'Safety check failed: this quote does not appear to route funds to your connected wallet. Refresh quotes and try again.'
        );
        return;
      }

      try {
        executionInFlightRef.current = true;
        setIsExecuting(true);
        setError('');
        setTxStatus(null);

        const isRelay = bestQuote.provider === 'relay-api';
        const assertActiveWallet = async (provider: Awaited<ReturnType<PrivyWalletBridge['getEthereumProvider']>>) => {
          const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
          const chainId = await provider.request({ method: 'eth_chainId' }) as string;
          if (accounts[0]?.toLowerCase() !== walletBridge.address.toLowerCase() || Number(BigInt(chainId)) !== fromChainId) throw new Error('Your wallet account or network changed. Refresh quotes.');
          if (isRelay) assertRelayExecution(bestQuote, draft, walletBridge.address);
        };
        if (isRelay) {
          assertRelayExecution(bestQuote, draft, walletBridge.address);
          const response = await fetch(`${API_BASE_URL}/quotes/relay/validate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...relayExecutionPayload(draft, walletBridge.address), requestId: bestQuote.tracking?.requestId }),
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) throw new Error('Relay quote is no longer valid. Refresh quotes.');
          const verified = await response.json() as { transaction: QuoteResult['transactionRequest']; relayOrderId: string; expiresAt: number };
          if (verified.transaction?.to?.toLowerCase() !== bestQuote.transactionRequest.to?.toLowerCase() || verified.transaction?.data?.toLowerCase() !== bestQuote.transactionRequest.data?.toLowerCase() || BigInt(verified.transaction?.value ?? '0') !== BigInt(bestQuote.transactionRequest.value ?? '0') || verified.relayOrderId !== bestQuote.relayOrderId) throw new Error('Relay transaction changed. Refresh quotes.');
        }

        await walletBridge.switchChain(fromChainId);
        const provider = await walletBridge.getEthereumProvider();
        if (isRelay) await assertActiveWallet(provider);

        if (fromChainId === 5042) {
          const nativeBalance = BigInt(
            (await provider.request({
              method: 'eth_getBalance',
              params: [walletBridge.address, 'latest'],
            })) as string
          );
          const sourceRaw = requestedAmountRaw ?? parseUnits(draft.amount, selectedFromToken.decimals);
          const sourceAmount = selectedFromToken.symbol === 'USDC'
            ? sourceRaw * 10n ** BigInt(18 - selectedFromToken.decimals)
            : 0n;
          const gasPrice = BigInt(
            (!isRelay ? bestQuote.transactionRequest.maxFeePerGas : undefined) ??
              (!isRelay ? bestQuote.transactionRequest.gasPrice : undefined) ??
              ((await provider.request({ method: 'eth_gasPrice' })) as string)
          );
          // Reserve for the route and a possible approval. Both spend native USDC.
          const gasLimit =
            BigInt((!isRelay ? bestQuote.transactionRequest.gasLimit : undefined) ?? '500000') + 100000n;
          const reserve = (gasLimit * gasPrice * 120n) / 100n;
          if (nativeBalance < sourceAmount + reserve)
            throw new Error(
              'Keep some USDC for Arc gas. Reduce your swap amount before continuing.'
            );
        }
        const spenderAddress = bestQuote.transactionRequest.to;
        const approvalToken = isRelay ? bestQuote.context!.srcToken : selectedFromToken.address;
        if (spenderAddress && !isNativeToken(approvalToken)) {
          const requiredAmount = isRelay ? BigInt(bestQuote.context!.amount) :
            requestedAmountRaw ??
            parseUnits(draft.amount, selectedFromToken.decimals);
          await ensureTokenApproval(
            provider,
            approvalToken,
            walletBridge.address,
            spenderAddress,
            requiredAmount
          );
        }

        if (isRelay) await assertActiveWallet(provider);

        const txParams: Record<string, unknown> = {
          from: walletBridge.address,
          to: bestQuote.transactionRequest.to,
          // Base Builder Code attribution applies on Base only.
          data: isRelay ? bestQuote.transactionRequest.data : appendBuilderCodeForChain(
            bestQuote.transactionRequest.data,
            fromChainId
          ),
          value: toHexQuantity(bestQuote.transactionRequest.value) ?? '0x0',
        };

        if (!isRelay && bestQuote.transactionRequest.maxFeePerGas) {
          txParams.maxFeePerGas = toHexQuantity(
            bestQuote.transactionRequest.maxFeePerGas
          );
          txParams.maxPriorityFeePerGas = toHexQuantity(
            bestQuote.transactionRequest.maxPriorityFeePerGas
          );
        } else if (!isRelay && bestQuote.transactionRequest.gasPrice) {
          txParams.gasPrice = toHexQuantity(
            bestQuote.transactionRequest.gasPrice
          );
        }
        if (!isRelay && bestQuote.transactionRequest.gasLimit) {
          txParams.gas = toHexQuantity(bestQuote.transactionRequest.gasLimit);
        }

        const txHash = (await provider.request({
          method: 'eth_sendTransaction',
          params: [txParams],
        })) as string;

        startStatusPolling(
          txHash,
          bestQuote.provider,
          draft.fromChain,
          draft.toChain,
          bestQuote.tracking
        );
        await recordSwap(
          txHash,
          walletBridge.address,
          bestQuote.id,
          draft,
          bestQuote.provider,
          volumeUsd,
          bestQuote.tracking
        );

        onPostSwap();
      } catch (caughtError) {
        setTxStatus((p) =>
          p ? { ...p, stage: 'failed', progress: p.progress } : null
        );
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Swap execution failed.'
        );
      } finally {
        executionInFlightRef.current = false;
        setIsExecuting(false);
      }
    },
    [walletBridge, fromChainId, startStatusPolling, recordSwap, onPostSwap]
  );

  const clearTxStatus = useCallback(() => setTxStatus(null), []);
  const clearError = useCallback(() => setError(''), []);

  return {
    isExecuting,
    txStatus,
    error,
    executeSwap,
    clearTxStatus,
    clearError,
  };
}
