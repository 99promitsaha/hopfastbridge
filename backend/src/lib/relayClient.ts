import { decodeFunctionData, encodeFunctionData, parseAbi } from 'viem';
import { env } from '../config/env.js';
import { assertValidRecipient, assertValidSender, ZERO_ADDRESS } from './recipientGuard.js';
import { relayOrderId, relayOrderSchema } from './relayOrder.js';
import type { requestLiFiQuote } from './lifiClient.js';

type Payload = Parameters<typeof requestLiFiQuote>[0];
export const RELAY_FEE_BPS = 5;
export const RELAY_API = 'https://api.relay.link';
// Independently obtained from Relay /chains and its protocol address reference.
// A response cannot choose its own trusted target. New deployments require review.
export const RELAY_DEPOSITORY = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
const ids: Record<string, number> = { ethereum: 1, base: 8453, bsc: 56, polygon: 137, monad: 143, robinhood: 4663, arc: 5042 };
const depositAbi = parseAbi([
  'function depositNative(address depositor, bytes32 id)',
  'function depositErc20(address depositor, address token, uint256 amount, bytes32 id)',
]);
const approveAbi = parseAbi(['function approve(address spender, uint256 amount)']);
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
function requireCheck(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(`Relay safety check failed: ${reason}.`);
}
function token(value?: string) {
  if (same(value, '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')) return ZERO_ADDRESS;
  requireCheck(typeof value === 'string' && /^0x[\da-fA-F]{40}$/.test(value), 'invalid token');
  return value.toLowerCase();
}
export function relayRequestContext(payload: Payload) {
  const fromChainId = ids[payload.srcChainKey ?? ''];
  const toChainId = ids[payload.dstChainKey ?? ''];
  requireCheck(fromChainId && toChainId, 'unsupported chain');
  const sender = assertValidSender(payload.srcWalletAddress, 'srcWalletAddress');
  const recipient = assertValidRecipient(payload.dstWalletAddress ?? sender, 'dstWalletAddress');
  const amount = payload.amount;
  requireCheck(typeof amount === 'string' && /^\d{1,78}$/.test(amount) && BigInt(amount) > 0n && BigInt(amount) < 2n ** 256n, 'invalid amount');
  const srcToken = token(payload.srcTokenAddress), dstToken = token(payload.dstTokenAddress);
  requireCheck(fromChainId !== toChainId || srcToken !== dstToken, 'identical assets');
  return { fromChainId, toChainId, sender: sender.toLowerCase(), recipient: recipient.toLowerCase(), amount: BigInt(amount).toString(), srcToken, dstToken };
}
type Context = ReturnType<typeof relayRequestContext>;
interface ChainInfo {
  id: number; vmType: string; disabled?: boolean; depositEnabled?: boolean;
  protocol?: { v2?: { chainId: string; depository?: string } };
}
interface RelayTx { from: string; to: string; data: string; value: string; chainId: number; gas?: string; gasLimit?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string }
interface CurrencyAmount { amount: string; minimumAmount?: string; amountUsd: string; currency: { chainId: number; address: string } }
export interface RelayQuote {
  requestId: string;
  steps: Array<{ id: string; kind: string; requestId?: string; items: Array<{ data: RelayTx }> }>;
  details: { sender: string; recipient: string; currencyIn: CurrencyAmount; currencyOut: CurrencyAmount; timeEstimate?: number };
  fees: { gas: CurrencyAmount; relayer: CurrencyAmount; app: CurrencyAmount; subsidized?: CurrencyAmount };
  protocol?: { v2?: { orderId: string; orderData: unknown; paymentDetails: { chainId: string; depository: string; currency: string; amount: string } } };
}
let chainsCache: { until: number; chains: ChainInfo[] } | undefined;
let chainsPending: Promise<ChainInfo[]> | undefined;
export function relayHeaders() {
  return { 'Content-Type': 'application/json', ...(env.RELAY_API_KEY ? { 'x-api-key': env.RELAY_API_KEY } : {}) };
}
async function chains() {
  if (chainsCache && chainsCache.until > Date.now()) return chainsCache.chains;
  if (chainsPending) return chainsPending;
  chainsPending = (async () => {
    const response = await fetch(`${RELAY_API}/chains`, { headers: relayHeaders(), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Relay chain metadata unavailable.');
    const data = await response.json() as { chains: ChainInfo[] };
    requireCheck(Array.isArray(data.chains), 'missing chain metadata');
    chainsCache = { chains: data.chains, until: Date.now() + 3600_000 };
    return data.chains;
  })();
  try { return await chainsPending; } finally { chainsPending = undefined; }
}

/** No arbitrary transfers, permits, origin routers or destination calls. */
export function validateRelayQuote(raw: RelayQuote, context: Context, metadata: ChainInfo[], now = Date.now()) {
  const origin = metadata.find(c => c.id === context.fromChainId);
  const destination = metadata.find(c => c.id === context.toChainId);
  for (const c of [origin, destination]) requireCheck(c && c.vmType === 'evm' && !c.disabled && c.protocol?.v2?.chainId && same(c.protocol.v2.depository, RELAY_DEPOSITORY), 'chain/depository unavailable');
  requireCheck(origin!.depositEnabled === true, 'origin deposits disabled');
  const protocol = raw.protocol?.v2;
  requireCheck(protocol && /^0x[\da-fA-F]{64}$/.test(protocol.orderId), 'missing verified settlement order');
  requireCheck(/^0x[\da-fA-F]{64}$/.test(raw.requestId), 'missing request ID');
  const order = relayOrderSchema.parse(protocol.orderData);
  const input = order.inputs[0].payment, output = order.output.payments[0];
  requireCheck(input.chainId === origin!.protocol!.v2!.chainId && order.output.chainId === destination!.protocol!.v2!.chainId, 'order chain mismatch');
  requireCheck(metadata.some(c => c.vmType === 'evm' && c.protocol?.v2?.chainId === order.solverChainId), 'unknown solver chain');
  requireCheck(same(input.currency, context.srcToken) && BigInt(input.amount) === BigInt(context.amount) && input.weight === '1', 'input token/amount mismatch');
  requireCheck(same(output.recipient, context.recipient) && same(output.currency, context.dstToken), 'destination recipient/token mismatch');
  const expected = BigInt(output.expectedAmount), minimum = BigInt(output.minimumAmount);
  requireCheck(expected > 0n && minimum > 0n && minimum <= expected && (minimum + 1n) * 10000n >= expected * BigInt(10000 - env.RELAY_SLIPPAGE_BPS), 'minimum output exceeds allowed slippage');
  requireCheck(order.output.deadline * 1000 > now + 10_000, 'expired order');
  for (const refund of order.inputs[0].refunds) {
    requireCheck(same(refund.recipient, context.sender) && metadata.some(c => c.vmType === 'evm' && c.protocol?.v2?.chainId === refund.chainId), 'unexpected refund recipient/chain');
  }
  const computedId = relayOrderId(order);
  requireCheck(same(computedId, protocol.orderId), 'order commitment mismatch');
  requireCheck(same(protocol.paymentDetails.depository, RELAY_DEPOSITORY) && protocol.paymentDetails.chainId === input.chainId && same(protocol.paymentDetails.currency, input.currency) && protocol.paymentDetails.amount === input.amount, 'payment details mismatch');
  const details = raw.details;
  requireCheck(same(details.sender, context.sender) && same(details.recipient, context.recipient), 'quoted wallet mismatch');
  requireCheck(details.currencyIn.currency.chainId === context.fromChainId && same(details.currencyIn.currency.address, context.srcToken) && details.currencyIn.amount === context.amount, 'quoted input mismatch');
  requireCheck(details.currencyOut.currency.chainId === context.toChainId && same(details.currencyOut.currency.address, context.dstToken) && details.currencyOut.amount === output.expectedAmount && details.currencyOut.minimumAmount === output.minimumAmount, 'quoted output mismatch');
  requireCheck(Array.isArray(raw.steps) && raw.steps.length > 0 && raw.steps.length <= 2, 'unsupported execution steps');
  let deposit: RelayTx | undefined, approvalSeen = false;
  for (const step of raw.steps) {
    requireCheck(step.kind === 'transaction' && step.items.length === 1 && (!step.requestId || same(step.requestId, raw.requestId)), 'unsupported signature or multi-transaction step');
    const tx = step.items[0].data;
    requireCheck(tx.chainId === context.fromChainId && same(tx.from, context.sender) && /^0x(?:[\da-fA-F]{2})+$/.test(tx.data), 'transaction sender/chain mismatch');
    if (step.id === 'approve') {
      requireCheck(!approvalSeen && !deposit && context.srcToken !== ZERO_ADDRESS && same(tx.to, context.srcToken) && BigInt(tx.value ?? '0') === 0n, 'unexpected approval');
      const decoded = decodeFunctionData({ abi: approveAbi, data: tx.data as `0x${string}` });
      requireCheck(same(decoded.args[0], RELAY_DEPOSITORY) && decoded.args[1] === BigInt(context.amount), 'wrong or unlimited approval');
      approvalSeen = true;
    } else {
      requireCheck(step.id === 'deposit' && !deposit && same(tx.to, RELAY_DEPOSITORY), 'unexpected transaction target');
      const native = context.srcToken === ZERO_ADDRESS;
      const wantedData = native
        ? encodeFunctionData({ abi: depositAbi, functionName: 'depositNative', args: [context.sender as `0x${string}`, computedId] })
        : encodeFunctionData({ abi: depositAbi, functionName: 'depositErc20', args: [context.sender as `0x${string}`, context.srcToken as `0x${string}`, BigInt(context.amount), computedId] });
      requireCheck(same(tx.data, wantedData) && BigInt(tx.value ?? '0') === (native ? BigInt(context.amount) : 0n), 'deposit calldata/value mismatch');
      deposit = tx;
    }
  }
  requireCheck(deposit, 'missing deposit transaction');
  const usd = (value: string) => { const n = Number(value); requireCheck(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(n) && n >= 0, 'invalid fee estimate'); return n; };
  const appUsd = usd(raw.fees.app.amountUsd), inputUsd = usd(details.currencyIn.amountUsd);
  const expectedFee = inputUsd * RELAY_FEE_BPS / 10000;
  requireCheck(BigInt(raw.fees.app.amount) > 0n && appUsd > 0 && inputUsd > 0 && Math.abs(appUsd - expectedFee) <= Math.max(0.000002, expectedFee * 0.001), 'five-bps fee missing or changed');
  const gasUsd = usd(raw.fees.gas.amountUsd), relayerUsd = usd(raw.fees.relayer.amountUsd);
  const totalUsd = Math.max(0, gasUsd + relayerUsd + appUsd - usd(raw.fees.subsidized?.amountUsd ?? '0'));
  return {
    // Wallet estimates gas and fees; never accept upstream gas-price overrides.
    transaction: { from: deposit.from, chainId: deposit.chainId, to: deposit.to, data: deposit.data, value: deposit.value },
    context, relayOrderId: computedId, expiresAt: Math.min(now + 120_000, order.output.deadline * 1000),
    dstAmount: output.expectedAmount, dstAmountMin: output.minimumAmount,
    feeUsd: totalUsd.toFixed(6), networkFeeUsd: gasUsd.toFixed(6), hopfastFeeUsd: raw.fees.app.amountUsd,
    feePercent: (totalUsd / inputUsd * 100).toFixed(4),
  };
}

// Short-lived, bounded execution tickets. A restarted server simply asks for a
// fresh quote. Untrusted clients cannot replace the quote between validation and signing.
const executionQuotes = new Map<string, ReturnType<typeof validateRelayQuote>>();
const quoteRequestTimes: number[] = [];
function reserveQuoteRequest() {
  const cutoff = Date.now() - 60_000;
  while (quoteRequestTimes.length && quoteRequestTimes[0] <= cutoff) quoteRequestTimes.shift();
  // Relay's default key quota is 50 quotes/minute. Keep room for dashboard use.
  requireCheck(quoteRequestTimes.length < 45, 'quote capacity reached; try again shortly');
  quoteRequestTimes.push(Date.now());
}
export function relayExecutionQuote(requestId: string, payload: Payload) {
  const quote = executionQuotes.get(requestId);
  requireCheck(quote && quote.expiresAt > Date.now() + 10_000, 'quote expired; refresh quotes');
  const context = relayRequestContext(payload);
  requireCheck(JSON.stringify(context) === JSON.stringify(quote.context), 'wallet or route changed; refresh quotes');
  return quote;
}
export async function requestRelayQuote(payload: Payload) {
  const context = relayRequestContext(payload);
  if (env.NODE_ENV === 'production' && !env.RELAY_API_KEY) throw new Error('Missing RELAY_API_KEY for production quotes.');
  const feeRecipient = assertValidRecipient(env.RELAY_FEE_RECIPIENT, 'Relay fee recipient');
  const metadata = await chains();
  reserveQuoteRequest();
  const response = await fetch(`${RELAY_API}/quote/v2`, {
    method: 'POST', headers: relayHeaders(), signal: AbortSignal.timeout(16000),
    body: JSON.stringify({
      user: context.sender, recipient: context.recipient, refundTo: context.sender,
      originChainId: context.fromChainId, destinationChainId: context.toChainId,
      originCurrency: context.srcToken, destinationCurrency: context.dstToken,
      amount: context.amount, tradeType: 'EXACT_INPUT', slippageTolerance: String(env.RELAY_SLIPPAGE_BPS),
      includeProtocolData: true, explicitDeposit: true, usePermit: false,
      // The current executor handles a canonical direct deposit only.
      disableOriginSwaps: true,
      appFees: [{ recipient: feeRecipient, fee: String(RELAY_FEE_BPS) }],
    }),
  });
  if (!response.ok) {
    // Never relay arbitrary upstream bodies/URLs to clients or logs.
    throw new Error(`Relay quote unavailable (${response.status}).`);
  }
  const raw = await response.json() as RelayQuote;
  const quote = validateRelayQuote(raw, context, metadata);
  for (const [id, q] of executionQuotes) if (q.expiresAt <= Date.now()) executionQuotes.delete(id);
  if (executionQuotes.size >= 1000) executionQuotes.delete(executionQuotes.keys().next().value!);
  executionQuotes.set(raw.requestId, quote);
  return {
    provider: 'relay' as const, requestId: raw.requestId,
    quotes: [{ id: raw.requestId, provider: 'relay', sourceAmountUsd: raw.details.currencyIn.amountUsd, routeSteps: [{ type: 'Relay' }],
      ...quote, duration: { estimated: String(Math.max(1000, (raw.details.timeEstimate ?? 30) * 1000)) },
      userSteps: [{ type: 'TRANSACTION', action: 'Deposit into Relay escrow.', transaction: quote.transaction }],
    }],
  };
}

export async function fetchRelayStatus(requestId: string, txHash: string, fromChainId: number, toChainId: number) {
  requireCheck(/^0x[\da-fA-F]{64}$/.test(requestId) && /^0x[\da-fA-F]{64}$/.test(txHash), 'invalid status request');
  const response = await fetch(`${RELAY_API}/intents/status/v3?${new URLSearchParams({ requestId })}`, { headers: relayHeaders(), signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return { status: 'confirming' as const, substatus: 'Waiting for Relay to detect your deposit.' };
  if (!response.ok) throw new Error('Relay status unavailable.');
  const data = await response.json() as { status: string; inTxHashes?: string[]; txHashes?: string[]; originChainId?: number; destinationChainId?: number; failReason?: string };
  requireCheck((data.originChainId == null || data.originChainId === fromChainId) && (data.destinationChainId == null || data.destinationChainId === toChainId), 'status chain mismatch');
  // A request ID alone is not evidence that this particular deposit settled.
  const matched = data.inTxHashes?.some(h => same(h, txHash));
  const status = data.status === 'success' && matched ? 'completed'
    : ['refund', 'failure'].includes(data.status) && matched ? 'failed'
    : ['pending', 'submitted'].includes(data.status) && matched ? 'bridging' : 'confirming';
  return {
    status: status as 'completed' | 'failed' | 'bridging' | 'confirming',
    substatus: data.status === 'refund' && matched ? 'Relay refunded the payment. Check your wallet.' : data.failReason ?? `Relay: ${data.status}`,
    sendingTxHash: txHash,
    receivingTxHash: matched && data.status === 'success' ? data.txHashes?.find(h => /^0x[\da-fA-F]{64}$/.test(h)) : undefined,
  };
}
