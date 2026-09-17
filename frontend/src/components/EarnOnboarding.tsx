import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { EarnPreference } from '../types';

interface Props {
  onComplete: (prefs: EarnPreference) => void;
  onSkip: () => void;
}

const variants = {
  enter: (d: number) => ({ x: d * 56, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d * -56, opacity: 0 }),
};
const transition = { duration: 0.22, ease: 'easeInOut' as const };

export function EarnOnboarding({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [prefs, setPrefs] = useState<Partial<EarnPreference>>({});

  function advance(patch: Partial<EarnPreference>) {
    const updated = { ...prefs, ...patch };
    setPrefs(updated);
    setDir(1);
    if (step === 2) {
      onComplete(updated as EarnPreference);
    } else {
      setStep((s) => s + 1);
    }
  }

  function back() {
    setDir(-1);
    setStep((s) => s - 1);
  }

  return (
    <div className="hf-onboarding-overlay" onClick={onSkip}>
      <div className="hf-onboarding-card" onClick={(e) => e.stopPropagation()}>

        {/* Progress dots */}
        <div className="hf-onboarding-dots">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`hf-onboarding-dot ${
                i === step ? 'active' : i < step ? 'done' : ''
              }`}
            />
          ))}
        </div>

        <AnimatePresence custom={dir} mode="wait">
          <motion.div
            key={step}
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
            className="hf-onboarding-step"
          >
            {step === 0 && (
              <>
                <p className="hf-onboarding-step-label">1 of 3</p>
                <h3 className="hf-onboarding-q">What's your earning style?</h3>
                <p className="hf-onboarding-sub">This helps us surface the most relevant vaults for you.</p>
                <div className="hf-onboarding-choices">
                  <button
                    className="hf-onboarding-choice"
                    onClick={() => advance({ riskAppetite: 'high' })}
                  >
                    <span className="hf-onboarding-choice-icon">🚀</span>
                    <div>
                      <p className="hf-onboarding-choice-title">Chase the yield</p>
                      <p className="hf-onboarding-choice-desc">I want the highest APY available and I understand the risks.</p>
                    </div>
                  </button>
                  <button
                    className="hf-onboarding-choice"
                    onClick={() => advance({ riskAppetite: 'safe' })}
                  >
                    <span className="hf-onboarding-choice-icon">🛡️</span>
                    <div>
                      <p className="hf-onboarding-choice-title">Safe and steady</p>
                      <p className="hf-onboarding-choice-desc">I prefer deep liquidity and predictable returns over chasing numbers.</p>
                    </div>
                  </button>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <p className="hf-onboarding-step-label">2 of 3</p>
                <h3 className="hf-onboarding-q">What would you like to deposit?</h3>
                <p className="hf-onboarding-sub">We'll filter vaults to match your preferred asset.</p>
                <div className="hf-onboarding-assets">
                  {(
                    [
                      { value: 'stablecoins', label: 'Stablecoins', icon: '/token-icons/usdc.svg' },
                      { value: 'ETH_FAMILY',  label: 'ETH',         icon: '/token-icons/eth.svg'  },
                      { value: 'BTC_FAMILY',  label: 'BTC',         icon: '/token-icons/wbtc.png' },
                      { value: 'DAI',         label: 'DAI',         icon: '/token-icons/dai.svg'  },
                    ] as const
                  ).map(({ value, label, icon }) => (
                    <button
                      key={value}
                      className="hf-onboarding-asset-btn"
                      onClick={() => advance({ preferredAsset: value })}
                    >
                      <img src={icon} alt={label} className="hf-onboarding-asset-icon" />
                      <span>{label}</span>
                    </button>
                  ))}
                  <button
                    className="hf-onboarding-asset-btn hf-onboarding-asset-any"
                    onClick={() => advance({ preferredAsset: 'any' })}
                  >
                    <span className="hf-onboarding-asset-any-icon">✦</span>
                    <span>No preference</span>
                  </button>
                </div>
                <button className="hf-onboarding-back" onClick={back}>← Back</button>
              </>
            )}

            {step === 2 && (
              <>
                <p className="hf-onboarding-step-label">3 of 3</p>
                <h3 className="hf-onboarding-q">How deep are you in DeFi?</h3>
                <p className="hf-onboarding-sub">We'll adjust recommendations to match your experience.</p>
                <div className="hf-onboarding-choices">
                  <button
                    className="hf-onboarding-choice"
                    onClick={() => advance({ experienceLevel: 'beginner' })}
                  >
                    <span className="hf-onboarding-choice-icon">🌱</span>
                    <div>
                      <p className="hf-onboarding-choice-title">Just getting started</p>
                      <p className="hf-onboarding-choice-desc">I'm new to yield vaults — show me the safest options first.</p>
                    </div>
                  </button>
                  <button
                    className="hf-onboarding-choice"
                    onClick={() => advance({ experienceLevel: 'intermediate' })}
                  >
                    <span className="hf-onboarding-choice-icon">⚡</span>
                    <div>
                      <p className="hf-onboarding-choice-title">Finding my footing</p>
                      <p className="hf-onboarding-choice-desc">I know how DeFi works and I'm comfortable exploring.</p>
                    </div>
                  </button>
                  <button
                    className="hf-onboarding-choice"
                    onClick={() => advance({ experienceLevel: 'advanced' })}
                  >
                    <span className="hf-onboarding-choice-icon">🧠</span>
                    <div>
                      <p className="hf-onboarding-choice-title">Living in the docs</p>
                      <p className="hf-onboarding-choice-desc">I eat yield strategies for breakfast. Show me everything.</p>
                    </div>
                  </button>
                </div>
                <button className="hf-onboarding-back" onClick={back}>← Back</button>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <button className="hf-onboarding-skip" onClick={onSkip}>Skip for now</button>
      </div>
    </div>
  );
}
