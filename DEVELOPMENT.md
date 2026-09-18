# Development phases

## Phase 1: cleanup and safe agent foundations

Implemented: remove Earn end to end; retain shared swap resources; compare two route providers with explicit limits; Arc balance; immutable private payment reviews; wallet approval; persistent receipt tracking. Preserve the existing theme.

## Phase 2: funding and complete swap handoffs

Arc USDC funding routes use the six-decimal contract and a shared native-USDC gas reserve. LI.FI and Squid are both queried for any requested route; if either provider has no route, the other remains available. Status updates persist against the transaction record so a tracked bridge can be recovered after a refresh. Keep swap execution primary. Do not label a bridge complete before destination confirmation.

## Phase 3: useful agent guidance

Curate high-signal research and planning prompts around Arc, route selection and post-bridge product experiments. No autonomous signing exists.

## Before a public grant demo

Configure provider credentials; test real quotes and a small user-approved mainnet payment; replace single-process payment storage; restrict CORS and configure HTTPS URLs; verify wallet support; prepare reproducible setup instructions; make the repository public only when requested. No grant application or deployment has been submitted.

## Arc UI redesign

- Swap-first navigation, Base USDC → Arc USDC default, and three editable starter pairs.
- Arc mainnet appears first in network selection, with one USDC row. Swap base units are six decimals; native payments and gas remain eighteen decimals.
- LI.FI and Squid are queried for Arc routes. Availability is decided by the live provider response, not a hard-coded provider block.
- White/navy design tokens, Manrope and DM Sans hosted locally, restrained glass navigation and overlays, responsive desktop/tablet/mobile layouts, keyboard dialog focus and reduced-motion support.
- Arc artwork copied unchanged from the supplied desktop brand folder. Hopfast has a separate bridge-shaped mark. These are independent identities.
- Existing quote transactions and included-fee accounting remain intact. Never send a transaction solely to test the redesign.
