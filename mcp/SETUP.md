# HopFast MCP Server — Setup Guide

HopFast exposes its DeFi capabilities (cross-chain swaps, yield vaults, transaction tracking) as an MCP server so any AI agent can interact with it natively.

---

## What is MCP?

Model Context Protocol (MCP) is an open standard by Anthropic that lets AI models (Claude, GPT, etc.) connect to external tools and data via a standardised interface. Instead of writing custom integrations, your agent simply connects to an MCP server and gains access to all its tools automatically.

---

## Prerequisites

- Node.js >= 18
- HopFast backend running (see `../backend/README.md`)

---

## Installation

```bash
cd mcp
npm install
npm run build
```

---

## Running the Server

### Option 1 — stdio (Claude Desktop / Claude Code / local agents)

The server communicates over standard input/output. MCP clients (like Claude Desktop) spawn this process automatically.

```bash
node dist/index.js
# or
npm start
```

### Option 2 — HTTP (remote agents / cloud deployments)

Starts an HTTP server at `POST /mcp`. Agents connect over the network.

```bash
node dist/index.js --http
# or with custom port:
node dist/index.js --http --port=3100
```

Health check: `GET http://localhost:3100/health`

---

## Environment Variables

| Variable          | Default                  | Description                          |
|-------------------|--------------------------|--------------------------------------|
| `HOPFAST_API_URL` | `http://localhost:8080`  | URL of the HopFast backend API       |
| `PORT`            | `3100`                   | HTTP port (only used with `--http`)  |

```bash
HOPFAST_API_URL=https://api.hopfast.xyz node dist/index.js --http
```

---

## Connecting to Claude Desktop

Add this to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hopfast": {
      "command": "node",
      "args": ["/absolute/path/to/hopfast.xyz/mcp/dist/index.js"],
      "env": {
        "HOPFAST_API_URL": "http://localhost:8080"
      }
    }
  }
}
```

After saving, restart Claude Desktop. You will see HopFast tools available in the tool list.

---

## Connecting to Claude Code (this terminal)

```bash
# Add to your project's .claude/settings.json or run:
claude mcp add hopfast node /absolute/path/to/hopfast.xyz/mcp/dist/index.js
```

Or in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "hopfast": {
      "command": "node",
      "args": ["./mcp/dist/index.js"],
      "env": {
        "HOPFAST_API_URL": "http://localhost:8080"
      }
    }
  }
}
```

---

## Connecting via HTTP (remote agents)

Start the HTTP server, then point your agent at:

```
POST http://localhost:3100/mcp
Content-Type: application/json
```

The server implements the [MCP Streamable HTTP transport spec](https://spec.modelcontextprotocol.io/specification/basic/transports/#streamable-http).

---

## Available Tools

| Tool | Description |
|------|-------------|
| `get_swap_quote` | Get cross-chain swap quote (LI.FI / Squid / deBridge) |
| `get_transaction_status` | Poll bridge/swap status by tx hash |
| `get_transaction_history` | Get wallet's past swaps |
| `record_transaction` | Save a swap tx to HopFast history |
| `get_earn_vaults` | Browse yield vaults by chain/token/protocol |
| `get_earn_quote` | Get vault deposit transaction payload |
| `get_earn_positions` | Get wallet's active earn positions |
| `record_earn_deposit` | Save a completed vault deposit |
| `get_user_preferences` | Fetch user's yield preferences |
| `save_user_preferences` | Save risk appetite and experience level |
| `register_wallet` | Register wallet with HopFast |
| `get_protocol_stats` | Get protocol-wide analytics |
| `check_health` | Verify backend connectivity |

## Available Resources

| URI | Description |
|-----|-------------|
| `hopfast://guide` | Full agent workflow guide (Markdown) |
| `hopfast://chains` | Supported chains, chain IDs, token addresses (JSON) |

## Available Prompts

| Prompt | Description |
|--------|-------------|
| `cross_chain_swap` | Step-by-step swap workflow |
| `find_yield` | Vault discovery and deposit workflow |
| `portfolio_review` | Review swap history and earn positions |
| `check_swap_status` | Monitor a pending bridge until completion |

---

## Quick Agent Test

Once connected, try asking an agent:

> "Use the hopfast://guide resource to understand HopFast, then check if the backend is healthy."

> "Get stats for HopFast over the last 30 days."

> "Find the best USDC yield vaults on Base sorted by APY."

---

## Architecture

```
Agent (Claude / GPT / custom)
        │  MCP protocol (JSON-RPC 2.0)
        ▼
┌─────────────────────┐
│   HopFast MCP       │  ← this package
│   Server            │
│  ┌───────────────┐  │
│  │ 13 Tools      │  │
│  │ 2 Resources   │  │
│  │ 4 Prompts     │  │
│  └───────────────┘  │
└──────────┬──────────┘
           │  HTTP REST
           ▼
┌─────────────────────┐
│   HopFast Backend   │  ← ../backend
│   (Express + Mongo) │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
  LI.FI       Squid / deBridge
  (quotes,    (quotes)
   vaults,
   status)
```

The MCP server is a **thin translation layer** — it converts MCP tool calls into HopFast REST API calls and returns structured results. No business logic lives here; all DeFi logic stays in the backend.
