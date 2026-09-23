import { useEffect, useMemo, useState } from 'react';
import { Check, CircleDollarSign, Copy, MessageCircle, Send, WalletCards } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
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
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('A payment is waiting for you on Arc. Sent with Hopfast.');
  const [config, setConfig] = useState<ArchitectConfig>({ ready: false, chainId: 5042, rpcUrl: 'https://rpc.mainnet.arc.io', feeBps: 250 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [claimUrl, setClaimUrl] = useState('');
  const [fundedAccess, setFundedAccess] = useState<DraftEnvelope | null>(null);
  const [pending, setPending] = useState<DraftEnvelope | null>(null);

  useEffect(() => {
    architectApi<ArchitectConfig>('/config').then(setConfig).catch(() => setError('Payments are temporarily unavailable. Please try again shortly.'));
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
      setNotice('Payment funded. Send the private claim link to the recipient.');
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
      setNotice('The private claim link was sent on X.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not send the X message. Copy the private link and share it yourself.');
    } finally { setBusy(false); }
  }

  function reset() {
    setHandle(''); setAmount('');
    setMessage('A payment is waiting for you on Arc. Sent with Hopfast.');
    setPending(null); setClaimUrl(''); setFundedAccess(null); setError(''); setNotice('');
  }

  if (isClaim) return (
    <div className="hf-support-shell hf-support-claim">
      <div className="hf-red-packet hf-red-packet-claim" aria-hidden="true"><CircleDollarSign size={30} /><span>A private envelope on Arc</span></div>
      <ArchitectClaim config={config} wallet={wallet} onConnect={onConnect} />
    </div>
  );

  return (
    <div className="hf-support-shell">
      {claimError && <p className="hf-support-error" role="alert">X verification did not finish. Open the original claim link and sign in with the recipient’s X account.</p>}
      <div className="hf-support-tabs" role="tablist" aria-label="Arc payment tools">
        <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')} role="tab" aria-selected={tab === 'send'}><CircleDollarSign size={15} /> New payment</button>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')} role="tab" aria-selected={tab === 'mine'}><WalletCards size={15} /> Sent</button>
      </div>
      {tab === 'mine' ? <ArchitectDeposits config={config} wallet={wallet} /> : (
        <div className="hf-support-layout">
          <section className="hf-support-object" aria-label="Envelope preview">
            <div className="hf-support-intro"><span>PAYMENT PREVIEW</span><h2>Pay a username. They claim on Arc.</h2><p>No wallet address needed upfront. The recipient verifies their X account, chooses a wallet, and claims the USDC on Arc.</p></div>
            <div className="hf-red-packet" aria-hidden="true"><div className="hf-red-packet-seal"><CircleDollarSign size={23} /></div><span>FOR</span><strong>@{validHandle ? cleanHandle : 'username'}</strong><small>{amounts?.amount ?? '—'} USDC TO CLAIM</small></div>
            <div className="hf-support-card" aria-hidden="true"><div><span>hopfast</span><img src="/brand/arc-logo.svg" alt="" /></div><strong>{amounts?.total ?? '—'} <small>USDC</small></strong><span>PRIVATE PAYMENT · ARC</span></div>
            <div className="hf-support-safety"><p><Check size={14} /> Unclaimed funds can be reclaimed after 30 days.</p><p><MessageCircle size={14} /> If you’re unable to recover funds, <a href="https://t.me/promitsaha" target="_blank" rel="noopener noreferrer">drop us a message</a> and we’ll help.</p></div>
          </section>
          <form className="hf-support-form" onSubmit={(event) => { event.preventDefault(); void fund(); }}>
            {!claimUrl ? <>
              <label htmlFor="envelope-handle">X username</label>
              <div className="hf-support-field hf-support-handle"><img src="/brand/x.svg" alt="" /><input id="envelope-handle" disabled={busy || !!pending} value={handle} maxLength={16} placeholder="username" onChange={(event) => setHandle(event.target.value)} /></div>
              {handle && !validHandle && <small role="alert">Enter a valid X username.</small>}
              <label htmlFor="envelope-amount">Amount</label>
              <div className="hf-support-field"><input id="envelope-amount" disabled={busy || !!pending} inputMode="decimal" value={amount} placeholder="0.00" onChange={(event) => setAmount(event.target.value)} /><strong>USDC</strong></div>
              {amount && !amounts && <small role="alert">Enter a positive amount with up to six decimal places.</small>}
              <label htmlFor="envelope-message">Message to recipient</label>
              <textarea id="envelope-message" disabled={busy || !!pending} maxLength={280} rows={4} value={message} onChange={(event) => setMessage(event.target.value)} />
              <div className="hf-support-count">{message.length}/280</div>
              <dl className="hf-support-fees"><div><dt>They receive</dt><dd>{amounts?.amount ?? '—'} USDC</dd></div><div><dt>Hopfast fee · 2.5%</dt><dd>{amounts?.fee ?? '—'} USDC</dd></div><div><dt>Wallet approves</dt><dd>{amounts?.total ?? '—'} USDC</dd></div></dl>
              <button className="hf-support-primary" type="submit" disabled={busy || !config.ready || !validHandle || !amounts || !message.trim()}>{busy ? 'Finish in your wallet…' : wallet ? 'Review payment in wallet' : 'Connect wallet'} <Send size={15} /></button>
              <button className="hf-support-secondary" type="button" onClick={onBack}>Need USDC? Bridge to Arc</button>
              <small className="hf-support-disclosure">Hopfast deducts 2.5% when you deposit. The recipient receives the amount shown above. The fee is not refunded if you later reclaim. Network gas is separate.</small>
            </> : (
              <div className="hf-support-success"><div className="hf-support-success-icon"><Check size={22} /></div><span>PAYMENT READY</span><h3>Now get it to @{cleanHandle}.</h3><p>Send the private claim link on X or share the QR code. Only the verified account can claim it.</p><div className="hf-claim-qr"><QRCodeSVG value={claimUrl} size={148} bgColor="transparent" fgColor="#193760" level="M" /><small>Scan to open the private claim</small></div><input aria-label="Private claim link" readOnly value={claimUrl} /><button className="hf-support-primary" type="button" onClick={deliver} disabled={busy || !config.deliveryEnabled}>Send claim link on X <Send size={15} /></button><button className="hf-support-secondary" type="button" onClick={copyLink}><Copy size={14} /> Copy private link</button><button className="hf-support-reset" type="button" onClick={reset}>Send another payment</button></div>
            )}
            {error && <p className="hf-support-error" role="alert">{error}</p>}
            {notice && <p className="hf-support-notice" role="status">{notice}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
