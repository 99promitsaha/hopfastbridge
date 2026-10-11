import { encodeFunctionData, parseAbi } from 'viem';
import type { QuoteResult } from '../services/quoteService';
import { CHAIN_BY_KEY, getToken } from './chains';
import { parseUnits } from './amount';
import { isNativeToken } from './erc20';
import type { SwapDraft } from '../types';

const depository = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
const abi = parseAbi([
  'function depositNative(address depositor, bytes32 id)',
  'function depositErc20(address depositor, address token, uint256 amount, bytes32 id)',
]);
const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
export function relayExecutionPayload(draft: SwapDraft, wallet: string) {
  const source = getToken(draft.fromChain, draft.fromTokenSymbol)!;
  return {
    srcChainKey: draft.fromChain, dstChainKey: draft.toChain,
    srcTokenAddress: source.address,
    dstTokenAddress: getToken(draft.toChain, draft.toTokenSymbol)!.address,
    srcWalletAddress: wallet, dstWalletAddress: wallet,
    amount: parseUnits(draft.amount, source.decimals).toString(),
  };
}
/** Recheck route binding before approval AND after every wallet interaction. */
export function assertRelayExecution(quote: QuoteResult, draft: SwapDraft, wallet: string, now = Date.now()) {
  const context = quote.context, tx = quote.transactionRequest;
  const source = getToken(draft.fromChain, draft.fromTokenSymbol);
  const destination = getToken(draft.toChain, draft.toTokenSymbol);
  if (!context || !tx || !source || !destination || !quote.expiresAt || quote.expiresAt <= now + 10_000) throw new Error('Relay quote expired. Refresh quotes before continuing.');
  const normalize = (a: string) => isNativeToken(a) ? '0x0000000000000000000000000000000000000000' : a;
  const amount = parseUnits(draft.amount, source.decimals);
  if (!same(context.sender, wallet) || !same(context.recipient, wallet) ||
    context.fromChainId !== CHAIN_BY_KEY[draft.fromChain].chainId || context.toChainId !== CHAIN_BY_KEY[draft.toChain].chainId ||
    !same(context.srcToken, normalize(source.address)) || !same(context.dstToken, normalize(destination.address)) || BigInt(context.amount) !== amount || !same(tx.to, depository)) {
    throw new Error('Wallet or swap details changed. Refresh Relay quotes.');
  }
  const orderId = quote.relayOrderId;
  if (!orderId || !/^0x[\da-fA-F]{64}$/.test(orderId)) throw new Error('Relay settlement order is missing.');
  const data = isNativeToken(source.address)
    ? encodeFunctionData({ abi, functionName: 'depositNative', args: [wallet as `0x${string}`, orderId as `0x${string}`] })
    : encodeFunctionData({ abi, functionName: 'depositErc20', args: [wallet as `0x${string}`, normalize(source.address) as `0x${string}`, amount, orderId as `0x${string}`] });
  if (!same(tx.data, data) || BigInt(tx.value ?? '0') !== (isNativeToken(source.address) ? amount : 0n)) throw new Error('Relay deposit transaction does not match the verified order.');
}
