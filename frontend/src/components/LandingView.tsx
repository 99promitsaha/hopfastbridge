import {
  ArrowRight,
  CircleDollarSign,
  Clock3,
  Coins,
  Globe2,
  LockKeyhole,
  Route,
  SendHorizontal,
  ShieldCheck,
  UserRound,
  Wallet2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import {
  architectApi,
  type ArchitectConfig,
} from '../services/architectService';

export function LandingView({
  onBridge,
  onPayAnyone,
}: {
  onBridge: () => void;
  onPayAnyone: () => void;
}) {
  const [paymentsReady, setPaymentsReady] = useState(false);
  const [heroAction, setHeroAction] = useState<'Bridge to' | 'Pay on'>('Bridge to');

  useEffect(() => {
    architectApi<ArchitectConfig>('/config')
      .then((config) => setPaymentsReady(config.ready))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeroAction((current) =>
        current === 'Bridge to' ? 'Pay on' : 'Bridge to'
      );
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hf-home hf-home-redesign hf-product-home">
      <section className="hf-product-hero" aria-labelledby="home-title">
        <div className="hf-product-hero-copy">
          <p className="hf-product-eyebrow">
            <span className="hf-product-live-dot" aria-hidden="true" />
            Live on Arc
          </p>
          <h1 id="home-title" className="hf-rotating-hero" aria-label="Bridge to and pay on Arc">
            <span className="hf-rotating-copy" aria-hidden="true">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={heroAction}
                  initial={{ opacity: 0, y: 18, filter: 'blur(5px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -18, filter: 'blur(5px)' }}
                  transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                >
                  {heroAction}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="hf-hero-arc">
              <img src="/brand/arc-logo.svg" alt="" aria-hidden="true" />
            </span>
          </h1>
          <p className="hf-product-lead">
            Bring USDC in from the network you already use. Then send it to a
            person through their X username. Quotes, approvals, and payment status
            stay in one place.
          </p>
          <div className="hf-product-actions">
            <button type="button" className="hf-home-primary" onClick={onBridge}>
              Bridge USDC <ArrowRight size={17} />
            </button>
            <button type="button" className="hf-home-secondary" onClick={onPayAnyone}>
              Pay someone <SendHorizontal size={16} />
            </button>
          </div>
          <div className="hf-product-proof" aria-label="Product assurances">
            <span><Route size={14} /> LI.FI + Squid routes</span>
            <span><Wallet2 size={14} /> You approve every move</span>
            <span><ShieldCheck size={14} /> Check realtime status</span>
          </div>
        </div>

        <div className="hf-hero-terminal" aria-label="A Hopfast route followed by an Arc payment">
          <div className="hf-terminal-glow" aria-hidden="true" />
          <div className="hf-terminal-shell">
            <div className="hf-terminal-route">
              <div className="hf-terminal-route-path" aria-label="Base USDC routed to Arc USDC via LI.FI or Squid">
                <span><img src="/chains/base.svg" alt="" /><strong>Base USDC</strong></span>
                <ArrowRight size={14} aria-hidden="true" />
                <span className="hf-terminal-route-providers">
                  <span className="hf-terminal-provider">
                    <img src="/providers/lifi.png" alt="" /><strong>LI.FI</strong>
                  </span>
                  <span className="hf-terminal-provider-sep">or</span>
                  <span className="hf-terminal-provider">
                    <img src="/providers/squid.ico" alt="" /><strong>Squid</strong>
                  </span>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
                <span><img src="/brand/arc-mark.svg" alt="" /><strong>Arc USDC</strong></span>
              </div>
            </div>
            <div className="hf-terminal-people">
              <img
                src="/brand/bridge-people.png"
                alt="Two people using their phones to send USDC."
                width="1402"
                height="1122"
                decoding="async"
                fetchPriority="high"
              />
            </div>
            <div className="hf-terminal-payment">
              <span className="hf-terminal-payment-icon"><CircleDollarSign size={16} /></span>
              <div><small>USDC RECEIVED</small><strong>@helloworld</strong></div>
              <b>100 <small>USDC</small></b>
            </div>
          </div>
        </div>
      </section>

      <section className="hf-product-duo" aria-labelledby="product-title">
        <header className="hf-product-section-heading">
          <div>
            <p className="hf-product-eyebrow">One balance, two useful moves</p>
            <h2 id="product-title">Your money should not stop at the bridge.</h2>
          </div>
          <p>
            Hopfast gets USDC onto Arc, then gives you a direct way to send it
            to someone. Each step is clear before you approve it.
          </p>
        </header>

        <div className="hf-product-duo-grid">
          <article className="hf-product-card hf-product-card-route">
            <div className="hf-product-card-top">
              <span className="hf-product-card-icon"><Globe2 size={20} /></span>
              <span className="hf-product-status"><i /> Live routing</span>
            </div>
            <div>
              <p className="hf-product-index">01 · BRIDGE</p>
              <h3>Get USDC onto Arc.</h3>
              <p>
                Pick a source network and compare live routes. If a provider
                cannot return a usable quote, it stays out of the list.
              </p>
              <button type="button" onClick={onBridge}>Compare routes <ArrowRight size={15} /></button>
            </div>
            <div className="hf-route-preview" aria-hidden="true">
              <div className="hf-route-preview-row">
                <span><img src="/chains/base.svg" alt="" /><b>Base</b><small>USDC</small></span>
                <Route size={15} />
                <span><img src="/brand/arc-mark.svg" alt="" /><b>Arc</b><small>USDC</small></span>
              </div>
              <div className="hf-route-preview-quotes">
                <div className="hf-route-preview-quote hf-route-preview-quote--best">
                  <span><img src="/providers/lifi.png" alt="" /></span>
                  <div className="hf-route-preview-quote-info">
                    <strong>LI.FI</strong>
                    <small className="hf-route-preview-badge">Lowest cost</small>
                  </div>
                  <div className="hf-route-preview-quote-right">
                    <strong>499.73 USDC</strong>
                    <small className="hf-route-preview-time">~2 min</small>
                  </div>
                </div>
                <div className="hf-route-preview-quote">
                  <span><img src="/providers/squid.ico" alt="" /></span>
                  <div className="hf-route-preview-quote-info">
                    <strong>Squid</strong>
                  </div>
                  <div className="hf-route-preview-quote-right">
                    <strong>498.91 USDC</strong>
                    <small className="hf-route-preview-time">~3 min</small>
                  </div>
                </div>
              </div>
              <div className="hf-route-preview-meta"><span>Fees itemised</span></div>
            </div>
          </article>

          <article className="hf-product-card hf-product-card-pay">
            <div className="hf-product-card-top">
              <span className="hf-product-card-icon"><UserRound size={20} /></span>
              <span className="hf-product-status"><i className={paymentsReady ? '' : 'is-waiting'} /> {paymentsReady ? 'Payments live' : 'Checking payments'}</span>
            </div>
            <div>
              <p className="hf-product-index">02 · PAY</p>
              <h3>Send USDC to a person.</h3>
              <p>
                Enter an X username and a message. They verify that account,
                connect a wallet, and claim the payment on Arc.
              </p>
              <button type="button" onClick={onPayAnyone}>Create a payment <ArrowRight size={15} /></button>
            </div>
            <div className="hf-payment-preview" aria-hidden="true">
              <div className="hf-preview-card">
                <span>hopfast</span>
                <img src="/brand/arc-logo.svg" alt="" />
                <strong>500.00 <small>USDC</small></strong>
                <em>PAYMENT ON ARC</em>
              </div>
              <div className="hf-preview-envelope">
                <span><CircleDollarSign size={18} /></span>
                <small>FOR</small>
                <strong>@username</strong>
                <em>100 USDC TO CLAIM</em>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="hf-product-journey" aria-labelledby="journey-title">
        <header>
          <p className="hf-product-eyebrow">One continuous flow</p>
          <h2 id="journey-title">From another network to another person.</h2>
          <p>No handoff between a bridge, a spreadsheet, and a wallet address.</p>
        </header>
        <ol>
          <li><span>01</span><div><Route size={17} /><strong>Compare</strong><p>Choose the live route that works for your amount.</p></div></li>
          <li><span>02</span><div><Wallet2 size={17} /><strong>Approve</strong><p>Your wallet signs the route. Hopfast never holds it.</p></div></li>
          <li><span>03</span><div><UserRound size={17} /><strong>Address</strong><p>Use the recipient’s X username instead of asking for a wallet.</p></div></li>
          <li><span>04</span><div><LockKeyhole size={17} /><strong>Verify</strong><p>Only the verified account can claim to an Arc wallet.</p></div></li>
        </ol>
      </section>

      <section className="hf-product-control" aria-labelledby="control-title">
        <header className="hf-product-section-heading">
          <div>
            <p className="hf-product-eyebrow">Built for real money</p>
            <h2 id="control-title">The important details stay in view.</h2>
          </div>
          <p>
            Amounts, fees, routes, timing, and status are shown where the
            decision happens, not buried after it.
          </p>
        </header>
        <div className="hf-control-grid">
          <article><span><Coins size={19} /></span><h3>Know what arrives.</h3><p>Every usable route shows the expected output, estimated time, and fee breakdown before you sign.</p></article>
          <article><span><ShieldCheck size={19} /></span><h3>Keep wallet control.</h3><p>Hopfast prepares the transaction. Your connected wallet approves it and sends it.</p></article>
          <article><span><Clock3 size={19} /></span><h3>Track what happens next.</h3><p>Bridge progress and sent-payment status stay available after the wallet prompt closes.</p></article>
          <article><span><Route size={19} /></span><h3>See only usable routes.</h3><p>Providers that cannot quote your amount stay out of the decision instead of filling the screen with errors.</p></article>
        </div>
      </section>

      <section className="hf-product-pricing" aria-labelledby="pricing-title">
        <div>
          <p className="hf-product-eyebrow">Clear costs</p>
          <h2 id="pricing-title">See the fee before the signature.</h2>
        </div>
        <dl>
          <div><dt>Bridge routes</dt><dd>Provider, network, and Hopfast fees are itemised in the selected quote.</dd></div>
          <div><dt>Pay on Arc</dt><dd>2.5% is deducted when the payment is deposited. Claiming adds no second Hopfast fee.</dd></div>
          <div><dt>Network gas</dt><dd>Gas is separate and shown by your wallet before you approve a transaction.</dd></div>
        </dl>
      </section>

      <section className="hf-product-final">
        <div className="hf-product-final-mark"><img src="/brand/arc-mark.svg" alt="" /></div>
        <div>
          <p className="hf-product-eyebrow">Ready when you are</p>
          <h2>Bring USDC in. Send it where it needs to go.</h2>
        </div>
        <div className="hf-product-final-actions">
          <button type="button" className="hf-home-primary" onClick={onBridge}>Bridge USDC <ArrowRight size={16} /></button>
          <button type="button" className="hf-home-secondary" onClick={onPayAnyone}>Pay someone</button>
        </div>
      </section>
    </div>
  );
}
