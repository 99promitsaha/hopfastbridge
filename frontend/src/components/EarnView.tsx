import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown, ExternalLink, Loader2, Search,
  Shield, TrendingUp, Wallet, Zap, CheckCircle2, X,
  ArrowDownToLine, ArrowUpFromLine, RefreshCw, Trash2, Info,
} from 'lucide-react';
import { useEarnVaults } from '../hooks/useEarnVaults';
import { useEarnDeposit } from '../hooks/useEarnDeposit';
import { useEarnPortfolio } from '../hooks/useEarnPortfolio';
import { useLifiPositions } from '../hooks/useLifiPositions';
import { EarnOnboarding } from './EarnOnboarding';
import { fetchPreferences, savePreferences } from '../services/earnService';
import { fetchSingleTokenBalance } from '../services/balanceService';
import { parseUnits, formatUnits } from '../lib/amount';
import { CHAINS } from '../lib/chains';
import type { ChainKey } from '../lib/chains';
import type { EarnVault, EarnPositionRecord, EarnPreference, EarnFilters } from '../types';
import type { PrivyWalletBridge } from './WalletConnector';

/* ─── Constants ── */
const EARN_CHAINS = [
  { id: 0, label: 'All Chains', icon: null, icons: ['/chains/ethereum.svg', '/chains/base.svg', '/chains/arbitrum.svg', '/chains/optimism.svg'] },
  { id: 1, label: 'Ethereum', icon: '/chains/ethereum.svg' },
  { id: 8453, label: 'Base', icon: '/chains/base.svg' },
  { id: 42161, label: 'Arbitrum', icon: '/chains/arbitrum.svg' },
  { id: 10, label: 'Optimism', icon: '/chains/optimism.svg' },
  { id: 137, label: 'Polygon', icon: '/chains/polygon.svg' },
  { id: 59144, label: 'Linea', icon: '/chains/linea.svg' },
  { id: 146, label: 'Sonic', icon: '/chains/sonic.svg' },
];

const EARN_PROTOCOLS = [
  { value: null, label: 'All Protocols', icon: null, url: null, icons: ['/protocols/aave.svg', '/protocols/morpho.svg', '/protocols/euler.svg', '/protocols/pendle.svg'] },
  { value: 'aave-v3',       label: 'Aave V3',     icon: '/protocols/aave.svg',         url: 'https://app.aave.com' },
  { value: 'morpho-v1',     label: 'Morpho',       icon: '/protocols/morpho.svg',       url: 'https://app.morpho.org' },
  { value: 'euler-v2',      label: 'Euler V2',     icon: '/protocols/euler.svg',        url: 'https://app.euler.finance' },
  { value: 'ethena-usde',   label: 'Ethena',       icon: '/protocols/ethena.svg',       url: 'https://www.ethena.fi' },
  { value: 'pendle',        label: 'Pendle',       icon: '/protocols/pendle.svg',       url: 'https://app.pendle.finance' },
  { value: 'maple',         label: 'Maple',        icon: '/protocols/maple.jpeg',       url: 'https://app.maple.finance/earn' },
  { value: 'ether.fi-stake',label: 'Ether.fi',     icon: '/protocols/etherfi.svg',      url: 'https://ether.fi/app' },
  { value: 'yo-protocol',   label: 'Yo Protocol',  icon: '/protocols/yo-protocol.png',  url: 'https://app.yo.xyz' },
  { value: 'neverland',     label: 'Neverland',    icon: '/protocols/neverland.png',    url: 'https://app.neverland.money' },
  { value: 'upshift',       label: 'Upshift',      icon: '/protocols/upshift.jpg',      url: 'https://app.upshift.finance' },
];

const ETH_FAMILY = ['ETH', 'WETH', 'STETH', 'WSTETH'];
const BTC_FAMILY = ['BTC', 'WBTC', 'CBBTC', 'TBTC', 'BTCB'];

const EARN_ASSETS = [
  { value: null, label: 'All Assets', icon: null, icons: ['/token-icons/usdc.svg', '/token-icons/eth.svg', '/token-icons/wbtc.png', '/token-icons/dai.svg'] },
  { value: 'USDC', label: 'USDC', icon: '/token-icons/usdc.svg' },
  { value: 'USDT', label: 'USDT', icon: '/token-icons/usdt.svg' },
  { value: 'ETH_FAMILY', label: 'ETH', icon: '/token-icons/eth.svg' },
  { value: 'BTC_FAMILY', label: 'BTC', icon: '/token-icons/wbtc.png' },
  { value: 'DAI', label: 'DAI', icon: '/token-icons/dai.svg' },
];

const CHAIN_EXPLORER: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  42161: 'https://arbiscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/',
  56: 'https://bscscan.com/tx/',

  59144: 'https://lineascan.build/tx/',
  146: 'https://sonicscan.org/tx/',
};

const CHAIN_NAME: Record<number, string> = {
  1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum', 10: 'Optimism',
  137: 'Polygon', 56: 'BNB Chain', 59144: 'Linea', 146: 'Sonic',
};

type EarnSubTab = 'vaults' | 'positions';

/* ─── Props ── */
interface EarnViewProps {
  walletBridge: PrivyWalletBridge | null;
  activeWalletAddress: string | null;
  onBack: () => void;
  /** Switch to swap tab with destination prefilled (chain + token). Undefined = not wired up. */
  onGetMore?: (toChain: ChainKey, toTokenSymbol: string) => void;
}

