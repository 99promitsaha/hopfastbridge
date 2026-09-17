import { env } from '../config/env.js';
import { assertCalldataRoutesToRecipient, assertValidRecipient, assertValidSender, InvalidRecipientError } from './recipientGuard.js';

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

interface LiFiFeeCost {
  amountUSD?: string;
}

interface LiFiQuoteResponse {
  id?: string;
  tool?: {
    name?: string;
    key?: string;
  };
  estimate?: {
    toAmount?: string;
    toAmountMin?: string;
    executionDuration?: number;
    feeCosts?: LiFiFeeCost[];
    gasCosts?: LiFiFeeCost[];
    // USD value of the source amount, used for computing feePercent.
    fromAmountUSD?: string;
    toAmountUSD?: string;
  };
  transactionRequest?: {
    to?: string;
    data?: string;
    value?: string;
    gasLimit?: string;
    gasPrice?: string;
    // LI.FI returns the sender explicitly on the tx request — cheap to verify.
    from?: string;
  };
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const CHAIN_ID_BY_KEY: Record<ChainKey, number> = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
  polygon: 137,
  monad: 143
};

function normalizeTokenAddress(address?: string): string {
  if (!address) {
    throw new Error('Missing token address for LI.FI fallback quote.');
  }

  if (address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    return ZERO_ADDRESS;
  }

  return address;
}

function parseChainId(value?: string): number {
  if (!value) {
    throw new Error('Missing chain key for LI.FI fallback quote.');
  }

  if (value in CHAIN_ID_BY_KEY) {
    return CHAIN_ID_BY_KEY[value as ChainKey];
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Unsupported chain key for LI.FI fallback: ${value}`);
  }

  return numeric;
}

function calculateFeeUsd(estimate?: LiFiQuoteResponse['estimate']): number {
  const allCosts = [...(estimate?.feeCosts ?? []), ...(estimate?.gasCosts ?? [])];

  return allCosts.reduce((accumulator, item) => {
    const parsed = Number(item.amountUSD ?? 0);
    return accumulator + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
}

function resolveSlippage(payload: UnifiedQuotePayload): number {
  const fallbackFromFeeTolerance = payload.options?.feeTolerance?.amount;
  const fromPayload =
    typeof fallbackFromFeeTolerance === 'number' && Number.isFinite(fallbackFromFeeTolerance)
      ? fallbackFromFeeTolerance / 100
      : undefined;

  return fromPayload ?? env.LIFI_SLIPPAGE;
}

export async function requestLiFiQuote(payload: UnifiedQuotePayload): Promise<{
  provider: 'lifi';
  quotes: Array<{
    id: string;
    provider: 'lifi';
    routeSteps: Array<{ type: string }>;
    feeUsd: string;
    feePercent: string;
    duration: { estimated: string };
    dstAmount: string;
    dstAmountMin: string;
    userSteps: Array<{
      type: 'TRANSACTION';
      action: string;
      transaction: LiFiQuoteResponse['transactionRequest'];
    }>;
    raw: LiFiQuoteResponse;
  }>;
  raw: LiFiQuoteResponse;
}> {
  const srcChainId = parseChainId(payload.srcChainKey);
  const dstChainId = parseChainId(payload.dstChainKey);

  if (!payload.amount) {
    throw new Error('Missing amount for LI.FI fallback quote.');
  }

  // Fail closed if wallet not connected — never send a zero recipient to
  // upstream APIs (Relay's /quote/v2 silently remaps 0x0 → a house wallet).
  const fromAddress = assertValidSender(payload.srcWalletAddress, 'srcWalletAddress');
  const toAddress = assertValidRecipient(payload.dstWalletAddress ?? payload.srcWalletAddress, 'dstWalletAddress');

  const params = new URLSearchParams({
    fromChain: String(srcChainId),
    toChain: String(dstChainId),
    fromToken: normalizeTokenAddress(payload.srcTokenAddress),
    toToken: normalizeTokenAddress(payload.dstTokenAddress),
    fromAmount: payload.amount,
    fromAddress,
    toAddress,
    slippage: String(resolveSlippage(payload))
  });

  if (env.LIFI_INTEGRATOR) {
    params.set('integrator', env.LIFI_INTEGRATOR);
  }

  if (typeof env.LIFI_FEE === 'number' && Number.isFinite(env.LIFI_FEE)) {
    params.set('fee', String(env.LIFI_FEE));
  }

  const headers: Record<string, string> = {};
  if (env.LIFI_API_KEY) {
    headers['x-lifi-api-key'] = env.LIFI_API_KEY;
  }

  const response = await fetch(`${env.LIFI_API_BASE_URL}/quote?${params.toString()}`, {
    method: 'GET',
    headers
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`LI.FI quote failed (${response.status}): ${text}`);
  }

  const raw = JSON.parse(text) as LiFiQuoteResponse;

  if (!raw.estimate?.toAmount) {
    throw new Error('LI.FI quote response is missing destination amount.');
  }

  // Defence-in-depth recipient verification. LI.FI has historically respected
  // the fromAddress / toAddress we send, but we don't want to rely on that —
  // any silent substitution upstream would otherwise reach a signing wallet.
  if (
    raw.transactionRequest?.from
    && raw.transactionRequest.from.toLowerCase() !== fromAddress.toLowerCase()
  ) {
    throw new InvalidRecipientError(
      `LI.FI rewrote sender (requested ${fromAddress}, returned ${raw.transactionRequest.from}). Refusing quote.`
    );
  }
  assertCalldataRoutesToRecipient(raw.transactionRequest?.data, toAddress, 'LI.FI');

  const feeUsd = calculateFeeUsd(raw.estimate);
  const durationSeconds = Number(raw.estimate.executionDuration ?? 90);
  const durationMilliseconds = Math.max(1000, Math.round(durationSeconds * 1000));

  // feePercent = fee as a % of the *source* USD value, consistent with the
  // other provider clients. LI.FI exposes `estimate.fromAmountUSD` directly.
  // Was previously hardcoded to '0', which made the UI always fall back to
  // the "<0.01%" label regardless of the actual fee share.
  const srcUsd = Number(raw.estimate.fromAmountUSD ?? 0);
  const feePercent = Number.isFinite(srcUsd) && srcUsd > 0
    ? (feeUsd / srcUsd) * 100
    : 0;

  const routeType = raw.tool?.name ?? raw.tool?.key ?? 'LI.FI';

  return {
    provider: 'lifi',
    quotes: [
      {
        id: raw.id ?? `lifi-${Date.now()}`,
        provider: 'lifi',
        routeSteps: [{ type: routeType }],
        feeUsd: feeUsd.toFixed(6),
        feePercent: feePercent.toFixed(4),
        duration: { estimated: String(durationMilliseconds) },
        dstAmount: raw.estimate.toAmount,
        dstAmountMin: raw.estimate.toAmountMin ?? raw.estimate.toAmount,
        userSteps: [
          {
            type: 'TRANSACTION',
            action: 'Submit LI.FI transaction request from wallet.',
            transaction: raw.transactionRequest
          }
        ],
        raw
      }
    ],
    raw
  };
}
