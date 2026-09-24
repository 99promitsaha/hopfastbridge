import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { ARC_CHAIN_ID, ARC_EXPLORER, arcRpc, assertArcNetwork, parseUsdc, validAddress } from './arc.js';

export interface Payment {
  id: string; tokenHash: string; walletAddress: string; recipient: string; amount: string; value: string;
  recipientHandle?: string;
  memo: string; chainId: number; createdAt: string; expiresAt: string;
  status: 'awaiting_approval' | 'submitted' | 'completed' | 'failed' | 'expired' | 'cancelled';
  txHash?: string; explorerLink?: string; checkedAt?: string; trackingMessage?: string;
}
const hash = (token: string) => createHash('sha256').update(token).digest();
const file = resolve(env.PAYMENT_STORE_PATH);
mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
const payments: Record<string, Payment> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
function save() {
  writeFileSync(file + '.tmp', JSON.stringify(payments), { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
export function publicPayment(payment: Payment) {
  const { tokenHash: _tokenHash, ...rest } = payment;
  return { ...rest, transactionRequest: { from: payment.walletAddress, to: payment.recipient, value: '0x' + BigInt(payment.value).toString(16), data: '0x', chainId: '0x' + ARC_CHAIN_ID.toString(16) } };
}
export function createPayment(input: { walletAddress: string; recipient: string; amount: string; recipientHandle?: string; memo?: string }) {
  if (!validAddress(input.walletAddress) || !validAddress(input.recipient)) throw new Error('Invalid wallet or recipient.');
  const value = parseUsdc(input.amount).toString();
  const token = randomBytes(32).toString('hex');
  const id = randomUUID();
  const payment: Payment = {
    id, tokenHash: hash(token).toString('hex'), walletAddress: input.walletAddress.toLowerCase(), recipient: input.recipient.toLowerCase(), amount: input.amount,
    recipientHandle: input.recipientHandle?.toLowerCase(),
    value, memo: input.memo ?? '', chainId: ARC_CHAIN_ID, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), status: 'awaiting_approval'
  };
  payments[id] = payment; save();
  const url = new URL(env.APP_BASE_URL); url.searchParams.set('payment', id); url.hash = token;
  return { payment: publicPayment(payment), accessToken: token, reviewUrl: url.toString() };
}
export function paymentsBySender(walletAddress: string) {
  return Object.values(payments)
    .filter((payment) => payment.walletAddress === walletAddress.toLowerCase())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100)
    .map(({ tokenHash: _tokenHash, value: _value, ...payment }) => payment);
}
export function settledPaymentStats() {
  const settled = Object.values(payments).filter((payment) => payment.status === 'completed');
  return {
    count: settled.length,
    volumeUsd: settled.reduce((total, payment) => total + Number(payment.amount), 0),
  };
}
export function getPayment(id: string, token: string): Payment | undefined {
  const payment = Object.hasOwn(payments, id) ? payments[id] : undefined;
  if (!payment || token.length !== 64 || !timingSafeEqual(hash(token), Buffer.from(payment.tokenHash, 'hex'))) return;
  if (payment.status === 'awaiting_approval' && Date.now() > Date.parse(payment.expiresAt)) { payment.status = 'expired'; save(); }
  return payment;
}
export function cancelPayment(payment: Payment) {
  if (payment.status !== 'awaiting_approval') throw new Error('Only an unsigned payment can be cancelled.');
  payment.status = 'cancelled'; save();
}
type RpcTx = { from: string; to: string | null; value: string; input: string; chainId?: string; hash: string; blockNumber?: string | null };
export function transactionMatches(payment: Payment, tx: RpcTx): boolean {
  return tx.from.toLowerCase() === payment.walletAddress && tx.to?.toLowerCase() === payment.recipient
    && BigInt(tx.value) === BigInt(payment.value) && tx.input === '0x'
    && (tx.chainId == null || BigInt(tx.chainId) === BigInt(ARC_CHAIN_ID));
}
export async function submitPayment(payment: Payment, txHash: string) {
  if (payment.txHash === txHash.toLowerCase()) return payment;
  if (!['awaiting_approval', 'expired'].includes(payment.status)) throw new Error('Payment cannot accept a transaction record.');
  if (!/^0x[\da-fA-F]{64}$/.test(txHash)) throw new Error('Invalid transaction hash.');
  await assertArcNetwork();
  const tx = await arcRpc<RpcTx | null>('eth_getTransactionByHash', [txHash]);
  if (!tx) throw new Error('Transaction not yet visible on Arc. Retry recording the same hash; do not send another payment.');
  if (!transactionMatches(payment, tx) || tx.hash.toLowerCase() !== txHash.toLowerCase()) throw new Error('Transaction does not match this payment.');
  if (tx.blockNumber) {
    const block = await arcRpc<{ timestamp: string }>('eth_getBlockByNumber', [tx.blockNumber, false]);
    if (!block || Number(BigInt(block.timestamp)) < Math.floor(Date.parse(payment.createdAt) / 1000)) throw new Error('Transaction predates this payment request.');
  }
  // Re-check after asynchronous RPC calls, including concurrent submissions.
  if (!['awaiting_approval', 'expired'].includes(payment.status)) throw new Error('Payment was already updated.');
  if (Object.values(payments).some(p => p.id !== payment.id && p.txHash === txHash.toLowerCase())) throw new Error('Transaction already recorded for another payment.');
  payment.txHash = txHash.toLowerCase(); payment.status = 'submitted'; payment.explorerLink = `${ARC_EXPLORER}/tx/${payment.txHash}`; save();
  return refreshPayment(payment);
}
const inFlight = new Set<string>();
export async function refreshPayment(payment: Payment) {
  if (payment.status !== 'submitted' || !payment.txHash || inFlight.has(payment.id)) return payment;
  inFlight.add(payment.id);
  try {
    await assertArcNetwork();
    const tx = await arcRpc<RpcTx | null>('eth_getTransactionByHash', [payment.txHash]);
    if (!tx || !transactionMatches(payment, tx)) throw new Error('Transaction unavailable or mismatched.');
    const receipt = await arcRpc<{ status: string; transactionHash: string; blockHash: string } | null>('eth_getTransactionReceipt', [payment.txHash]);
    if (receipt && receipt.transactionHash.toLowerCase() === payment.txHash && receipt.blockHash) {
      if (receipt.status === '0x1') payment.status = 'completed';
      else if (receipt.status === '0x0') payment.status = 'failed';
    }
    payment.checkedAt = new Date().toISOString(); payment.trackingMessage = payment.status === 'submitted' ? 'Awaiting an Arc receipt.' : 'Arc transaction verified.';
  } catch {
    payment.checkedAt = new Date().toISOString();
    payment.trackingMessage = 'Verification unavailable. Payment status is unknown; do not resend.';
  } finally { inFlight.delete(payment.id); save(); }
  return payment;
}
export function startPaymentTracking() {
  const tick = () => {
    const submitted = Object.values(payments).filter(p => p.status === 'submitted').sort((a, b) => (a.checkedAt ?? '').localeCompare(b.checkedAt ?? '')).slice(0, 20);
    void Promise.allSettled(submitted.map(refreshPayment));
  };
  tick(); const timer = setInterval(tick, 15000); timer.unref(); return () => clearInterval(timer);
}
