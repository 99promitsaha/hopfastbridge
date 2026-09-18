import { useState } from "react";
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
    <section className="hf-grant-crosslink hf-architect-deposits">
      <div>
        <h2>Your envelopes</h2>
        <p>Review funded envelopes and reclaim unclaimed USDC after 30 days.</p>
        <button disabled={!wallet || busy} onClick={load}>
          {busy ? "Please wait…" : "Load my envelopes"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div>
        {items.map((e) => {
          let saved: { claimUrl?: string } | null = null;
          try {
            saved = JSON.parse(
              localStorage.getItem(`hopfast-envelope:${e.envelopeId}`) ||
                "null",
            );
          } catch {}
          const net =
            BigInt(e.gross) - (BigInt(e.gross) * 250n + 9999n) / 10000n;
          return (
            <article key={e.envelopeId}>
              <h3>
                @{e.handle} · {formatUnits(net, 6)} USDC
              </h3>
              <p>
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
              <small>{e.envelopeId}</small>
              {e.state === 1 && saved?.claimUrl && (
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(saved!.claimUrl!)
                  }
                >
                  Copy private claim link
                </button>
              )}
              {e.state === 1 && Date.now() >= e.expiresAt && (
                <button disabled={busy} onClick={() => reclaim(e.envelopeId)}>
                  Reclaim {formatUnits(net, 6)} USDC
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
