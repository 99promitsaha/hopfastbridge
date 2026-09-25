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
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  architectApi,
  type ArchitectConfig,
} from "../services/architectService";

export function LandingView({
  onBridge,
  onPayAnyone,
}: {
  onBridge: () => void;
  onPayAnyone: () => void;
}) {
  const [paymentsStatus, setPaymentsStatus] = useState<
    "checking" | "live" | "offline"
  >("checking");

  useEffect(() => {
    architectApi<ArchitectConfig>("/config")
      .then((config) => setPaymentsStatus(config.ready ? "live" : "offline"))
      .catch(() => setPaymentsStatus("offline"));
  }, []);

  return (
    <div className="hf-home hf-home-redesign hf-product-home">
      <section className="hf-product-hero" aria-labelledby="home-title">
        <div className="hf-product-hero-copy">
          <h1 id="home-title">
            <span className="hf-hero-bridge-line">
              Bridge <span className="hf-hero-usdc-word">USDC.</span>
              <span className="hf-hero-usdc-coin" aria-hidden="true">
                <img src="/token-icons/usdc.svg" alt="" />
              </span>
            </span>
            <span className="hf-hero-pay-line">Pay by username.</span>
          </h1>
          <p className="hf-product-lead">
            Compare live routes into Arc. Pay a Hopfast ID directly, or send USDC
            to an X username for them to verify and claim in their own wallet.
          </p>
          <div className="hf-product-actions">
            <button
              type="button"
              className="hf-home-primary"
              onClick={onBridge}
            >
              Bridge USDC <ArrowRight size={17} />
            </button>
            <button
              type="button"
              className="hf-home-secondary"
              onClick={onPayAnyone}
            >
              Pay someone <SendHorizontal size={16} />
            </button>
          </div>
          <div className="hf-product-proof" aria-label="Product assurances">
            <span>
              <Route size={14} /> Compare LI.FI and Squid
            </span>
            <span>
              <AtSign size={14} /> Pay a Hopfast ID or X username
            </span>
            <span>
              <ShieldCheck size={14} /> Sign with your own wallet
            </span>
          </div>
        </div>

        <div
          className="hf-hero-terminal"
          aria-label="A Hopfast route followed by an Arc payment"
        >
          <div className="hf-terminal-glow" aria-hidden="true" />
          <div className="hf-terminal-shell">
            <div className="hf-terminal-route">
              <div
                className="hf-terminal-route-path"
                aria-label="Base USDC routed to Arc USDC via LI.FI or Squid"
              >
                <span>
                  <img src="/chains/base.svg" alt="" />
                  <strong>Base USDC</strong>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
                <span className="hf-terminal-route-providers">
                  <span className="hf-terminal-provider">
                    <img src="/providers/lifi.png" alt="" />
                    <strong>LI.FI</strong>
                  </span>
                  <span className="hf-terminal-provider-sep">or</span>
                  <span className="hf-terminal-provider">
                    <img src="/providers/squid.ico" alt="" />
                    <strong>Squid</strong>
                  </span>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
                <span>
                  <img src="/brand/arc-mark.svg" alt="" />
                  <strong>Arc USDC</strong>
                </span>
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
              <span className="hf-terminal-payment-icon">
                <img src="/token-icons/usdc.svg" alt="" />
              </span>
              <div>
                <small>USDC RECEIVED</small>
                <strong>@helloworld</strong>
              </div>
              <b>
                100 <small>USDC</small>
              </b>
            </div>
          </div>
        </div>
      </section>

      <section className="hf-upi-story" aria-labelledby="upi-story-title">
        <div className="hf-upi-story-photo">
          <img
            src="https://images.pexels.com/photos/13326556/pexels-photo-13326556.jpeg?auto=compress&cs=tinysrgb&w=1600"
            alt="A shopkeeper at his small stall in Maharashtra, with a payment QR stand on the counter."
            loading="lazy"
            decoding="async"
          />
          <a
            href="https://www.pexels.com/photo/man-sitting-inside-a-store-13326556/"
            target="_blank"
            rel="noopener noreferrer"
            className="hf-upi-story-credit"
          >
            Photo: Ankit Rainloure / Pexels
          </a>
        </div>
        <div className="hf-upi-story-copy">
          <h2 id="upi-story-title">A small shop taught us what payments should feel like.</h2>
          <p>
            In India, a shopkeeper can put a QR code on the counter and accept a
            payment from almost anyone. The customer doesn’t need
            to ask for bank details. They just scan and pay.
          </p>
          <p>
            We wanted that kind of ease for money moving across the internet.
            Pay a person through their Hopfast ID, a
            link, a QR code, or an X username. Settle in USDC.
          </p>
          <div className="hf-upi-story-vision">
            <img src="/token-icons/usdc.svg" alt="" aria-hidden="true" />
            <span>Our belief: wherever a crypto payment starts, it should be able to settle as USDC.</span>
          </div>
        </div>
      </section>

      <section className="hf-product-duo" aria-labelledby="product-title">
        <header className="hf-product-section-heading">
          <div>
            <h2 id="product-title">
              Bridge in. Pay by username. Receive by link.
            </h2>
          </div>
          <p>
            Bring USDC onto Arc, pay an existing Hopfast ID directly, or create
            a private claim for any X username.
          </p>
        </header>

        <div className="hf-product-duo-grid">
          <article className="hf-product-card hf-product-card-route">
            <div className="hf-product-card-top">
              <span className="hf-product-card-icon">
                <Globe2 size={20} />
              </span>
              <span className="hf-product-status">
                <i /> Live routing
              </span>
            </div>
            <div>
              <h3>Get USDC onto Arc.</h3>
              <p>
                Choose where your USDC starts. Hopfast compares live LI.FI and
                Squid routes and shows only the quotes you can use.
              </p>
              <button type="button" onClick={onBridge}>
                Compare routes <ArrowRight size={15} />
              </button>
            </div>
            <div className="hf-route-preview" aria-hidden="true">
              <div className="hf-route-preview-row">
                <span>
                  <img src="/chains/base.svg" alt="" />
                  <b>Base</b>
                  <small>USDC</small>
                </span>
                <Route size={15} />
                <span>
                  <img src="/brand/arc-mark.svg" alt="" />
                  <b>Arc</b>
                  <small>USDC</small>
                </span>
              </div>
              <div className="hf-route-preview-quotes">
                <div className="hf-route-preview-quote hf-route-preview-quote--best">
                  <span>
                    <img src="/providers/lifi.png" alt="" />
                  </span>
                  <div className="hf-route-preview-quote-info">
                    <strong>LI.FI</strong>
                    <small className="hf-route-preview-badge">
                      Lowest cost
                    </small>
                  </div>
                  <div className="hf-route-preview-quote-right">
                    <strong>499.73 USDC</strong>
                    <small className="hf-route-preview-time">~2 min</small>
                  </div>
                </div>
                <div className="hf-route-preview-quote">
                  <span>
                    <img src="/providers/squid.ico" alt="" />
                  </span>
                  <div className="hf-route-preview-quote-info">
                    <strong>Squid</strong>
                  </div>
                  <div className="hf-route-preview-quote-right">
                    <strong>498.91 USDC</strong>
                    <small className="hf-route-preview-time">~3 min</small>
                  </div>
                </div>
              </div>
              <div className="hf-route-preview-meta">
                <span>Live quotes · tracked through arrival</span>
              </div>
            </div>
          </article>

          <article className="hf-product-card hf-product-card-pay">
            <div className="hf-product-card-top">
              <span className="hf-product-card-icon">
                <UserRound size={20} />
              </span>
              <span className="hf-product-status">
                <i className={paymentsStatus === "live" ? "" : "is-waiting"} />{" "}
                {paymentsStatus === "live"
                  ? "Payments live"
                  : paymentsStatus === "checking"
                    ? "Checking payments"
                    : "Payments unavailable"}
              </span>
            </div>
            <div>
              <h3>Pay the person you know.</h3>
              <p>
                Pay a Hopfast ID directly to its verified Arc wallet. If they do
                not have one yet, address a private payment to their X username.
              </p>
              <button
                type="button"
                onClick={onPayAnyone}
                disabled={paymentsStatus === "offline"}
              >
                {paymentsStatus === "offline"
                  ? "Payments temporarily unavailable"
                  : "Open payments"}{" "}
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="hf-payment-preview" aria-hidden="true">
              <div className="hf-preview-card">
                <span>hopfast</span>
                <img src="/brand/arc-logo.svg" alt="" />
                <strong>
                  500.00 <small>USDC</small>
                </strong>
                <em>PAYMENT ON ARC</em>
              </div>
              <div className="hf-preview-envelope">
                <span>
                  <img
                    className="hf-usdc-icon"
                    src="/token-icons/usdc.svg"
                    alt=""
                  />
                </span>
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
          <h2 id="journey-title">They do not need a wallet address ready.</h2>
          <p>
            You create the payment and share its private link. The intended X
            account must verify before claiming.
          </p>
        </header>
        <div
          className="hf-journey-terminal"
          role="img"
          aria-label="Payment flow: address, fund, share, claim"
        >
          <div className="hf-journey-terminal-bar" aria-hidden="true">
            <span className="hf-jt-dot hf-jt-dot--red" />
            <span className="hf-jt-dot hf-jt-dot--yellow" />
            <span className="hf-jt-dot hf-jt-dot--green" />
            <span className="hf-jt-title">hopfast MCP (coming soon)</span>
          </div>
          <div className="hf-journey-terminal-body" aria-hidden="true">
            <div className="hf-jt-block">
              <p className="hf-jt-line">
                <span className="hf-jt-prompt">$</span>
                <span className="hf-jt-cmd">hopfast pay</span>
                <span className="hf-jt-flag">--to</span>
                <span className="hf-jt-val">@username</span>
                <span className="hf-jt-flag">--amount</span>
                <span className="hf-jt-val">100 USDC</span>
              </p>
              <p className="hf-jt-output">
                <span className="hf-jt-step">01 ADDRESS</span> Recipient set to
                @username · amount 100 USDC
              </p>
            </div>
            <div className="hf-jt-block">
              <p className="hf-jt-line">
                <span className="hf-jt-prompt">$</span>
                <span className="hf-jt-cmd">hopfast fund</span>
                <span className="hf-jt-flag">--wallet</span>
                <span className="hf-jt-val">0xd4f…3a9</span>
              </p>
              <p className="hf-jt-output">
                <span className="hf-jt-step">02 FUND</span> Wallet signed · USDC
                deposited into Arc contract
              </p>
              <p className="hf-jt-output hf-jt-output--dim">
                {" "}
                ✓ tx 0x7f2a…c310 confirmed in 2 blocks
              </p>
            </div>
            <div className="hf-jt-block">
              <p className="hf-jt-line">
                <span className="hf-jt-prompt">$</span>
                <span className="hf-jt-cmd">hopfast share</span>
                <span className="hf-jt-flag">--copy-link</span>
              </p>
              <p className="hf-jt-output">
                <span className="hf-jt-step">03 SHARE</span> Private claim link
                copied to clipboard
              </p>
              <p className="hf-jt-output hf-jt-output--dim">
                {" "}
                → hopfast.xyz/claim/prv_6Xk2…mN9q
              </p>
            </div>
            <div className="hf-jt-block">
              <p className="hf-jt-line">
                <span className="hf-jt-prompt">$</span>
                <span className="hf-jt-cmd">hopfast status</span>
                <span className="hf-jt-flag">--payment</span>
                <span className="hf-jt-val">prv_6Xk2…mN9q</span>
              </p>
              <p className="hf-jt-output">
                <span className="hf-jt-step hf-jt-step--done">04 CLAIMED</span>{" "}
                @username verified X account · 100 USDC received
              </p>
              <p className="hf-jt-cursor">█</p>
            </div>
          </div>
        </div>
      </section>

      <section className="hf-product-control" aria-labelledby="control-title">
        <header className="hf-product-section-heading">
          <div>
            <h2 id="control-title">See exactly where the USDC goes.</h2>
          </div>
          <p>
            Hopfast keeps the route, recipient, amount, and transaction state
            visible from quote to confirmation.
          </p>
        </header>
        <div className="hf-control-grid">
          <article>
            <span>
              <Coins size={19} />
            </span>
            <h3>Expected arrival</h3>
            <p>
              Compare the USDC expected on Arc, minimum received, route cost,
              and estimated time.
            </p>
          </article>
          <article>
            <span>
              <ShieldCheck size={19} />
            </span>
            <h3>Wallet approval</h3>
            <p>
              Hopfast prepares each transaction. Your wallet shows it before
              anything moves.
            </p>
          </article>
          <article>
            <span>
              <Clock3 size={19} />
            </span>
            <h3>Live status</h3>
            <p>
              Follow bridges and payments after the wallet closes, with explorer
              links when available.
            </p>
          </article>
          <article>
            <span>
              <Route size={19} />
            </span>
            <h3>Usable quotes only</h3>
            <p>
              A provider appears only when it returns an executable route for
              your transfer.
            </p>
          </article>
        </div>
      </section>

      <section
        className="hf-product-pricing hf-product-identity"
        aria-labelledby="identity-title"
      >
        <div className="hf-identity-story">
          <h2 id="identity-title">Give people one reliable way to pay you.</h2>
          <p>
            Verify your X username once and point your Hopfast ID, link, and QR
            to the Arc wallet you control.
          </p>
          <button type="button" onClick={onPayAnyone}>
            Create your Hopfast ID <ArrowRight size={15} />
          </button>
        </div>
        <div className="hf-identity-bento" aria-label="Hopfast ID features">
          <article className="hf-identity-bento-id">
            <AtSign size={18} />
            <small>HOPFAST ID</small>
            <strong>
              username<span>@hopfast</span>
            </strong>
            <p>A memorable payment ID backed by your verified X account.</p>
          </article>
          <article>
            <QrCode size={24} />
            <strong>Personal QR</strong>
            <p>
              Download it for profiles, pages, presentations, or in-person
              payments.
            </p>
            <div className="hf-mini-qr" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </article>
          <article>
            <Link2 size={24} />
            <strong>Payment link</strong>
            <p>
              Share a link that opens with your verified recipient details
              already filled.
            </p>
            <code>hopfast.xyz/?pay=username</code>
          </article>
          <article className="hf-identity-bento-usdc">
            <img src="/token-icons/usdc.svg" alt="USDC" />
            <strong>Direct USDC on Arc</strong>
            <p>
              Payments go from the sender's wallet to your connected Arc wallet.
            </p>
          </article>
        </div>
      </section>

      <section className="hf-product-final">
        <div className="hf-product-final-mark">
          <img src="/brand/arc-mark.svg" alt="" />
        </div>
        <div>
          <h2>Move USDC onto Arc, then send it by username.</h2>
        </div>
        <div className="hf-product-final-actions">
          <button type="button" className="hf-home-primary" onClick={onBridge}>
            Bridge USDC <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="hf-home-secondary"
            onClick={onPayAnyone}
          >
            Pay someone
          </button>
        </div>
      </section>
    </div>
  );
}
