import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Gift, Send, WalletCards } from 'lucide-react';
import { architectApi, escrowWrite, walletProof, type ArchitectConfig } from '../services/architectService';
import { fundingAmounts } from '../lib/builderFunding';
import type { PrivyWalletBridge } from './WalletConnector';
import { ArchitectClaim } from './ArchitectClaim';
import { ArchitectDeposits } from './ArchitectDeposits';

type DraftEnvelope = { envelopeId: string; xIdentity: string; gross: string; claimUrl: string; access: string };

export function AgentView({ onBack, initialHandle = '', wallet = null, onConnect }: {
  onBack: () => void; initialHandle?: string; wallet?: PrivyWalletBridge | null; onConnect?: () => void;
}) {
  const isClaim = new URLSearchParams(location.search).has('envelope');
  const claimError = new URLSearchParams(location.search).has('claimError');
  const [tab, setTab] = useState<'send' | 'mine'>('send');
  const [handle, setHandle] = useState(initialHandle);
  const [amount, setAmount] = useState('25');
  const [message, setMessage] = useState('Your work on Arc caught my eye. Here’s a small grant to help you keep building.');
  const [config, setConfig] = useState<ArchitectConfig>({ ready: false, chainId: 5042, rpcUrl: 'https://rpc.mainnet.arc.io', feeBps: 250 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [claimUrl, setClaimUrl] = useState('');
  const [fundedAccess, setFundedAccess] = useState<DraftEnvelope | null>(null);
  const [pending, setPending] = useState<DraftEnvelope | null>(null);

  useEffect(() => {
    architectApi<ArchitectConfig>('/config').then(setConfig).catch(() => setError('Support is temporarily unavailable. Please try again shortly.'));
  }, []);

  const cleanHandle = handle.replace(/^@/, '').trim();
  const validHandle = /^[A-Za-z0-9_]{1,15}$/.test(cleanHandle);
  const amounts = useMemo(() => fundingAmounts(amount, 250), [amount]);

  async function fund() {
    if (!wallet) { onConnect?.(); return; }
    if (!validHandle || !amounts || !message.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const draft = pending ?? await architectApi<DraftEnvelope>('/envelopes', {
        handle: cleanHandle, amount, message: message.trim(), ...(await walletProof(wallet)),
      });
      setPending(draft);
      sessionStorage.setItem(`hopfast-envelope:${draft.envelopeId}`, JSON.stringify({ ...draft, funder: wallet.address }));
      await escrowWrite(config, wallet, 'deposit', [draft.envelopeId, draft.xIdentity, BigInt(draft.gross)]);
      setClaimUrl(draft.claimUrl); setFundedAccess(draft); setPending(null);
      setNotice('Envelope funded. Deliver the private claim link when ready.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally { setBusy(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(claimUrl); setNotice('Private claim link copied.'); }
    catch { setError('Could not copy the link. Select it manually instead.'); }
  }

  async function deliver() {
    if (!wallet || !fundedAccess) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await architectApi(`/envelopes/${fundedAccess.envelopeId}/deliver`, await walletProof(wallet), fundedAccess.access);
      setNotice('The private claim message was delivered on X.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'X delivery failed. Copy the private link and send it manually.');
    } finally { setBusy(false); }
  }

  function reset() {
    setHandle(''); setAmount('25');
    setMessage('Your work on Arc caught my eye. Here’s a small grant to help you keep building.');
    setPending(null); setClaimUrl(''); setFundedAccess(null); setError(''); setNotice('');
  }

  if (isClaim) return (
    <div className="hf-support-shell hf-support-claim">
      <div className="hf-red-packet hf-red-packet-claim" aria-hidden="true"><Gift size={30} /><span>A private envelope on Arc</span></div>
      <ArchitectClaim config={config} wallet={wallet} onConnect={onConnect} />
    </div>
  );

  return (
    <div className="hf-support-shell">
      {claimError && <p className="hf-support-error" role="alert">X verification did not complete. Open the original private envelope link and sign in with the recipient’s X account.</p>}
      <div className="hf-support-tabs" role="tablist" aria-label="Support tools">
        <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')} role="tab" aria-selected={tab === 'send'}><Gift size={15} /> Send an envelope</button>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')} role="tab" aria-selected={tab === 'mine'}><WalletCards size={15} /> Your envelopes</button>
      </div>
      {tab === 'mine' ? <ArchitectDeposits config={config} wallet={wallet} /> : (
        <div className="hf-support-layout">
          <section className="hf-support-object" aria-label="Envelope preview">
            <div className="hf-support-intro"><span>ARCHITECTS SUPPORTING ARCHITECTS</span><h2>Send more than money.</h2><p>A private message and USDC, addressed to their X handle. They verify that account and claim on Arc.</p></div>
            <div className="hf-red-packet" aria-hidden="true"><div className="hf-red-packet-seal"><Gift size={23} /></div><span>FOR</span><strong>@{validHandle ? cleanHandle : 'architect'}</strong><small>{amounts?.amount ?? '—'} USDC TO CLAIM</small></div>
            <div className="hf-support-card" aria-hidden="true"><div><span>hopfast</span><img src="/brand/arc-logo.svg" alt="" /></div><strong>{amounts?.amount ?? '25.00'} <small>USDC</small></strong><span>PRIVATE GRANT · ARC</span></div>
            <p className="hf-support-safety"><Check size={14} /> Unclaimed funds can be reclaimed after 30 days.</p>
          </section>
          <form className="hf-support-form" onSubmit={(event) => { event.preventDefault(); void fund(); }}>
            {!claimUrl ? <>
              <label htmlFor="envelope-handle">Architect’s X handle</label>
              <div className="hf-support-field hf-support-handle"><img src="/brand/x.svg" alt="" /><input id="envelope-handle" disabled={busy || !!pending} value={handle} maxLength={16} placeholder="@jerallaire" onChange={(event) => setHandle(event.target.value)} /></div>
              {handle && !validHandle && <small role="alert">Enter a valid X handle.</small>}
              <label htmlFor="envelope-amount">Amount to deposit</label>
              <div className="hf-support-field"><input id="envelope-amount" disabled={busy || !!pending} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /><strong>USDC</strong></div>
              {!amounts && <small role="alert">Enter a positive amount with up to six decimal places.</small>}
              <label htmlFor="envelope-message">Private message</label>
              <textarea id="envelope-message" disabled={busy || !!pending} maxLength={280} rows={4} value={message} onChange={(event) => setMessage(event.target.value)} />
              <div className="hf-support-count">{message.length}/280</div>
              <dl className="hf-support-fees"><div><dt>Architect receives</dt><dd>{amounts?.amount ?? '—'} USDC</dd></div><div><dt>Hopfast fee · 2.5%</dt><dd>{amounts?.fee ?? '—'} USDC</dd></div><div><dt>You approve</dt><dd>{amounts?.total ?? '—'} USDC</dd></div></dl>
              <button className="hf-support-primary" type="submit" disabled={busy || !config.ready || !validHandle || !amounts || !message.trim()}>{busy ? 'Finish in your wallet…' : wallet ? 'Fund envelope on Arc' : 'Connect wallet'} <Send size={15} /></button>
              <button className="hf-support-secondary" type="button" onClick={onBack}>Bridge USDC to Arc first</button>
              <small className="hf-support-disclosure">The fee is deducted at deposit and is not refunded. Network gas is separate.</small>
            </> : (
              <div className="hf-support-success"><div className="hf-support-success-icon"><Check size={22} /></div><span>ENVELOPE FUNDED</span><h3>Now put it in their hands.</h3><p>The claim link is private. The recipient must still verify @{cleanHandle} before the contract releases funds.</p><input aria-label="Private claim link" readOnly value={claimUrl} /><button className="hf-support-primary" type="button" onClick={deliver} disabled={busy || !config.deliveryEnabled}>Send privately on X <Send size={15} /></button><button className="hf-support-secondary" type="button" onClick={copyLink}><Copy size={14} /> Copy private link</button><button className="hf-support-reset" type="button" onClick={reset}>Create another envelope</button></div>
            )}
            {error && <p className="hf-support-error" role="alert">{error}</p>}
            {notice && <p className="hf-support-notice" role="status">{notice}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
