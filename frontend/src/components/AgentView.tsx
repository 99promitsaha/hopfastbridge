import { useEffect, useState } from "react";
import {
  architectApi,
  escrowWrite,
  walletProof,
  type ArchitectConfig,
} from "../services/architectService";
import { ArchitectClaim } from "./ArchitectClaim";
import { ArchitectDeposits } from "./ArchitectDeposits";
import type { PrivyWalletBridge } from "./WalletConnector";
import {
  ArrowRight,
  Bell,
  Check,
  LockKeyhole,
  Send,
  RotateCcw,
  Copy,
} from "lucide-react";
import { fundingAmounts } from "../lib/builderFunding";

export function AgentView({
  onBack,
  onGrants,
  initialHandle = "",
  wallet = null,
  onConnect,
}: {
  onBack: () => void;
  onGrants: () => void;
  initialHandle?: string;
  wallet?: PrivyWalletBridge | null;
  onConnect?: () => void;
}) {
  const [handle, setHandle] = useState(initialHandle);
  const [amount, setAmount] = useState("25");
  const [message, setMessage] = useState(
    "Your work on Arc caught my eye. Here’s a small grant to help you keep building.",
  );
  const [copied, setCopied] = useState(false);
  const [config, setConfig] = useState<ArchitectConfig>({
    ready: false,
    chainId: 5042,
    rpcUrl: "https://rpc.mainnet.arc.io",
    feeBps: 250,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [claimUrl, setClaimUrl] = useState("");
  const [fundedAccess, setFundedAccess] = useState<{
    envelopeId: string;
    access: string;
  } | null>(null);
  const [pending, setPending] = useState<{
    envelopeId: string;
    xIdentity: string;
    gross: string;
    claimUrl: string;
    access: string;
  } | null>(null);
  useEffect(() => {
    architectApi<ArchitectConfig>("/config")
      .then(setConfig)
      .catch(() => {});
  }, []);
  const amounts = fundingAmounts(amount, 250);
  async function fund() {
    if (!wallet) {
      onConnect?.();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const draft =
        pending ??
        (await architectApi<{
          envelopeId: string;
          xIdentity: string;
          gross: string;
          claimUrl: string;
          access: string;
        }>("/envelopes", {
          handle: cleanHandle,
          amount,
          message,
          ...(await walletProof(wallet)),
        }));
      setPending(draft);
      // Save the claim link before asking for a transaction, so a reload cannot lose it.
      localStorage.setItem(
        `hopfast-envelope:${draft.envelopeId}`,
        JSON.stringify({ ...draft, funder: wallet.address }),
      );
      await escrowWrite(config, wallet, "deposit", [
        draft.envelopeId,
        draft.xIdentity,
        BigInt(draft.gross),
      ]);
      setClaimUrl(draft.claimUrl);
      setFundedAccess(draft);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const cleanHandle = handle.replace(/^@/, "").trim();
  const validHandle = /^[A-Za-z0-9_]{1,15}$/.test(cleanHandle);
  const notification = `@${validHandle ? cleanHandle : "architect_handle"}, someone has backed your work on Arc with ${amounts?.amount ?? "24.375"} USDC.\n\n“${message.trim() || "Keep building on Arc."}”\n\nVerify your X account and connect your wallet to claim on Arc within 30 days.\n${claimUrl || "[Your private claim link is added after funding.]"}`;
  return (
    <main className="hf-content hf-pay-x-page" id="main-content">
      {new URLSearchParams(location.search).has("claimError") && (
        <p role="alert">
          X verification did not complete. Open the original envelope link and
          sign in with the recipient’s X account.
        </p>
      )}
      {new URLSearchParams(location.search).has("envelope") && (
        <div className="hf-architect-claim">
          <ArchitectClaim
            config={config}
            wallet={wallet}
            onConnect={onConnect}
          />
        </div>
      )}
      <div className="hf-pay-x-hero">
        <div className="hf-pay-x-copy">
          <p className="hf-landing-kicker">SUPPORT ARCHITECTS · ON ARC</p>
          <h1>
            Back an architect.
            <br />
            Send an envelope.
          </h1>
          <p>
            Backing an early founder can start with a small grant. Send USDC to
            an Arc builder’s X handle, with a message about why you believe in
            their work.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="hf-pay-x-bridge-link"
          >
            Bridge USDC to Arc first <ArrowRight size={15} />
          </button>
        </div>
        <div
          className="hf-pay-card-scene"
          aria-label="Illustrative USDC envelope card"
        >
          <div className="hf-pay-card">
            <div className="hf-pay-card-top">
              <span>hopfast</span>
              <img src="/brand/arc-logo.svg" alt="Arc" />
            </div>
            <div className="hf-pay-card-chip" />
            <div className="hf-pay-card-amount">
              {amounts?.amount ?? "25.00"} <small>USDC</small>
            </div>
            <div className="hf-pay-card-bottom">
              <span>FOR @{validHandle ? cleanHandle : "architect_handle"}</span>
              <span>ARC</span>
            </div>
          </div>
          <div className="hf-pay-card-shadow" />
        </div>
      </div>
      <section className="hf-pay-x-flow">
        <header>
          <p className="hf-landing-kicker">HOW IT WILL WORK</p>
          <h2>A small grant, delivered to their X handle.</h2>
        </header>
        <div className="hf-pay-flow-rail" aria-hidden="true">
          <span />
          <i />
          <span />
          <i />
          <span />
          <i />
          <span />
          <i />
          <span />
        </div>
        <div className="hf-pay-flow-steps">
          <article>
            <span className="hf-flow-icon">
              <img src="/brand/x.svg" alt="X" />
            </span>
            <span className="hf-flow-number">01</span>
            <h3>Paste their handle</h3>
            <p>
              Choose the Arc architect you want to back. You don’t need their
              wallet address.
            </p>
          </article>
          <article>
            <span className="hf-flow-icon">
              <LockKeyhole size={17} />
            </span>
            <span className="hf-flow-number">02</span>
            <h3>Fund the envelope</h3>
            <p>
              Add USDC and a personal message. Review the 2.5% fee and approve
              from your wallet.
            </p>
          </article>
          <article>
            <span className="hf-flow-icon">
              <Bell size={17} />
            </span>
            <span className="hf-flow-number">03</span>
            <h3>Share their claim link</h3>
            <p>
              Send the funded envelope’s private link on X, or ask our agent to
              deliver it when enabled. Your message and USDC amount travel with
              it.
            </p>
          </article>
          <article>
            <span className="hf-flow-icon">
              <Check size={17} />
            </span>
            <span className="hf-flow-number">04</span>
            <h3>They claim the USDC</h3>
            <p>
              They verify their X account and connect a wallet to receive your
              grant on Arc.
            </p>
          </article>
          <article>
            <span className="hf-flow-icon">
              <RotateCcw size={17} />
            </span>
            <span className="hf-flow-number">05</span>
            <h3>Reclaim after 30 days</h3>
            <p>
              If they haven’t claimed, reclaim the remaining 97.5% anytime after
              30 days. The fee paid at deposit is not refunded.
            </p>
          </article>
        </div>
      </section>
      <section className="hf-pay-x-preview">
        <div>
          <p className="hf-landing-kicker">A DIGITAL RED ENVELOPE</p>
          <h2>
            A gift with a message.
            <br />A grant to keep building.
          </h2>
          <p>
            Inspired by red envelopes given as a gesture of support, a Hopfast
            envelope pairs USDC with your words. Back a prototype, thank someone
            for a useful tool, or help an early founder reach their next
            milestone.
          </p>
          <div
            className="hf-notification-preview"
            aria-label="Agent message preview"
          >
            <span>YOUR MESSAGE TO THE ARCHITECT</span>
            <p>{notification}</p>
          </div>
          <button
            type="button"
            className="hf-copy-message"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(notification);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy size={14} />
            {copied ? "Message copied" : "Copy message preview"}
          </button>
        </div>
        <form
          className="hf-pay-x-form"
          onSubmit={(e) => {
            e.preventDefault();
            void fund();
          }}
          aria-label="USDC envelope preview"
        >
          <label htmlFor="envelope-handle">Builder’s X handle</label>
          <input
            id="envelope-handle"
            disabled={busy || !!pending || !!claimUrl}
            value={handle}
            maxLength={16}
            placeholder="@jerallaire"
            onChange={(e) => {
              setHandle(e.target.value);
              setCopied(false);
            }}
          />
          {handle && !validHandle && (
            <small role="alert">
              Use a valid X handle with up to 15 letters, numbers, or
              underscores.
            </small>
          )}
          <label htmlFor="envelope-amount">USDC to deposit</label>
          <input
            id="envelope-amount"
            disabled={busy || !!pending || !!claimUrl}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {!amounts && (
            <small role="alert">
              Enter a positive amount with up to 6 decimal places.
            </small>
          )}
          <label htmlFor="envelope-message">Your message</label>
          <textarea
            id="envelope-message"
            disabled={busy || !!pending || !!claimUrl}
            maxLength={280}
            rows={4}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setCopied(false);
            }}
          />
          <div className="hf-envelope-fees">
            <span>Architect receives</span>
            <strong>{amounts?.amount ?? "—"} USDC</strong>
            <span>Hopfast fee · 2.5%</span>
            <strong>{amounts?.fee ?? "—"} USDC</strong>
            <span>Total to approve</span>
            <strong>{amounts?.total ?? "—"} USDC</strong>
          </div>
          <small>
            Fee deducted and forwarded to Hopfast when you deposit, even if
            unclaimed. Network gas is separate.
          </small>
          <button
            disabled={
              busy ||
              !!claimUrl ||
              !config.ready ||
              !validHandle ||
              !amounts ||
              !message.trim()
            }
            type="submit"
          >
            {busy
              ? "Please finish in your wallet…"
              : wallet
                ? "Fund envelope on Arc"
                : "Connect wallet"}{" "}
            <Send size={15} />
          </button>
          <small>
            {!config.ready
              ? "Funding will open once the Arc escrow and X verification are configured."
              : "After 30 days, expired funds may also be recovered by the admin following a seven-day public delay. You can reclaim during that delay."}
          </small>
          {error && <p role="alert">{error}</p>}
          {pending && !busy && (
            <button type="button" onClick={() => setPending(null)}>
              Edit envelope details
            </button>
          )}
          {claimUrl && (
            <>
              <label>Funded envelope · private claim link</label>
              <input readOnly value={claimUrl} />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(claimUrl)}
              >
                Copy claim link
              </button>
            </>
          )}
          {claimUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setClaimUrl("");
                setFundedAccess(null);
                setCopied(false);
                setError("");
              }}
            >
              Create another envelope
            </button>
          )}
          {claimUrl && fundedAccess && config.deliveryEnabled && (
            <button
              disabled={busy}
              type="button"
              onClick={async () => {
                if (!wallet) return;
                setBusy(true);
                setError("");
                try {
                  await architectApi(
                    `/envelopes/${fundedAccess.envelopeId}/deliver`,
                    await walletProof(wallet),
                    fundedAccess.access,
                  );
                  setError("Agent message delivered on X.");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Delivery failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Ask our agent to send on X
            </button>
          )}
        </form>
      </section>
      <ArchitectDeposits config={config} wallet={wallet} />
      <div className="hf-grant-crosslink">
        <p>
          Building on Arc and need a first grant? Share your project and the
          milestone you want to fund.
        </p>
        <button type="button" onClick={onGrants}>
          Request a micro-grant <ArrowRight size={15} />
        </button>
      </div>
    </main>
  );
}
