# Supported providers

## Swap routing

- LI.FI: quote API, parallel route comparison and transaction status.
- Squid Router v2: quote API, parallel route comparison and transaction status.

The app exposes Ethereum, Base, BNB Chain, Polygon and Monad. A provider may not return a route for every pair, token or amount; live availability determines routing. Arc mainnet is currently a separate native-USDC balance/payment feature, not a supported swap destination.

## Other services

Privy provides wallet connection. Alchemy is optional for browser balance lookup. CoinGecko and CoinMarketCap supply USD prices through the backend. Local MongoDB stores swap history and statistics; Arc requests currently use the separate single-process JSON store.

Removed: direct deBridge and Relay clients, status integrations, provider choices and logos. LI.FI or Squid can still choose underlying bridges themselves. Removing a direct integration does not disable a bridge inside an aggregator.
