# Configuration and keys

Add credentials to local environment files, never commit them. Public `VITE_*` values are visible in the browser bundle.

1. `VITE_PRIVY_APP_ID` in `frontend/.env`: public app ID from the [Privy dashboard](https://dashboard.privy.io). Configure allowed local and deployed origins. Without it, payment reviews support an injected EVM wallet; account features requiring Privy remain unavailable.
2. `SQUID_INTEGRATOR_ID` in `backend/.env`: request integration access through [Squid](https://www.squidrouter.com). Validate the identifier with real quotes; anonymous access is not assumed.
3. `LIFI_API_KEY` in `backend/.env`: [LI.FI developer portal](https://portal.li.fi). Swap routes only. Public limits may work for initial development.
4. `DEBRIDGE_ACCESS_TOKEN` in `backend/.env`, if your deBridge account requires it: [deBridge](https://debridge.finance). Relay uses its configured public API for now; no Relay credential is requested by this implementation.
5. `ARC_RPC_URL` in `backend/.env`: defaults to the public Arc mainnet endpoint. A dedicated RPC endpoint is optional. The service checks chain ID 5042 before verifying payments.
6. `MONGODB_URI` in `backend/.env`: a local MongoDB instance or [Atlas](https://cloud.mongodb.com) connection string for swap history. This is a secret connection string, not a browser setting.

`APP_BASE_URL` must point to your frontend. `PAYMENT_STORE_PATH` must be on persistent private disk. `VITE_HOPFAST_API_BASE_URL`, `VITE_MCP_URL` and `HOPFAST_API_URL` (backend origin, without `/api`) must match your local services; use the exact variable names in each `.env.example`.

Optional `VITE_ALCHEMY_API_KEY` comes from the [Alchemy dashboard](https://dashboard.alchemy.com) for browser balance lookup. Restrict it to your frontend origins; public RPC fallback is available.

Existing optional CoinGecko/CoinMarketCap price integrations need a backend proxy before private keys are used. Do not put private price API keys in `VITE_*` variables. Core quote comparison and native Arc payment verification do not require price keys, an LLM API key, a Circle API key or a private signing key.
