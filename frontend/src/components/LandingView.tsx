import { motion } from 'framer-motion';
import { Bot, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL, PROVIDER_META } from '../constants';

interface LandingViewProps {
  onHumanClick: () => void;
  onAgentClick: () => void;
}

function formatVolume(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

function useCountUp(target: number | null, duration = 1100): number | null {
  const [value, setValue] = useState<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (target === null) return;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

export function LandingView({ onHumanClick, onAgentClick }: LandingViewProps) {
  const [lifetimeVolume, setLifetimeVolume] = useState<number | null>(null);
  const displayVolume = useCountUp(lifetimeVolume);

  useEffect(() => {
    fetch(`${API_BASE_URL}/stats?period=all`)
      .then(r => r.json())
      .then(data => setLifetimeVolume(typeof data.swapVolumeUsd === 'number' ? data.swapVolumeUsd : null))
      .catch(() => {});
  }, []);

  return (
    <motion.main
      key="landing"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="hf-content"
    >
      {/* ── Hero ── */}
      <div className="hf-hero">
        <h1>
          Hop assets
          <br />
          <span>at light speed 🐰</span>
        </h1>
        <p className="hf-hero-sub">
          Cross-Chain Swaps. Agent-ready payments.
        </p>
      </div>

      {/* ── Role cards ── */}
      <div className="hf-role-list">
        <button className="hf-role-card" onClick={onHumanClick}>
          <div>
            <p className="hf-role-title">Human</p>
            <p className="hf-role-sub">Swap across chains. All in one hop 🐇</p>
          </div>
          <span className="hf-role-icon">
            <UserRound size={18} />
          </span>
        </button>

        <button className="hf-role-card hf-role-card-muted" onClick={onAgentClick}>
          <div>
            <p className="hf-role-title">Agent</p>
            <p className="hf-role-sub">Claude · GPT · Gemini · any AI workflow</p>
          </div>
          <span className="hf-role-icon hf-role-icon-muted">
            <Bot size={18} />
          </span>
        </button>
      </div>

      {/* ── Trust row ── */}
      <div className="hf-trust-row">
        <span className="hf-trust-logos">
          Powered By
          {PROVIDER_META.map(p => (
            <img key={p.key} src={p.logo} alt={p.label} className="hf-trust-logo" title={p.label} />
          ))}
        </span>
        <span className="hf-trust-sep">·</span>
        <span><span className="hf-trust-volume">{displayVolume != null ? formatVolume(displayVolume) : '—'}</span> in recorded swaps.</span>
      </div>
    </motion.main>
  );
}