const PROTOCOL_ICON: Record<string, string> = Object.fromEntries(
  EARN_PROTOCOLS.filter((p) => p.value && p.icon).map((p) => [p.value, p.icon!])
);

const PROTOCOL_URL: Record<string, string> = Object.fromEntries(
  EARN_PROTOCOLS.filter((p) => p.value && p.url).map((p) => [p.value, p.url!])
);

function getProtocolIcon(protocolName: string): string | null {
  return PROTOCOL_ICON[protocolName] ?? null;
}

function getProtocolUrl(protocolName: string): string | null {
  return PROTOCOL_URL[protocolName] ?? null;
}

/** Match vault/token name to a local icon based on keywords */
function getTokenIcon(symbol: string): string | null {
  const s = symbol.toUpperCase();
  if (s === 'USDC' || s === 'USDC.E' || s === 'USDCE') return '/token-icons/usdc.svg';
  if (s === 'USDT') return '/token-icons/usdt.svg';
  if (s === 'DAI' || s === 'XDAI') return '/token-icons/dai.svg';
  if (s === 'WSTETH') return '/token-icons/wsteth.svg';
  if (s === 'WETH' || s === 'STETH') return '/token-icons/weth.png';
  if (s === 'ETH') return '/token-icons/eth.svg';
  if (s === 'CBBTC') return '/token-icons/cbbtc.png';
  if (s === 'TBTC') return '/token-icons/tbtc.svg';
  if (s === 'WBTC' || s === 'BTC') return '/token-icons/wbtc.png';
  if (s === 'BTCB') return '/token-icons/btcb.png';
  if (s === 'BNB' || s === 'WBNB') return '/token-icons/bnb.svg';
  if (s === 'POL' || s === 'MATIC' || s === 'WMATIC') return '/token-icons/matic.svg';
  if (s === 'VIRTUAL') return '/token-icons/virtual.png';
  if (s === 'MON' || s === 'WMON') return '/token-icons/mon.png';
  if (s === 'BUSD') return '/token-icons/busd.png';
  return null;
}

/* ─── Helpers ── */
function formatTvl(usd: string): string {
  const n = Number(usd);
  if (!Number.isFinite(n)) return '$—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatApy(val: number | null): string {
  if (val == null) return '—';
  return `${val.toFixed(2)}%`;
}

