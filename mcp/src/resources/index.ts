/**
 * MCP Resources — static reference data agents can read at any time
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const SUPPORTED_CHAINS = [
  {
    key: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    nativeToken: 'ETH',
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    blockExplorer: 'https://etherscan.io',
    popularTokens: [
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
      { symbol: 'DAI',  address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    ],
  },
  {
    key: 'base',
    chainId: 8453,
    name: 'Base',
    nativeToken: 'ETH',
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    blockExplorer: 'https://basescan.org',
    popularTokens: [
      { symbol: 'USDC',    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      { symbol: 'cbBTC',   address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8 },
      { symbol: 'WETH',    address: '0x4200000000000000000000000000000000000006', decimals: 18 },
      { symbol: 'VIRTUAL', address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', decimals: 18 },
    ],
  },
  {
    key: 'bsc',
    chainId: 56,
    name: 'BNB Chain',
    nativeToken: 'BNB',
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    blockExplorer: 'https://bscscan.com',
    popularTokens: [
      { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
    ],
  },
  {
    key: 'polygon',
    chainId: 137,
    name: 'Polygon',
    nativeToken: 'POL',
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    blockExplorer: 'https://polygonscan.com',
    popularTokens: [
      { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
      { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
      { symbol: 'WETH', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
      { symbol: 'WBTC', address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals: 8 },
    ],
  },
  {
    key: 'monad',
    chainId: 143,
    name: 'Monad',
    nativeToken: 'MON',
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    blockExplorer: 'https://explorer.monad.xyz',
    popularTokens: [],
  },
];

const AGENT_GUIDE = `# Hopfastbridge Agent Guide

Compare supported swap routes, prepare user-approved Arc payments, and check receipts.
Never ask for a private key. An address identifies a wallet; it does not prove ownership.
Use compare_swap_routes for actual provider comparison. get_swap_quote defaults to LI.FI.
Amounts for swap tools are integer strings in each token's smallest unit. Read hopfast://chains; decimals vary by chain, including stablecoins.
Arc payment tools accept decimal USDC strings. Native Arc USDC uses 18 decimals.
prepare_arc_payment returns a browser review URL and private access token. Show the amount, recipient, and network before opening it. User signs in a wallet. The request remains pending until its on-chain transaction is verified.
Use get_payment_status with the payment ID and token to resume tracking. Do not report success from a submitted hash alone. RPC failures mean unknown, not failed.
The HTTP server has no built-in model, autonomous signer, or delegated spending permissions.
`;

export function registerResources(server: McpServer): void {
  // ─── hopfast://guide ───────────────────────────────────────────────────────
  server.resource(
    'hopfast://guide',
    'HopFast Agent Guide — workflows, authentication, and best practices',
    async () => ({
      contents: [
        {
          uri: 'hopfast://guide',
          mimeType: 'text/markdown',
          text: AGENT_GUIDE,
        },
      ],
    }),
  );

  // ─── hopfast://chains ──────────────────────────────────────────────────────
  server.resource(
    'hopfast://chains',
    'Supported blockchain networks with chain IDs, native tokens, and popular token addresses',
    async () => ({
      contents: [
        {
          uri: 'hopfast://chains',
          mimeType: 'application/json',
          text: JSON.stringify(SUPPORTED_CHAINS, null, 2),
        },
      ],
    }),
  );
}
