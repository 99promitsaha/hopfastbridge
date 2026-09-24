import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, ExternalLink, ShieldCheck } from 'lucide-react';
import { formatUnits } from 'viem';
import { formatDisplayAmount } from '../lib/amount';
import {
  architectApi,
  escrowWrite,
  walletProof,
  type ArchitectConfig,
  type Envelope,
} from '../services/architectService';
import type { PrivyWalletBridge } from './WalletConnector';

export function ArchitectClaim({
  config,
  wallet,
  onConnect,
}: {
  config: ArchitectConfig;
  wallet: PrivyWalletBridge | null;
  onConnect?: () => void;
}) {
  const id = new URLSearchParams(location.search).get('envelope');
  const fragment = new URLSearchParams(location.hash.slice(1));
  const access =
    fragment.get('access') ||
    (id ? sessionStorage.getItem(`envelope:${id}`) : null);
  const session = fragment.get('session');
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (id && fragment.get('access'))
      sessionStorage.setItem(`envelope:${id}`, fragment.get('access')!);
  }, [id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refresh = async () => {
    if (id && access)
      setEnvelope(
        await architectApi<Envelope>(`/envelopes/${id}`, undefined, access)
      );
  };

  useEffect(() => {
    refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Payment unavailable.')
    );
  }, [id, access]);

  if (!id) return null;
  const expired = Boolean(envelope) && now >= envelope!.expiresAt;
  const claimAmount = envelope
    ? formatDisplayAmount(formatUnits(
        BigInt(envelope.gross) -
          (BigInt(envelope.gross) * BigInt(config.feeBps) + 9999n) / 10000n,
        6
      ))
    : null;

  async function action(kind: 'verify' | 'claim' | 'reclaim') {
    if (!wallet) {
      onConnect?.();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (kind === 'verify') {
        const result = await architectApi<{ url: string }>(
          `/envelopes/${id}/x`,
          await walletProof(wallet),
          access!
        );
        location.assign(result.url);
        return;
      }
      if (kind === 'claim') {
        const auth = await architectApi<{
          recipient: string;
          deadline: string;
          signature: string;
        }>(`/envelopes/${id}/authorization`, {}, session!);
        if (auth.recipient.toLowerCase() !== wallet.address.toLowerCase())
          throw new Error('Connect the wallet you verified with X.');
        await escrowWrite(config, wallet, 'claim', [
          id,
          auth.recipient,
          BigInt(auth.deadline),
          auth.signature,
        ]);
        setDone(true);
        history.replaceState(null, '', `/?envelope=${id}`);
      } else {
        await escrowWrite(config, wallet, 'reclaim', [id]);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const status = !envelope
    ? 'Loading payment…'
    : envelope.state === 1
      ? expired
        ? 'The claim window has ended.'
        : `Available until ${new Date(envelope.expiresAt).toLocaleString()}`
      : envelope.state === 2
        ? 'Claimed on Arc'
        : envelope.state === 3
          ? 'Returned to the sender'
          : envelope.state === 4
            ? 'Recovered by Hopfast support'
            : 'Waiting for the deposit';

  return (
    <section className="hf-claim-card" aria-label="Claim your Arc payment">
      <p className="hf-claim-eyebrow"><ShieldCheck size={13} /> Private Arc payment</p>
      <h2>{done ? 'USDC is in your wallet.' : 'A payment is waiting for you.'}</h2>
      {envelope && (
        <>
          <div className="hf-claim-recipient"><span>ADDRESSED TO</span><strong>@{envelope.handle}</strong></div>
          <blockquote>{envelope.message}</blockquote>
          <div className="hf-claim-amount"><strong>{claimAmount}</strong><span>USDC</span></div>
          <p className="hf-claim-status">
            {done ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
            {status}
          </p>
        </>
      )}

      {!wallet && (
        <button className="hf-support-primary" onClick={onConnect}>
          Connect wallet to continue
        </button>
      )}
      {wallet && envelope?.state === 1 && !expired && !done && (
        <button
          className="hf-support-primary"
          disabled={busy || !config.ready}
          onClick={() => action(session ? 'claim' : 'verify')}
        >
          {busy
            ? 'Finish in your wallet…'
            : session
              ? 'Claim USDC to this wallet'
              : 'Verify username with X'}
          {!busy && <ExternalLink size={14} />}
        </button>
      )}
      {wallet &&
        envelope?.state === 1 &&
        expired &&
        wallet.address.toLowerCase() === envelope.funder.toLowerCase() && (
          <button
            className="hf-support-primary"
            disabled={busy}
            onClick={() => action('reclaim')}
          >
            Return unclaimed USDC to sender
          </button>
        )}
      {error && <p className="hf-support-error" role="alert">{error}</p>}
      <small className="hf-claim-disclosure">
        The payment fee was collected when this payment was created. Claiming
        adds no second Hopfast fee. Network gas is separate.
      </small>
    </section>
  );
}
