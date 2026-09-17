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

const AGENT_GUIDE = `# HopFast Agent Guide

HopFast is a DeFi aggregator that lets users swap tokens across 5 blockchains
and earn yield in DeFi vaults. This guide explains how to use HopFast as an agent.

---

## Authentication
HopFast uses **wallet-based identity** — no username/password.
Every action is tied to a wallet address (0x...). You need the user's wallet
address to perform personalised operations.

---

## Supported Chains
| Chain     | Key        | Chain ID |
|-----------|------------|----------|
| Ethereum  | ethereum   | 1        |
| Base      | base       | 8453     |
| BNB Chain | bsc        | 56       |
| Polygon   | polygon    | 137      |
| Monad     | monad      | 143      |

---

## Core Workflows

### 1. Cross-Chain Swap
**Goal:** Swap token A on chain X to token B on chain Y.

Steps:
1. Call \`register_wallet\` with the user's wallet address.
2. Call \`get_swap_quote\` with fromChain, toChain, fromToken, toToken, amount (in wei), and walletAddress.
3. Present the quote to the user: show destination amount, fees, and estimated time.
4. Ask the user to sign and broadcast the \`transactionRequest\` from the quote using their wallet.
5. Call \`record_transaction\` with the returned txHash.
6. Poll \`get_transaction_status\` every 15–30 seconds until status is "completed" or "failed".

### 2. Earn Yield
**Goal:** Help a user deposit tokens into a DeFi vault.

Steps:
1. Call \`get_user_preferences\` to check if the user has set yield preferences.
   - If not, ask for their risk appetite and experience level, then call \`save_user_preferences\`.
2. Call \`get_earn_vaults\` with appropriate filters based on preferences.
3. Present top vault options (APY, TVL, protocol, token).
4. Once user picks a vault, call \`get_earn_quote\` with the vault details and user wallet.
5. Present quote (fees, ETA, expected vault tokens).
6. Ask the user to sign and send the deposit transaction.
7. Call \`record_earn_deposit\` with transaction details after confirmation.

### 3. Portfolio Review
**Goal:** Show a user what they have in HopFast.

Steps:
1. Call \`get_transaction_history\` to show swap history.
2. Call \`get_earn_positions\` to show active vault deposits.

---

## Amount Formatting
- Amounts in API calls must be in the **smallest token unit** (wei).
- USDC/USDT (6 decimals): 1 token = "1000000"
- ETH/most ERC-20 (18 decimals): 1 token = "1000000000000000000"
- WBTC (8 decimals): 1 token = "100000000"

Use this formula: \`amount_in_wei = human_amount * 10^decimals\`

---

## Token Addresses
- For **native tokens** (ETH, BNB, POL, MON) use: \`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE\`
- For ERC-20s, use the contract address on the specific chain.
- Read the \`hopfast://chains\` resource for popular token addresses per chain.

---

## Error Handling
- If \`get_swap_quote\` fails, try a different \`provider\` (lifi → squid → debridge).
- If transaction status stays "confirming" for >10 minutes, inform the user and suggest checking the explorerLink.
- Rate limits: quote endpoints are limited. Wait 2 seconds between retries.

---

## What Agents Cannot Do
- Agents cannot sign transactions — only the user's wallet can sign.
- Agents cannot move funds without the user's explicit wallet signature.
- The \`transactionRequest\` in quote responses is a payload that MUST be signed by the user's wallet key.
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
