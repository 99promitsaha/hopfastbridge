import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Send, ShieldCheck } from 'lucide-react';
import { API_BASE_URL } from '../constants';
import { architectApi } from '../services/architectService';
import type { PrivyWalletBridge } from './WalletConnector';

type PublicProfile = { handle: string; wallet: string; vpa: string; verifiedBy: 'X' };

export function ProfilePayment({ handle, wallet, onConnect, onPayAnother }: {
  handle: string;
  wallet: PrivyWalletBridge | null;
  onConnect?: () => void;
  onPayAnother: () => void;
}) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const normalizedHandle = handle.replace(/^@/, '').trim().toLowerCase();
  const walletSuffix = profile?.wallet.slice(-4) ?? '';
  const validAmount = useMemo(() => /^\d+(?:\.\d{1,6})?$/.test(amount) && Number(amount) > 0, [amount]);
  const quickAmounts = ['10', '25', '100'];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    architectApi<{ profile: PublicProfile }>(`/profiles/${encodeURIComponent(normalizedHandle)}`)
      .then((result) => { if (active) setProfile(result.profile); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'This Hopfast ID is unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [normalizedHandle]);

  async function continueToWallet() {
    if (!wallet) { onConnect?.(); return; }
    if (!profile || !validAmount) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: wallet.address, recipient: profile.wallet, recipientHandle: profile.handle, amount, memo: memo.trim() }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.reviewUrl !== 'string') throw new Error(result.error ?? 'Could not prepare this payment.');
      window.location.assign(result.reviewUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare this payment.');
      setBusy(false);
    }
  }

  if (loading) return <section className="hf-profile-payment hf-profile-payment-state"><Loader2 className="hf-spin" size={22} /><p>Checking this Hopfast ID…</p></section>;

  if (!profile) return (
    <section className="hf-profile-payment hf-profile-payment-state">
      <span className="hf-support-eyebrow">PAYMENT LINK UNAVAILABLE</span>
      <h2>@{normalizedHandle} does not have an active Hopfast ID.</h2>
      <p>You can still send them a private payment addressed to their X username.</p>
      <button className="hf-support-primary hf-profile-fallback-action" type="button" onClick={onPayAnother}>Pay by X username <Send size={15} /></button>
    </section>
  );

  return (
    <section className="hf-profile-payment">
      <div className="hf-profile-recipient">
        <span className="hf-support-eyebrow">X VERIFIED · ARC READY</span>
        <div className="hf-profile-avatar">@</div>
        <div className="hf-profile-recipient-title">
          <span>Pay</span>
          <h2>@{profile.handle}</h2>
        </div>
        <p className="hf-profile-vpa">{profile.vpa}</p>
        <div className="hf-profile-wallet-hint" title={profile.wallet}>
          <span>Linked Arc wallet</span>
          <strong>••••{walletSuffix}</strong>
        </div>
        <div className="hf-profile-trust"><ShieldCheck size={15} /> This ID resolves to a wallet verified by @{profile.handle}.</div>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void continueToWallet(); }}>
        <label htmlFor="profile-payment-amount">Amount</label>
        <div className="hf-support-field">
          <input id="profile-payment-amount" inputMode="decimal" autoFocus value={amount} placeholder="0.00" onChange={(event) => setAmount(event.target.value)} />
          <strong>USDC</strong>
        </div>
        <div className="hf-payment-quick-amounts" aria-label="Quick amounts">
          {quickAmounts.map((value) => (
            <button type="button" key={value} className={amount === value ? 'active' : ''} onClick={() => setAmount(value)}>
              {value} USDC
            </button>
          ))}
        </div>
        <label htmlFor="profile-payment-note">Note <span>optional</span></label>
        <textarea id="profile-payment-note" rows={3} maxLength={180} value={memo} placeholder="What is this payment for?" onChange={(event) => setMemo(event.target.value)} />
        <small className="hf-profile-note-count">{memo.length}/180</small>
        <div className="hf-profile-payment-summary">
          <span>Recipient</span><strong>@{profile.handle} · ••••{walletSuffix}</strong>
          <span>Network</span><strong className="hf-profile-network"><img src="/brand/arc-logo.svg" alt="Arc" /></strong>
          <span>Delivery</span><strong>Within 30 seconds</strong>
        </div>
        <button className="hf-support-primary" type="submit" disabled={busy || !validAmount}>
          {busy ? 'Preparing payment…' : wallet ? 'Continue to wallet' : 'Connect wallet'}
          {busy ? <Loader2 className="hf-spin" size={15} /> : <Send size={15} />}
        </button>
        <button className="hf-support-reset" type="button" onClick={onPayAnother}><ArrowLeft size={14} /> Pay someone else</button>
        {amount && !validAmount && <small role="alert">Enter a positive amount with up to six decimal places.</small>}
        {error && <p className="hf-support-error" role="alert">{error}</p>}
      </form>
    </section>
  );
}
