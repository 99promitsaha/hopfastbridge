import { useEffect, useRef, useState } from 'react';
import { AtSign, Check, Copy, Download, ExternalLink, QrCode, Share2, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { architectApi, walletProof } from '../services/architectService';
import type { PrivyWalletBridge } from './WalletConnector';

type PaymentProfile = {
  handle: string;
  wallet: string;
  vpa: string;
  payUrl: string;
  verifiedBy: 'X';
};

export function PaymentIdentity({
  wallet,
  onConnect,
}: {
  wallet: PrivyWalletBridge | null;
  onConnect?: () => void;
}) {
  const [profile, setProfile] = useState<PaymentProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'vpa' | 'link' | 'wallet' | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const paymentUrl = profile
    ? `${import.meta.env.DEV ? window.location.origin : 'https://www.hopfast.xyz'}/?pay=${encodeURIComponent(profile.handle)}`
    : '';

  useEffect(() => {
    setProfile(null);
    setLoaded(false);
    setError('');
  }, [wallet?.address]);

  async function loadProfile() {
    if (!wallet) {
      onConnect?.();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await architectApi<{ profile: PaymentProfile | null }>(
        `/profile/wallet/${wallet.address}`,
      );
      setProfile(result.profile);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your Hopfast ID.');
    } finally {
      setBusy(false);
    }
  }

  async function connectX() {
    if (!wallet) {
      onConnect?.();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await architectApi<{ url: string }>(
        '/profile/x',
        await walletProof(wallet),
      );
      window.location.assign(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'X verification could not start.');
      setBusy(false);
    }
  }

  async function copy(value: string, kind: 'vpa' | 'link' | 'wallet') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError('Could not copy that value.');
    }
  }

  async function shareProfile() {
    if (!profile) return;
    const text = `Pay @${profile.handle} in USDC on Arc with Hopfast: ${paymentUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Pay @${profile.handle} on Arc`, text, url: paymentUrl });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied('link');
        window.setTimeout(() => setCopied(null), 1800);
      }
    } catch (cause) {
      if ((cause as DOMException)?.name !== 'AbortError')
        setError('Could not open sharing. Copy the payment link instead.');
    }
  }

  function downloadQr() {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg || !profile) return;
    const source = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `hopfast-${profile.handle}-qr.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!wallet || !loaded) {
    return (
      <section className="hf-identity-onboarding">
        <div className="hf-identity-orbit" aria-hidden="true">
          <div><QrCode size={34} /></div>
          <span>@</span>
        </div>
        <span className="hf-support-eyebrow">RECEIVE USDC ON ARC</span>
        <h2>Turn your X username into a payment address.</h2>
        <p>
          Verify once to create a Hopfast ID, personal QR, and payment link that
          all resolve to your Arc wallet.
        </p>
        <button className="hf-support-primary" type="button" onClick={loadProfile} disabled={busy}>
          {busy ? 'Checking your wallet…' : wallet ? 'Show my Hopfast ID' : 'Connect wallet'}
          <AtSign size={16} />
        </button>
        <small><ShieldCheck size={13} /> Creating or moving an ID requires one wallet signature. It never moves funds.</small>
        {error && <p className="hf-support-error" role="alert">{error}</p>}
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="hf-identity-onboarding hf-identity-x-connect">
        <img src="/brand/x.svg" alt="X" />
        <span className="hf-support-eyebrow">CLAIM YOUR HOPFAST ID</span>
        <h2>Claim the Hopfast ID that matches your X username.</h2>
        <p>
          X confirms the username. Your wallet signature confirms where direct
          USDC payments should arrive.
        </p>
        <div className="hf-identity-example"><strong>username</strong><span>@hopfast</span></div>
        <button className="hf-support-primary" type="button" onClick={connectX} disabled={busy}>
          {busy ? 'Opening X…' : 'Verify with X'} <ExternalLink size={15} />
        </button>
        <small>Verify again later if you want this ID to point to another wallet.</small>
        {error && <p className="hf-support-error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="hf-identity-dashboard">
      <div className="hf-identity-copy">
        <span className="hf-support-eyebrow">VERIFIED ON X · READY ON ARC</span>
        <h2>Your Hopfast ID is ready.</h2>
        <p>Share any option below. Each one opens a payment to @{profile.handle} on Arc.</p>
        <div className="hf-vpa-card">
          <span>HOPFAST ID</span>
          <strong>{profile.vpa}</strong>
          <button type="button" onClick={() => copy(profile.vpa, 'vpa')}>
            {copied === 'vpa' ? <Check size={14} /> : <Copy size={14} />}
            {copied === 'vpa' ? 'Copied' : 'Copy ID'}
          </button>
        </div>
        <div className="hf-identity-actions">
          <button type="button" onClick={shareProfile}>
            {copied === 'link' ? <Check size={14} /> : <Share2 size={14} />} {copied === 'link' ? 'Copied' : 'Share payment link'}
          </button>
          <button type="button" onClick={() => copy(profile.wallet, 'wallet')}>
            {copied === 'wallet' ? <Check size={14} /> : <Copy size={14} />} Copy Arc wallet
          </button>
        </div>
      </div>
      <div className="hf-identity-qr-card">
        <div className="hf-identity-qr" ref={qrRef}>
          <QRCodeSVG value={paymentUrl} size={190} bgColor="transparent" fgColor="#17375f" level="M" />
          <img src="/brand/hopfast-mark.svg" alt="" />
        </div>
        <strong>Scan to pay @{profile.handle}</strong>
        <span>USDC on Arc · X verified</span>
        <small>{paymentUrl.replace(/^https?:\/\//, '')}</small>
        <button className="hf-identity-download" type="button" onClick={downloadQr}>
          <Download size={13} /> Download QR
        </button>
      </div>
    </section>
  );
}
