# Builder funding

The product now combines bridging to Arc, direct USDC envelopes for architects on X, and community micro-grant requests.

## Implemented locally

- Closing the bridge modal resets chains, tokens, amount, selection, quotes, debounce, retries and countdown. Existing transaction tracking remains active.
- Quote drawers show route fees, network fees, the included Hopfast fee and the original provider total. The displayed commission is never added again to that total.
- Envelope composer with recipient handle, six-decimal USDC amount, a 280-character message, and exact 2.5% deducted fee.
- Five-stage product flow ending with sender reclaim of unclaimed USDC after 30 days.
- Mongo-backed request board at GET/POST `/api/grants`, validated HTTPS links, public project descriptions and milestones, USDC targets, and a posting rate limit. Community submissions are not identity-verified.
- Request cards link to project demos and prefill an envelope preview for that builder. No fabricated funded totals or donations are displayed.
- A dismissible lower-left funding suggestion appears after provider-confirmed completion of a cross-chain bridge to Arc, once per transaction during the session.

## Still coming soon

Arc escrow deployment and live X configuration are pending. Funding, claim and reclaim code is implemented and gated until configured. Micro-grant contributions remain a preview. No contract was deployed or live X message sent during development. Posting a request saves it to Mongo, not an external grant platform.

## Fee policy

Envelope fee: **2.5%, deducted and forwarded at deposit**, irrespective of whether claimed. A 25 USDC deposit pays 0.625 USDC to Hopfast and reserves 24.375 USDC. Only that remaining balance can be claimed or reclaimed. No additional Hopfast fee applies at withdrawal. The treasury is immutable in the contract. Fees round up to micro-USDC precision.

Micro-grant contribution fee remains 1.5%, deducted; the builder receives 98.5%. Network gas is separate. Bridge fees are unchanged.

## Claim and identity

The backend resolves the X handle to a permanent user ID and binds the contract deposit to its hash. Recipient sign-in uses OAuth 2.0 PKCE S256, single-use state, ten-minute expiry and an HttpOnly SameSite browser cookie. `/2/users/me` must match that permanent ID. Renamed or recycled usernames cannot redirect old grants. X access tokens are not persisted.

A five-minute, single-use wallet challenge authenticates the intended recipient wallet before OAuth. The backend issues a short-lived EIP-712 claim authorization binding the envelope ID, recipient wallet, chain and escrow contract. Only that wallet can execute it. Contract state prevents repeated payment. The signer is a trusted identity authority; compromising its key could authorize fraudulent claims, so keep it server-side and separate from admin/deployer keys. Admin can pause deposits/claims and rotate it.

Private links use 256-bit tokens in fragments, with hashes stored in Mongo. Links are saved in the funder browser before signing a deposit. Funders can authenticate again to recover their envelope records on another device, but private links can only be copied from the original browser. Losing the link does not block funder reclaim. OAuth callback query strings and private request data are not logged.

## Reclaim and admin recovery

Recipients can claim only before 30 days. At or after expiry the original funder can reclaim the remaining 97.5%, anytime, including while paused. They can call `reclaim(bytes32)` directly without the backend.

The admin cannot directly drain active escrow. Once expired, the owner can queue recovery to a nominated wallet with a reason hash. Execution waits seven additional days. The funder can reclaim throughout that delay, cancelling recovery. Recovery transfers the remaining 97.5% and emits public events. This is a disclosed recovery power over expired funds; use a multisig and validate support requests off-chain. It cannot overcome USDC freezes or chain outages. Two-step ownership transfer is required; renouncing ownership is disabled. Token rescue cannot spend reserved USDC.

The owner is also trusted because it can replace the claim-authorization signer. A malicious owner could use that power to authorize claims of active envelopes. The expiry and delay constrain the recovery function, not the owner’s identity-authority power. This is not a trustless escrow.

## Agent delivery

