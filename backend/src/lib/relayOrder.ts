import { hashStruct } from 'viem';
import { z } from 'zod';

const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
const hex = z.string().regex(/^0x(?:[\da-fA-F]{2})*$/).max(8194);
const uint = z.string().regex(/^\d+$/).max(78).refine(v => BigInt(v) < 2n ** 256n);
const deadline = z.number().int().positive().max(2 ** 32 - 1);
export const relayOrderSchema = z.object({
  version: z.literal('v1'), solverChainId: z.string().max(64), solver: address,
  salt: z.string().regex(/^0x[\da-fA-F]{64}$/),
  inputs: z.array(z.object({
    payment: z.object({ chainId: z.string().max(64), currency: address, amount: uint, weight: uint }).strict(),
    refunds: z.array(z.object({
      chainId: z.string().max(64), recipient: address, currency: address,
      minimumAmount: uint, deadline, extraData: hex,
    }).strict()).min(1).max(8),
  }).strict()).length(1),
  output: z.object({
    chainId: z.string().max(64),
    payments: z.array(z.object({ recipient: address, currency: address, minimumAmount: uint, expectedAmount: uint }).strict()).length(1),
    deadline, calls: z.array(hex).length(0), extraData: hex,
  }).strict(),
  // App fees accrue offchain. Extra settlement payments are unsupported here.
  fees: z.array(z.unknown()).length(0),
}).strict();
export type RelayOrder = z.infer<typeof relayOrderSchema>;

// Relay settlement-sdk 0.0.146 Order/v1 EIP-712 format (MIT, Uneven Labs).
// EVM addresses are already 20-byte hex, so no multichain codec is needed.
// https://docs.relay.link/references/api/api_core_concepts/input-validation
// Keep this version pinned: future order versions fail closed until reviewed.
const types = {
  Order: [
    { name: 'version', type: 'string' }, { name: 'solverChainId', type: 'string' },
    { name: 'solver', type: 'address' }, { name: 'salt', type: 'uint256' },
    { name: 'inputs', type: 'Input[]' }, { name: 'output', type: 'Output' }, { name: 'fees', type: 'Fee[]' },
  ],
  Input: [{ name: 'payment', type: 'InputPayment' }, { name: 'refunds', type: 'InputRefund[]' }],
  InputPayment: [
    { name: 'chainId', type: 'string' }, { name: 'currency', type: 'bytes' },
    { name: 'amount', type: 'uint256' }, { name: 'weight', type: 'uint256' },
  ],
  InputRefund: [
    { name: 'chainId', type: 'string' }, { name: 'recipient', type: 'bytes' },
    { name: 'currency', type: 'bytes' }, { name: 'minimumAmount', type: 'uint256' },
    { name: 'deadline', type: 'uint32' }, { name: 'extraData', type: 'bytes' },
  ],
  Output: [
    { name: 'chainId', type: 'string' }, { name: 'payments', type: 'OutputPayment[]' },
    { name: 'deadline', type: 'uint32' }, { name: 'calls', type: 'bytes[]' }, { name: 'extraData', type: 'bytes' },
  ],
  OutputPayment: [
    { name: 'recipient', type: 'bytes' }, { name: 'currency', type: 'bytes' },
    { name: 'minimumAmount', type: 'uint256' }, { name: 'expectedAmount', type: 'uint256' },
  ],
  Fee: [
    { name: 'recipientChainId', type: 'string' }, { name: 'recipient', type: 'bytes' },
    { name: 'currencyChainId', type: 'string' }, { name: 'currency', type: 'bytes' }, { name: 'amount', type: 'uint256' },
  ],
};
export function relayOrderId(order: RelayOrder): `0x${string}` {
  return hashStruct({ types, primaryType: 'Order', data: order });
}
