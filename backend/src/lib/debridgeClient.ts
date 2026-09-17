import { env } from '../config/env.js';
import { getNativeUsdPrice, nativeWeiToUsd } from './nativePrice.js';
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
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

interface DebridgeTokenEstimation {
  amount?: string;
  approximateUsdValue?: number;
  recommendedAmount?: string;
  recommendedApproximateUsdValue?: number;
}

interface DebridgeCreateTxResponse {
  orderId?: string;
  // Top-level `fixFee` is the native-token protocol fee (wei) charged via
  // `msg.value` on the source tx. deBridge's estimation USD values do NOT
  // include this — we must convert and add it ourselves.
  fixFee?: string;
  tx?: {
    to?: string;
    data?: string;
    value?: string;
    gasLimit?: number | string;
  };
  order?: {
    approximateFulfillmentDelay?: number;
  };
  estimation?: {
    srcChainTokenIn?: DebridgeTokenEstimation & {
      originApproximateUsdValue?: number;
    };
    dstChainTokenOut?: DebridgeTokenEstimation;
  };
  estimatedTransactionFee?: {
    details?: {
      gasLimit?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    };
  };
}

// Single-chain `/v1.0/chain/transaction` response. Completely different shape
// from the DLN cross-chain one above — see:
//   https://docs.debridge.com/api-reference/single-chain-swap/get-v10chaintransaction
// Notable differences: the tx block is flat `tx { to, data, value }`; the
// output amount lives at `tokenOut.amount` (not `estimation.dstChainTokenOut`);
// no `fixFee` (single-chain swaps pay no bridge fixed fee); no ETA field (the
// swap is one same-chain tx).
interface DebridgeSingleChainResponse {
  tokenIn?: {
    address?: string;
    amount?: string;
    approximateUsdValue?: number;
  };
  tokenOut?: {
    address?: string;
    amount?: string;
    minAmount?: string;
    approximateUsdValue?: number;
  };
  protocolFee?: string;
  protocolFeeApproximateUsdValue?: number | string;
  estimatedTransactionFee?: {
    approximateUsdValue?: number;
    details?: {
      gasLimit?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    };
  };
  tx?: {
    to?: string;
    data?: string;
    value?: string;
  };
}

/** The `raw` field in the response may carry either shape depending on which
 *  deBridge endpoint served the quote. Downstream consumers treat it as
 *  opaque JSON — this union just keeps the type checker happy. */
type DebridgeRawResponse = DebridgeCreateTxResponse | DebridgeSingleChainResponse;

interface DebridgeQuoteResult {
  provider: 'debridge';
  quotes: Array<{
    id: string;
    provider: 'debridge';
    routeSteps: Array<{ type: string }>;
    feeUsd: string;
    fixFeeUsd?: string;
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
    raw: DebridgeRawResponse;
  }>;
  raw: DebridgeRawResponse;
}

