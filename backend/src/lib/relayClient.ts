import { env } from '../config/env.js';
import { assertCalldataRoutesToRecipient, assertValidRecipient, assertValidSender } from './recipientGuard.js';

const RELAY_API = 'https://api.relay.link';

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

function parseChainId(value?: string): number {
  if (!value) throw new Error('Missing chain key for Relay quote.');
  if (value in CHAIN_ID_BY_KEY) return CHAIN_ID_BY_KEY[value as ChainKey];
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Unsupported chain key for Relay: ${value}`);
  return numeric;
}

// Relay uses 0x000...000 for native tokens — normalise EEE address
function normalizeTokenAddress(address?: string): string {
  if (!address) throw new Error('Missing token address for Relay quote.');
  if (address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') return ZERO_ADDRESS;
  return address;
}

interface RelayStepItemData {
  from?: string;
  to?: string;
  data?: string;
  value?: string;
  chainId?: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

interface RelayStepItem {
  status?: string;
  data?: RelayStepItemData;
  requestId?: string;
}

interface RelayStep {
  id?: string;
  action?: string;
  description?: string;
  kind?: string;
  requestId?: string;
  items?: RelayStepItem[];
}

interface RelayFeeEntry {
  amountUsd?: string;
}

interface RelayCurrencyAmount {
  amount?: string;
  minimumAmount?: string;
  amountUsd?: string;
}

interface RelayQuoteResponse {
  steps?: RelayStep[];
  fees?: {
    gas?: RelayFeeEntry;
    relayer?: RelayFeeEntry;
    relayerService?: RelayFeeEntry;
    app?: RelayFeeEntry;
  };
  // v2 API: amounts and ETA live inside `details`
  details?: {
    currencyIn?: RelayCurrencyAmount;
    currencyOut?: RelayCurrencyAmount;
    timeEstimate?: number; // seconds
  };
}

function calculateFeeUsd(fees?: RelayQuoteResponse['fees']): number {
  // gas = source-chain gas the user pays
  // relayer = total bridge fee (destination gas + solver margin)
  // We exclude app (our own referral fee) to keep ranking apples-to-apples.
  const components = [fees?.gas, fees?.relayer];
  return components.reduce((sum, item) => {
    const v = Number(item?.amountUsd ?? 0);
    return sum + (Number.isFinite(v) && v > 0 ? v : 0);
  }, 0);
}

export async function requestRelayQuote(payload: UnifiedQuotePayload): Promise<{
  provider: 'relay';
  quotes: Array<{
    id: string;
    provider: 'relay';
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
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
      };
    }>;
    raw: RelayQuoteResponse;
  }>;
  raw: RelayQuoteResponse;
}> {
  const srcChainId = parseChainId(payload.srcChainKey);
  const dstChainId = parseChainId(payload.dstChainKey);

  if (!payload.amount) throw new Error('Missing amount for Relay quote.');

  // Fail closed: never quote against Relay with a zero/missing recipient.
  // Relay's API silently substitutes 0x0 with its own fallback wallet
  // (0xf3d6…691e), which has caused funds to be delivered there in the past.
  const user = assertValidSender(payload.srcWalletAddress, 'srcWalletAddress');
  const recipient = assertValidRecipient(payload.dstWalletAddress ?? payload.srcWalletAddress, 'dstWalletAddress');

  // feeTolerance.amount is a percentage (e.g. 2 = 2%). Relay takes basis points.
  const slippageBps =
    typeof payload.options?.feeTolerance?.amount === 'number'
      ? String(Math.round(payload.options.feeTolerance.amount * 100))
      : '50'; // 0.5% default

  const body: Record<string, unknown> = {
    user,
    recipient,
    originChainId: srcChainId,
    destinationChainId: dstChainId,
    originCurrency: normalizeTokenAddress(payload.srcTokenAddress),
    destinationCurrency: normalizeTokenAddress(payload.dstTokenAddress),
    amount: payload.amount,
    tradeType: 'EXACT_INPUT',
    slippageTolerance: slippageBps,
  };

  // Optional app-fee recipient wired via env
  if (env.RELAY_APP_FEES_RECIPIENT) {
    body.appFees = [{ recipient: env.RELAY_APP_FEES_RECIPIENT, fee: '15' }]; // 15 bps = 0.15%
  }

  const response = await fetch(`${RELAY_API}/quote/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  if (!response.ok) {
    // Surface Relay's error (including BLOCKED_WALLET_ADDRESS) verbatim so the
    // user sees the real cause. Never silently retry with a different recipient
    // — Relay's API substitutes recipient=0x0 with its own fallback wallet,
    // which caused funds to be delivered to Relay's house address in the past.
    throw new Error(`Relay quote failed (${response.status}): ${text}`);
  }

  const raw = JSON.parse(text) as RelayQuoteResponse;

  // Defence-in-depth: if Relay rewrote the recipient, refuse the quote.
  // Fail closed — if `details.recipient` is absent but we asked for a real
  // address, we have no proof the stored quote routes to us.
  const requestedRecipient = String(body.recipient).toLowerCase();
  const storedRecipientRaw = (raw as { details?: { recipient?: string } }).details?.recipient;
  if (!storedRecipientRaw) {
    throw new Error(
      'Relay response omits details.recipient — cannot verify destination. Refusing quote to prevent funds loss.'
    );
  }
  if (storedRecipientRaw.toLowerCase() !== requestedRecipient) {
    throw new Error(
      `Relay rewrote the recipient (requested ${requestedRecipient}, stored ${storedRecipientRaw.toLowerCase()}). Refusing quote to prevent funds loss.`
    );
  }

  const destinationOutput = raw.details?.currencyOut;
  if (!destinationOutput?.amount) {
    throw new Error('Relay quote response is missing destination amount.');
  }

  // The deposit step is the main on-chain tx. The approve step (ERC-20 only)
  // is handled by ensureTokenApproval in the frontend — no need to return it.
  const depositStep = raw.steps?.find(s => s.id === 'deposit') ?? raw.steps?.[0];
  if (!depositStep) {
    throw new Error('Relay quote response contains no executable steps.');
  }

  const item = depositStep.items?.[0];
  const tx = item?.data;
  // requestId lives at step level in the current API response shape
  const requestId = depositStep.requestId ?? item?.requestId;

  const transactionData = tx?.to
    ? {
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gasLimit: tx.gas,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      }
    : undefined;

  // Second layer on top of the `details.recipient` check above: belt-and-braces.
  // If Relay's stored recipient field ever drifts from what actually ends up
  // encoded in the deposit calldata, this catches the mismatch too.
  assertCalldataRoutesToRecipient(tx?.data, recipient, 'Relay');

  const feeUsd = calculateFeeUsd(raw.fees);

  // feePercent = fee as a % of the *source* USD value, mirroring how the other
  // provider clients compute it. Relay gives us details.currencyIn.amountUsd
  // directly. Previously this was hardcoded to '0', which made the UI always
  // fall back to the "<0.01%" label regardless of the actual fee share.
  const srcUsd = Number(raw.details?.currencyIn?.amountUsd ?? 0);
  const feePercent = Number.isFinite(srcUsd) && srcUsd > 0
    ? (feeUsd / srcUsd) * 100
    : 0;

  // Use Relay's own time estimate (seconds); default 30 s if absent.
  const etaSeconds = Number(raw.details?.timeEstimate ?? 30);
  const durationMs = Math.max(5_000, Math.round(etaSeconds * 1_000));

  return {
    provider: 'relay',
    quotes: [
      {
        id: requestId ?? `relay-${Date.now()}`,
        provider: 'relay',
        routeSteps: [{ type: 'Relay' }],
        feeUsd: feeUsd.toFixed(6),
        feePercent: feePercent.toFixed(4),
        duration: { estimated: String(durationMs) },
        dstAmount: destinationOutput.amount,
        dstAmountMin: destinationOutput.minimumAmount ?? destinationOutput.amount,
        userSteps: transactionData
          ? [{ type: 'TRANSACTION', action: 'Submit Relay transaction from wallet.', transaction: transactionData }]
          : [],
        raw,
      }
    ],
    raw,
  };
}
