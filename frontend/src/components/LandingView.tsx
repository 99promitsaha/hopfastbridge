import {
  ArrowRight,
  AtSign,
  Clock3,
  Coins,
  Globe2,
  Link2,
  LockKeyhole,
  QrCode,
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
  const [paymentsStatus, setPaymentsStatus] = useState<'checking' | 'live' | 'offline'>('checking');
  const [heroAction, setHeroAction] = useState<'Bridge to' | 'Pay on'>('Bridge to');

  useEffect(() => {
    architectApi<ArchitectConfig>('/config')
      .then((config) => setPaymentsStatus(config.ready ? 'live' : 'offline'))
      .catch(() => setPaymentsStatus('offline'));
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
            Unified Payments App on Arc. From 🇮🇳 to 🌏
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
            Compare routes, send USDC to an X username, and receive
            payments through your own Hopfast link or QR.
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
            <span><Wallet2 size={14} /> Your wallet stays in control</span>
            <span><ShieldCheck size={14} /> Live transaction status</span>
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
              <span className="hf-terminal-payment-icon"><img src="/token-icons/usdc.svg" alt="" /></span>
              <div><small>USDC RECEIVED</small><strong>@helloworld</strong></div>
              <b>100 <small>USDC</small></b>
            </div>
          </div>
        </div>
      </section>

      <section className="hf-product-duo" aria-labelledby="product-title">
        <header className="hf-product-section-heading">
          <div>
            <p className="hf-product-eyebrow">One place to move and pay</p>
            <h2 id="product-title">Bridge in. Pay by username. Receive by link.</h2>
          </div>
          <p>
            Bring USDC onto Arc, pay an existing Hopfast ID directly, or create
            a private claim for any X username.
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
                Choose where your USDC starts. Hopfast compares live LI.FI and
                Squid routes and shows only the quotes you can use.
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
              <div className="hf-route-preview-meta"><span>Live quotes · tracked through arrival</span></div>
            </div>
          </article>

          <article className="hf-product-card hf-product-card-pay">
            <div className="hf-product-card-top">
              <span className="hf-product-card-icon"><UserRound size={20} /></span>
              <span className="hf-product-status"><i className={paymentsStatus === 'live' ? '' : 'is-waiting'} /> {paymentsStatus === 'live' ? 'Payments live' : paymentsStatus === 'checking' ? 'Checking payments' : 'Payments unavailable'}</span>
            </div>
            <div>
              <p className="hf-product-index">02 · PAY</p>
              <h3>Pay the person you know.</h3>
              <p>
                Pay a Hopfast ID directly to its verified Arc wallet. If they do
                not have one yet, address a private payment to their X username.
              </p>
              <button type="button" onClick={onPayAnyone} disabled={paymentsStatus === 'offline'}>{paymentsStatus === 'offline' ? 'Payments temporarily unavailable' : 'Open payments'} <ArrowRight size={15} /></button>
            </div>
            <div className="hf-payment-preview" aria-hidden="true">
              <div className="hf-preview-card">
                <span>hopfast</span>
                <img src="/brand/arc-logo.svg" alt="" />
                <strong>500.00 <small>USDC</small></strong>
                <em>PAYMENT ON ARC</em>
              </div>
              <div className="hf-preview-envelope">
                <span><img className="hf-usdc-icon" src="/token-icons/usdc.svg" alt="" /></span>
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
          <p className="hf-product-eyebrow">Private payments by X username</p>
          <h2 id="journey-title">They do not need a wallet address ready.</h2>
          <p>You create the payment and share its private link. The intended X account must verify before claiming.</p>
        </header>
        <ol>
          <li><span>01</span><div><AtSign size={17} /><strong>Address</strong><p>Enter their X username and the USDC amount.</p></div></li>
          <li><span>02</span><div><Wallet2 size={17} /><strong>Fund</strong><p>Your wallet deposits the payment into the Arc contract.</p></div></li>
          <li><span>03</span><div><SendHorizontal size={17} /><strong>Share</strong><p>Send the private claim link yourself, wherever you already talk.</p></div></li>
          <li><span>04</span><div><LockKeyhole size={17} /><strong>Claim</strong><p>They verify the matching X account and choose their Arc wallet.</p></div></li>
        </ol>
      </section>

      <section className="hf-product-control" aria-labelledby="control-title">
        <header className="hf-product-section-heading">
          <div>
            <p className="hf-product-eyebrow">Before you approve</p>
            <h2 id="control-title">See exactly where the USDC goes.</h2>
          </div>
          <p>
            Hopfast keeps the route, recipient, amount, and transaction state
            visible from quote to confirmation.
          </p>
        </header>
        <div className="hf-control-grid">
          <article><span><Coins size={19} /></span><h3>Expected arrival</h3><p>Compare the USDC expected on Arc, minimum received, route cost, and estimated time.</p></article>
          <article><span><ShieldCheck size={19} /></span><h3>Wallet approval</h3><p>Hopfast prepares each transaction. Your wallet shows it before anything moves.</p></article>
          <article><span><Clock3 size={19} /></span><h3>Live status</h3><p>Follow bridges and payments after the wallet closes, with explorer links when available.</p></article>
          <article><span><Route size={19} /></span><h3>Usable quotes only</h3><p>A provider appears only when it returns an executable route for your transfer.</p></article>
        </div>
      </section>

      <section className="hf-product-pricing hf-product-identity" aria-labelledby="identity-title">
        <div className="hf-identity-story">
          <p className="hf-product-eyebrow">Your payment identity on Arc</p>
          <h2 id="identity-title">Give people one reliable way to pay you.</h2>
          <p>Verify your X username once and point your Hopfast ID, link, and QR to the Arc wallet you control.</p>
          <button type="button" onClick={onPayAnyone}>Create your Hopfast ID <ArrowRight size={15} /></button>
        </div>
        <div className="hf-identity-bento" aria-label="Hopfast ID features">
          <article className="hf-identity-bento-id"><AtSign size={18} /><small>HOPFAST ID</small><strong>username<span>@hopfast</span></strong><p>A memorable payment ID backed by your verified X account.</p></article>
          <article><QrCode size={24} /><strong>Personal QR</strong><p>Download it for profiles, pages, presentations, or in-person payments.</p><div className="hf-mini-qr" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></article>
          <article><Link2 size={24} /><strong>Payment link</strong><p>Share a link that opens with your verified recipient details already filled.</p><code>hopfast.xyz/?pay=username</code></article>
          <article className="hf-identity-bento-usdc"><img src="/token-icons/usdc.svg" alt="USDC" /><strong>Direct USDC on Arc</strong><p>Payments go from the sender's wallet to your connected Arc wallet.</p></article>
        </div>
      </section>

      <section className="hf-product-final">
        <div className="hf-product-final-mark"><img src="/brand/arc-mark.svg" alt="" /></div>
        <div>
          <p className="hf-product-eyebrow">Your next Arc payment</p>
          <h2>Move USDC onto Arc, then send it by username.</h2>
        </div>
        <div className="hf-product-final-actions">
          <button type="button" className="hf-home-primary" onClick={onBridge}>Bridge USDC <ArrowRight size={16} /></button>
          <button type="button" className="hf-home-secondary" onClick={onPayAnyone}>Pay someone</button>
        </div>
      </section>
    </div>
  );
}
