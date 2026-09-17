import { env } from '../config/env.js';
export const ARC_CHAIN_ID = 5042;
export const ARC_EXPLORER = 'https://explorer.arc.io';
export const ADDRESS = /^0x[\da-fA-F]{40}$/;
export function validAddress(value: string): boolean {
  return ADDRESS.test(value) && !/^0x0{40}$/i.test(value);
}
export function parseUsdc(amount: string): bigint {
  if (!/^\d+(?:\.\d{1,18})?$/.test(amount) || amount.length > 50) throw new Error('Use a positive decimal USDC amount with at most 18 decimals.');
  const [whole, fraction = ''] = amount.split('.');
  const units = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (units <= 0n || units >= 2n ** 256n) throw new Error('USDC amount is out of range.');
  return units;
}
export function formatUsdc(units: bigint): string {
  const fraction = (units % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${units / 10n ** 18n}${fraction ? '.' + fraction : ''}`;
}
export async function arcRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(env.ARC_RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Arc RPC unavailable.');
  const body = await response.json() as { result: T; error?: { message: string } };
  if (body.error) throw new Error('Arc RPC request failed.');
  return body.result;
}
export async function assertArcNetwork(): Promise<void> {
  const id = await arcRpc<string>('eth_chainId', []);
  if (BigInt(id) !== BigInt(ARC_CHAIN_ID)) throw new Error('Configured RPC is not Arc mainnet.');
}
