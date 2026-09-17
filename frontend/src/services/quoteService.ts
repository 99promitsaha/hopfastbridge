import { type ChainKey, getToken } from '../lib/chains';
import { formatUnits, parseUnits } from '../lib/amount';

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface QuoteRequest {
  fromChain: ChainKey;
  toChain: ChainKey;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  amount: string;
  walletAddress?: string | null;
}

export interface QuoteResult {
  id: string;
  provider: 'lifi-api' | 'squid-api' | 'mock';
  route: string;
  feeUsd: number;
  feePercent: number;
  etaSeconds: number;
  destinationAmount: string;
  destinationAmountMin?: string;
  transactionRequest?: {
    to?: string;
    data?: string;
    value?: string;
    gasLimit?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  warning?: string;
  raw?: unknown;
}

function numberFromUnknown(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAmountFromQuote(value: unknown, decimals: number): string {
  if (typeof value !== 'string') {
    return '0';
  }

  try {
    return formatUnits(BigInt(value), decimals, 6);
  } catch {
    return '0';
  }
}

/**
 * Resolve the base URL for the backend API.
 * Priority: env var → localhost fallback when running dev.
 */
function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_HOPFAST_API_BASE_URL;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.replace(/\/$/, '');
  }

  if (
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    return 'http://localhost:8080/api';
  }

  return '';
}

function resolveQuoteUrl(provider: string): string {
  const directProxy = import.meta.env.VITE_HOPFAST_QUOTE_PROXY_URL;
  if (directProxy && directProxy.trim().length > 0) {
    return `${directProxy}?provider=${provider}`;
  }

  const base = resolveApiBaseUrl();
  if (base) {
    return `${base}/quotes?provider=${provider}`;
  }

  return '';
}

async function fetchQuoteFromBackend(payload: Record<string, unknown>, provider: string): Promise<unknown> {
  const quoteUrl = resolveQuoteUrl(provider);

  if (!quoteUrl) {
    throw new Error('Backend quote URL unavailable.');
  }

  const response = await fetch(quoteUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Quote proxy returned ${response.status}`);
  }

  return response.json();
}

export async function getSwapQuote(
  request: QuoteRequest,
  provider: 'lifi' | 'squid' = 'lifi'
): Promise<QuoteResult> {
  if (request.fromChain === request.toChain && request.fromTokenSymbol === request.toTokenSymbol) {
    throw new Error('Source and destination tokens must be different for a same-chain swap.');
  }

  const fromToken = getToken(request.fromChain, request.fromTokenSymbol);
  const toToken = getToken(request.toChain, request.toTokenSymbol);

  if (!fromToken || !toToken) {
    throw new Error('Unsupported token for selected chain.');
  }

  const amountInUnits = parseUnits(request.amount, fromToken.decimals).toString();
  const wallet = request.walletAddress || NULL_ADDRESS;

  const payload = {
    srcChainKey: request.fromChain,
    dstChainKey: request.toChain,
    srcTokenAddress: fromToken.address,
    dstTokenAddress: toToken.address,
    srcWalletAddress: wallet,
    dstWalletAddress: wallet,
    amount: amountInUnits,
    options: {
      amountType: 'EXACT_SRC_AMOUNT',
      feeTolerance: {
        type: 'PERCENT',
        amount: 2
      }
    }
  };

  try {
    const data = (await fetchQuoteFromBackend(payload, provider)) as {
      provider?: 'lifi' | 'squid';
      fallbackUsed?: boolean;
      fallbackFrom?: string;
      warnings?: string[];
      quotes?: Array<{
        id: string;
        provider?: 'lifi' | 'squid';
        routeSteps?: Array<{ type?: string }>;
        feeUsd?: string;
        feePercent?: string;
        duration?: { estimated?: string | null };
        dstAmount?: string;
        dstAmountMin?: string;
        userSteps?: Array<{
          type?: string;
          transaction?: {
            to?: string;
            data?: string;
            value?: string;
            gas?: string;
            gasLimit?: string;
            gasPrice?: string;
            maxFeePerGas?: string;
            maxPriorityFeePerGas?: string;
          };
        }>;
      }>;
    };

    const quote = data.quotes?.[0];
    if (!quote) {
      throw new Error('No quote available for this route yet.');
    }

    const route = quote.routeSteps?.map((step) => step.type).filter(Boolean).join(' + ') ?? 'LI.FI';

    const etaMilliseconds = numberFromUnknown(quote.duration?.estimated, 90000);

    const fallbackWarning = data.fallbackUsed
      ? `Fallback used (${data.fallbackFrom ?? 'unknown'}).`
      : undefined;
    const detailsWarning = data.warnings?.length ? data.warnings.join(' | ') : undefined;
    const combinedWarning = [fallbackWarning, detailsWarning].filter(Boolean).join(' ');
    const rawTx = quote.userSteps?.find((step) => step.type === 'TRANSACTION')?.transaction;
    const transactionRequest = rawTx ? {
      to: rawTx.to,
      data: rawTx.data,
      value: rawTx.value,
      gasLimit: rawTx.gasLimit ?? rawTx.gas,
      gasPrice: rawTx.gasPrice,
      maxFeePerGas: rawTx.maxFeePerGas,
      maxPriorityFeePerGas: rawTx.maxPriorityFeePerGas,
    } : undefined;

    return {
      id: quote.id,
      provider: provider === 'squid' ? 'squid-api' : 'lifi-api',
      route,
      feeUsd: numberFromUnknown(quote.feeUsd, 0),
      feePercent: numberFromUnknown(quote.feePercent, 0),
      etaSeconds: Math.max(15, Math.round(etaMilliseconds / 1000)),
      destinationAmount: parseAmountFromQuote(quote.dstAmount, toToken.decimals),
      destinationAmountMin: parseAmountFromQuote(quote.dstAmountMin, toToken.decimals),
      transactionRequest,
      warning: combinedWarning || undefined,
      raw: quote
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error('Failed to fetch quote.');
  }
}

