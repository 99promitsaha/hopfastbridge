import { useState } from "react";
import { Copy, ExternalLink, RefreshCw, RotateCcw, Search } from "lucide-react";
import { formatUnits } from "viem";
import { formatDisplayAmount } from "../lib/amount";
import {
  architectApi,
  escrowWrite,
  walletProof,
  type ArchitectConfig,
  type Envelope,
} from "../services/architectService";
import type { PrivyWalletBridge } from "./WalletConnector";
type DirectPayment = {
  id: string;
  recipient: string;
  recipientHandle?: string;
  amount: string;
  memo: string;
  status: 'awaiting_approval' | 'submitted' | 'completed' | 'failed' | 'expired' | 'cancelled';
  txHash?: string;
  explorerLink?: string;
  createdAt: string;
};
export function ArchitectDeposits({
  config,
  wallet,
}: {
  config: ArchitectConfig;
  wallet: PrivyWalletBridge | null;
}) {
  const [items, setItems] = useState<Envelope[]>([]);
  const [directItems, setDirectItems] = useState<DirectPayment[]>([]);
  const [kind, setKind] = useState<'all' | 'direct' | 'private'>('all');
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [contact, setContact] = useState("");
  async function load() {
    if (!wallet) return;
    setBusy(true);
    setError("");
    try {
      const data = await architectApi<{ envelopes: Envelope[]; directPayments: DirectPayment[] }>(
        "/mine",
        await walletProof(wallet),
      );
      setItems(data.envelopes);
      setDirectItems(data.directPayments ?? []);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load envelopes.");
    } finally {
      setBusy(false);
    }
  }
  async function reclaim(id: string) {
    if (!wallet) return;
    setBusy(true);
    setError("");
    try {
      await escrowWrite(config, wallet, "reclaim", [id]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reclaim.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="hf-architect-deposits">
      <header>
        <div>
          <span>PAID FROM THIS WALLET</span>
          <h2>Sent payments</h2>
          <p>See direct Hopfast ID transfers and private X username payments sent from this wallet.</p>
        </div>
        <button className="hf-deposits-load" disabled={!wallet || busy} onClick={load}>
          <RefreshCw size={14} className={busy ? "hf-spin" : ""} />
          {busy ? "Loading…" : loaded ? "Refresh" : wallet ? "Load payments" : "Connect to load"}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {loaded && (items.length > 0 || directItems.length > 0) && (
        <div className="hf-activity-kind" role="group" aria-label="Filter payment type">
          <button className={kind === 'all' ? 'active' : ''} type="button" onClick={() => setKind('all')}>All</button>
          <button className={kind === 'direct' ? 'active' : ''} type="button" onClick={() => setKind('direct')}>Hopfast ID</button>
          <button className={kind === 'private' ? 'active' : ''} type="button" onClick={() => setKind('private')}>X username</button>
        </div>
      )}
      {loaded && (items.length > 0 || directItems.length > 0) && (
        <label className="hf-contact-search">
          <Search size={14} />
          <input
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder="Find a contact"
            aria-label="Filter payment activity by recipient"
          />
        </label>
      )}
      {loaded && items.length === 0 && directItems.length === 0 && <div className="hf-deposits-empty"><WalletEmptyIcon /><h3>No payments yet.</h3><p>Payments sent from this wallet will appear here.</p></div>}
      <div className="hf-deposits-list">
        {kind !== 'private' && directItems.filter((payment) => {
          const query = contact.replace(/^@/, '').trim().toLowerCase();
          return !query || payment.recipientHandle?.toLowerCase().includes(query) || payment.recipient.toLowerCase().includes(query);
        }).map((payment) => (
          <article key={`direct-${payment.id}`} className="hf-deposit-card">
            <div className="hf-deposit-main"><span className={`hf-deposit-status state-${payment.status}`} /> <div><small>HOPFAST ID</small><h3>{payment.recipientHandle ? `@${payment.recipientHandle}` : `••••${payment.recipient.slice(-4)}`}</h3></div></div>
            <strong>{formatDisplayAmount(payment.amount)} <small>USDC</small></strong>
            <p className="hf-deposit-state">{payment.status === 'completed' ? 'Settled directly on Arc' : payment.status === 'submitted' ? 'Submitted · waiting for confirmation' : payment.status === 'failed' ? 'Failed' : payment.status === 'cancelled' ? 'Cancelled' : payment.status === 'expired' ? 'Payment request expired' : 'Waiting for wallet approval'}</p>
            <small className="hf-deposit-id">Direct transfer · {new Date(payment.createdAt).toLocaleString()}</small>
            {payment.explorerLink && <div className="hf-deposit-actions"><a href={payment.explorerLink} target="_blank" rel="noopener noreferrer">View on Arc <ExternalLink size={13} /></a></div>}
          </article>
        ))}
        {kind !== 'direct' && items.filter((e) => e.handle.toLowerCase().includes(contact.replace(/^@/, '').trim().toLowerCase())).map((e) => {
          let saved: { claimUrl?: string } | null = null;
          try {
            saved = JSON.parse(
              localStorage.getItem(`hopfast-envelope:${e.envelopeId}`) ||
                sessionStorage.getItem(`hopfast-envelope:${e.envelopeId}`) ||
                "null",
            );
          } catch {}
          const net =
            BigInt(e.gross) - (BigInt(e.gross) * BigInt(config.feeBps) + 9999n) / 10000n;
          return (
            <article key={e.envelopeId} className="hf-deposit-card">
              <div className="hf-deposit-main"><span className={`hf-deposit-status state-${e.state}`} /> <div><small>X USERNAME</small><h3>@{e.handle}</h3></div></div>
              <strong>{formatDisplayAmount(formatUnits(net, 6))} <small>USDC</small></strong>
              <p className="hf-deposit-state">
                {e.state === 0
                  ? "Draft · awaiting deposit"
                  : e.state === 1
                    ? `Waiting to be claimed · ${Date.now() >= e.expiresAt ? "claim window ended" : `available until ${new Date(e.expiresAt).toLocaleDateString()}`}`
                    : e.state === 2
                      ? "Claimed"
                      : e.state === 3
                        ? "Reclaimed"
                        : "Admin recovery completed"}
              </p>
              <small className="hf-deposit-id">{e.envelopeId}</small>
              <div className="hf-deposit-actions">
              {e.state === 1 && saved?.claimUrl && (
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(saved!.claimUrl!)
                  }
                >
                  <Copy size={13} /> Copy claim link
                </button>
              )}
              {e.state === 1 && Date.now() >= e.expiresAt && (
                <button disabled={busy} onClick={() => reclaim(e.envelopeId)}>
                  <RotateCcw size={13} /> Reclaim {formatDisplayAmount(formatUnits(net, 6))} USDC
                </button>
              )}
              </div>
            </article>
          );
        })}
      </div>
      {loaded && (items.length > 0 || directItems.length > 0) && contact &&
        (kind === 'direct' || kind === 'all' ? directItems.filter((payment) => payment.recipientHandle?.toLowerCase().includes(contact.replace(/^@/, '').trim().toLowerCase()) || payment.recipient.toLowerCase().includes(contact.replace(/^@/, '').trim().toLowerCase())).length : 0) === 0 &&
        (kind === 'private' || kind === 'all' ? items.filter((e) => e.handle.toLowerCase().includes(contact.replace(/^@/, '').trim().toLowerCase())).length : 0) === 0 && (
        <div className="hf-deposits-empty hf-deposits-empty--filter"><Search size={20} /><h3>No matching payments.</h3><p>Try another recipient.</p></div>
      )}
    </section>
  );
}

function WalletEmptyIcon() {
  return <div className="hf-deposits-empty-icon"><WalletCardsIcon /></div>;
}

function WalletCardsIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h13"/><path d="M16 13h5"/><circle cx="16" cy="13" r=".8" fill="currentColor"/></svg>;
}
