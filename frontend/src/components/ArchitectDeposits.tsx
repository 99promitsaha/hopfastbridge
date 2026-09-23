import { useState } from "react";
import { Copy, RefreshCw, RotateCcw } from "lucide-react";
import { formatUnits } from "viem";
import {
  architectApi,
  escrowWrite,
  walletProof,
  type ArchitectConfig,
  type Envelope,
} from "../services/architectService";
import type { PrivyWalletBridge } from "./WalletConnector";
export function ArchitectDeposits({
  config,
  wallet,
}: {
  config: ArchitectConfig;
  wallet: PrivyWalletBridge | null;
}) {
  const [items, setItems] = useState<Envelope[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  async function load() {
    if (!wallet) return;
    setBusy(true);
    setError("");
    try {
      const data = await architectApi<{ envelopes: Envelope[] }>(
        "/mine",
        await walletProof(wallet),
      );
      setItems(data.envelopes);
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
          <span>SENT FROM THIS WALLET</span>
          <h2>Your payments</h2>
          <p>Review payment status, recover a saved claim link, or reclaim unclaimed USDC after 30 days.</p>
        </div>
        <button className="hf-deposits-load" disabled={!wallet || busy} onClick={load}>
          <RefreshCw size={14} className={busy ? "hf-spin" : ""} />
          {busy ? "Loading…" : loaded ? "Refresh" : wallet ? "Load payments" : "Connect wallet first"}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {loaded && items.length === 0 && <div className="hf-deposits-empty"><WalletEmptyIcon /><h3>No payments from this wallet yet.</h3><p>Your funded envelopes will appear here.</p></div>}
      <div className="hf-deposits-list">
        {items.map((e) => {
          let saved: { claimUrl?: string } | null = null;
          try {
            saved = JSON.parse(
              sessionStorage.getItem(`hopfast-envelope:${e.envelopeId}`) ||
                "null",
            );
          } catch {}
          const net =
            BigInt(e.gross) - (BigInt(e.gross) * 250n + 9999n) / 10000n;
          return (
            <article key={e.envelopeId} className="hf-deposit-card">
              <div className="hf-deposit-main"><span className={`hf-deposit-status state-${e.state}`} /> <div><small>PAYMENT TO</small><h3>@{e.handle}</h3></div></div>
              <strong>{formatUnits(net, 6)} <small>USDC</small></strong>
              <p className="hf-deposit-state">
                {e.state === 0
                  ? "Draft · not funded"
                  : e.state === 1
                    ? `Unclaimed · ${Date.now() >= e.expiresAt ? "reclaim available" : `claim until ${new Date(e.expiresAt).toLocaleDateString()}`}`
                    : e.state === 2
                      ? "Claimed"
                      : e.state === 3
                        ? "Reclaimed"
                        : "Recovered by admin"}
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
                  <RotateCcw size={13} /> Reclaim {formatUnits(net, 6)} USDC
                </button>
              )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function WalletEmptyIcon() {
  return <div className="hf-deposits-empty-icon"><WalletCardsIcon /></div>;
}

function WalletCardsIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h13"/><path d="M16 13h5"/><circle cx="16" cy="13" r=".8" fill="currentColor"/></svg>;
}