function parseChainId(value?: string): number {
  if (!value) {
    throw new Error('Missing chain key for deBridge quote.');
  }

  if (value in CHAIN_ID_BY_KEY) {
    return CHAIN_ID_BY_KEY[value as ChainKey];
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Unsupported chain key for deBridge: ${value}`);
  }

  return numeric;
}

function normalizeTokenAddress(address?: string): string {
  if (!address) {
    throw new Error('Missing token address for deBridge quote.');
  }

  if (address.toLowerCase() === NATIVE_EEE) {
    return ZERO_ADDRESS;
  }

  return address;
}

function normalizeAddress(address?: string): string | undefined {
  if (!address) return undefined;
  if (!EVM_ADDRESS_REGEX.test(address)) return undefined;
  if (address.toLowerCase() === ZERO_ADDRESS) return undefined;
  return address;
}

/**
 * Compute the USD fee components for a deBridge DLN order.
 *
 * Returns two separate amounts so callers can display them distinctly:
 *   - `spread`   — the token-value difference between input and output
 *                  (captures the maker margin / AMM slippage on destination).
 *   - `fixFee`   — the native-token protocol fee (`fixFee` wei, paid as
 *                  `msg.value` on the source tx). deBridge does NOT include
 *                  this in its estimation USD numbers, so without the
 *                  conversion it was shown as ~$0.02 when the wallet was
 *                  actually debited ~$2.34.
 *   - `total`    — sum of the above; used for quote ranking.
 */
async function resolveFeeComponents(
  raw: DebridgeCreateTxResponse,
  srcChainId: number
): Promise<{ total: number; spread: number; fixFee: number }> {
  const srcUsdRaw = raw.estimation?.srcChainTokenIn?.approximateUsdValue
    ?? raw.estimation?.srcChainTokenIn?.originApproximateUsdValue;
  const dstUsdRaw = raw.estimation?.dstChainTokenOut?.approximateUsdValue
    ?? raw.estimation?.dstChainTokenOut?.recommendedApproximateUsdValue;

  const srcUsd = Number(srcUsdRaw ?? 0);
  const dstUsd = Number(dstUsdRaw ?? 0);

  const spread = Number.isFinite(srcUsd) && Number.isFinite(dstUsd)
    ? Math.max(0, srcUsd - dstUsd)
    : 0;

  // Convert the native msg.value fee to USD. Prefer the top-level `fixFee`
  // field; fall back to `tx.value` when the source token is ERC20 (in which
  // case `tx.value` is exactly the fixed fee). When the source token IS the
  // native asset, `tx.value = amount + fixFee`, so we rely on `fixFee` to
  // avoid double-counting the swap amount as fee.
  const nativeFeeWei = raw.fixFee ?? raw.tx?.value;
  let fixFee = 0;
  if (nativeFeeWei && nativeFeeWei !== '0' && nativeFeeWei !== '0x0') {
    const usdPerNative = await getNativeUsdPrice(srcChainId);
    fixFee = nativeWeiToUsd(nativeFeeWei, usdPerNative);
  }

  return { total: spread + fixFee, spread, fixFee };
}

export async function requestDebridgeQuote(
  payload: UnifiedQuotePayload
): Promise<DebridgeQuoteResult> {
  const srcChainId = parseChainId(payload.srcChainKey);
  const dstChainId = parseChainId(payload.dstChainKey);

  if (!payload.amount) {
    throw new Error('Missing amount for deBridge quote.');
  }

  // deBridge's DLN endpoint (`/v1.0/dln/order/create-tx`) is cross-chain only
  // and returns error 25 (SAME_SOURCE_AND_DESTINATION_CHAINS) for same-chain
  // swaps. For those, deBridge exposes a separate single-chain swap endpoint
  // — route the request there and map the response back into our shared shape.
  if (srcChainId === dstChainId) {
    return requestDebridgeSingleChainQuote(payload, srcChainId);
  }

  // Fail closed: a quote without a valid recipient could be delivered to a
  // fallback address by upstream routers. Reject before reaching deBridge.
  const srcAuthority = assertValidSender(payload.srcWalletAddress, 'srcWalletAddress');
  const dstRecipient = assertValidRecipient(payload.dstWalletAddress ?? payload.srcWalletAddress, 'dstWalletAddress');

  const params = new URLSearchParams({
    srcChainId: String(srcChainId),
    srcChainTokenIn: normalizeTokenAddress(payload.srcTokenAddress),
    srcChainTokenInAmount: payload.amount,
    dstChainId: String(dstChainId),
    dstChainTokenOut: normalizeTokenAddress(payload.dstTokenAddress),
    dstChainTokenOutAmount: 'auto',
    // IMPORTANT: keep this `false` so the user pays exactly `srcChainTokenInAmount`.
    // When `true`, deBridge inflates the source debit by adding operating expenses on
    // top of the user's entered amount — causing MetaMask to ask for noticeably more
    // ETH (or other native token) than what was typed into the swap box. With `false`
    // (default deBridge behaviour), fees are deducted from the destination amount
    // instead, which matches every other aggregator we support.
    prependOperatingExpenses: 'false'
  });

  if (srcAuthority) {
    params.set('srcChainOrderAuthorityAddress', srcAuthority);
    params.set('senderAddress', srcAuthority);
  }

  if (dstRecipient) {
    params.set('dstChainOrderAuthorityAddress', dstRecipient);
    params.set('dstChainTokenOutRecipient', dstRecipient);
  }

  if (env.DEBRIDGE_ACCESS_TOKEN) {
    params.set('accesstoken', env.DEBRIDGE_ACCESS_TOKEN);
  }

  if (typeof env.DEBRIDGE_REFERRAL_CODE === 'number' && Number.isFinite(env.DEBRIDGE_REFERRAL_CODE)) {
    params.set('referralCode', String(env.DEBRIDGE_REFERRAL_CODE));
  }

  const response = await fetch(`${env.DEBRIDGE_API_BASE_URL}/v1.0/dln/order/create-tx?${params.toString()}`, {
    method: 'GET'
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`deBridge quote failed (${response.status}): ${text}`);
  }

  const raw = JSON.parse(text) as DebridgeCreateTxResponse;

  const dstAmount =
    raw.estimation?.dstChainTokenOut?.amount
    ?? raw.estimation?.dstChainTokenOut?.recommendedAmount;

  if (!dstAmount) {
    throw new Error('deBridge quote response is missing destination amount.');
  }

  const { total: feeUsd, fixFee: fixFeeUsd } = await resolveFeeComponents(raw, srcChainId);
  const etaSeconds = Number(raw.order?.approximateFulfillmentDelay ?? 90);
  const etaMs = Math.max(1_000, Math.round(etaSeconds * 1_000));
  const txGasLimit = raw.tx?.gasLimit != null
    ? String(raw.tx.gasLimit)
    : raw.estimatedTransactionFee?.details?.gasLimit;
  const txData = raw.tx?.to
    ? {
      to: raw.tx.to,
      data: raw.tx.data,
      value: raw.tx.value,
      gasLimit: txGasLimit,
      gasPrice: raw.estimatedTransactionFee?.details?.gasPrice,
      maxFeePerGas: raw.estimatedTransactionFee?.details?.maxFeePerGas,
      maxPriorityFeePerGas: raw.estimatedTransactionFee?.details?.maxPriorityFeePerGas
    }
    : undefined;

  // Defence-in-depth: the DLN order struct encoded in tx calldata includes
  // the destination recipient. If deBridge substituted anything, our EOA
  // wouldn't appear in the hex payload — refuse before any signing.
  assertCalldataRoutesToRecipient(raw.tx?.data, dstRecipient, 'deBridge');

  const srcUsd = Number(
    raw.estimation?.srcChainTokenIn?.approximateUsdValue
      ?? raw.estimation?.srcChainTokenIn?.originApproximateUsdValue
      ?? 0
  );
  const feePercent = srcUsd > 0 ? (feeUsd / srcUsd) * 100 : 0;

  return {
    provider: 'debridge',
    quotes: [
      {
        id: raw.orderId ?? `debridge-${Date.now()}`,
        provider: 'debridge',
        routeSteps: [{ type: 'DEBRIDGE_DLN' }],
        feeUsd: feeUsd.toFixed(6),
        // Expose the native fixed-fee component separately so the UI can show
        // "route fee + DLN fixed fee" instead of a single opaque total.
        fixFeeUsd: fixFeeUsd > 0 ? fixFeeUsd.toFixed(6) : undefined,
        feePercent: feePercent.toFixed(4),
        duration: { estimated: String(etaMs) },
        dstAmount,
        dstAmountMin: dstAmount,
        userSteps: txData
          ? [{ type: 'TRANSACTION', action: 'Submit deBridge DLN transaction from wallet.', transaction: txData }]
          : [],
        raw
      }
    ],
    raw
  };
}

/**
 * Same-chain swap via deBridge's `/v1.0/chain/transaction` endpoint.
 *
 * The cross-chain DLN endpoint returns error 25 for srcChainId === dstChainId,
 * so we route those requests here instead. Same recipient guards, same return
 * shape as the DLN path — downstream code doesn't need to know which endpoint
 * served the quote.
 */
async function requestDebridgeSingleChainQuote(
  payload: UnifiedQuotePayload,
  chainId: number
): Promise<DebridgeQuoteResult> {
  // Fail closed: same as the DLN path — a missing/invalid recipient could
  // otherwise cause upstream routers to silently substitute a fallback wallet.
  const srcAuthority = assertValidSender(payload.srcWalletAddress, 'srcWalletAddress');
  const dstRecipient = assertValidRecipient(
    payload.dstWalletAddress ?? payload.srcWalletAddress,
    'dstWalletAddress'
  );

  const params = new URLSearchParams({
    chainId: String(chainId),
    tokenIn: normalizeTokenAddress(payload.srcTokenAddress),
    tokenInAmount: payload.amount!,
    tokenOut: normalizeTokenAddress(payload.dstTokenAddress)
  });

  if (dstRecipient) {
    params.set('tokenOutRecipient', dstRecipient);
  }

  if (srcAuthority) {
    params.set('senderAddress', srcAuthority);
  }

  if (env.DEBRIDGE_ACCESS_TOKEN) {
    params.set('accesstoken', env.DEBRIDGE_ACCESS_TOKEN);
  }

  if (typeof env.DEBRIDGE_REFERRAL_CODE === 'number' && Number.isFinite(env.DEBRIDGE_REFERRAL_CODE)) {
    params.set('referralCode', String(env.DEBRIDGE_REFERRAL_CODE));
  }

  const response = await fetch(
    `${env.DEBRIDGE_API_BASE_URL}/v1.0/chain/transaction?${params.toString()}`,
    { method: 'GET' }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`deBridge quote failed (${response.status}): ${text}`);
  }

  const raw = JSON.parse(text) as DebridgeSingleChainResponse;

  const dstAmount = raw.tokenOut?.amount;
  if (!dstAmount) {
    throw new Error('deBridge quote response is missing destination amount.');
  }
  const dstAmountMin = raw.tokenOut?.minAmount ?? dstAmount;

  // Fee breakdown: same `srcUsd - dstUsd` spread approach as the DLN path for
  // consistency, plus the explicit single-chain `protocolFee` when present.
  // No `fixFee` equivalent on same-chain swaps (no bridge involved).
  const srcUsd = Number(raw.tokenIn?.approximateUsdValue ?? 0);
  const dstUsd = Number(raw.tokenOut?.approximateUsdValue ?? 0);
  const spreadUsd = Number.isFinite(srcUsd) && Number.isFinite(dstUsd)
    ? Math.max(0, srcUsd - dstUsd)
    : 0;
  const protocolFeeUsdRaw = Number(raw.protocolFeeApproximateUsdValue ?? 0);
  const protocolFeeUsd = Number.isFinite(protocolFeeUsdRaw) ? protocolFeeUsdRaw : 0;
  const feeUsd = spreadUsd + protocolFeeUsd;
  const feePercent = srcUsd > 0 ? (feeUsd / srcUsd) * 100 : 0;

  const txGasLimit = raw.estimatedTransactionFee?.details?.gasLimit;
  const txData = raw.tx?.to
    ? {
      to: raw.tx.to,
      data: raw.tx.data,
      value: raw.tx.value,
      gasLimit: txGasLimit,
      gasPrice: raw.estimatedTransactionFee?.details?.gasPrice,
      maxFeePerGas: raw.estimatedTransactionFee?.details?.maxFeePerGas,
      maxPriorityFeePerGas: raw.estimatedTransactionFee?.details?.maxPriorityFeePerGas
    }
    : undefined;

  // Defence-in-depth: same-chain swap calldata encodes tokenOutRecipient. If
  // the upstream substituted a fallback wallet, our EOA wouldn't appear in
  // the returned hex — refuse before any signing.
  assertCalldataRoutesToRecipient(raw.tx?.data, dstRecipient, 'deBridge');

  // Single-chain swap is one source-chain tx — ~15s is a reasonable default
  // (faster than the 90s DLN fallback used for cross-chain orders).
  const etaMs = 15_000;

  return {
    provider: 'debridge',
    quotes: [
      {
        id: `debridge-swap-${chainId}-${Date.now()}`,
        provider: 'debridge',
        routeSteps: [{ type: 'DEBRIDGE_SWAP' }],
        feeUsd: feeUsd.toFixed(6),
        fixFeeUsd: undefined,
        feePercent: feePercent.toFixed(4),
        duration: { estimated: String(etaMs) },
        dstAmount,
        dstAmountMin,
        userSteps: txData
          ? [{ type: 'TRANSACTION', action: 'Submit deBridge swap transaction from wallet.', transaction: txData }]
          : [],
        raw
      }
    ],
    raw
  };
}
