# Integrator fees

## Pay on Arc

Payment envelopes deduct a 2.5% Hopfast fee (250 basis points) from the entered deposit and forward it to the contract’s immutable treasury immediately. A 25 USDC deposit pays 0.625 USDC to Hopfast and reserves 24.375 USDC for claiming or reclaiming. The fee is nonrefundable, irrespective of claim. No second fee applies at claim or reclaim. Gas is separate. Six-decimal integer calculations round fees up to the next micro-USDC; amounts entirely consumed by rounding are rejected. Existing bridge fees remain unchanged. See [builder funding](BUILDER-FUNDING.md) for contract and identity details.

Reviewed against provider documentation on 2026-09-17. Local `LIFI_FEE` is configured to 0.0005: five basis points, or 0.05%. LI.FI quotes require the portal integrator and receiving wallet; missing configuration produces an explicit error. Squid requests have no added Hopfast commission. External provider accounts have not been modified.

## LI.FI

Create the integration and configure the receiving wallet in [LI.FI Portal](https://portal.li.fi). Use that integration's short API integrator string (maximum 23 alphanumeric characters, also allowing `-`, `_` and `.`), not its UUID as `LIFI_INTEGRATOR` in `backend/.env`. The existing quote client forwards `LIFI_INTEGRATOR` and `LIFI_FEE` to LI.FI; the latter is a decimal fraction, not a percentage integer.

Example: `LIFI_FEE=0.0005` requests a 0.05% integrator fee, or $0.05 of a $100 input before any revenue share. `LIFI_FEE=0` requests no extra commission. Never set `0.1` if you mean 0.1%, since that is 10%.

Fees are deducted from the sending asset and forwarded to the portal-configured wallet at execution. LI.FI receives a share of integrator fees depending on use case and volume, so confirm commercial terms before calculating net revenue. LI.FI also documents a 0.25% service fee and variable bridge/DEX costs; our extra commission is not the entire user cost.

References: [monetization setup](https://docs.li.fi/introduction/integrating-lifi/monetizing-integration), [fee FAQ](https://docs.li.fi/faqs/fees-monetization).

## Squid v2

Contact Squid with your integrator ID, receiving wallet and proposed rate to enable fee collection. Its v2 fee documentation supports flat or percentage fees and optional secondary recipients. It documents a 50/50 split of collected integrator fees.

The documented route field is `collectFees`, with `integratorAddress` and `fee` in basis points: 10 basis points is 0.1%, and 50 basis points is 0.5%. Do not copy the older v1 documentation's conflicting numeric example. Squid's team should confirm the accepted request format and fee configuration for our specific integrator ID before enabling it in our route client.

Current code sends the integrator ID but does not inject a custom `collectFees` object. API-key verification is not proof that monetization has been enabled. Integrator and platform fees appear together as Service fee in `feeCosts`; use those quoted costs without adding the commission a second time.

Reference: [Squid v2 fee collection](https://docs.squidrouter.com/widget-integration/add-a-widget/widget/customization-guide/collect-fees).

## Activation checklist

Choose a rate and receiving wallet, configure LI.FI Portal, arrange Squid enablement, add the Squid server configuration, validate fee-bearing quotes and display the actual commission alongside total estimated costs. Confirm fee receipt with a user-approved transaction before calling monetization complete. Wallet signing remains entirely with the user.

## Display and accounting

The Hopfast fee row uses LI.FI's returned `amountUSD` for its included fee-collection step. A separate commission retains the provider's decimal amount. When LI.FI supplies `feeSplit.integratorFee` and token price/decimals, the row values that exact integrator token amount at the quote price using decimal integer arithmetic. When the split is absent and LI.FI combines its 25-basis-point platform fee with our 5-basis-point commission, we fall back to our proportional share of the reported USD amount. This is a quote valuation, subject to the provider's price and rounding, not a guarantee of final fiat settlement. The live `hopfast` quote confirmed a combined 0.0030 fee; $0.0729 total corresponds to $0.01215 for Hopfast. No fee-bearing transaction was sent. Fees cannot be reliably classified by free-text names. If LI.FI does not confirm the commission, the backend refuses the quote instead of inventing a dollar amount.

This is a breakdown only: route totals use top-level fee/gas costs once, quoted output remains unchanged, and no extra transfer or amount deduction is added. Squid displays Free for the Hopfast commission; provider and network costs still apply.
