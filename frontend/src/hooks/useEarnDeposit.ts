import { useCallback, useState } from 'react';
import { API_BASE_URL } from '../constants';
import { toHexQuantity, validateTransactionRequest } from '../lib/swap';
import { appendBuilderCodeForChain } from '../lib/builderCode';
import { ensureTokenApproval, isNativeToken } from '../lib/erc20';
import { savePosition } from '../services/earnService';
import type { EarnVault } from '../types';
import type { PrivyWalletBridge } from '../components/WalletConnector';

interface EarnQuote {
  transactionRequest: {
    to?: string;
    data?: string;
    value?: string;
    gasLimit?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  feeUsd: number;
  etaSeconds: number;
  destinationAmount: string;
}

type EarnStage = 'idle' | 'quoting' | 'approving' | 'executing' | 'confirming' | 'done' | 'error';

/**
 * Handles deposit flow via the LI.FI Composer.
 * Deposit: fromToken = underlying, toToken = vault address
 */
export function useEarnDeposit(
  walletBridge: PrivyWalletBridge | null,
  onSuccess?: () => void,
) {
  const [loading, setLoading] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState<EarnQuote | null>(null);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [stage, setStage] = useState<EarnStage>('idle');

  const getDepositQuote = useCallback(async (
    vault: EarnVault, amount: string, walletAddress: string,
  ) => {
    setQuoting(true);
    setError('');
    setQuote(null);
    setStage('quoting');

    try {
      const payload = {
        srcTokenAddress: vault.underlyingTokens[0].address,
        dstTokenAddress: vault.address,
        srcWalletAddress: walletAddress,
        dstWalletAddress: walletAddress,
        amount,
        srcChainId: vault.chainId,
        dstChainId: vault.chainId,
      };

      const res = await fetch(`${API_BASE_URL}/earn/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Quote failed: ${res.status}`);
      }

      const data = await res.json();
      setQuote(data);
      setStage('idle');
      return data as EarnQuote;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to get quote';
      setError(msg);
      setStage('error');
      return null;
    } finally {
      setQuoting(false);
    }
  }, []);

  const executeDeposit = useCallback(async (
    vault: EarnVault, amountRaw: string, humanAmount: string, earnQuote?: EarnQuote,
  ) => {
    const q = earnQuote ?? quote;
    if (!q?.transactionRequest || !walletBridge) {
      setError('No quote or wallet available');
      return;
    }

    setLoading(true);
    setError('');

    const txValidationError = validateTransactionRequest(q.transactionRequest);
    if (txValidationError) {
      setError(txValidationError);
      setStage('error');
      setLoading(false);
      return;
    }

    try {
      await walletBridge.switchChain(vault.chainId);
      const provider = await walletBridge.getEthereumProvider();

      const fromTokenAddress = vault.underlyingTokens[0].address;
      const spenderAddress = q.transactionRequest.to;
      if (spenderAddress && !isNativeToken(fromTokenAddress)) {
        setStage('approving');
        const requiredAmount = BigInt(amountRaw) > 0n ? BigInt(amountRaw) : 0n;
        if (requiredAmount > 0n) {
          await ensureTokenApproval(
            provider,
            fromTokenAddress,
            walletBridge.address,
            spenderAddress,
            requiredAmount,
          );
        }
      }

      setStage('executing');
      const txParams: Record<string, unknown> = {
        from: walletBridge.address,
        to: q.transactionRequest.to,
        // Only append Base Builder Code when depositing on Base — it earns
        // nothing on other chains and risks breaking strict calldata validation.
        data: appendBuilderCodeForChain(q.transactionRequest.data, vault.chainId),
        value: toHexQuantity(q.transactionRequest.value) ?? '0x0',
      };

      if (q.transactionRequest.gasLimit) {
        txParams.gas = toHexQuantity(q.transactionRequest.gasLimit);
      }

      const hash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      })) as string;

      setTxHash(hash);
      setStage('confirming');

      let confirmed = false;
      for (let i = 0; i < 120 && !confirmed; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const receipt = (await provider.request({
          method: 'eth_getTransactionReceipt',
          params: [hash],
        })) as { status: string } | null;
        if (receipt) {
          confirmed = true;
          if (receipt.status === '0x0') throw new Error('Transaction reverted');
        }
      }

      const token = vault.underlyingTokens[0];
      try {
        await savePosition({
          userAddress: walletBridge.address,
          vaultAddress: vault.address,
          vaultName: vault.name,
          chainId: vault.chainId,
          network: vault.network,
          protocolName: vault.protocol.name,
          protocolUrl: vault.protocol.url,
          tokenSymbol: token?.symbol ?? '',
          tokenAddress: token?.address ?? '',
          tokenDecimals: token?.decimals ?? 18,
          amount: humanAmount,
          amountRaw,
          txHash: hash,
          action: 'deposit',
        });
      } catch { /* non-critical — position still deposited on-chain */ }

      setStage('done');
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setError(msg);
      setStage('error');
    } finally {
      setLoading(false);
    }
  }, [quote, walletBridge, onSuccess]);

  const reset = useCallback(() => {
    setQuote(null);
    setError('');
    setTxHash(null);
    setStage('idle');
    setLoading(false);
    setQuoting(false);
  }, []);

  return {
    quote,
    quoting,
    loading,
    error,
    txHash,
    stage,
    getDepositQuote,
    executeDeposit,
    reset,
  };
}
