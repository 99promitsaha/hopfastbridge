<div align="center">

# Hopfastbridge

**Swap tokens across chains. Earn yield in DeFi vaults. Works for humans and AI agents.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>


Fresh development repository for Hopfastbridge. This checkout has no shutdown banner or countdown. No public deployment is configured.

## Development status

Use Node.js 22 and the committed lockfiles (`npm ci` in each service). Local environment files are ignored by Git. The API and MCP server can start without a database; wallet history and preferences require MongoDB. Live wallet authentication needs a Privy app ID. LI.FI quotes need an API key, and Squid needs an integrator ID. End-to-end swaps have not been verified in this revival. Arc integration is not implemented yet.

---

HopFast lets you swap tokens across five blockchains and deposit into DeFi yield vaults, all from one place. No account, no sign-up. Connect your wallet and go.

It also ships with a full MCP server so AI agents (Claude, Codex, Gemini, whatever) can do the same things programmatically. One URL, and the agent figures the rest out on its own.

---

## What you can do

### Swapping

Pick a token on one chain, pick where you want it to end up, and HopFast finds the best route. It pulls quotes from **four routing providers in parallel** — LI.FI, Squid Router, deBridge, and Relay — and shows you the one with the best output and lowest fees. You sign one transaction and it handles the rest.

Cross-chain swaps usually take 30 seconds to a few minutes depending on the chains. HopFast polls the bridge status and shows you when your funds land.

**Fit gas.** When you're swapping the native asset of a chain and your entered amount would leave nothing for the transaction fee, a "Fit gas" chip appears. One tap auto-reduces the input by the worst-case gas cost across every returned quote (plus a 15 % buffer) so the swap actually goes through instead of failing on submission.

**Safety hardening.** Every provider client refuses to request a quote without a verified recipient and validates the response recipient matches what was asked — an aggregator silently substituting a fallback wallet is the kind of thing that costs real money, so we fail closed on the backend, the frontend skips quoting before a wallet connects, and the execution path checks calldata contains your address before signing.

### Earning

Browse yield vaults from protocols like Aave, Morpho, and Yo Protocol across all supported chains. Each vault shows current APY, TVL, and which token it accepts.

Vault data comes from the LI.FI Earn API, but we don't just dump raw results. The frontend applies its own curation layer on top:

- **Asset family grouping**: Filtering by "ETH" doesn't just show native ETH vaults. It groups ETH, WETH, stETH, and wstETH together. Same for "BTC" which covers WBTC, cbBTC, tBTC, and BTCB. These are resolved client-side so one filter shows you the full picture.
- **Stablecoin mix**: The stablecoins filter pulls all vaults (no API-level asset filter), then filters client-side for USDC, USDT, DAI, PYUSD, and others. Results are sorted by TVL so you get a natural mix of the biggest pools first instead of only one token dominating the list.
- **API calls**: Changing a filter that doesn't affect the API query (like toggling between client-side filters) skips the network request and just re-filters locally. Only server-side params (chain, sort order, protocol, specific asset) trigger a fresh fetch.

### Preferences

First-time users get a short questionnaire: earning style (chase yield vs. safe and steady), preferred asset category (stablecoins, ETH, BTC, DAI, or no preference), and DeFi experience. Beginners automatically get stablecoins regardless of their asset pick. These preferences drive the initial filter state. You can redo this anytime from the Earn tab.

### Transaction history

Every swap and vault deposit you make through HopFast gets saved to your wallet's history. You can see the status, which chains were involved, and link out to the block explorer.

---

## Supported chains

| Chain | Chain ID |
|-------|----------|
| Ethereum | 1 |
| Base | 8453 |
| BNB Chain | 56 |
| Polygon | 137 |
| Monad | 143 |

---

## For AI agents

HopFast includes an MCP server that lets any AI agent interact with it the same way a human would. Get swap quotes, browse yield vaults, check transaction status, read wallet history. All through one endpoint, no API key needed.

**MCP endpoint:** `http://localhost:3100/mcp`

### Connecting your agent

**Claude Desktop**

Open your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac, `%APPDATA%\Claude\claude_desktop_config.json` on Windows) and add:

```json
{
  "mcpServers": {
    "hopfast": {
      "type": "http",
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

Restart Claude Desktop and HopFast tools will show up in your chat.

**Claude Code**

```bash
claude mcp add --transport http hopfast http://localhost:3100/mcp
```

That registers HopFast globally. Run `claude mcp list` to confirm it connected.

**Any other HTTP agent**

Every request needs these two headers or you'll get a 406:

```
Content-Type: application/json
Accept: application/json, text/event-stream
```

To list all available tools:

```bash
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Tools

| Tool | What it does |
|------|-------------|
| `check_health` | Check the backend and database are online |
| `register_wallet` | Register a wallet at the start of a session |
| `get_swap_quote` | Get a cross-chain quote from LI.FI, Squid, deBridge, or Relay |
| `get_transaction_status` | Poll a bridge or swap until it completes or fails |
| `get_transaction_history` | Fetch a wallet's past swaps |
| `record_transaction` | Save a swap after the user signs it |
| `get_earn_vaults` | Browse yield vaults by chain, token, or protocol |
| `get_earn_quote` | Get a vault deposit transaction payload |
| `get_earn_positions` | See all vaults a wallet has deposited into |
| `record_earn_deposit` | Save a vault deposit after it confirms on-chain |
| `get_user_preferences` | Read a user's saved risk and experience preferences |
| `save_user_preferences` | Store preferences for personalised vault recommendations |
| `get_protocol_stats` | Get swap volume, unique users, and earn stats |

