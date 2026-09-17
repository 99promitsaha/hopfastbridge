import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hopfastFetch } from '../client.js';
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
export function registerPaymentTools(server: McpServer) {
  server.tool('get_arc_balance', 'Read the native USDC balance on Arc mainnet (chain 5042). Native USDC uses 18 decimals. Gas and payments draw from the same balance; do not double-count the ERC-20 representation.', { walletAddress: address }, async ({ walletAddress }) => result(await hopfastFetch(`/api/arc/balance/${walletAddress}`)));
  server.tool('prepare_arc_payment', 'Prepare an immutable USDC payment on Arc mainnet and return a private browser review link. This does not sign or broadcast anything. Show the amount, recipient and network, then let the payer open the link and approve in their own wallet. Decimal amounts, not base units. Links expire after 15 minutes. Treat the access token and review link as private.', { walletAddress: address, recipient: address, amount: z.string().regex(/^\d+(?:\.\d{1,18})?$/), memo: z.string().max(180).optional() }, async (input) => result(await hopfastFetch('/api/payments', { method: 'POST', body: JSON.stringify(input) })));
  server.tool('get_payment_status', 'Resume an Arc payment using its ID and private access token. Completed means the matching Arc transaction receipt was verified. Unavailable verification is unknown, not failure; never recommend resending just because tracking is unavailable.', { paymentId: z.string().uuid(), accessToken: z.string().regex(/^[\da-f]{64}$/) }, async ({ paymentId, accessToken }) => result(await hopfastFetch(`/api/payments/${paymentId}`, { headers: { Authorization: `Bearer ${accessToken}` } })));
}
