# Development phases

## Phase 1: cleanup and safe agent foundations
Implemented: remove Earn end to end; retain shared swap resources; compare two route providers with explicit limits; Arc balance; immutable private payment reviews; wallet approval; persistent receipt tracking. Preserve the existing theme.

## Phase 2: funding and complete swap handoffs
Next: Circle CCTP / Bridge Kit funding into Arc, explicit supported chains and token decimals, browser review links for agent-prepared swaps, recoverable bridge status. Keep swap execution primary. Do not label a bridge complete before destination confirmation.

## Phase 3: bounded agent payments
Next: spending policies, expiry, recipient allowlists and explicit wallet delegation. Investigate x402 payment workflows only after the underlying funding and receipt paths are verified. No autonomous signing currently exists.

## Before a public grant demo
Configure provider credentials; test real quotes and a small user-approved mainnet payment; replace single-process payment storage; restrict CORS and configure HTTPS URLs; verify wallet support; prepare reproducible setup instructions; make the repository public only when requested. No grant application or deployment has been submitted.
