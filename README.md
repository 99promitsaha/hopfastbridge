# Hopfast

**Bridge USDC. Pay by username.**

[Hopfast](https://hopfast.xyz) is a USDC payments app on Arc. Compare bridge routes into Arc, send USDC directly to a verified Hopfast ID, or pay an X username without asking for a wallet address first. Receive payments through your own ID, link, and QR code.

Built around a familiar idea from India's UPI: paying someone should start with knowing who they are. Hopfast brings that idea to crypto, with USDC settlement on Arc and transactions signed in your own wallet.

[Open the app](https://hopfast.xyz) · [Explore the code](#architecture) · [Run locally](#local-development)

## Try it

- **Bring funds to Arc:** connect your wallet, choose a supported source asset, compare available routes, and bridge.
- **Pay someone you know:** enter their Hopfast ID to confirm their linked wallet, or use their X username to create a private claim link.
- **Get paid:** verify your X account and wallet, then share your Hopfast ID, payment link, or QR code.
- **Follow a payment:** open Activity for direct transfers and X username payments, including their onchain transaction links.

For X username payments, you share the claim link yourself. The recipient signs in with the intended X account and claims the USDC to their own wallet. Hopfast does not send messages from your social account.

## Why we are building it

Crypto payments still ask the recipient to explain addresses, tokens, and networks before money can move. Hopfast brings the bridge and the payment into the same app: bring USDC to Arc, identify the person, and pay.

The longer-term goal is to let people collect USDC regardless of the supported asset or network the payer starts with. Freelancer invoices are implemented in this branch and await their separate escrow deployment. Merchant checkout, an open-source integration API, and Telegram payments remain planned extensions.

Users sign their own transfers, bridges, approvals, deposits, and claims. Direct Hopfast ID payments go wallet to wallet; X username payments use an escrow with a backend identity-verification signer. The [escrow trust boundary](#how-the-escrow-protects-payments) is explained below.

## What Hopfast offers

| Product | What it does | Settlement |
| --- | --- | --- |
| Bridge to Arc | Compares executable LI.FI and Squid routes and presents the best available options | The selected provider routes funds to the connected Arc wallet |
| Hopfast ID | Connects a verified X identity to an Arc wallet, personal payment link, and QR code | Direct wallet-to-wallet USDC transfer on Arc |
| Pay an X username | Creates a private payment for a specific X account without requiring its wallet address first | Funds remain in the Hopfast escrow until the matching X account claims them |
| Payment activity | Separates direct Hopfast ID transfers from private X username payments | Status and explorer links remain available after signing |
| Freelancer invoices | Saves billing details and reusable clients, itemized drafts, shareable invoice links and QR codes | Separate USDC escrow; checkout remains unavailable until configured |
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

### Invoice a client

Open **Invoices** beside the payment tabs. Sign a wallet challenge to access your private workspace, save your billing details and clients, and create an itemized draft. Review its calculated total before publishing. Publishing requires a verified Hopfast ID and locks the invoice details, amount, and receiving wallet.

The shareable link and QR open that specific invoice, including its breakdown and payment review. A client pays into a separate invoice escrow. The invoicer releases the funded invoice to their wallet; the configured treasury receives the deducted platform cut in that same transaction. Drafts remain editable; published invoices are immutable. Cancellation stops new payment authorizations and waits for existing short-lived authorizations to expire.

Billing details shown on a published invoice are visible to anyone with its link. The saved client book stays private. Invoice records and business profiles live in MongoDB and survive an application restart as long as the database is retained. Onchain records are authoritative for funding, release and recovery.

## How the escrow protects payments

`ArchitectEscrow.sol` is an EIP-712 authorized USDC escrow for private X username payments.

- A deposit is bound to a unique envelope ID and a hash of the recipient's permanent X user ID.
- A claim authorization is bound to one envelope, one recipient wallet, one chain, one deployed contract, and a short deadline.
- The contract requires the authorized recipient to be the transaction sender.
- Envelope state prevents duplicate claims and duplicate deposits.
- Reentrancy protection and safe token transfers protect state transitions.
- Fee-on-transfer and otherwise incompatible tokens are rejected by exact balance accounting.
- The token rescue function cannot withdraw the accounted active escrow balance.
- The original funder alone can reclaim an unclaimed payment after 30 days.
- Administrative recovery applies only after expiry, adds a seven-day delay, and remains cancellable by a funder reclaim.
- Contract ownership uses a two-step transfer and cannot be renounced accidentally.

The escrow has a trusted authorization signer. The owner can rotate that signer and pause deposits and claims. A compromised signer or malicious owner could authorize an incorrect active claim, so production keys should be separated and protected. Administrative recovery can redirect an expired payment after its public delay. These are explicit trust boundaries: wallet signatures do not make social-identity verification fully trustless. This README describes protections in the implementation, not a claim of an independent security audit.

### Separate invoice escrow

`InvoiceEscrow.sol` binds payment authorizations to the invoice ID, published-details hash, exact amount, issuer, payer, chain, contract and deadline. It accepts only its configured six-decimal USDC token, checks the exact transferred amount, and prevents duplicate funding or release. Reserved invoice funds cannot be withdrawn through the surplus-token rescue function.

The invoicer alone can release a funded invoice normally. The owner has full recovery authority over any invoice still held in escrow and may redirect the entire amount to a chosen wallet. Recovery records the recipient and reason hash onchain. This is a trusted administrator model, not a trustless dispute system; neither administrator nor invoicer can reverse funds already released. The payment review discloses that authority before signing.

Invoice checkout fails closed until the backend verifies the deployed contract's token, owner, treasury, signer, network and configuration. Local tests exercise real wallet signatures, MongoDB persistence, API access boundaries, onchain settlement, recovery, replay protection and adversarial token callbacks. They do not replace an independent audit or production wallet testing.

## Transaction costs

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
| `INVOICE_ESCROW_ADDRESS` | Separate deployed invoice escrow; leaving it blank disables publishing and checkout |
| `INVOICE_SIGNER_KEY` | Server-only invoice payment authorization key, separate from the claim signer |
| `INVOICE_ADMIN_ADDRESS` | Invoice owner with full recovery authority over funds still held in escrow |
| `INVOICE_TREASURY_ADDRESS` | Treasury matched against the invoice contract before authorizing payment |
| `COINGECKO_API_KEY` or `CMC_API_KEY` | Optional server-side token price source |

Never put a private key, database credential, provider secret, or OAuth secret in a `VITE_*` variable. Vite variables are included in the browser bundle.

### Activate invoice checkout

Compile and test the contracts first. Configure `contracts/.env` with the Arc RPC, a deployment wallet, the invoice authorization signer's **public address**, admin and treasury. Review these addresses, then explicitly set `CONFIRM_DEPLOY=invoice-arc-5042` for mainnet (or `invoice-arc-5042002` for testnet) and run `npm run deploy:invoices` inside `contracts/`. This broadcasts a real deployment and spends gas; it is not part of the test command.

Set the resulting address and matching signer, admin and treasury in the backend environment, retain its MongoDB database, and redeploy the backend and frontend. No signing key belongs in the frontend. Existing private-payment escrow settings remain separate. Test a small published invoice through funding, release and recovery before announcing availability.

The MongoDB integration tests require a local `mongod` executable. Set `TEST_MONGOD` when it is installed outside the macOS Homebrew default. Tests start isolated temporary databases and remove them afterward; they do not use the production database.

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

The default frontend is `http://localhost:5173`; the API is `http://localhost:8080/api`. Keep the browser hostname consistent with your allowed origins and OAuth return configuration; `localhost` and `127.0.0.1` are different origins.

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

For the public deployment, set `APP_BASE_URL=https://hopfast.xyz` so generated links and QR codes always use the production domain. Allow both `https://hopfast.xyz` and `https://www.hopfast.xyz` in `CORS_ORIGIN` and Privy. The X callback must point to the backend callback endpoint, rather than a frontend page. Browser API requests use `VITE_HOPFAST_API_BASE_URL`; these values serve different purposes.

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
- Profile and private-payment metadata survive process restarts through MongoDB. Direct-payment records require the persistent disk described above; a redeploy without that disk is not equivalent to a restart.
- USDC or network-level restrictions cannot be bypassed by the application or escrow.

## Repository hygiene

Only `.env.example` files belong in version control. Before publishing changes, review the staged diff and scan the complete git history for secrets. Public blockchain addresses and official token contracts are not credentials, but personal operational addresses should remain outside example configuration unless disclosure is intentional.