### Workflow prompts

Pre-written instructions you can inject into an agent's conversation to handle full DeFi workflows. Instead of figuring out which tools to call and in what order, invoke a prompt and the agent already knows the sequence.

| Prompt | What it covers |
|--------|---------------|
| `cross_chain_swap` | Quote, confirm, sign, and track status |
| `find_yield` | Preferences, vault search, deposit quote, save position |
| `portfolio_review` | Swap history and active earn positions for a wallet |
| `check_swap_status` | Monitors a bridge until it resolves |

### Resources

| URI | What is it |
|-----|------------|
| `hopfast://guide` | Full agent workflow guide written in Markdown, read this first |
| `hopfast://chains` | All five supported chains with token contract addresses and decimals |

### How wallet signing works

Agents can't sign blockchain transactions. Only the user's wallet can do that. Here's the flow:

1. Agent calls `get_swap_quote` and gets back a `transactionRequest` payload
2. Agent shows the user what they're about to do: destination amount, fees, estimated time
3. User signs in their wallet (MetaMask, Privy, etc.). The agent never sees the private key
4. Wallet returns a `txHash`. Agent calls `record_transaction` and polls `get_transaction_status` until the bridge finishes

Agents plan and track. Users sign and approve. Nothing moves without a wallet confirmation.

---

## Tech stack

**Frontend** React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, Privy

**Backend** Express, MongoDB, Mongoose, TypeScript, Zod

**MCP server** @modelcontextprotocol/sdk, TypeScript, Node 18+

**Routing providers** LI.FI, Squid Router, deBridge, Relay

---

## Project structure

```
hopfastbridge/
├── frontend/          Web app (hopfast.xyz)
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── lib/
│   └── public/
│       ├── llms.txt       Agent-readable capability manifest
│       ├── sitemap.xml
│       └── robots.txt
│
├── backend/           REST API (api.hopfast.xyz)
│   └── src/
│       ├── routes/
│       ├── models/
│       └── lib/
│
└── mcp/               MCP server (mcp.hopfast.xyz)
    └── src/
        ├── tools/
        ├── resources/
        └── prompts/
```

---

## Running locally

You need Node 22 and a MongoDB instance (local or Atlas).

**Backend**

```bash
cd backend
npm ci
cp .env.example .env
npm run dev
# runs on http://localhost:8080
```

**Frontend**

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
# runs on http://localhost:5173
```

**MCP server**

```bash
cd mcp
npm ci
npm run build

# stdio mode, for Claude Desktop or Claude Code
npm start

# HTTP mode, for remote agents
npm run start:http
# runs on http://localhost:3100/mcp
```

---

## Environment variables

**Backend**

```env
PORT=8080
CORS_ORIGIN=http://localhost:5173
MONGODB_URI=mongodb://localhost:27017/hopfast

LIFI_API_KEY=                 # required, sign up at li.quest
LIFI_API_BASE_URL=https://li.quest/v1
LIFI_SLIPPAGE=0.005

SQUID_API_BASE_URL=https://v2.api.squidrouter.com
SQUID_INTEGRATOR_ID=
```

Relay and deBridge work against their public endpoints with sensible defaults — you don't need to set anything for them to run locally.

**Frontend**

```env
VITE_PRIVY_APP_ID=                             # Privy app ID for wallet auth
VITE_HOPFAST_API_BASE_URL=http://localhost:8080/api
VITE_ALCHEMY_API_KEY=                          # for on-chain balance reads
VITE_COINGECKO_API_KEY=                        # demo key works fine
VITE_CMC_API_KEY=                              # fallback when CoinGecko rate-limits
```

**MCP server**

```env
HOPFAST_API_URL=http://localhost:8080
PORT=3100
```

---

## API

Base URL: `http://localhost:8080/api`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service and database status |
| `POST` | `/wallets` | Register or update a wallet |
| `POST` | `/quotes` | Get a swap quote |
| `GET` | `/transactions` | Get a wallet's transaction history |
| `POST` | `/transactions` | Record a transaction |
| `GET` | `/status` | Poll a transaction's bridge status |
| `GET` | `/earn/vaults` | List yield vaults |
| `POST` | `/earn/quote` | Get a vault deposit quote |
| `GET` | `/earn/positions/:address` | Get a wallet's earn positions |
| `POST` | `/earn/positions` | Record a vault deposit |
| `GET` | `/earn/preferences/:address` | Get yield preferences |
| `POST` | `/earn/preferences` | Save yield preferences |
| `GET` | `/stats` | Protocol analytics |

---

## Privacy

No email, phone number, or personal data collected. The only things stored are your wallet address (already public on-chain), swap records, and earn positions. Blockchain transactions are permanent and visible to anyone.

---