function protocolLabel(name: string): string {
  return name
    .replace(/-/g, ' ')
    .replace(/\bv(\d)/g, ' V$1')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getExplorerUrl(chainId: number, txHash: string): string {
  const base = CHAIN_EXPLORER[chainId] ?? 'https://etherscan.io/tx/';
  return `${base}${txHash}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return '';
  }
}

/* ─── Reusable dropdown ── */
function FilterIconStack({ icons }: { icons: string[] }) {
  return (
    <span className="hf-filter-icon-stack">
      {icons.map((src, i) => (
        <img key={src} src={src} alt="" className="hf-filter-icon-stacked" style={{ zIndex: icons.length - i }} />
      ))}
    </span>
  );
}

function FilterDropdown({ label, options, value, onChange }: {
  label: string;
  options: Array<{ value: string | null; label: string; icon?: string | null; icons?: string[] }>;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const selectedLabel = selected?.label ?? label;

  const renderIcon = (o: { icon?: string | null; icons?: string[] }) => {
    if (o.icons) return <FilterIconStack icons={o.icons} />;
    if (o.icon) return <img src={o.icon} alt="" className="hf-filter-icon" />;
    return null;
  };

  return (
    <div className="hf-earn-chain-filter" ref={ref}>
      <button className="hf-chain-btn" onClick={() => setOpen(!open)}>
        {selected && renderIcon(selected)}
        {selectedLabel}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="hf-earn-chain-dropdown">
          {options.map((o) => (
            <button
              key={o.value ?? '__all'}
              className={`hf-earn-chain-option ${value === o.value ? 'hf-earn-chain-option-active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {renderIcon(o)}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function prefsToFilters(prefs: EarnPreference): Partial<EarnFilters> {
  const f: Partial<EarnFilters> = {};
  f.sortBy = prefs.riskAppetite === 'high' ? 'apy' : 'tvl';

  if (prefs.preferredAsset === 'stablecoins') { f.stablecoinOnly = true; f.asset = null; }
  else if (prefs.preferredAsset === 'ETH_FAMILY') { f.stablecoinOnly = false; f.asset = 'ETH_FAMILY'; }
  else if (prefs.preferredAsset === 'BTC_FAMILY') { f.stablecoinOnly = false; f.asset = 'BTC_FAMILY'; }
  else if (prefs.preferredAsset === 'DAI') { f.stablecoinOnly = false; f.asset = 'DAI'; }
  else { f.stablecoinOnly = false; f.asset = null; }

  // Beginners get stablecoins regardless of asset choice — safety first
  if (prefs.experienceLevel === 'beginner' && !f.stablecoinOnly) {
    f.stablecoinOnly = true;
    f.asset = null;
  }
  return f;
}

function onboardingKey(address: string) {
  return `hf_earn_onboarded_${address.toLowerCase()}`;
}

const CHAIN_ID_TO_KEY: Record<number, ChainKey> = Object.fromEntries(
  CHAINS.map((c) => [c.chainId, c.key])
) as Record<number, ChainKey>;

/* ─── Main Component ── */
export function EarnView({ walletBridge, activeWalletAddress, onBack, onGetMore }: EarnViewProps) {
  const { vaults, loading, error, filters, updateFilters, loadMore, hasMore, allCount } = useEarnVaults();
  const portfolio = useEarnPortfolio(activeWalletAddress);
  const lifiPositions = useLifiPositions(activeWalletAddress);
  const { startPolling, stopPolling } = lifiPositions;
  const depositTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [subTab, setSubTabRaw] = useState<EarnSubTab>('vaults');
  const setSubTab = useCallback((tab: EarnSubTab) => {
    setSubTabRaw(tab);
    if (tab === 'positions') {
      startPolling();
    } else {
      stopPolling();
    }
  }, [startPolling, stopPolling]);

  // Cleanup deposit-refresh timers on unmount
  useEffect(() => {
    return () => { depositTimers.current.forEach(clearTimeout); };
  }, []);

  const [selectedVault, setSelectedVault] = useState<EarnVault | null>(null);
  const [inputAmount, setInputAmount] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [apyTip, setApyTip] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showMoreVaults, setShowMoreVaults] = useState(false);
  const [showTrackedDeposits, setShowTrackedDeposits] = useState(false);
  const prefsChecked = useRef(false);

  // Reset prefs check when wallet changes (M3 fix)
  useEffect(() => { prefsChecked.current = false; }, [activeWalletAddress]);

  const [vaultTokenBalance, setVaultTokenBalance] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    if (!selectedVault || !activeWalletAddress) {
      setVaultTokenBalance(null);
      return;
    }

    const underlying = selectedVault.underlyingTokens[0];
    if (!underlying) return;

    const chainKey = CHAIN_ID_TO_KEY[selectedVault.chainId];
    if (!chainKey) return;

    let cancelled = false;
    setBalanceLoading(true);
    setVaultTokenBalance(null);

    fetchSingleTokenBalance(chainKey, activeWalletAddress, {
      address: underlying.address,
      symbol: underlying.symbol,
      decimals: underlying.decimals,
    }).then((bal) => {
      if (!cancelled) {
        setVaultTokenBalance(bal);
        setBalanceLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setBalanceLoading(false);
    });

    return () => { cancelled = true; };
  }, [selectedVault?.address, selectedVault?.chainId, activeWalletAddress]);

  useEffect(() => {
    if (!activeWalletAddress || prefsChecked.current) return;
    prefsChecked.current = true;

    const key = onboardingKey(activeWalletAddress);
    const cached = localStorage.getItem(key);
    if (cached) {
      // Returning user — apply saved prefs immediately
      try {
        updateFilters(prefsToFilters(JSON.parse(cached)));
      } catch { /* ignore malformed cache */ }
      return;
    }
    // First time — fetch from DB, show modal if nothing found
    fetchPreferences(activeWalletAddress).then((prefs) => {
      if (prefs) {
        localStorage.setItem(key, JSON.stringify(prefs));
        updateFilters(prefsToFilters(prefs));
      } else {
        setShowOnboarding(true);
      }
    }).catch(() => setShowOnboarding(true));
  }, [activeWalletAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOnboardingComplete = async (prefs: EarnPreference) => {
    setShowOnboarding(false);
    updateFilters(prefsToFilters(prefs));
    if (activeWalletAddress) {
      localStorage.setItem(onboardingKey(activeWalletAddress), JSON.stringify(prefs));
      savePreferences(activeWalletAddress, prefs).catch(() => { /* non-critical */ });
    }
  };

  const handleOnboardingSkip = () => {
    setShowOnboarding(false);
    if (activeWalletAddress) {
      // Mark as seen so it doesn't reappear this session
      localStorage.setItem(onboardingKey(activeWalletAddress), JSON.stringify({ skipped: true }));
    }
  };

  const earnAction = useEarnDeposit(walletBridge, () => {
    setSelectedVault(null);
    setInputAmount('');
    setApyTip(null);
    portfolio.refresh();
    // LI.FI takes ~30-60s to index a new deposit, refresh after a short delay
    // Store timer IDs so they can be cleared on unmount (prevents stale-wallet updates)
    depositTimers.current.push(
      setTimeout(() => lifiPositions.refresh(), 8_000),
      setTimeout(() => lifiPositions.refresh(), 30_000),
    );
  });

  const handleDeposit = async () => {
    if (!selectedVault || !activeWalletAddress || !inputAmount) return;

    const token = selectedVault.underlyingTokens[0];
    let amountRaw: string;
    try {
      amountRaw = parseUnits(inputAmount, token.decimals).toString();
    } catch {
      earnAction.reset();
      return;
    }
    if (amountRaw === '0') return;

    const q = await earnAction.getDepositQuote(selectedVault, amountRaw, activeWalletAddress);
    if (q) {
      await earnAction.executeDeposit(selectedVault, amountRaw, inputAmount, q);
    }
  };

  const openVaultModal = (vault: EarnVault) => {
    setSelectedVault(vault);
    setInputAmount('');
    earnAction.reset();
  };

  const closeModal = () => {
    setSelectedVault(null);
    setInputAmount('');
    setApyTip(null);
    earnAction.reset();
  };

  const tokenSymbol = selectedVault?.underlyingTokens[0]?.symbol ?? 'Token';
  const modalChainId = selectedVault?.chainId ?? 1;

  const isInsufficient = (() => {
    if (!inputAmount || vaultTokenBalance == null || !selectedVault) return false;
    const decimals = selectedVault.underlyingTokens[0]?.decimals ?? 18;
    try { return parseUnits(inputAmount, decimals) > vaultTokenBalance; } catch { return false; }
  })();

  const chainOptions = EARN_CHAINS.map((c) => ({ value: c.id === 0 ? null : String(c.id), label: c.label, icon: c.icon, icons: 'icons' in c ? c.icons : undefined }));
  const protocolOptions = EARN_PROTOCOLS.map((p) => ({ value: p.value, label: p.label, icon: p.icon, icons: 'icons' in p ? p.icons : undefined }));
  const assetOptions = EARN_ASSETS.map((a) => ({ value: a.value, label: a.label, icon: a.icon, icons: 'icons' in a ? a.icons : undefined }));

  return (
    <motion.div
      key="earn"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="hf-earn-wrap"
    >
      {/* ── Onboarding Modal ── */}
      {showOnboarding && (
        <EarnOnboarding
          onComplete={handleOnboardingComplete}
          onSkip={handleOnboardingSkip}
        />
      )}

      {/* ── Deposit Modal ── */}
      <AnimatePresence>
        {selectedVault && (
          <motion.div
            className="hf-earn-detail-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={closeModal}
          >
            <motion.div
              className="hf-earn-detail-card"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="hf-earn-detail-close" onClick={closeModal}>
                <X size={16} />
              </button>

              <div className="hf-earn-detail-header">
                <div className="hf-earn-detail-identity">
                  {(() => {
                    const icon = getTokenIcon(selectedVault.underlyingTokens[0]?.symbol ?? '');
                    const protoIcon = getProtocolIcon(selectedVault.protocol.name);
                    return icon ? (
                      <span className="hf-earn-vault-card-icon-wrap hf-earn-detail-icon-wrap">
                        <img src={icon} alt="" className="hf-earn-vault-card-icon" />
                        {protoIcon && <img src={protoIcon} alt="" className="hf-earn-vault-card-proto-badge" />}
                      </span>
                    ) : null;
                  })()}
                  <div>
                    <h3 className="hf-earn-detail-name">{selectedVault.name}</h3>
                    <span className="hf-earn-detail-protocol">
                      {protocolLabel(selectedVault.protocol.name)} · {selectedVault.network}
                    </span>
                  </div>
                </div>
                <div className="hf-earn-detail-apy-big">
                  {formatApy(selectedVault.analytics.apy.total)}
                  <span>APY</span>
                </div>
              </div>

              <div className="hf-earn-detail-stats">
                <div className="hf-earn-stat">
                  <span className="hf-earn-stat-label">TVL</span>
                  <span className="hf-earn-stat-value">{formatTvl(selectedVault.analytics.tvl.usd)}</span>
                </div>
                <div className="hf-earn-stat">
                  <span className="hf-earn-stat-label">
                    Base APY
                    <button className="hf-apy-tip-btn" onClick={() => setApyTip(apyTip === 'base' ? null : 'base')}>
                      <Info size={11} />
                    </button>
                  </span>
                  <span className="hf-earn-stat-value">{formatApy(selectedVault.analytics.apy.base)}</span>
                  {apyTip === 'base' && (
                    <p className="hf-apy-tip-text">The core yield from the vault's lending or strategy — e.g. interest paid by borrowers. This is the stable, sustainable part of your return.</p>
                  )}
                </div>
                <div className="hf-earn-stat">
                  <span className="hf-earn-stat-label">
                    Reward APY
                    <button className="hf-apy-tip-btn" onClick={() => setApyTip(apyTip === 'reward' ? null : 'reward')}>
                      <Info size={11} />
                    </button>
                  </span>
                  <span className="hf-earn-stat-value">{formatApy(selectedVault.analytics.apy.reward)}</span>
                  {apyTip === 'reward' && (
                    <p className="hf-apy-tip-text">Extra yield from protocol token incentives (e.g. MORPHO, COMP, OP). Can be volatile — if the reward token price drops or the incentive program ends, this number may fall significantly.</p>
                  )}
                </div>
                <div className="hf-earn-stat">
                  <span className="hf-earn-stat-label">
                    30d APY
                    <button className="hf-apy-tip-btn" onClick={() => setApyTip(apyTip === '30d' ? null : '30d')}>
                      <Info size={11} />
                    </button>
                  </span>
                  <span className="hf-earn-stat-value">{formatApy(selectedVault.analytics.apy30d)}</span>
                  {apyTip === '30d' && (
                    <p className="hf-apy-tip-text">The actual average yield delivered over the last 30 days. Often the most reliable number — it reflects real past performance, not a forward-looking estimate.</p>
                  )}
                </div>
              </div>

              <div className="hf-earn-tags">
                {selectedVault.tags.map((tag) => (
                  <span key={tag} className="hf-earn-tag">{tag}</span>
                ))}
              </div>

              {/* Deposit input */}
              <div className="hf-earn-deposit-section">
                <div className="hf-earn-deposit-label-row">
                  <label className="hf-earn-deposit-label">
                    Deposit {tokenSymbol}
                  </label>
                  {activeWalletAddress && (
                    <div className="hf-earn-deposit-balance">
                      {balanceLoading ? (
                        <span className="hf-skeleton hf-balance-skeleton" aria-hidden="true">&nbsp;</span>
                      ) : vaultTokenBalance != null ? (
                        <>
                          <span className="hf-earn-balance-text">
                            {formatUnits(vaultTokenBalance, selectedVault!.underlyingTokens[0].decimals, 4)} {tokenSymbol}
                          </span>
                          <button
                            type="button"
                            className="hf-pct-btn"
                            onClick={() => {
                              const decimals = selectedVault!.underlyingTokens[0].decimals;
                              setInputAmount(formatUnits(vaultTokenBalance / 2n, decimals, decimals));
                            }}
                          >50%</button>
                          <button
                            type="button"
                            className="hf-pct-btn"
                            onClick={() => {
                              const decimals = selectedVault!.underlyingTokens[0].decimals;
                              setInputAmount(formatUnits(vaultTokenBalance, decimals, decimals));
                            }}
                          >MAX</button>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
                <div className="hf-earn-deposit-input-wrap">
                  <input
                    className="hf-amount-input"
                    value={inputAmount}
                    onChange={(e) => setInputAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.0"
                    disabled={earnAction.loading || earnAction.quoting}
                  />
                  <span className="hf-earn-deposit-token">{tokenSymbol}</span>
                </div>

                {/* Insufficient balance warning */}
                {isInsufficient && selectedVault && (() => {
                  const chainKey = CHAIN_ID_TO_KEY[selectedVault.chainId];
                  const chain = chainKey ? CHAINS.find((c) => c.key === chainKey) : null;
                  const isSwapSupported = chain?.tokens.some((t) => t.symbol === tokenSymbol);

                  return (
                    <p className="hf-earn-insufficient">
                      <span>Insufficient {tokenSymbol} balance.</span>
                      {isSwapSupported && onGetMore && chainKey && (
                        <button
                          type="button"
                          className="hf-earn-getmore-link"
                          onClick={() => {
                            closeModal();
                            onGetMore(chainKey, tokenSymbol);
                          }}
                        >
                          Get more →
                        </button>
                      )}
                    </p>
                  );
                })()}

                {earnAction.stage === 'done' ? (
                  <div className="hf-earn-success">
                    <CheckCircle2 size={18} />
                    <span>Deposit successful!</span>
                    {earnAction.txHash && (
                      <a
                        href={getExplorerUrl(modalChainId, earnAction.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hf-earn-tx-link"
                      >
                        View tx <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                ) : (
                  <button
                    className="hf-btn hf-btn-primary hf-btn-wide"
                    onClick={handleDeposit}
                    disabled={
                      !inputAmount ||
                      !activeWalletAddress ||
                      isInsufficient ||
                      earnAction.quoting ||
                      earnAction.loading
                    }
                  >
                    {earnAction.quoting ? (
                      <><Loader2 size={14} className="hf-spin" /> Preparing deposit…</>
                    ) : earnAction.stage === 'approving' ? (
                      <><Loader2 size={14} className="hf-spin" /> Approving…</>
                    ) : earnAction.stage === 'executing' ? (
                      <><Loader2 size={14} className="hf-spin" /> Depositing…</>
                    ) : earnAction.stage === 'confirming' ? (
                      <><Loader2 size={14} className="hf-spin" /> Confirming…</>
                    ) : !activeWalletAddress ? (
                      <>Connect wallet</>
                    ) : (
                      <><Zap size={14} /> Deposit</>
                    )}
                  </button>
                )}

                {earnAction.error && (
                  <p className="hf-note hf-note-error">{earnAction.error}</p>
                )}
              </div>

              <a
                href={selectedVault.protocol.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hf-earn-protocol-link"
              >
                Manage on {protocolLabel(selectedVault.protocol.name)} <ExternalLink size={11} />
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div className="hf-earn-header">
        <h3 className="hf-swap-title">Earn. <span>While You Sleep</span></h3>
        <div className="hf-earn-powered">
          Powered by
          <img src="/providers/lifi.png" alt="LI.FI" className="hf-earn-powered-logo" />
        </div>
      </div>

      {/* ── Sub-tabs ── */}
      <div className="hf-earn-subtabs">
        <button
          className={`hf-earn-subtab ${subTab === 'vaults' ? 'hf-earn-subtab-active' : ''}`}
          onClick={() => setSubTab('vaults')}
        >
          <Wallet size={13} /> Explore Vaults
        </button>
        <button
          className={`hf-earn-subtab ${subTab === 'positions' ? 'hf-earn-subtab-active' : ''}`}
          onClick={() => setSubTab('positions')}
        >
          <ArrowUpFromLine size={13} /> Your Positions
          {lifiPositions.positions.length > 0 && (
            <span className="hf-earn-subtab-badge">{lifiPositions.positions.length}</span>
          )}
        </button>
        {activeWalletAddress && (
          <button
            className="hf-earn-redo-prefs"
            onClick={() => {
              localStorage.removeItem(onboardingKey(activeWalletAddress));
              prefsChecked.current = false;
              setShowOnboarding(true);
            }}
            title="Redo your risk preferences"
          >
            <RefreshCw size={12} /> Redo preferences
          </button>
        )}
      </div>

      {/* ══════════ VAULTS TAB ══════════ */}
      {subTab === 'vaults' && (
        <>
          <div className="hf-earn-filters">
            <FilterDropdown
              label="All Chains"
              options={chainOptions}
              value={filters.chainId != null ? String(filters.chainId) : null}
              onChange={(v) => updateFilters({ chainId: v != null ? Number(v) : null })}
            />
            <FilterDropdown
              label="All Protocols"
              options={protocolOptions}
              value={filters.protocol}
              onChange={(v) => updateFilters({ protocol: v })}
            />
            <FilterDropdown
              label="All Assets"
              options={assetOptions}
              value={filters.asset}
              onChange={(v) => updateFilters({ asset: v })}
            />
            <button
              className={`hf-earn-filter-btn ${filters.stablecoinOnly ? 'hf-earn-filter-btn-active' : ''}`}
              onClick={() => updateFilters({ stablecoinOnly: !filters.stablecoinOnly })}
            >
              <FilterIconStack icons={['/token-icons/usdc.svg', '/token-icons/usdt.svg', '/token-icons/dai.svg']} /> Stablecoins
            </button>
            <button
              className={`hf-earn-filter-btn ${filters.sortBy === 'apy' ? 'hf-earn-filter-btn-active' : ''}`}
              onClick={() => updateFilters({ sortBy: filters.sortBy === 'apy' ? 'tvl' : 'apy' })}
            >
              <TrendingUp size={12} /> {filters.sortBy === 'apy' ? 'Top APY' : 'Top TVL'}
            </button>
            {(filters.chainId || filters.protocol || filters.asset || filters.stablecoinOnly || filters.search || filters.sortBy !== 'apy') && (
              <button
                className="hf-earn-clear-filters"
                onClick={() => updateFilters({ chainId: null, protocol: null, asset: null, stablecoinOnly: false, search: '', sortBy: 'apy' })}
              >
                <X size={11} /> Clear
              </button>
            )}
            <div className="hf-earn-search">
              <Search size={13} />
              <input
                placeholder="Search vaults..."
                value={filters.search}
                onChange={(e) => updateFilters({ search: e.target.value })}
              />
            </div>
            <div className="hf-earn-info-tip">
              <Info size={13} />
              <span className="hf-earn-info-tooltip">
                High APR values are subject to fluctuate. Please do your own due diligence before depositing.
              </span>
            </div>
          </div>

          <div className="hf-earn-count">
            {loading && vaults.length === 0 ? (
              <span>Loading vaults…</span>
            ) : (
              <span>{vaults.length} vault{vaults.length !== 1 ? 's' : ''} found{allCount > 0 ? ` (${allCount} total)` : ''}</span>
            )}
          </div>

          {error && <p className="hf-note hf-note-error">{error}</p>}

          <div className="hf-earn-list">
            {loading && vaults.length === 0 ? (
              <div className="hf-earn-loading">
                <Loader2 size={24} className="hf-spin" />
                <p>Discovering best yields…</p>
              </div>
            ) : vaults.length === 0 ? (
              <div className="hf-earn-empty">
                <Wallet size={32} />
                <p>No vaults found matching your filters.</p>
              </div>
            ) : (() => {
              const featured = vaults.filter((v) => getTokenIcon(v.underlyingTokens?.[0]?.symbol ?? v.name));
              const more = vaults.filter((v) => !getTokenIcon(v.underlyingTokens?.[0]?.symbol ?? v.name));

              const renderVault = (vault: EarnVault) => {
                const icon = getTokenIcon(vault.underlyingTokens?.[0]?.symbol ?? vault.name);
                const protoIcon = getProtocolIcon(vault.protocol.name);
                const baseApy = vault.analytics.apy.base;
                const rewardApy = vault.analytics.apy.reward;
                const apy7d = vault.analytics.apy7d;
                const isStable = vault.tags?.includes('stablecoin');

                return (
                <button
                  key={vault.slug}
                  className="hf-earn-vault-card"
                  onClick={() => openVaultModal(vault)}
                >
                  {/* Row 1: Identity */}
                  <div className="hf-earn-vault-card-top">
                    <div className="hf-earn-vault-card-identity">
                      {icon && (
                        <span className="hf-earn-vault-card-icon-wrap">
                          <img src={icon} alt="" className="hf-earn-vault-card-icon" />
                          {protoIcon && <img src={protoIcon} alt="" className="hf-earn-vault-card-proto-badge" />}
                        </span>
                      )}
                      <div>
                        <span className="hf-earn-vault-card-name">{vault.name}</span>
                        <span className="hf-earn-vault-card-protocol">{protocolLabel(vault.protocol.name)}</span>
                      </div>
                    </div>
                    <div className="hf-earn-vault-card-tags">
                      {isStable && <span className="hf-earn-vault-tag hf-earn-vault-tag-stable">Stablecoin</span>}
                      <span className="hf-earn-vault-tag">{vault.network}</span>
                    </div>
                  </div>

                  {/* Row 2: Metrics */}
                  <div className="hf-earn-vault-card-metrics">
                    <div className="hf-earn-vault-card-stat hf-earn-vault-card-stat-apy">
                      <span className="hf-earn-vault-card-stat-value">{formatApy(vault.analytics.apy.total)}</span>
                      <span className="hf-earn-vault-card-stat-label">APY</span>
                    </div>
                    <div className="hf-earn-vault-card-stat">
                      <span className="hf-earn-vault-card-stat-value">{formatTvl(vault.analytics.tvl.usd)}</span>
                      <span className="hf-earn-vault-card-stat-label">TVL</span>
                    </div>
                    {baseApy != null && (
                      <div className="hf-earn-vault-card-stat">
                        <span className="hf-earn-vault-card-stat-value">{formatApy(baseApy)}</span>
                        <span className="hf-earn-vault-card-stat-label">Base</span>
                      </div>
                    )}
                    {rewardApy != null && rewardApy > 0 && (
                      <div className="hf-earn-vault-card-stat">
                        <span className="hf-earn-vault-card-stat-value hf-earn-vault-card-stat-reward">+{formatApy(rewardApy)}</span>
                        <span className="hf-earn-vault-card-stat-label">Reward</span>
                      </div>
                    )}
                    {apy7d != null && (
                      <div className="hf-earn-vault-card-stat">
                        <span className="hf-earn-vault-card-stat-value">{formatApy(apy7d)}</span>
                        <span className="hf-earn-vault-card-stat-label">7d Avg</span>
                      </div>
                    )}
                    <div className="hf-earn-vault-card-tokens">
                      {vault.underlyingTokens.map((t) => (
                        <span key={t.address} className="hf-earn-token-badge">{t.symbol}</span>
                      ))}
                    </div>
                  </div>
                </button>
                );
              };

              return (
              <>
                {featured.map(renderVault)}

                {more.length > 0 && (
                  <>
                    <button
                      className="hf-earn-more-toggle"
                      onClick={() => setShowMoreVaults((p) => !p)}
                    >
                      <ChevronDown size={13} className={showMoreVaults ? 'hf-earn-more-chevron-open' : ''} />
                      {showMoreVaults ? 'Hide' : 'More Vaults'} ({more.length})
                    </button>
                    {showMoreVaults && more.map(renderVault)}
                  </>
                )}

                {hasMore && (
                  <button className="hf-earn-load-more" onClick={loadMore} disabled={loading}>
                    {loading ? <><Loader2 size={14} className="hf-spin" /> Loading…</> : 'Load more vaults'}
                  </button>
                )}
              </>
              );
            })()}
          </div>
        </>
      )}

      {/* ══════════ POSITIONS TAB ══════════ */}
      {subTab === 'positions' && (
        <div className="hf-earn-positions">
          {!activeWalletAddress ? (
            <div className="hf-earn-empty">
              <Wallet size={32} />
              <p>Connect your wallet to view positions.</p>
            </div>
          ) : (
            <>
              {/* ── Live Positions (LI.FI) ── */}
              <div className="hf-earn-positions-section">
                <div className="hf-earn-positions-section-header">
                  <span className="hf-earn-positions-section-title">Your Deposits</span>
                  <button className="hf-earn-refresh-btn" onClick={() => lifiPositions.refresh()} disabled={lifiPositions.loading}>
                    <RefreshCw size={13} className={lifiPositions.loading ? 'hf-spin' : ''} />
                  </button>
                </div>
                {lifiPositions.loading ? (
                  <div className="hf-earn-loading" style={{ padding: '1.5rem' }}>
                    <Loader2 size={20} className="hf-spin" />
                    <p>Fetching live positions…</p>
                  </div>
                ) : lifiPositions.error ? (
                  <p className="hf-note hf-note-error">{lifiPositions.error}</p>
                ) : lifiPositions.positions.length === 0 ? (
                  <div className="hf-earn-empty" style={{ padding: '1.5rem' }}>
                    <ArrowDownToLine size={24} />
                    <p>No active positions found on-chain.</p>
                  </div>
                ) : (() => {
                  // Show the most recent HopFast deposit as a syncing ghost row
                  // if it was made within the last 2 hours (LI.FI takes ~1hr to sync)
                  const TWO_HOURS = 2 * 60 * 60 * 1000;
                  const latestDeposit = portfolio.positions.length > 0
                    ? [...portfolio.positions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
                    : null;
                  const alreadySynced = latestDeposit && lifiPositions.positions.some(
                    (p) => p.protocolName === latestDeposit.protocolName
                      && p.asset.symbol.toUpperCase() === latestDeposit.tokenSymbol.toUpperCase()
                  );
                  const isSyncing = latestDeposit
                    && !alreadySynced
                    && (Date.now() - new Date(latestDeposit.createdAt).getTime()) < TWO_HOURS;

                  return (
                  <div className="hf-earn-list">
                    {lifiPositions.positions.map((pos, i) => {
                      const icon = getTokenIcon(pos.asset.symbol);
                      const protoIcon = getProtocolIcon(pos.protocolName);
                      const balUsd = parseFloat(pos.balanceUsd);
                      return (
                        <div key={i} className="hf-earn-vault-row hf-earn-position-row">
                          <div className="hf-earn-vault-main">
                            {icon ? (
                              <span className="hf-earn-vault-card-icon-wrap" style={{ width: 24, height: 24 }}>
                                <img src={icon} alt="" className="hf-earn-vault-icon" />
                                {protoIcon && <img src={protoIcon} alt="" className="hf-earn-vault-card-proto-badge" />}
                              </span>
                            ) : null}
                            <div className="hf-earn-vault-name-wrap">
                              <span className="hf-earn-vault-name">{pos.asset.symbol}</span>
                              <span className="hf-earn-vault-protocol">
                                {protocolLabel(pos.protocolName)} · {CHAIN_NAME[pos.chainId] ?? `Chain ${pos.chainId}`}
                              </span>
                            </div>
                          </div>
                          <div className="hf-earn-vault-metrics">
                            <div className="hf-earn-vault-apy">
                              <span className="hf-earn-vault-tvl-value">
                                {Number(pos.balanceNative).toFixed(4)} {pos.asset.symbol}
                              </span>
                              <span className="hf-earn-vault-tvl-label">
                                {balUsd > 0 ? `≈ $${balUsd.toFixed(2)}` : 'Live balance'}
                              </span>
                            </div>
                            {getProtocolUrl(pos.protocolName) && (
                              <a
                                href={getProtocolUrl(pos.protocolName)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hf-earn-position-link hf-earn-manage-link"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Manage <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Syncing ghost row for latest deposit */}
                    {isSyncing && latestDeposit && (
                      <div className="hf-earn-vault-row hf-earn-position-row hf-earn-position-syncing">
                        <div className="hf-earn-vault-main">
                          {(() => {
                            const icon = getTokenIcon(latestDeposit.tokenSymbol);
                            const protoIcon = getProtocolIcon(latestDeposit.protocolName);
                            return icon ? (
                              <span className="hf-earn-vault-card-icon-wrap" style={{ width: 24, height: 24 }}>
                                <img src={icon} alt="" className="hf-earn-vault-icon" />
                                {protoIcon && <img src={protoIcon} alt="" className="hf-earn-vault-card-proto-badge" />}
                              </span>
                            ) : null;
                          })()}
                          <div className="hf-earn-vault-name-wrap">
                            <span className="hf-earn-vault-name">{latestDeposit.tokenSymbol}</span>
                            <span className="hf-earn-vault-protocol">
                              {protocolLabel(latestDeposit.protocolName)} · {latestDeposit.network || CHAIN_NAME[latestDeposit.chainId] || `Chain ${latestDeposit.chainId}`}
                            </span>
                          </div>
                        </div>
                        <div className="hf-earn-vault-metrics">
                          <div className="hf-earn-vault-apy">
                            <span className="hf-earn-vault-tvl-value">{latestDeposit.amount} {latestDeposit.tokenSymbol}</span>
                            <span className="hf-earn-vault-tvl-label hf-earn-syncing-label">
                              <Loader2 size={10} className="hf-spin" /> Syncing. Takes an hour.
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })()}
              </div>

              {/* ── HopFast Tracked Deposits ── */}
              {portfolio.positions.length > 0 && (
                <div className="hf-earn-positions-section">
                  <button
                    className="hf-earn-positions-section-header hf-earn-positions-section-toggle"
                    onClick={() => setShowTrackedDeposits((p) => !p)}
                  >
                    <span className="hf-earn-positions-section-title">HopFast Tracked Deposits</span>
                    <ChevronDown size={13} className={showTrackedDeposits ? 'hf-earn-more-chevron-open' : ''} />
                  </button>

                  {showTrackedDeposits && (
                  <>
                  {/* Recorded balance notice */}
                  <div className="hf-earn-recorded-balance-notice">
                    <Info size={13} />
                    <span>
                      Balances here are based on recorded deposits and may be out of date.
                    </span>
                  </div>

                  <div className="hf-earn-list" style={{ opacity: 0.5 }}>
                    {portfolio.positions.map((pos) => (
                      <div key={pos._id} className="hf-earn-vault-row hf-earn-position-row">
                        <div className="hf-earn-vault-main">
                          {(() => { const icon = getTokenIcon(pos.tokenSymbol || pos.vaultName); return icon ? <img src={icon} alt="" className="hf-earn-vault-icon" /> : null; })()}
                          <div className="hf-earn-vault-name-wrap">
                            <span className="hf-earn-vault-name">{pos.vaultName || pos.tokenSymbol}</span>
                            <span className="hf-earn-vault-protocol">
                              {protocolLabel(pos.protocolName)} · {pos.network || CHAIN_NAME[pos.chainId] || `Chain ${pos.chainId}`}
                            </span>
                          </div>
                          <div className="hf-earn-vault-tokens">
                            <span className="hf-earn-token-badge">{pos.tokenSymbol}</span>
                          </div>
                        </div>
                        <div className="hf-earn-vault-metrics">
                          <div className="hf-earn-vault-apy">
                            <span className="hf-earn-vault-tvl-value">{pos.amount} {pos.tokenSymbol}</span>
                            <span className="hf-earn-vault-tvl-label">Deposited · {formatDate(pos.createdAt)}</span>
                          </div>
                          <div className="hf-earn-position-actions">
                            {pos.protocolUrl && (
                              <a href={pos.protocolUrl} target="_blank" rel="noopener noreferrer"
                                className="hf-earn-position-link" title={`Manage on ${protocolLabel(pos.protocolName)}`}
                                onClick={(e) => e.stopPropagation()}>
                                <ExternalLink size={13} />
                              </a>
                            )}
                            <a href={getExplorerUrl(pos.chainId, pos.txHash)} target="_blank" rel="noopener noreferrer"
                              className="hf-earn-position-link" title="View transaction"
                              onClick={(e) => e.stopPropagation()}>
                              <Search size={13} />
                            </a>
                            {confirmDelete === pos._id ? (
                              <span className="hf-earn-confirm-delete">
                                <button className="hf-earn-confirm-yes"
                                  onClick={(e) => { e.stopPropagation(); portfolio.removePosition(pos._id); setConfirmDelete(null); }}>
                                  Yes, remove
                                </button>
                                <button className="hf-earn-confirm-no"
                                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}>
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button className="hf-earn-delete-btn" title="Remove from portfolio"
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete(pos._id); }}>
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  </>
                  )}
                </div>
              )}

              {/* Empty state if nothing on either */}
              {lifiPositions.positions.length === 0 && portfolio.positions.length === 0 && !lifiPositions.loading && (
                <div className="hf-earn-empty">
                  <ArrowDownToLine size={32} />
                  <p>No positions yet.</p>
                  <button className="hf-earn-filter-btn hf-earn-filter-btn-active"
                    onClick={() => setSubTab('vaults')} style={{ marginTop: '0.5rem' }}>
                    Explore vaults to start earning
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}
