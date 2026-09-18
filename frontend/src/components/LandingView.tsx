import { ArrowRight, ArrowUpRight, Layers, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { architectApi, type ArchitectConfig } from "../services/architectService";

export function LandingView({ onBridge, onPayAnyone, onGrants }: {
  onBridge: () => void; onPayAnyone: () => void; onGrants: () => void;
}) {
  const [fundingReady, setFundingReady] = useState(false);
  useEffect(() => {
    architectApi<ArchitectConfig>("/config").then(config => setFundingReady(config.ready)).catch(() => {});
  }, []);
  return (
    <div className="hf-home">
      <section className="hf-home-hero" aria-labelledby="home-title">
        <p className="hf-home-eyebrow">Swap aggregator and micro-grant platform, on Arc</p>
        <h1 id="home-title">Bridge from anywhere.<span>To <img src="/brand/arc-logo.svg" alt="Arc" /></span></h1>
        <p className="hf-home-lead">Bring your funds to Arc. Back the people building it.</p>
        <div className="hf-home-actions">
          <button className="hf-home-primary" type="button" onClick={onBridge}>Bridge to Arc <ArrowRight size={18} /></button>
          <a className="hf-home-link" href="#home-builders">Explore builder funding <ArrowRight size={16} /></a>
        </div>
      </section>
      <section className="hf-home-bridge" aria-labelledby="home-bridge-title">
        <div className="hf-home-bridge-copy">
          <span className="hf-home-status"><i /> Bridge is live</span>
          <h2 id="home-bridge-title">Your funds.<br />A route to Arc.</h2>
          <p>Compare LI.FI and Squid quotes in one place. See what arrives, what it costs, and how long it takes before you approve.</p>
          <button className="hf-home-link" type="button" onClick={onBridge}>Find a bridge route <ArrowRight size={17} /></button>
          <div className="hf-home-providers"><span>Routes from</span><strong>LI.FI</strong><strong>Squid</strong></div>
        </div>
        <div className="hf-home-bridge-visual">
          <div className="hf-home-route" aria-label="Bridge from Ethereum, Base, or Polygon to Arc">
            <div className="hf-home-route-sources"><img src="/token-icons/eth.svg" alt="Ethereum" /><img src="/chains/base.svg" alt="Base" /><img src="/chains/polygon.svg" alt="Polygon" /></div>
            <ArrowRight size={24} />
            <div className="hf-home-route-arc"><img src="/brand/arc-logo.svg" alt="Arc" /></div>
          </div>
          <img className="hf-home-people" src="/brand/bridge-people.png" alt="Two people transferring funds using their phones." width="1402" height="1122" decoding="async" fetchPriority="high" />
          <div className="hf-home-bridge-caption">Compare quotes <span /> Approve in your wallet <span /> Track arrival</div>
        </div>
      </section>
      <section className="hf-home-builders" id="home-builders" aria-labelledby="home-builders-title">
        <header className="hf-home-section-heading">
          <p className="hf-home-eyebrow">Architects supporting Architects</p>
          <h2 id="home-builders-title">Great work needs early backers.</h2>
          <p>Arc’s next useful app might still be a prototype. Help a builder keep going, or share what you’re building and ask the community to back your next milestone.</p>
        </header>
        <div className="hf-home-products">
          <article className="hf-home-product hf-home-support">
            <div className="hf-home-product-heading"><Send size={20} /><span>{fundingReady ? "Support Architects" : "Support Architects · Opening soon"}</span></div>
            <h3>A grant, sent to their X handle.</h3>
            <p>Choose a builder, add USDC and a personal message. They verify their X account and claim to an Arc wallet through a private link.</p>
            <button className="hf-home-link" type="button" onClick={onPayAnyone}>Support an Architect <ArrowUpRight size={17} /></button>
            <figure className="hf-home-envelope"><img src="/brand/x-thank-you.png" alt="An example USDC envelope for @jerallaire, with a message and claim link." loading="lazy" decoding="async" /><figcaption>*illustrative purposes only.</figcaption></figure>
            <p className="hf-home-fine-print">Unclaimed after 30 days? Reclaim the remaining funds. Hopfast deducts 2.5% at deposit; that fee is not refundable.</p>
          </article>
          <article className="hf-home-product hf-home-grants">
            <div className="hf-home-product-heading"><Layers size={20} /><span>Micro-grants · Contributions coming soon</span></div>
            <h3>Raise a small grant. Keep your equity.</h3>
            <p>Share your Arc project, a funding goal, and a specific milestone. Link your weekly updates so fellow Architects can follow the work.</p>
            <button className="hf-home-link" type="button" onClick={onGrants}>Request a micro-grant <ArrowUpRight size={17} /></button>
            <div className="hf-home-request-preview" aria-label="What a micro-grant request includes">
              <div className="hf-home-request-top"><span>YOUR PROJECT ON ARC</span><Layers size={22} /></div>
              <h4>What are you building?</h4><p>A project link and a short explanation of the problem you’re solving.</p>
              <div className="hf-home-request-row"><span>Next milestone</span><strong>What you’ll ship</strong></div>
              <div className="hf-home-request-row"><span>Funding goal</span><strong>USDC on Arc</strong></div>
              <div className="hf-home-request-row"><span>Progress</span><strong>Your weekly updates</strong></div>
              <span className="hf-home-request-label">Request preview</span>
            </div>
            <p className="hf-home-fine-print">Requests are open. When contributions launch, a 1.5% Hopfast fee will be deducted from each contribution to cover agent and infrastructure costs.</p>
          </article>
        </div>
      </section>
      <section className="hf-home-details" aria-label="Fees and how funds work">
        <h2>A few things to know.</h2>
        <details><summary>What does bridging cost?</summary><p>LI.FI quotes include a 0.05% Hopfast fee. Squid routes have no Hopfast fee. Provider and network costs are shown in the quote before you approve.</p></details>
        <details><summary>How does a builder claim an envelope?</summary><p>The recipient opens the private link, verifies the X account the envelope was addressed to, and claims to their connected Arc wallet. The link alone cannot authorize a claim.</p></details>
        <details><summary>What if an envelope goes unclaimed?</summary><p>After 30 days, the original funder can reclaim the remaining funds. The 2.5% fee was collected at deposit and is not refunded. Network gas is separate.</p></details>
      </section>
      <section className="hf-home-close" aria-label="Start bridging"><h2>Start with USDC on Arc.</h2><button className="hf-home-primary" type="button" onClick={onBridge}>Bridge to Arc <ArrowRight size={18} /></button></section>
    </div>
  );
}
