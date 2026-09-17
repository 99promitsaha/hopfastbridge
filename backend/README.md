# HopFast / Backend

The REST API. Handles swap quotes, transaction tracking, yield vault data, earn positions, wallet registration, and protocol analytics. Runs at [api.hopfast.xyz](https://api.hopfast.xyz/api/health).

---

## Tech stack

| | |
|---|---|
| Framework | Express |
| Language | TypeScript |
| Database | MongoDB + Mongoose |
| Validation | Zod |
| Security | Helmet + CORS + express-rate-limit |
| Logging | Morgan |

---

## Running locally

```bash
npm install
cp .env.example .env
npm run dev
# http://localhost:8080
```

MongoDB needs to be running before you start. Either a local instance or point `MONGODB_URI` at an Atlas cluster.

---

## Environment variables

```env
# Server
PORT=8080
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# Database
MONGODB_URI=mongodb://localhost:27017/hopfast

# LI.FI — required. Free tier is fine for dev.
LIFI_API_KEY=
LIFI_API_BASE_URL=https://li.quest/v1
LIFI_SLIPPAGE=0.005

# Squid Router
SQUID_API_BASE_URL=https://v2.api.squidrouter.com
SQUID_INTEGRATOR_ID=
```

`LIFI_API_KEY` is required — without it the Earn API calls (vaults, quotes, positions) will 401. Get one at https://li.quest/.

**Providers with zero-config defaults.** deBridge (`https://dln.debridge.finance`) and Relay (`https://api.relay.link`) don't need any env vars to run locally; their base URLs are hardcoded defaults in `src/config/env.ts`. Set `DEBRIDGE_ACCESS_TOKEN`, `DEBRIDGE_REFERRAL_CODE`, or `RELAY_APP_FEES_RECIPIENT` only if you've signed partner agreements with those protocols.

**Optional price oracles** (`COINGECKO_API_KEY`, `CMC_API_KEY`) are used to convert deBridge's native-token fixed fee to USD. Without them, quotes still work but the deBridge fee will under-report by the fixed native-fee portion.

---

## API reference

Base URL: `http://localhost:8080/api`

### Health

```
GET /api/health
```

Returns service name and database connection status. Good first call to make sure everything's wired up.

```json
{ "ok": true, "service": "hopfast-api", "db": "connected" }
```

---

### Wallets

```
POST /api/wallets
```

Registers a wallet or updates its last-seen timestamp. Safe to call on every session start, it's an upsert.

**Body**
```json
{ "address": "0x..." }
```

---

### Quotes

```
POST /api/quotes?provider=lifi|squid|debridge|relay
```

Fetches a cross-chain swap quote from the specified provider. Returns destination amount, fees, ETA, and a transaction request payload ready to sign.

**Body**
```json
{
  "srcChainKey": "base",
  "dstChainKey": "ethereum",
  "srcTokenAddress": "0x...",
  "dstTokenAddress": "0x...",
  "amount": "1000000",
  "srcWalletAddress": "0x...",
  "dstWalletAddress": "0x..."
}
```

**Recipient safety.** Every quote request goes through `assertValidSender` / `assertValidRecipient` (see `src/lib/recipientGuard.ts`). A request without a real EVM address is rejected with a 400 before it ever hits the upstream provider — some aggregators silently substitute a fallback house wallet when the recipient is the zero address, which has historically cost users money. The Relay client additionally verifies that the recipient stored in the response matches what we asked for, and refuses the quote if they differ.

Rate limited to 30 requests per minute per IP in production.

---

### Swaps

```
POST /api/swaps          Create a swap record
GET  /api/swaps          Get swap records for a wallet (?userAddress=&limit=)
```

Persists swap records. Separate from transaction history: swap records are created at quote time, transactions are created after the user signs.

---

### Transactions

```
POST /api/transactions   Record a submitted transaction
GET  /api/transactions   Get transaction history (?userAddress=&limit=)
```

Created after a swap is signed and broadcast. Shows up in the user's history.

---

### Transaction status

```
GET /api/status?txHash=&provider=lifi|squid|debridge|relay&fromChain=&toChain=
```

Polls the bridge provider for the current status of a cross-chain transaction.

Possible statuses: `submitted`, `confirming`, `bridging`, `completed`, `failed`

Also returns `receivingTxHash` and `explorerLink` once the bridge completes.

---

### Earn

```
GET  /api/earn/vaults                    List yield vaults
GET  /api/earn/chains                    List chains that support earn
GET  /api/earn/protocols                 List supported DeFi protocols
POST /api/earn/quote                     Get a vault deposit quote
GET  /api/earn/positions/:address        Get a wallet's active positions
POST /api/earn/positions                 Record a vault deposit
DELETE /api/earn/positions/:id           Remove a position
GET  /api/earn/preferences/:address      Get yield preferences for a wallet
POST /api/earn/preferences               Save yield preferences
```

Vault data proxied from LI.FI Earn. Positions and preferences stored in MongoDB.

**Vault query params:** `chainId`, `asset`, `protocol`, `minTvlUsd`, `sortBy` (apy|tvl), `limit`, `cursor`

Rate limited to 60 requests per minute per IP for the earn quote endpoint in production.

---

### Stats

```
GET /api/stats?period=7d|15d|30d
```

Protocol-wide analytics for the given time window.

```json
{
  "period": "7d",
  "uniqueUsers": 42,
  "swapVolumeUsd": 18500,
  "swapCount": 103,
  "earnDepositCount": 17,
  "earnDepositsByToken": { "USDC": 12, "ETH": 5 },
  "protocolFeeUsd": 37.20
}
```

---

## Database models

### Wallet
Wallet addresses and last-seen timestamps. Created on first visit, updated each session.

| Field | Type | Notes |
|-------|------|-------|
| `address` | String | Unique, lowercase |
| `lastSeenAt` | Date | Updated on each register call |

### SwapRecord
Created when a quote is accepted (before signing).

| Field | Type | Notes |
|-------|------|-------|
| `userAddress` | String | |
| `quoteId` | String | |
| `provider` | String | lifi, squid, debridge, or relay |
| `fromChain` | String | Chain key |
| `toChain` | String | Chain key |
| `fromTokenSymbol` | String | |
| `toTokenSymbol` | String | |
| `amount` | String | Human-readable |
| `volumeUsd` | Number | Optional |
| `txHash` | String | Optional, set after signing |
| `status` | String | Default: quote-created |

### TransactionHistory
Created after a tx is signed and broadcast.

| Field | Type | Notes |
|-------|------|-------|
| `userAddress` | String | Indexed |
| `txHash` | String | Unique per user |
| `provider` | String | |
| `fromChain` | String | |
| `toChain` | String | |
| `fromTokenSymbol` | String | |
| `toTokenSymbol` | String | |
| `amount` | String | |
| `volumeUsd` | Number | Optional |
| `status` | String | Default: submitted |

### EarnPosition
Tracks vault deposits per wallet.

| Field | Type | Notes |
|-------|------|-------|
| `userAddress` | String | Indexed |
| `vaultAddress` | String | |
| `vaultName` | String | |
| `chainId` | Number | |
| `network` | String | |
| `protocolName` | String | |
| `tokenSymbol` | String | |
| `amount` | String | Human-readable |
| `amountRaw` | String | In wei |
| `txHash` | String | |
| `action` | String | deposit or withdraw |

### EarnPreference
Yield preferences for personalised vault recommendations.

| Field | Type | Notes |
|-------|------|-------|
| `userAddress` | String | Unique |
| `riskAppetite` | String | high or safe |
| `preferredAsset` | String | Token symbol or "any" |
| `experienceLevel` | String | beginner, intermediate, or advanced |

---

## Source structure

```
src/
├── config/
│   ├── env.ts          Zod-validated environment config
│   └── db.ts           MongoDB connection
├── models/
│   ├── Wallet.ts
│   ├── SwapRecord.ts
│   ├── TransactionHistory.ts
│   ├── EarnPosition.ts
│   └── EarnPreference.ts
├── lib/
│   ├── lifiClient.ts       LI.FI quote and earn API client
│   ├── squidClient.ts      Squid Router quote client
│   ├── debridgeClient.ts   deBridge DLN quote client
│   ├── relayClient.ts      Relay Protocol quote client
│   ├── recipientGuard.ts   Recipient validation used by all quote clients
│   └── nativePrice.ts      Native-token USD price lookup (CoinGecko → CMC)
├── routes/
│   ├── index.ts            Route aggregator
│   ├── health.routes.ts
│   ├── wallets.routes.ts
│   ├── quotes.routes.ts
│   ├── swaps.routes.ts
│   ├── transactions.routes.ts
│   ├── status.routes.ts
│   ├── earn.routes.ts
│   └── stats.routes.ts
└── index.ts                Express app entry point
```

---

## Scripts

```bash
npm run dev      # start with tsx watch (hot reload)
npm run build    # compile TypeScript to dist/
npm start        # run compiled output
```
