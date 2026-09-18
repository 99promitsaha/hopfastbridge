import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import {
  architectApi,
  escrowWrite,
  walletProof,
  type ArchitectConfig,
  type Envelope,
} from "../services/architectService";
import type { PrivyWalletBridge } from "./WalletConnector";
export function ArchitectClaim({
  config,
  wallet,
  onConnect,
}: {
  config: ArchitectConfig;
  wallet: PrivyWalletBridge | null;
  onConnect?: () => void;
}) {
  const id = new URLSearchParams(location.search).get("envelope");
  const fragment = new URLSearchParams(location.hash.slice(1));
  const access =
    fragment.get("access") ||
    (id ? sessionStorage.getItem(`envelope:${id}`) : null);
  const session = fragment.get("session");
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (id && fragment.get("access"))
      sessionStorage.setItem(`envelope:${id}`, fragment.get("access")!);
  }, [id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const refresh = async () => {
    if (id && access)
      setEnvelope(
        await architectApi<Envelope>(`/envelopes/${id}`, undefined, access),
      );
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [id, access]);
  if (!id) return null;
  const expired = !!envelope && now >= envelope.expiresAt;
  async function action(kind: "verify" | "claim" | "reclaim") {
    if (!wallet) {
      onConnect?.();
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (kind === "verify") {
        const result = await architectApi<{ url: string }>(
          `/envelopes/${id}/x`,
          await walletProof(wallet),
          access!,
        );
        location.assign(result.url);
        return;
      }
      if (kind === "claim") {
        const auth = await architectApi<{
          recipient: string;
          deadline: string;
          signature: string;
        }>(`/envelopes/${id}/authorization`, {}, session!);
        if (auth.recipient.toLowerCase() !== wallet.address.toLowerCase())
          throw new Error("Connect the wallet you verified with X.");
        await escrowWrite(config, wallet, "claim", [
          id,
          auth.recipient,
          BigInt(auth.deadline),
          auth.signature,
        ]);
        setDone(true);
        history.replaceState(null, "", `/?envelope=${id}`);
      } else await escrowWrite(config, wallet, "reclaim", [id]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="hf-pay-x-form" aria-label="Claim your envelope">
      <h2>{done ? "USDC claimed on Arc" : "Your USDC envelope"}</h2>
      {envelope && (
        <>
          <p>For @{envelope.handle}</p>
          <p>{envelope.message}</p>
          <strong>
            {formatUnits(
              BigInt(envelope.gross) -
                (BigInt(envelope.gross) * 250n + 9999n) / 10000n,
              6,
            )}{" "}
            USDC
          </strong>
          <p>
            {envelope.state === 1
              ? expired
                ? "The claim window has ended."
                : `Claim before ${new Date(envelope.expiresAt).toLocaleString()}.`
              : envelope.state === 2
                ? "Claimed"
                : envelope.state === 3
                  ? "Reclaimed by funder"
                  : envelope.state === 4
                    ? "Recovered by admin"
                    : "Not funded yet"}
          </p>
        </>
      )}
      {!wallet && <button onClick={onConnect}>Connect wallet</button>}
      {wallet && envelope?.state === 1 && !expired && !done && (
        <button
          disabled={busy || !config.ready}
          onClick={() => action(session ? "claim" : "verify")}
        >
          {busy
            ? "Please finish in your wallet…"
            : session
              ? "Claim USDC on Arc"
              : "Verify your X account"}
        </button>
      )}
      {wallet &&
        envelope?.state === 1 &&
        expired &&
        wallet.address.toLowerCase() === envelope.funder.toLowerCase() && (
          <button disabled={busy} onClick={() => action("reclaim")}>
            Reclaim unclaimed USDC
          </button>
        )}
      {error && <p role="alert">{error}</p>}
      <small>
        The 2.5% Hopfast fee was paid at deposit. No second Hopfast fee applies
        to claiming or reclaiming. Network gas is separate.
      </small>
    </section>
  );
}
