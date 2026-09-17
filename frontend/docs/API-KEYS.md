# API Keys

## Frontend

**Privy App ID** (`VITE_PRIVY_APP_ID`)

Get this from [dashboard.privy.io](https://dashboard.privy.io). It enables the wallet connection UI. Without it, a demo wallet is used automatically so you can still develop locally.

This is safe to expose in the frontend bundle — it is a public app identifier, not a secret.

## Backend

**LI.FI API key** (`LIFI_API_KEY`) — optional

Raises your rate limits on the LI.FI quote and earn APIs. Without it you are on the free tier, which is fine for development but may cause 429 errors under heavy load. Get one at [li.fi](https://li.fi).

**Squid integrator ID** (`SQUID_INTEGRATOR_ID`) — optional

Identifies your integration to Squid Router. Without it requests go through as anonymous. Get one at [squidrouter.com](https://squidrouter.com).

**deBridge access token** (`DEBRIDGE_ACCESS_TOKEN`) — optional

Used for higher limits on the deBridge DLN API. Without it you are on the public tier. Get one at [debridge.finance](https://debridge.finance).

## Where to put secrets

- Frontend `.env` — only `VITE_*` variables, and only non-sensitive ones like the Privy app ID
- Backend `.env` — all provider API keys go here, never in the frontend bundle

Browser apps expose their bundled environment variables to anyone who opens DevTools. Keep anything sensitive on the server side.
