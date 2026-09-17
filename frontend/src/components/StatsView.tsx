import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { API_BASE_URL } from '../constants';

type Period = '7d' | '15d' | '30d';

interface StatsData {
  period: string;
  uniqueUsers: number;
  swapVolumeUsd: number;
  swapCount: number;
  protocolFeeUsd: number;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

const PERIOD_LABELS: Record<Period, string> = {
  '7d': 'Last 7 days',
  '15d': 'Last 15 days',
  '30d': 'Last 30 days',
};

interface Props {
  onBack: () => void;
}

export function StatsView({ onBack }: Props) {
  const [period, setPeriod] = useState<Period>('7d');
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`${API_BASE_URL}/stats?period=${period}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError('Failed to load stats.'); setLoading(false); });
  }, [period]);

  return (
    <motion.main
      key="stats"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="hf-content hf-stats-wrap"
    >
      <button className="hf-stats-close" onClick={onBack} aria-label="Close">✕</button>

      <div className="hf-stats-header">
        <div className="hf-stats-header-left">
          <p className="hf-kicker">Public Dashboard</p>
          <h2 className="hf-stats-title">Platform Stats</h2>
          <p className="hf-stats-range">{PERIOD_LABELS[period]}</p>
        </div>
        <div className="hf-stats-periods">
          {(['7d', '15d', '30d'] as Period[]).map((p) => (
            <button
              key={p}
              className={`hf-stats-period-btn ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p === '7d' ? '7D' : p === '15d' ? '15D' : '30D'}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="hf-stats-loading">Loading...</p>}
      {error && <p className="hf-stats-error">{error}</p>}

      {data && !loading && (
        <>
          <div className="hf-stats-grid">
            <div className="hf-stat-card">
              <p className="hf-stat-card-label">Unique Users</p>
              <p className="hf-stat-card-value">{data.uniqueUsers.toLocaleString()}</p>
            </div>
            <div className="hf-stat-card">
              <p className="hf-stat-card-label">Swap Volume</p>
              <p className="hf-stat-card-value">{formatUsd(data.swapVolumeUsd)}</p>
              <p className="hf-stat-card-sub">{data.swapCount.toLocaleString()} swaps</p>
            </div>
            <div className="hf-stat-card hf-stat-card-free">
              <p className="hf-stat-card-label">Protocol Fee</p>
              <p className="hf-stat-card-value">$0</p>
              <p className="hf-stat-card-free-badge">Zero. For now.</p>
            </div>
          </div>

          <p className="hf-stats-note">
            Data reflects activity recorded through HopFast. Swap records are self-reported and are not independently verified platform volume.
          </p>
        </>
      )}
    </motion.main>
  );
}
