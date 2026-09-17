import { NATIVE_TOKEN_ADDRESS } from './chains';

const ALLOWANCE_SELECTOR = '0xdd62ed3e';
const APPROVE_SELECTOR = '0x095ea7b3';

export function encodeAllowanceCall(owner: string, spender: string): string {
  const o = owner.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const s = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  return `${ALLOWANCE_SELECTOR}${o}${s}`;
}

export function encodeApproveCall(spender: string, approveAmount: bigint): string {
  const s = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amount = approveAmount.toString(16).padStart(64, '0');
  return `${APPROVE_SELECTOR}${s}${amount}`;
}

export function isNativeToken(address: string): boolean {
  const lower = address.toLowerCase();
  return lower === NATIVE_TOKEN_ADDRESS.toLowerCase()
    || lower === '0x0000000000000000000000000000000000000000';
}

export async function ensureTokenApproval(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  requiredAmount: bigint
): Promise<void> {
  if (isNativeToken(tokenAddress)) return;

  const data = encodeAllowanceCall(ownerAddress, spenderAddress);
  const allowanceHex = (await provider.request({
    method: 'eth_call',
    params: [{ to: tokenAddress, data }, 'latest']
  })) as string;

  const currentAllowance = BigInt(allowanceHex || '0x0');
  if (currentAllowance >= requiredAmount) return;

  const approveData = encodeApproveCall(spenderAddress, requiredAmount);
  await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: ownerAddress,
      to: tokenAddress,
      data: approveData,
      value: '0x0'
    }]
  });

  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const updatedHex = (await provider.request({
      method: 'eth_call',
      params: [{ to: tokenAddress, data }, 'latest']
    })) as string;
    if (BigInt(updatedHex || '0x0') >= requiredAmount) return;
  }

  throw new Error('Token approval was not confirmed in time. Please try again.');
}
