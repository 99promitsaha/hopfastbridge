# Hopfastbridge

Cross-chain swaps remain the primary offering. The existing visual theme is preserved. LI.FI Earn has been removed, including its APIs, models, MCP tools, portfolio hooks, styles and exclusive assets. Shared swap tokens and provider graphics remain.

## Run locally

Use Node 22 or newer. In each of `backend`, `frontend`, and `mcp`, run `npm ci`, copy `.env.example` to `.env` where provided, then run `npm run dev`. The frontend defaults to port 5173, backend to 8080 and MCP HTTP to 3100 (`npm run start:http` after building). Check each environment example for configuration. MongoDB is optional for the payment workflow but required for stored swap history and statistics.

See [API keys](frontend/docs/API-KEYS.md) and [development phases](DEVELOPMENT.md).

## Current agent functions

- Compare LI.FI, Squid, deBridge and Relay quotes with fee, duration and minimum output constraints. Partial provider failures do not discard working quotes. Arc is not yet a supported swap destination.
- Prepare an immutable Arc mainnet USDC payment and return a private review link. The user approves with their wallet. No signing keys are stored by the server or MCP.
- Verify the sender, recipient, amount and Arc receipt; persist tracking through restarts. RPC outages leave the result unknown and warn against resending.

Arc native USDC uses 18 decimal places. Its ERC-20 representation is the same balance and is not counted twice. Review links expire after 15 minutes for new signing; already-broadcast transactions can still be recorded; their fragment token is a private capability. Keep them private.

## Validation

`npm test` in `backend` covers quote constraints, exact amounts, private links, persisted requests, replay rejection, receipt verification and RPC failures. `npm test` in `mcp` (after building the backend) checks real HTTP/MCP preparation, access enforcement, status and cancellation. `npm run build` in all three packages checks compilation and frontend production assets.

This is a local development foundation. It has not been deployed or verified with a live payment. The payment JSON store requires a single backend process and persistent disk; migrate it to a transactional database before scaling. Swap history is self-reported rather than verified volume.
