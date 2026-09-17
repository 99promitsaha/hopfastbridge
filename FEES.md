# Integrator fees

Reviewed against provider documentation on 2026-09-17. This change does not activate a new Hopfastbridge commission or modify an external provider account.

## LI.FI

Create the integration and configure the receiving wallet in [LI.FI Portal](https://portal.li.fi). Use that integration's exact identifier as `LIFI_INTEGRATOR` in `backend/.env`. The existing quote client forwards `LIFI_INTEGRATOR` and `LIFI_FEE` to LI.FI; the latter is a decimal fraction, not a percentage integer.

Example: `LIFI_FEE=0.001` requests a 0.1% integrator fee, or $0.10 of a $100 input before any revenue share. `LIFI_FEE=0` requests no extra commission. Never set `0.1` if you mean 0.1%, since that is 10%.

Fees are deducted from the sending asset and forwarded to the portal-configured wallet at execution. LI.FI receives a share of integrator fees depending on use case and volume, so confirm commercial terms before calculating net revenue. LI.FI also documents a 0.25% service fee and variable bridge/DEX costs; our extra commission is not the entire user cost.

References: [monetization setup](https://docs.li.fi/introduction/integrating-lifi/monetizing-integration), [fee FAQ](https://docs.li.fi/faqs/fees-monetization).

## Squid v2

Contact Squid with your integrator ID, receiving wallet and proposed rate to enable fee collection. Its v2 fee documentation supports flat or percentage fees and optional secondary recipients. It documents a 50/50 split of collected integrator fees.

The documented route field is `collectFees`, with `integratorAddress` and `fee` in basis points: 10 basis points is 0.1%, and 50 basis points is 0.5%. Do not copy the older v1 documentation's conflicting numeric example. Squid's team should confirm the accepted request format and fee configuration for our specific integrator ID before enabling it in our route client.

Current code sends the integrator ID but does not inject a custom `collectFees` object. API-key verification is not proof that monetization has been enabled. Integrator and platform fees appear together as Service fee in `feeCosts`; use those quoted costs without adding the commission a second time.

Reference: [Squid v2 fee collection](https://docs.squidrouter.com/widget-integration/add-a-widget/widget/customization-guide/collect-fees).

## Activation checklist

Choose a rate and receiving wallet, configure LI.FI Portal, arrange Squid enablement, add the Squid server configuration, validate fee-bearing quotes and display the actual commission alongside total estimated costs. Confirm fee receipt with a user-approved transaction before calling monetization complete. Wallet signing remains entirely with the user.
