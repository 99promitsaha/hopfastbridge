# Hopfast

**Unified payments on Arc.**

[Hopfast](https://hopfast.xyz) brings bridging, direct payments, payment identities, and private claims into one focused Arc application. Move USDC to Arc, pay a verified Hopfast ID, or create a payment for an X username before you know their wallet address.

The application keeps wallet control with the user. Hopfast prepares and verifies transactions, but every transfer, bridge, approval, deposit, claim, and recovery is signed by the wallet that performs it.

## What Hopfast offers

| Product | What it does | Settlement |
| --- | --- | --- |
| Bridge to Arc | Compares executable LI.FI and Squid routes and presents the best available options | The selected provider routes funds to the connected Arc wallet |
| Hopfast ID | Connects a verified X identity to an Arc wallet, personal payment link, and QR code | Direct wallet-to-wallet USDC transfer on Arc |
| Pay an X username | Creates a private payment for a specific X account without requiring its wallet address first | Funds remain in the Hopfast escrow until the matching X account claims them |
| Payment activity | Separates direct Hopfast ID transfers from private X username payments | Status and explorer links remain available after signing |
| Public stats | Shows routed bridge volume and cumulative completed Hopfast ID payments | Derived from recorded application activity |

## Product flows

### Bridge USDC to Arc

1. Connect a wallet and choose the source chain, token, and amount.
2. Hopfast requests LI.FI and Squid quotes in parallel.
3. Providers that do not return an executable route are hidden.
4. The user compares output, duration, provider costs, and the included Hopfast fee where applicable.
5. The wallet signs the selected provider transaction.
6. Hopfast tracks the source transaction and destination settlement, with explorer links when available.

Quotes refresh every 20 seconds. A partial provider outage does not remove a valid quote returned by the other provider. The backend validates sender and recipient addresses and rejects provider calldata that does not contain the requested destination recipient.

### Pay a Hopfast ID

A Hopfast ID looks like `username@hopfast`. The owner verifies an X account and signs a wallet challenge to bind that identity to an Arc wallet. Hopfast then creates a persistent payment link and downloadable QR code for that profile.

When another user pays the ID:

1. Hopfast resolves the ID to its verified Arc wallet.
2. The payer chooses an amount and can add a private note.
3. A private review link is generated for the payer.
4. The payer signs a native USDC transfer on Arc.
5. The backend checks the sender, recipient, value, chain, transaction hash, and receipt before marking it complete.

Direct Hopfast ID transfers are wallet-to-wallet. Hopfast does not take custody of the payment.

### Pay an X username

Private X username payments are useful when the sender knows the recipient's social identity but not their wallet address.

1. The sender enters the X username, amount, and note.
2. Hopfast resolves the username to X's permanent user ID and asks the sender to confirm the recipient.
3. The sender deposits USDC into the Arc escrow contract.
4. Hopfast generates a private claim link and a message for the sender to share from their own account.
5. The recipient opens the link, connects an Arc wallet, and signs in with X.
6. The backend confirms that the permanent X user ID matches the intended recipient and issues a short-lived claim authorization for the connected wallet.
7. The recipient signs the onchain claim and receives USDC in that wallet.

Hopfast does not send automated DMs and does not retain X access tokens. If the payment is not claimed within 30 days, the original sender can reclaim the remaining escrowed amount.

## How the escrow protects payments

`ArchitectEscrow.sol` is an EIP-712 authorized USDC escrow for private X username payments.

- A deposit is bound to a unique envelope ID and a hash of the recipient's permanent X user ID.
- A claim authorization is bound to one envelope, one recipient wallet, one chain, one deployed contract, and a short deadline.
- The contract requires the authorized recipient to be the transaction sender.
- Envelope state prevents duplicate claims and duplicate deposits.
- Reentrancy protection and safe token transfers protect state transitions.
- Fee-on-transfer and otherwise incompatible tokens are rejected by exact balance accounting.
- Active escrow cannot be withdrawn through the token rescue function.
- The original funder alone can reclaim an unclaimed payment after 30 days.
- Administrative recovery applies only after expiry, adds a seven-day delay, and remains cancellable by a funder reclaim.
- Contract ownership uses a two-step transfer and cannot be renounced accidentally.

The escrow has a trusted authorization signer. The owner can rotate that signer and pause deposits and claims. A compromised signer or malicious owner could authorize an incorrect active claim, so production keys should be separated, protected, and operated through appropriate custody controls. This is a disclosed trust boundary rather than a claim of fully trustless identity verification.

## Fees

- **Private X username payment:** 2.5% is deducted from the deposited amount and sent to the configured treasury when the deposit is made. The remaining 97.5% is available to claim or reclaim. The fee is not charged again during claiming.
- **Direct Hopfast ID payment:** Hopfast does not add a platform fee. Arc network cost still applies.
- **LI.FI route:** the integration requests a 0.05% Hopfast integrator fee when portal configuration confirms that fee. It remains part of the provider quote and is never added a second time by Hopfast.
- **Squid route:** Hopfast currently adds no custom integrator fee. Provider and network costs can still apply.

Every executable quote shows the costs returned by its provider before the user signs.

## Architecture

```text
frontend/
  React application, wallet connection, quote comparison,
  payment and claim interfaces, QR codes, activity, and stats

backend/
  Express API, provider adapters, X OAuth, wallet challenges,
  payment verification, quote guards, persistence, and rate limits

contracts/
  Arc USDC escrow contract, deployment tooling, and contract tests
```

The frontend never receives server credentials or signing keys. Provider credentials, database access, X OAuth secrets, and the claim authorization key stay in the backend environment. Wallet transactions are created for review and signed by the user through Privy or a compatible injected wallet.

## Technology

- React 18, TypeScript, Vite, Framer Motion, and Privy
- Node.js 22, Express, Mongoose, Zod, and viem
- Solidity 0.8, OpenZeppelin Contracts, ethers, and solc
- MongoDB for identities, private payment metadata, and bridge activity
- A persistent private JSON store for direct payment review and receipt tracking
- LI.FI and Squid for route discovery and cross-chain status
- X OAuth 2.0 with PKCE for recipient and Hopfast ID verification

## Local development

### Requirements

- Node.js 22 or newer
- npm
- MongoDB, locally or through Atlas
- An EVM wallet configured for Arc when testing wallet flows

### Install dependencies

```bash
cd backend && npm ci
cd ../frontend && npm ci
cd ../contracts && npm ci
```

### Configure the backend

```bash
cp backend/.env.example backend/.env
```

The application starts with safe local defaults, but individual features require their corresponding configuration:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection used for profiles, private payments, bridge history, and stats |
| `ARC_RPC_URL` | Arc RPC used for payment, contract, and receipt verification |
| `APP_BASE_URL` | Canonical frontend origin used in generated payment and claim links |
| `CORS_ORIGIN` | Comma-separated frontend origins allowed to call the API |
| `PAYMENT_STORE_PATH` | Private persistent path for direct payment review records |
| `LIFI_API_KEY` | Optional LI.FI API credential |
| `LIFI_INTEGRATOR` | LI.FI portal integrator string |
| `LIFI_FEE` | Decimal LI.FI integrator fee, currently `0.0005` for five basis points |
| `SQUID_INTEGRATOR_ID` | Squid integrator identifier |
| `X_CLIENT_ID` and `X_CLIENT_SECRET` | X OAuth web application credentials |
| `X_BEARER_TOKEN` | Server-side X user lookup credential |
| `X_CALLBACK_URL` | Exact callback registered in the X developer application |
| `ARCHITECT_ESCROW_ADDRESS` | Deployed private-payment escrow contract |
| `ARCHITECT_SIGNER_KEY` | Server-only EIP-712 claim authorization key |
| `ARCHITECT_ADMIN_ADDRESS` | Contract owner or administrative multisig |
| `ARCHITECT_TREASURY_ADDRESS` | Wallet that receives the private-payment fee |
| `COINGECKO_API_KEY` or `CMC_API_KEY` | Optional server-side token price source |

Never put a private key, database credential, provider secret, or OAuth secret in a `VITE_*` variable. Vite variables are included in the browser bundle.

### Configure the frontend

```bash
cp frontend/.env.example frontend/.env
```

`VITE_PRIVY_APP_ID` enables Privy wallet authentication. `VITE_HOPFAST_API_BASE_URL` points to the backend `/api` origin. `VITE_ALCHEMY_API_KEY` is optional and should be restricted to approved browser origins.

### Start the application

Run these in separate terminals:

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm run dev
```

The default frontend is `http://localhost:5173`; the API is `http://localhost:8080/api`.

## Contracts

Build and test the escrow locally:

```bash
cd contracts
npm run build
npm test
```

Deployment uses `contracts/.env`. It requires an RPC URL, deployer key, admin address, treasury address, and the public address corresponding to the backend claim signer. The deployment script also requires an explicit network confirmation value before broadcasting.

```bash
cp contracts/.env.example contracts/.env
npm run deploy
```

Start on Arc testnet. Review constructor arguments, compiled bytecode, deployed roles, and the transaction in the wallet before approving a deployment. Never reuse the deployer, owner, treasury, and authorization-signer keys as one operational key.

## Production configuration

The frontend can be hosted as a static Vite deployment. The backend needs a Node.js host with HTTPS, a persistent private disk for `PAYMENT_STORE_PATH`, and access to MongoDB.

Production origins must agree across:

- the frontend API base URL;
- backend `APP_BASE_URL` and `CORS_ORIGIN`;
- Privy's allowed domains;
- the X application's registered callback URL.

Keep the backend on a single process while it uses the JSON payment store. Move that store to a transactional database before horizontal scaling. Place the API behind platform-level request filtering in addition to the application rate limits.

## Security and privacy

- `.env` files, build output, local databases, and contract artifacts are ignored by git.
- Claim links and payment review links contain capability tokens in the URL fragment. Treat them as private until used or expired.
- OAuth state, wallet challenges, and claim sessions are short-lived and single-use.
- X access tokens are used only to read the authenticated account and are not stored.
- Backend logs omit private claim routes and return generic production errors.
- Payment verification fails closed when the chain, sender, recipient, amount, calldata, receipt, or configured contract state does not match.
- Quotes can expire. The interface refreshes them and does not silently reuse an invalid route.

Do not commit real credentials even temporarily. Removing a secret from a later commit does not remove it from git history. Rotate any credential that may have entered a commit, log, screenshot, or shared terminal session.

## Known operational limits

- Route availability depends on provider liquidity, supported assets, amount, and current network conditions.
- Bridge statistics represent activity recorded through Hopfast, not all activity on Arc.
- Direct payment records currently use a single-process persistent store.
- Identity claims depend on X OAuth availability and the backend authorization signer.
- USDC or network-level restrictions cannot be bypassed by the application or escrow.

## Repository hygiene

Only `.env.example` files belong in version control. Before publishing changes, review the staged diff and scan the complete git history for secrets. Public blockchain addresses and official token contracts are not credentials, but personal operational addresses should remain outside example configuration unless disclosure is intentional.
