# Supported providers

## Swap routing

- LI.FI: quote API, parallel route comparison and transaction status.
- Squid Router v2: quote API, parallel route comparison and transaction status.

The app exposes Arc, Ethereum, Base, BNB Chain, Polygon and Monad. A provider may not return a route for every pair, token or amount; live availability determines routing. Both LI.FI and Squid are queried for Arc mainnet (5042) routes, and the interface presents whichever providers return an executable route. Arc swap USDC uses the six-decimal ERC-20 address `0x3600000000000000000000000000000000000000`; native payments and gas use 18 decimals, sharing the same underlying balance. Live Base-to-Arc executable LI.FI quotes were verified on 2026-09-17; no funds were sent.

## Other services

Privy provides wallet connection. Alchemy is optional for browser balance lookup. CoinGecko and CoinMarketCap supply USD prices through the backend. Local MongoDB stores swap history and statistics; Arc requests currently use the separate single-process JSON store.

Removed: direct deBridge and Relay clients, status integrations, provider choices and logos. LI.FI or Squid can still choose underlying bridges themselves. Removing a direct integration does not disable a bridge inside an aggregator.