Sharing a funded private link works without agent delivery. Bot delivery requires an OAuth user-context token with `dm.write`, and `X_DELIVERY_ENABLED=true`; the sample default is false. The funded sender explicitly requests delivery with a fresh wallet proof. Backend verifies the deposit’s funder, identity, amount and active state before sending. Atomic locking prevents duplicate sends. Ambiguous timeouts are not automatically retried. Failed DMs offer link sharing. A definite 401 triggers one refresh-token exchange and retry; rotated tokens are saved atomically in a private, git-ignored server file. Keep that file on persistent storage. Refresh revocation or expiry requires account reauthorization.

Local X app “Hopfast Support Architects” (33445194) is configured with OAuth 2.0 and numeric-loopback callback `http://127.0.0.1:8080/api/architects/x/callback`. Bearer lookup and the delivery token’s `/2/users/me` account were verified. Delivery is explicitly approved from `@99promitsaha`, with `dm.write`, public read scopes and refresh access; `dm.read` was cleared. No actual DMs have been sent. Use a dedicated bot account later if messages should come from Hopfast’s own handle.

## Setup

1. Start with Arc testnet: chain 5042002 and its RPC. Mainnet is 5042. Arc USDC at `0x3600000000000000000000000000000000000000` uses six decimals through ERC-20; gas uses eighteen.
2. Choose admin, fee treasury and separate claim-signer addresses. Keep all private keys out of frontend settings and git.
3. Run `npm ci` and `npm test` in `contracts`. Review `src/ArchitectEscrow.sol`. Deployment script requires `ARC_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `ARCHITECT_ADMIN_ADDRESS`, `ARCHITECT_TREASURY_ADDRESS`, `ARCHITECT_SIGNER_ADDRESS` and explicit `CONFIRM_DEPLOY=arc-5042002` (or `arc-5042`). Then run `npm run deploy`. The deployer pays gas; configured admin owns the contract.
4. Add the deployed `ARCHITECT_ESCROW_ADDRESS`, matching `ARCHITECT_SIGNER_KEY`, chain ID and RPC to backend settings.
5. In X Developer Console, enable OAuth 2.0 for a Web App, register the exact callback, and obtain Client ID, Client Secret and app bearer token. Set `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_BEARER_TOKEN`, `X_CALLBACK_URL`. Recipient scopes are `tweet.read users.read`. Optional bot scopes include `dm.write` and `offline.access`; provision `X_BOT_ACCESS_TOKEN` and `X_BOT_REFRESH_TOKEN`. X API access and recipient DM restrictions still apply.
6. Use matching hostnames for frontend links and browsing, and for API/callback. Production requires HTTPS and a same-site API for the browser cookie. Set APP_BASE_URL, CORS_ORIGIN and VITE_HOPFAST_API_BASE_URL accordingly.
7. Restart backend and check `/api/architects/config`, then perform a separately approved testnet deposit and claim. Configuration and live OAuth remain unverified until credentials and deployment are supplied.

## Mainnet deployment review

Mainnet deployment is authorized, but the wallet transaction remains unsigned. The local-only review at `http://127.0.0.1:5173/?deploy=architects` prepares the compiled constructor with admin and treasury `0xe7953857d0dBA2d39B6Fb8e63296e408058120F4`, and separate claim signer `0xc7C7b1Da4fe5504f19d394DD0ded7CA038A615Ed`. It estimates gas from the live Arc mainnet RPC and requires the admin wallet. Clicking review is a user action that requests the wallet transaction; no deployment was initiated by the agent.

After confirmation, the server verifies chain, exact creation bytecode/constructor data, sender, successful receipt and deployed roles before saving the address. This setup endpoint is disabled outside development and rejects non-loopback callers. Submitted transaction hashes survive reload, so verification can be retried without deploying twice. If a wallet transaction fails, clear the saved hash only after checking its on-chain receipt. An already configured escrow is never silently replaced.

Admin tooling: from `contracts`, `node scripts/admin.mjs queue <id> <recipient> <reason>`, `cancel <id>`, or `execute <id>`, with local admin credentials. A multisig may call the functions directly instead.

References: [Arc USDC](https://docs.arc.io/arc/references/contract-addresses), [Arc networks](https://docs.arc.io/arc/references/connect-to-arc), [X OAuth PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [X DMs](https://docs.x.com/x-api/direct-messages/create-dm-message-by-participant-id).
