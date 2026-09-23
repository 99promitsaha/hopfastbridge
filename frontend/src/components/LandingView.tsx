import { ArrowRight, Check, Gift, Route, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { architectApi, type ArchitectConfig } from '../services/architectService';

export function LandingView({ onBridge, onPayAnyone }: {
  onBridge: () => void; onPayAnyone: () => void;
}) {
  const [supportReady, setSupportReady] = useState(false);
  useEffect(() => {
    architectApi<ArchitectConfig>('/config').then((config) => setSupportReady(config.ready)).catch(() => {});
  }, []);

  return (
    <div className="hf-home hf-home-redesign">
      <section className="hf-new-hero" aria-labelledby="home-title">
        <div className="hf-new-hero-copy">
          <p className="hf-home-eyebrow">Built for Arc</p>
          <h1 id="home-title">Move money to Arc.<br />Pay anyone on Arc.</h1>
          <p>
            Find a route into Arc, then send USDC directly to someone through a simple payment envelope.
          </p>
          <div className="hf-new-actions">
            <button type="button" className="hf-home-primary" onClick={onBridge}>Bridge to Arc <ArrowRight size={17} /></button>
            <button type="button" className="hf-new-text-action" onClick={onPayAnyone}>Pay on Arc <Gift size={15} /></button>
          </div>
          <div className="hf-new-trust">
            <span><Check size={13} /> Quotes before you sign</span>
            <span><Check size={13} /> Non-custodial</span>
            <span><Check size={13} /> USDC on Arc</span>
          </div>
        </div>
        <div className="hf-new-hero-art" aria-label="USDC moving from other networks to two people on Arc">
          <div className="hf-new-orbit hf-new-orbit-one" />
          <div className="hf-new-orbit hf-new-orbit-two" />
          <img src="/brand/bridge-people.png" alt="Two people using their phones to send USDC." width="1402" height="1122" decoding="async" fetchPriority="high" />
          <div className="hf-new-float hf-new-float-usdc"><img src="/token-icons/usdc.svg" alt="" /><strong>USDC</strong><span>moving to Arc</span></div>
          <div className="hf-new-float hf-new-float-arc"><img src="/brand/arc-mark.svg" alt="" /><strong>Arc</strong></div>
          <div className="hf-new-float hf-new-float-route"><Route size={15} /><span>Best available route</span></div>
        </div>
      </section>

      <section className="hf-story" aria-labelledby="story-title">
        <div className="hf-story-heading">
          <p className="hf-home-eyebrow">WHAT HOPFAST IS FOR</p>
          <h2 id="story-title">Bring money to Arc, then send it to the people you want to pay.</h2>
        </div>
        <div className="hf-bento">
          <article className="hf-bento-card hf-bento-bridge">
            <div className="hf-bento-icon"><Route size={20} /></div>
            <span>LIVE</span>
            <h3>Get your USDC to Arc.</h3>
            <p>Compare real routes from the providers that can serve your trade. See the amount arriving, fees and timing before your wallet asks you to approve anything.</p>
            <button type="button" onClick={onBridge}>Compare routes <ArrowRight size={15} /></button>
            <div className="hf-mini-route" aria-hidden="true">
              <div><img src="/token-icons/eth.svg" alt="" /><img src="/chains/base.svg" alt="" /><img src="/chains/polygon.svg" alt="" /></div>
              <span />
              <img src="/brand/arc-logo.svg" alt="" />
            </div>
          </article>

          <article className="hf-bento-card hf-bento-support">
            <div className="hf-bento-icon"><Gift size={20} /></div>
            <span>{supportReady ? 'LIVE' : 'OPENING SOON'}</span>
            <h3>Pay someone directly on Arc.</h3>
            <p>Send USDC to an X handle with a private message. They verify the account and claim it to their wallet on Arc.</p>
            <button type="button" onClick={onPayAnyone}>Send an envelope <ArrowRight size={15} /></button>
            <div className="hf-bento-envelope" aria-hidden="true">
              <div><Gift size={17} /></div>
              <small>FOR</small>
              <strong>@architect</strong>
              <span>25.00 USDC</span>
            </div>
          </article>

          <article className="hf-bento-card hf-bento-safety">
            <div className="hf-bento-icon"><ShieldCheck size={20} /></div>
            <h3>You stay in control.</h3>
            <ul>
              <li><Check size={14} /> Your wallet approves every transaction.</li>
              <li><Check size={14} /> Failed providers disappear instead of cluttering the quote list.</li>
              <li><Check size={14} /> Unclaimed envelopes can be reclaimed after 30 days.</li>
            </ul>
          </article>

        </div>
      </section>

      <section className="hf-new-how" aria-labelledby="how-title">
        <div>
          <p className="hf-home-eyebrow">START WHERE YOU ARE</p>
          <h2 id="how-title">Bridge first. Pay someone when you are ready.</h2>
        </div>
        <ol>
          <li><span>01</span><div><strong>Choose what you are moving</strong><p>Pick the network, token and amount.</p></div></li>
          <li><span>02</span><div><strong>Take the route that suits you</strong><p>We show valid quotes only. You choose the provider.</p></div></li>
          <li><span>03</span><div><strong>Use your USDC on Arc</strong><p>Keep it, use it, or pay someone directly on Arc.</p></div></li>
        </ol>
      </section>

      <section className="hf-new-final">
        <img src="/brand/arc-logo.svg" alt="Arc" />
        <div><p className="hf-home-eyebrow">HOPFAST</p><h2>Your route into Arc starts here.</h2></div>
        <button type="button" className="hf-home-primary" onClick={onBridge}>Find a route <ArrowRight size={17} /></button>
      </section>
    </div>
  );
}
