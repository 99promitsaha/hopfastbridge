import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ExternalLink, Loader2, Shield, X } from 'lucide-react';
import { API_BASE_URL } from '../constants';
import { formatDisplayAmount } from '../lib/amount';
import type { PrivyWalletBridge } from './WalletConnector';

interface Payment {
  id: string;
  walletAddress: string;
  recipient: string;
  amount: string;
  value: string;
  memo: string;
  chainId: number;
  expiresAt: string;
  status: string;
  txHash?: string;
  explorerLink?: string;
  trackingMessage?: string;
  transactionRequest: {
    from: string;
    to: string;
    value: string;
    data: string;
    chainId: string;
  };
}
type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
export function PaymentReview({
  walletBridge,
  onConnect,
  onBack,
}: {
  walletBridge: PrivyWalletBridge | null;
  onConnect?: () => void;
  onBack: () => void;
}) {
  const id = new URLSearchParams(window.location.search).get('payment') ?? '';
  const token = window.location.hash.slice(1);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submittedHash, setSubmittedHash] = useState(
    () => localStorage.getItem('hf-payment-' + id) ?? ''
  );
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null);
  async function api(action = '', body?: unknown): Promise<Payment> {
    const response = await fetch(
      `${API_BASE_URL}/payments/${encodeURIComponent(id)}${action}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Payment unavailable.');
    return data;
  }
  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        const data = await api();
        if (active) {
          setPayment(data);
          setError('');
        }
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : 'Payment unavailable.');
      }
    };
    void update();
    const timer = setInterval(() => void update(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, token]);
  async function record(hash: string) {
    setPayment(await api('/submit', { txHash: hash }));
  }
  async function approve() {
    setBusy(true);
    setError('');
    try {
      if (submittedHash) {
        await record(submittedHash);
        return;
      }
      const fresh = await api();
      setPayment(fresh);
      if (
        fresh.status !== 'awaiting_approval' ||
        Date.now() >= Date.parse(fresh.expiresAt)
      )
        throw new Error('This payment is no longer awaiting approval.');
      let provider: Provider;
      if (walletBridge) {
        await walletBridge.switchChain(5042);
        provider = await walletBridge.getEthereumProvider();
      } else {
        const injected = (window as unknown as { ethereum?: Provider })
          .ethereum;
        if (!injected) {
          onConnect?.();
          throw new Error('Connect the payer wallet to review this payment.');
        }
        provider = injected;
        await provider.request({ method: 'eth_requestAccounts' });
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x13b2' }],
          });
        } catch (err) {
          if ((err as { code?: number }).code !== 4902) throw err;
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x13b2',
                chainName: 'Arc',
                nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
                rpcUrls: ['https://rpc.mainnet.arc.io'],
                blockExplorerUrls: ['https://explorer.arc.io'],
              },
            ],
          });
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x13b2' }],
          });
        }
      }
      const chain = (await provider.request({
        method: 'eth_chainId',
      })) as string;
      if (BigInt(chain) !== 5042n)
        throw new Error('Switch your wallet to Arc mainnet.');
      const accounts = (await provider.request({
        method: 'eth_accounts',
      })) as string[];
      if (accounts[0]?.toLowerCase() !== fresh.walletAddress.toLowerCase())
        throw new Error('Connected wallet does not match the requested payer.');
      const tx = {
        chainId: '0x13b2',
        from: fresh.walletAddress,
        to: fresh.recipient,
        value: '0x' + BigInt(fresh.value).toString(16),
        data: '0x',
      };
      const gas =
        (BigInt(
          (await provider.request({
            method: 'eth_estimateGas',
            params: [tx],
          })) as string
        ) *
          120n) /
        100n;
      const price = BigInt(
        (await provider.request({ method: 'eth_gasPrice' })) as string
      );
      const maxFee = (price > 20000000000n ? price : 20000000000n) * 2n;
      const balance = BigInt(
        (await provider.request({
          method: 'eth_getBalance',
          params: [fresh.walletAddress, 'latest'],
        })) as string
      );
      const fee = gas * maxFee;
      setEstimatedFee(formatDisplayAmount(Number(fee) / 1e18));
      if (balance < BigInt(fresh.value) + fee)
        throw new Error(
          'Insufficient USDC for both this payment and the gas reserve.'
        );
      if (Date.now() >= Date.parse(fresh.expiresAt))
        throw new Error('Payment expired. Create a new request to continue.');
      const hash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            ...tx,
            gas: '0x' + gas.toString(16),
            maxFeePerGas: '0x' + maxFee.toString(16),
            maxPriorityFeePerGas: '0x0',
          },
        ],
      })) as string;
      if (!/^0x[\da-fA-F]{64}$/.test(hash))
        throw new Error(
          'Wallet did not return a transaction hash. Check your wallet before retrying.'
        );
      localStorage.setItem('hf-payment-' + id, hash);
      setSubmittedHash(hash);
      await record(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed.');
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      setPayment(await api('/cancel', {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <motion.main
      className="hf-content"
      id="main-content"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="hf-payment-card">
        <button
          className="hf-panel-close"
          onClick={onBack}
          aria-label="Close payment"
        >
          <X size={18} />
        </button>
        <p className="hf-kicker">
          <Shield size={14} /> Arc payment review
        </p>
        <h1>Confirm this Arc payment</h1>
        <p className="hf-payment-sub">
          Confirm the amount and destination before approving in your wallet.
        </p>
        {!payment && !error && (
          <p>
            <Loader2 size={16} className="hf-spin" /> Loading payment details…
          </p>
        )}
        {payment && (
          <>
            <div className="hf-payment-amount">
              {formatDisplayAmount(payment.amount)} <span>USDC</span>
            </div>
            <dl className="hf-payment-details">
              <dt>Network</dt>
              <dd className="hf-payment-network">
                <img
                  src="/brand/arc-network.svg"
                  width="17"
                  height="17"
                  alt=""
                />
                Arc mainnet
              </dd>
              <dt>Sender</dt>
              <dd>{payment.walletAddress}</dd>
              <dt>Recipient</dt>
              <dd>{payment.recipient}</dd>
              {payment.memo && (
                <>
                  <dt>Message</dt>
                  <dd>{payment.memo}</dd>
                </>
              )}
              <dt>Status</dt>
              <dd aria-live="polite">{payment.status.replace(/_/g, ' ')}</dd>
              <dt>Expires</dt>
              <dd>{new Date(payment.expiresAt).toLocaleString()}</dd>
            </dl>
            <p className="hf-payment-sub">
              Arc gas is paid separately in USDC.
              {estimatedFee && ` Maximum gas reserve: ${estimatedFee} USDC.`}
            </p>
            {payment.trackingMessage && (
              <p role="status">{payment.trackingMessage}</p>
            )}
            {payment.status === 'completed' && (
              <p className="hf-payment-success">
                <CheckCircle2 size={18} /> Payment confirmed on Arc.
              </p>
            )}
            {(submittedHash || payment.txHash) && (
              <a
                className="hf-payment-link"
                href={`https://explorer.arc.io/tx/${payment.txHash ?? submittedHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View transaction <ExternalLink size={14} />
              </a>
            )}
            {(payment.status === 'awaiting_approval' ||
              (submittedHash && !payment.txHash)) && (
              <div className="hf-payment-actions">
                <button
                  className="hf-btn hf-btn-primary"
                  disabled={busy}
                  onClick={() => void approve()}
                >
                  {busy
                    ? 'Checking wallet…'
                    : submittedHash
                      ? 'Retry transaction verification'
                      : 'Approve in wallet'}
                </button>
                {!submittedHash && (
                  <button
                    className="hf-btn hf-btn-secondary"
                    disabled={busy}
                    onClick={() => void cancel()}
                  >
                    Cancel request
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {error && (
          <p className="hf-payment-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </motion.main>
  );
}
