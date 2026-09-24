import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Check, Copy, MessageCircle, QrCode, ScanLine, Send, Share2, WalletCards, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { architectApi, escrowWrite, walletProof, type ArchitectConfig } from '../services/architectService';
import { fundingAmounts } from '../lib/builderFunding';
import type { PrivyWalletBridge } from './WalletConnector';
import { ArchitectClaim } from './ArchitectClaim';
import { ArchitectDeposits } from './ArchitectDeposits';
import { PaymentIdentity } from './PaymentIdentity';
import { ProfilePayment } from './ProfilePayment';

type DraftEnvelope = { envelopeId: string; xIdentity: string; gross: string; claimUrl: string; access: string };
type DetectedBarcode = { rawValue: string };
type QrDetector = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type QrDetectorConstructor = new (options: { formats: string[] }) => QrDetector;

function paymentHandleFromQr(value: string) {
  const raw = value.trim();
  try {
    const url = new URL(raw);
    const handle = url.searchParams.get('pay')?.replace(/^@/, '').trim() ?? '';
    if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) return handle;
  } catch { /* A Hopfast ID may be encoded without a URL. */ }
  const handle = raw.replace(/^@/, '').replace(/@hopfast$/i, '').trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : '';
}

export function AgentView({ onBack, initialHandle = '', wallet = null, onConnect }: {
  onBack: () => void; initialHandle?: string; wallet?: PrivyWalletBridge | null; onConnect?: () => void;
}) {
  const isClaim = new URLSearchParams(location.search).has('envelope');
  const claimError = new URLSearchParams(location.search).has('claimError');
  const [tab, setTab] = useState<'send' | 'receive' | 'mine'>(() =>
    new URLSearchParams(location.search).has('payProfile') ? 'receive' : 'send'
  );
  const [paymentMode, setPaymentMode] = useState<'direct' | 'private'>('direct');
  const [directHandle, setDirectHandle] = useState('');
  const [handle, setHandle] = useState(initialHandle);
  const [profileLinkHandle, setProfileLinkHandle] = useState(initialHandle);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('A payment is waiting for you on Arc. Sent with Hopfast.');
  const [config, setConfig] = useState<ArchitectConfig>({ ready: false, chainId: 5042, rpcUrl: 'https://rpc.mainnet.arc.io', feeBps: 250 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [claimUrl, setClaimUrl] = useState('');
  const [pending, setPending] = useState<DraftEnvelope | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const scannerVideo = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    architectApi<ArchitectConfig>('/config').then(setConfig).catch(() => setError('Payments are temporarily unavailable. Please try again shortly.'));
  }, []);

  useEffect(() => {
    if (!scannerOpen) return;
    let active = true;
    let frame = 0;
    let stream: MediaStream | null = null;
    const start = async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector?: QrDetectorConstructor }).BarcodeDetector;
        if (!Detector) throw new Error('QR scanning is not supported in this browser. Enter the Hopfast ID instead.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!active || !scannerVideo.current) return;
        scannerVideo.current.srcObject = stream;
        await scannerVideo.current.play();
        const detector = new Detector({ formats: ['qr_code'] });
        const scan = async () => {
          if (!active || !scannerVideo.current) return;
          try {
            const result = await detector.detect(scannerVideo.current);
            const handle = result[0] ? paymentHandleFromQr(result[0].rawValue) : '';
            if (handle) {
              setDirectHandle(handle);
              setScannerOpen(false);
              return;
            }
          } catch { /* Keep scanning while the camera is moving. */ }
          frame = requestAnimationFrame(() => void scan());
        };
        void scan();
      } catch (cause) {
        if (active) setScannerError(cause instanceof Error ? cause.message : 'Could not open the camera.');
      }
    };
    void start();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scannerOpen]);

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
      localStorage.setItem(`hopfast-envelope:${draft.envelopeId}`, JSON.stringify({ ...draft, funder: wallet.address }));
      await escrowWrite(config, wallet, 'deposit', [draft.envelopeId, draft.xIdentity, BigInt(draft.gross)]);
      setClaimUrl(draft.claimUrl); setPending(null);
      setNotice('Payment funded. Share the private claim link with the recipient.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally { setBusy(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(claimUrl); setNotice('Private claim link copied.'); }
    catch { setError('Could not copy the link. Select it manually instead.'); }
  }

  const shareText = claimUrl
    ? `Hey @${cleanHandle}, I sent you ${amounts?.amount ?? ''} USDC on Arc with Hopfast. Verify your X account and claim it here: ${claimUrl}`
    : '';

  async function sharePayment() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `USDC for @${cleanHandle}`, text: shareText });
        setNotice('Payment details opened in your share menu.');
      } else {
        await navigator.clipboard.writeText(shareText);
        setNotice('Message and private claim link copied.');
      }
    } catch (cause) {
      if ((cause as DOMException)?.name !== 'AbortError') setError('Could not share it. Copy the link instead.');
    }
  }

  function reset() {
    setHandle(''); setAmount('');
    setMessage('A payment is waiting for you on Arc. Sent with Hopfast.');
    setPending(null); setClaimUrl(''); setError(''); setNotice('');
  }

  if (isClaim) return (
    <div className="hf-support-shell hf-support-claim">
      <div className="hf-red-packet hf-red-packet-claim" aria-hidden="true"><img className="hf-usdc-icon" src="/token-icons/usdc.svg" alt="" /><span>A private envelope on Arc</span></div>
      <ArchitectClaim config={config} wallet={wallet} onConnect={onConnect} />
    </div>
  );

  return (
    <div className="hf-support-shell">
      {claimError && <p className="hf-support-error" role="alert">X verification did not finish. Open the original claim link and sign in with the recipient’s X account.</p>}
      <div className="hf-support-tabs" role="tablist" aria-label="Arc payment tools">
        <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')} role="tab" aria-selected={tab === 'send'}><img className="hf-tab-usdc" src="/token-icons/usdc.svg" alt="" /> New payment</button>
        <button className={tab === 'receive' ? 'active' : ''} onClick={() => setTab('receive')} role="tab" aria-selected={tab === 'receive'}><QrCode size={15} /> Receive</button>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')} role="tab" aria-selected={tab === 'mine'}><WalletCards size={15} /> Activity</button>
      </div>
      {tab === 'mine' ? <ArchitectDeposits config={config} wallet={wallet} /> : tab === 'receive' ? (
        <PaymentIdentity wallet={wallet} onConnect={onConnect} />
      ) : profileLinkHandle ? (
        <ProfilePayment
          handle={profileLinkHandle}
          wallet={wallet}
          onConnect={onConnect}
          onPayAnother={() => {
            setProfileLinkHandle('');
            setHandle('');
          }}
        />
      ) : (
        <>
        <div className="hf-payment-mode" role="group" aria-label="Payment type">
          <button type="button" className={paymentMode === 'direct' ? 'active' : ''} onClick={() => setPaymentMode('direct')}><AtSign size={14} /><span><strong>Pay a Hopfast ID</strong><small>Direct to their verified Arc wallet</small></span></button>
          <button type="button" className={paymentMode === 'private' ? 'active' : ''} onClick={() => setPaymentMode('private')}><Send size={14} /><span><strong>Pay an X username</strong><small>They verify and claim later</small></span></button>
        </div>
        {paymentMode === 'direct' ? (
          <div className="hf-direct-pay-start">
            <div className="hf-direct-pay-copy">
              <span className="hf-support-eyebrow">DIRECT PAYMENT</span>
              <h2>Pay their verified Arc wallet.</h2>
              <p>Enter a Hopfast ID or X username. We will resolve the verified recipient before you choose an amount.</p>
              <div className="hf-direct-id-preview"><AtSign size={22} /><strong>{directHandle.replace(/^@/, '').trim() || 'username'}<span>@hopfast</span></strong></div>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); const value = directHandle.replace(/^@/, '').trim(); if (/^[A-Za-z0-9_]{1,15}$/.test(value)) setProfileLinkHandle(value); }}>
              <label htmlFor="direct-hopfast-id">Hopfast ID or X username</label>
              <div className="hf-support-field hf-support-handle">
                <AtSign className="hf-support-handle-prefix" size={17} />
                <input id="direct-hopfast-id" value={directHandle} maxLength={24} placeholder="username@hopfast" onChange={(event) => setDirectHandle(event.target.value.replace(/@hopfast$/i, ''))} autoFocus />
                <button className="hf-qr-scan-trigger" type="button" onClick={() => { setScannerError(''); setScannerOpen(true); }} aria-label="Scan a Hopfast payment QR code"><ScanLine size={18} /></button>
              </div>
              {scannerOpen && (
                <div className="hf-qr-scanner" role="dialog" aria-label="Scan Hopfast payment QR code">
                  <div className="hf-qr-scanner-head"><span><QrCode size={15} /> Scan Hopfast QR</span><button type="button" onClick={() => setScannerOpen(false)} aria-label="Close QR scanner"><X size={16} /></button></div>
                  <div className="hf-qr-camera"><video ref={scannerVideo} playsInline muted /><span aria-hidden="true" /></div>
                  <p>Point the camera at a Hopfast payment QR code.</p>
                  {scannerError && <small role="alert">{scannerError}</small>}
                </div>
              )}
              {directHandle && !/^[A-Za-z0-9_]{1,15}$/.test(directHandle.replace(/^@/, '').trim()) && <small role="alert">Enter a valid Hopfast ID or X username.</small>}
              <button className="hf-support-primary" type="submit" disabled={!/^[A-Za-z0-9_]{1,15}$/.test(directHandle.replace(/^@/, '').trim())}>Find recipient <ArrowIcon /></button>
              <small className="hf-direct-pay-hint">No Hopfast ID yet? Choose “Pay an X username” above.</small>
            </form>
          </div>
        ) : (
        <div className="hf-support-layout">
          <section className="hf-support-object" aria-label="Envelope preview">
            <div className="hf-support-intro"><span>PRIVATE PAYMENT</span><h2>Send USDC before you know their wallet.</h2><p>Address the payment to an X username. Only that verified account can connect an Arc wallet and claim it.</p></div>
            <div className="hf-red-packet" aria-hidden="true"><div className="hf-red-packet-seal"><img className="hf-usdc-icon" src="/token-icons/usdc.svg" alt="" /></div><span>FOR</span><strong>@{validHandle ? cleanHandle : 'username'}</strong><small>{amounts?.amount ?? '—'} USDC TO CLAIM</small></div>
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
              <label htmlFor="envelope-message">Private note</label>
              <textarea id="envelope-message" disabled={busy || !!pending} maxLength={280} rows={4} value={message} onChange={(event) => setMessage(event.target.value)} />
              <div className="hf-support-count">{message.length}/280</div>
              <dl className="hf-support-fees"><div><dt>They receive</dt><dd>{amounts?.amount ?? '—'} USDC</dd></div><div><dt>Hopfast fee · 2.5%</dt><dd>{amounts?.fee ?? '—'} USDC</dd></div><div><dt>Wallet approves</dt><dd>{amounts?.total ?? '—'} USDC</dd></div></dl>
              <button className="hf-support-primary" type="submit" disabled={busy || !config.ready || !validHandle || !amounts || !message.trim()}>{busy ? 'Waiting for wallet approval…' : wallet ? 'Fund private payment' : 'Connect wallet to continue'} <Send size={15} /></button>
              <button className="hf-support-secondary" type="button" onClick={onBack}>Need USDC? Bridge to Arc</button>
              <small className="hf-support-disclosure">Hopfast deducts 2.5% when you deposit. The recipient receives the amount shown above. The fee is not refunded if you later reclaim. Network gas is separate.</small>
            </> : (
              <div className="hf-support-success"><div className="hf-support-success-icon"><Check size={22} /></div><span>FUNDED ON ARC</span><h3>Now share it with @{cleanHandle}.</h3><p>The link is private. The recipient must open it and verify the matching X account before choosing a wallet to claim the USDC.</p><div className="hf-claim-qr"><QRCodeSVG value={claimUrl} size={148} bgColor="transparent" fgColor="#193760" level="M" /><small>Scan to open the private claim</small></div><div className="hf-share-message"><small>MESSAGE TO SHARE</small><p>{shareText}</p></div><input aria-label="Private claim link" readOnly value={claimUrl} /><button className="hf-support-primary" type="button" onClick={sharePayment}>Share payment <Share2 size={15} /></button><button className="hf-support-secondary" type="button" onClick={copyLink}><Copy size={14} /> Copy private link</button><button className="hf-support-reset" type="button" onClick={reset}>Create another payment</button></div>
            )}
            {error && <p className="hf-support-error" role="alert">{error}</p>}
            {notice && <p className="hf-support-notice" role="status">{notice}</p>}
          </form>
        </div>
        )}
        </>
      )}
    </div>
  );
}

function ArrowIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}
