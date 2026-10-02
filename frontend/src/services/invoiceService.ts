import { createPublicClient, createWalletClient, custom, http, erc20Abi, type Address, type Hex } from 'viem';
import artifact from '../contracts/InvoiceEscrow.json';
import type { PrivyWalletBridge } from '../components/WalletConnector';

export type Billing = { name: string; email: string; address: string };
export type Business = Billing & { clients: (Billing & { id: string })[] };
export type InvoiceInput = { number: string; client: Billing; issueDate: string; dueDate: string; lines: { description: string; quantity: string; rate: string }[]; discount: string; taxBps: number; notes: string };
export type InvoiceRecord = { invoiceId: Hex; owner: Address; handle?: string; state: string; input: InvoiceInput; billing?: Billing; totals: { lineTotals: string[]; subtotal: string; discount: string; tax: string; total: string }; detailsHash?: Hex; contract?: Address; url?: string; payer?: string; fundedTx?: Hex; settlementTx?: Hex };
export type InvoiceConfig = { configured: boolean; contract?: Address; admin: Address; chainId: number; rpcUrl: string };
export type PaymentAuthorization = { invoiceId: Hex; issuer: Address; payer: Address; amount: string; detailsHash: Hex; deadline: number; signature: Hex; contract: Address; token: Address };
const base = (import.meta.env.VITE_HOPFAST_API_BASE_URL || (['localhost', '127.0.0.1'].includes(location.hostname) ? `http://${location.hostname}:8080/api` : '/api')).replace(/\/$/, '');
export async function invoiceApi<T>(path: string, session = '', body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`${base}/invoices${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), credentials: 'include', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not complete the invoice action.'); return result;
}
const invoiceSessions = new Map<string, { token: string; expiresAt: number }>();
export function clearInvoiceSessions() { invoiceSessions.clear(); }
export async function invoiceLogin(wallet: PrivyWalletBridge) {
  const address = wallet.address.toLowerCase();
  const existing = invoiceSessions.get(address);
  if (existing && existing.expiresAt > Date.now()) return existing.token;
  const challenge = await invoiceApi<{ nonce: string; message: string }>('/challenge', '', { wallet: wallet.address });
  const provider = await wallet.getEthereumProvider();
  const signature = await provider.request({ method: 'personal_sign', params: [`0x${Array.from(new TextEncoder().encode(challenge.message)).map(b => b.toString(16).padStart(2, '0')).join('')}`, wallet.address] });
  const { session } = await invoiceApi<{ session: string }>('/session', '', { nonce: challenge.nonce, signature });
  invoiceSessions.set(address, { token: session, expiresAt: Date.now() + 55 * 60 * 1000 });
  return session;
}
export function usdc(value: string | bigint) {
  const raw = BigInt(value); const fraction = (raw % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${raw / 1000000n}${fraction ? `.${fraction}` : ''}`;
}
export async function invoiceWrite(config: InvoiceConfig, wallet: PrivyWalletBridge, contract: Address, method: string, args: unknown[]) {
  await wallet.switchChain(config.chainId);
  const provider = await wallet.getEthereumProvider();
  const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
  if (!accounts.some(account => account.toLowerCase() === wallet.address.toLowerCase())) throw new Error('Reconnect the wallet you used for this invoice.');
  const reader = createPublicClient({ transport: http(config.rpcUrl) });
  if (await reader.getChainId() !== config.chainId) throw new Error('Invoice RPC network mismatch.');
  const signer = createWalletClient({ account: wallet.address as Address, transport: custom(provider) });
  if (method === 'pay') {
    const amount = BigInt(String(args[2])), token = '0x3600000000000000000000000000000000000000';
    const allowance = await reader.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [wallet.address as Address, contract] });
    if (allowance < amount) {
      const hash = await signer.writeContract({ chain: null, address: token, abi: erc20Abi, functionName: 'approve', args: [contract, amount] });
      if ((await reader.waitForTransactionReceipt({ hash })).status !== 'success') throw new Error('USDC approval failed.');
    }
  }
  const simulation = await reader.simulateContract({ account: wallet.address as Address, address: contract, abi: artifact.abi, functionName: method, args });
  const hash = await signer.writeContract({ ...simulation.request, chain: null });
  if ((await reader.waitForTransactionReceipt({ hash })).status !== 'success') throw new Error('Invoice transaction failed.');
  return hash;
}
