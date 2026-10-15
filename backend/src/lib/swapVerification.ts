import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { env } from '../config/env.js';
import assets from '../config/swapAssets.json' with { type: 'json' };
import { TransactionHistory } from '../models/TransactionHistory.js';

export class HistoryError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const swapChains = Object.fromEntries(assets.map(chain => [chain.key, chain]));
const chainSchema = z.enum(['ethereum', 'base', 'bsc', 'polygon', 'monad', 'robinhood', 'arc']);
const rpcOverrides = z.record(chainSchema, z.string().url()).parse(JSON.parse(env.SWAP_RPC_URLS));
const rpcUrls: Record<string, string> = {
  ethereum: 'https://ethereum-rpc.publicnode.com', base: 'https://mainnet.base.org',
  bsc: 'https://bsc-rpc.publicnode.com', polygon: 'https://polygon-bor-rpc.publicnode.com',
  monad: 'https://rpc.monad.xyz', robinhood: 'https://rpc.mainnet.chain.robinhood.com', arc: env.ARC_RPC_URL,
  ...rpcOverrides,
};
const hexHash = z.string().regex(/^0x[\da-f]{64}$/);
const proofSchema = z.object({
  version: z.literal(1), userAddress: z.string().regex(/^0x[\da-f]{40}$/),
  fromChain: chainSchema, toChain: chainSchema, fromTokenSymbol: z.string().max(32), toTokenSymbol: z.string().max(32),
  amount: z.string().max(100), volumeUsd: z.number().finite().nonnegative().nullable(),
  provider: z.enum(['lifi', 'squid', 'relay']), quoteId: z.string().min(1).max(256),
  requestId: z.string().max(256).optional(), transactionDigests: z.array(z.string().regex(/^[\da-f]{64}$/)).min(1).max(2),
  issuedAt: z.number().int(), expiresAt: z.number().int(),
}).strict();
export type HistoryProof = z.infer<typeof proofSchema>;
let key: Buffer | undefined;
function signingKey() {
  if (key) return key;
  // Domain-separated authentication material; no onchain signature is exposed.
  let material = env.HISTORY_SIGNING_SECRET ?? env.INVOICE_SIGNER_KEY ?? env.ARCHITECT_SIGNER_KEY;
  if (!material) {
    const file = join(dirname(env.PAYMENT_STORE_PATH), 'history-signing.key');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    try { writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    material = readFileSync(file, 'utf8').trim();
    if (!/^[\da-f]{64}$/i.test(material)) throw new Error('Invalid history signing material.');
  }
  key = createHmac('sha256', material).update('Hopfast verified swap history v1').digest();
  return key;
}
function digestTransaction(to: string, value: string, data: string) {
  return createHash('sha256').update(`${to.toLowerCase()}:${BigInt(value)}:${data.toLowerCase()}`).digest('hex');
}
const builderSuffix = Buffer.from('bc_52mjdvpq').toString('hex') + '0b00' + '80218021802180218021802180218021';
function token(chain: string | undefined, address: string | undefined) {
  const normalized = address?.toLowerCase();
  return swapChains[chain ?? '']?.tokens.find(asset => asset.address === normalized || (normalized === '0x' + '0'.repeat(40) && asset.address === '0x' + 'e'.repeat(40)));
}
export function issueHistoryProof(provider: HistoryProof['provider'], payload: { srcChainKey?: string; dstChainKey?: string; srcTokenAddress?: string; dstTokenAddress?: string; srcWalletAddress?: string; amount?: string }, quote: any, requestId?: string) {
  const fromToken = token(payload.srcChainKey, payload.srcTokenAddress), toToken = token(payload.dstChainKey, payload.dstTokenAddress);
  const tx = quote.userSteps?.find((step: any) => step.type === 'TRANSACTION')?.transaction;
  if (!fromToken || !toToken || !tx?.to || !tx.data || !payload.amount) return undefined;
  const amount = BigInt(payload.amount), scale = 10n ** BigInt(fromToken.decimals);
  const fraction = (amount % scale).toString().padStart(fromToken.decimals, '0').replace(/0+$/, '');
  const sourceUsd = Number(quote.sourceAmountUsd ?? quote.raw?.estimate?.fromAmountUSD ?? quote.raw?.route?.estimate?.fromAmountUSD);
  const data = tx.data.toLowerCase();
  const claim = proofSchema.parse({
    version: 1, userAddress: payload.srcWalletAddress?.toLowerCase(), fromChain: payload.srcChainKey, toChain: payload.dstChainKey,
    fromTokenSymbol: fromToken.symbol, toTokenSymbol: toToken.symbol,
    amount: `${amount / scale}${fraction ? '.' + fraction : ''}`,
    volumeUsd: Number.isFinite(sourceUsd) && sourceUsd > 0 ? sourceUsd : null,
    provider, quoteId: quote.id, ...(requestId ? { requestId } : {}),
    transactionDigests: [digestTransaction(tx.to, tx.value ?? '0', data), ...(payload.srcChainKey === 'base' && provider !== 'relay' ? [digestTransaction(tx.to, tx.value ?? '0', data + builderSuffix)] : [])],
    issuedAt: Date.now(), expiresAt: Date.now() + 7 * 86400000,
  });
  const encoded = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `${encoded}.${createHmac('sha256', signingKey()).update(encoded).digest('hex')}`;
}
export function readHistoryProof(proof: string): HistoryProof {
  if (proof.length > 4096) throw new HistoryError('Invalid swap verification proof.', 400);
  const [encoded, mac, extra] = proof.split('.');
  if (!encoded || !/^[\da-f]{64}$/.test(mac ?? '') || extra !== undefined || !timingSafeEqual(Buffer.from(mac, 'hex'), createHmac('sha256', signingKey()).update(encoded).digest())) throw new HistoryError('Invalid swap verification proof.', 400);
  let claim: HistoryProof;
  try { claim = proofSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString())); }
  catch { throw new HistoryError('Invalid swap verification proof.', 400); }
  if (claim.expiresAt <= Date.now()) throw new HistoryError('Swap verification proof expired.', 400);
  return claim;
}
async function rpc<T>(chain: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrls[chain], { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!response.ok) throw new HistoryError('Source transaction verification is temporarily unavailable.', 503);
  const result = await response.json() as { result: T; error?: unknown };
  if (result.error) throw new HistoryError('Source transaction verification is temporarily unavailable.', 503);
  return result.result;
}
let sourceChecks = 0;
export async function verifySource(claim: HistoryProof, txHash: string) {
  if (sourceChecks >= 32) throw new HistoryError('Source verification is busy. Please retry shortly.', 503);
  sourceChecks++;
  try { return await checkSource(claim, txHash); }
  finally { sourceChecks--; }
}
async function checkSource(claim: HistoryProof, txHash: string) {
  const chainId = await rpc<string>(claim.fromChain, 'eth_chainId', []);
  if (BigInt(chainId) !== BigInt(swapChains[claim.fromChain].chainId)) throw new HistoryError('Source verification network mismatch.', 503);
  const tx = await rpc<{ hash: string; from: string; to: string | null; input: string; value: string; blockNumber?: string | null; chainId?: string } | null>(claim.fromChain, 'eth_getTransactionByHash', [txHash]);
  if (!tx) throw new HistoryError('Transaction not visible yet. Retry recording this hash; do not send another swap.', 425);
  if (tx.hash?.toLowerCase() !== txHash || tx.from?.toLowerCase() !== claim.userAddress || !tx.to ||
      (tx.chainId && BigInt(tx.chainId) !== BigInt(swapChains[claim.fromChain].chainId)) ||
      !claim.transactionDigests.includes(digestTransaction(tx.to, tx.value, tx.input))) throw new HistoryError('Transaction does not match the issued Hopfast quote.');
  const receipt = await rpc<{ status: string; transactionHash: string; blockHash: string } | null>(claim.fromChain, 'eth_getTransactionReceipt', [txHash]);
  if (receipt && (receipt.transactionHash?.toLowerCase() !== txHash || !hexHash.safeParse(receipt.blockHash?.toLowerCase()).success || !['0x0', '0x1'].includes(receipt.status))) throw new HistoryError('Source receipt does not match this transaction.');
  if (tx.blockNumber) {
    const block = await rpc<{ timestamp: string } | null>(claim.fromChain, 'eth_getBlockByNumber', [tx.blockNumber, false]);
    if (!block || Number(BigInt(block.timestamp)) * 1000 < claim.issuedAt - 120000) throw new HistoryError('Transaction predates the issued quote.');
  }
  return { sourceConfirmed: receipt?.status === '0x1', status: receipt?.status === '0x0' ? 'failed' : receipt ? 'submitted' : 'confirming' };
}
export const recordHistorySchema = z.object({ txHash: z.string().regex(/^0x[\da-fA-F]{64}$/), historyProof: z.string().min(1).max(4096), userAddress: z.string().regex(/^0x[\da-fA-F]{40}$/).optional() });
export async function recordVerifiedHistory(input: z.infer<typeof recordHistorySchema>) {
  const claim = readHistoryProof(input.historyProof), txHash = input.txHash.toLowerCase();
  if (input.userAddress && input.userAddress.toLowerCase() !== claim.userAddress) throw new HistoryError('The recording wallet does not match this quote.');
  const verificationKey = `${swapChains[claim.fromChain].chainId}:${txHash}`;
  // Replay can only return an existing immutable record, never modify it.
  const existing = await TransactionHistory.findOne({ verificationKey });
  if (existing) return existing;
  const source = await verifySource(claim, txHash);
  const record = { userAddress: claim.userAddress, txHash, verificationKey, proofVersion: 1, sourceConfirmed: source.sourceConfirmed,
    quoteId: claim.quoteId, provider: claim.provider, fromChain: claim.fromChain, toChain: claim.toChain,
    fromTokenSymbol: claim.fromTokenSymbol, toTokenSymbol: claim.toTokenSymbol, amount: claim.amount, volumeUsd: claim.volumeUsd,
    status: source.status, verification: claim, metadata: { quoteId: claim.quoteId, ...(claim.requestId ? { requestId: claim.requestId } : {}) },
  };
  // An old unverified row with this hash can be replaced only by chain-verified
  // canonical data. Once verified, this filter cannot modify it again.
  try { return await TransactionHistory.findOneAndUpdate({ userAddress: claim.userAddress, txHash, proofVersion: { $ne: 1 } }, { $set: record }, { upsert: true, new: true, setDefaultsOnInsert: true }); }
  catch (error) {
    if ((error as { code?: number }).code === 11000) { const saved = await TransactionHistory.findOne({ verificationKey }); if (saved) return saved; }
    throw error;
  }
}
