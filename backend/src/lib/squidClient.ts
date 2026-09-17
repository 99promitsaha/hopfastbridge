import { env } from '../config/env.js';
import { assertCalldataRoutesToRecipient, assertValidRecipient, assertValidSender } from './recipientGuard.js';

type ChainKey = 'ethereum' | 'base' | 'bsc' | 'polygon' | 'monad';

interface UnifiedQuotePayload {
  srcChainKey?: string;
  dstChainKey?: string;
  srcTokenAddress?: string;
  dstTokenAddress?: string;
  srcWalletAddress?: string;
  dstWalletAddress?: string;
  amount?: string;
  options?: {
    feeTolerance?: {
      amount?: number;
    };
  };
}

const CHAIN_ID_BY_KEY: Record<ChainKey, number> = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
  polygon: 137,
  monad: 143
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const NATIVE_EEE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function parseChainId(value?: string): number {
  if (!value) throw new Error('Missing chain key for Squid quote.');
  if (value in CHAIN_ID_BY_KEY) return CHAIN_ID_BY_KEY[value as ChainKey];
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Unsupported chain key for Squid: ${value}`);
  return numeric;
}

function normalizeTokenAddress(address?: string): string {
  if (!address) throw new Error('Missing token address for Squid quote.');
  // Squid uses the 0xEeee... convention for native tokens
  if (address.toLowerCase() === ZERO_ADDRESS) return NATIVE_EEE;
  return address;
}

interface SquidFeeCost {
  amount?: string;
  amountUsd?: string;
  description?: string;
  name?: string;
}

interface SquidEstimate {
  toAmount?: string;
  toAmountMin?: string;
  estimatedRouteDuration?: number;
  feeCosts?: SquidFeeCost[];
  gasCosts?: SquidFeeCost[];
  // USD value of the source amount, used for computing feePercent.
  fromAmountUSD?: string;
  toAmountUSD?: string;
}

interface SquidRouteResponse {
  route?: {
    quoteId?: string;
    estimate?: SquidEstimate;
    transactionRequest?: {
      target?: string;
      data?: string;
      value?: string;
      gasLimit?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    };
  };
  requestId?: string;
}

function calculateFeeUsd(estimate?: SquidEstimate): number {
  const allCosts = [...(estimate?.feeCosts ?? []), ...(estimate?.gasCosts ?? [])];
  return allCosts.reduce((sum, item) => {
    const parsed = Number(item.amountUsd ?? 0);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
}

export async function requestSquidQuote(payload: UnifiedQuotePayload): Promise<{
  provider: 'squid';
  quotes: Array<{
    id: string;
    provider: 'squid';
    routeSteps: Array<{ type: string }>;
    feeUsd: string;
    feePercent: string;
    duration: { estimated: string };
    dstAmount: string;
    dstAmountMin: string;
    userSteps: Array<{
      type: 'TRANSACTION';
      action: string;
      transaction: {
        to?: string;
        data?: string;
        value?: string;
        gasLimit?: string;
        gasPrice?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
      };
    }>;
    raw: SquidRouteResponse;
  }>;
  raw: SquidRouteResponse;
  requestId?: string;
}> {
  const srcChainId = parseChainId(payload.srcChainKey);
  const dstChainId = parseChainId(payload.dstChainKey);

  if (!payload.amount) throw new Error('Missing amount for Squid quote.');

  // Fail closed: zero/missing recipient is forbidden across the board.
  const fromAddress = assertValidSender(payload.srcWalletAddress, 'srcWalletAddress');
  const toAddress = assertValidRecipient(payload.dstWalletAddress ?? payload.srcWalletAddress, 'dstWalletAddress');

  const slippage = typeof payload.options?.feeTolerance?.amount === 'number'
    ? payload.options.feeTolerance.amount
    : 1;

  const body = {
    fromChain: String(srcChainId),
    toChain: String(dstChainId),
    fromToken: normalizeTokenAddress(payload.srcTokenAddress),
    toToken: normalizeTokenAddress(payload.dstTokenAddress),
    fromAmount: payload.amount,
    fromAddress,
    toAddress,
    slippage,
    slippageConfig: { autoMode: 1 }
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (env.SQUID_INTEGRATOR_ID) {
    headers['x-integrator-id'] = env.SQUID_INTEGRATOR_ID;
  }

  const response = await fetch(`${env.SQUID_API_BASE_URL}/v2/route`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Squid quote failed (${response.status}): ${text}`);
  }

  const raw = JSON.parse(text) as SquidRouteResponse;
  const requestId = response.headers.get('x-request-id') ?? raw.requestId;

  const estimate = raw.route?.estimate;
  if (!estimate?.toAmount) {
    throw new Error('Squid quote response is missing destination amount.');
  }

  const feeUsd = calculateFeeUsd(estimate);
  const durationSeconds = Number(estimate.estimatedRouteDuration ?? 90);
  const durationMs = Math.max(1000, Math.round(durationSeconds * 1000));

  // feePercent = fee as a % of the *source* USD value, consistent with the
  // other provider clients. Squid exposes `estimate.fromAmountUSD` directly.
  // Was previously hardcoded to '0', which made the UI always fall back to
  // the "<0.01%" label regardless of the actual fee share.
  const srcUsd = Number(estimate.fromAmountUSD ?? 0);
  const feePercent = Number.isFinite(srcUsd) && srcUsd > 0
    ? (feeUsd / srcUsd) * 100
    : 0;

  const tx = raw.route?.transactionRequest;
  const txData = tx?.target
    ? {
        to: tx.target,
        data: tx.data,
        value: tx.value,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas
      }
    : undefined;

  // Defence-in-depth: the Squid router encodes the destination recipient in
  // source-chain calldata. If the upstream silently remapped toAddress, our
  // EOA wouldn't appear in the returned hex — refuse before any signing.
  assertCalldataRoutesToRecipient(tx?.data, toAddress, 'Squid');

  return {
    provider: 'squid',
    quotes: [
      {
        id: raw.route?.quoteId ?? `squid-${Date.now()}`,
        provider: 'squid',
        routeSteps: [{ type: 'Axelar' }],
        feeUsd: feeUsd.toFixed(6),
        feePercent: feePercent.toFixed(4),
        duration: { estimated: String(durationMs) },
        dstAmount: estimate.toAmount,
        dstAmountMin: estimate.toAmountMin ?? estimate.toAmount,
        userSteps: txData
          ? [{ type: 'TRANSACTION', action: 'Submit Squid transaction from wallet.', transaction: txData }]
          : [],
        raw
      }
    ],
    raw,
    requestId: requestId ?? undefined
  };
}
