import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, FileText, Megaphone, X, Zap } from 'lucide-react';
import './WhatsNew.css';

// Bump this for a new update so previously dismissed announcements can return.
const DISMISSED_KEY = 'hopfast:whats-new:2026-10-relay';

export function WhatsNew({ onBridge, onPayAnyone, onInvoices }: {
  onBridge: () => void;
  onPayAnyone: () => void;
  onInvoices: () => void;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try { return window.localStorage.getItem(DISMISSED_KEY) === 'dismissed'; }
    catch { return false; }
  });
  const [open, setOpen] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !widgetRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  function dismiss() {
    try { window.localStorage.setItem(DISMISSED_KEY, 'dismissed'); } catch { /* Storage is optional. */ }
    setDismissed(true);
  }

  function explore(action: () => void) {
    setOpen(false);
    action();
  }

  if (dismissed || typeof document === 'undefined') return null;

  // Portal keeps the corner position independent of the landing page's motion.
  return createPortal(
    <div className="hf-whats-new" ref={widgetRef}>
      {open && (
        <section
          className="hf-whats-new-panel"
          id="hf-whats-new-panel"
          role="dialog"
          aria-labelledby="hf-whats-new-title"
        >
          <header className="hf-whats-new-header">
            <div>
              <h2 id="hf-whats-new-title">What’s new at Hopfast?</h2>
              <p>More ways to move USDC and get paid.</p>
            </div>
            <button
              type="button"
              ref={closeRef}
              className="hf-whats-new-icon-button"
              aria-label="Close updates"
              onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
            ><X size={17} aria-hidden="true" /></button>
          </header>
          <div className="hf-whats-new-list">
            <button className="hf-whats-new-item" type="button" onClick={() => explore(onBridge)}>
              <span className="hf-whats-new-item-icon">
                <img src="/providers/relay.png" alt="" />
              </span>
              <span className="hf-whats-new-item-copy">
                <strong>Relay joins the lineup</strong>
                <span>Compare Relay, LI.FI and Squid quotes for your next swap.</span>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <button className="hf-whats-new-item" type="button" onClick={() => explore(onInvoices)}>
              <span className="hf-whats-new-item-icon hf-whats-new-item-icon--invoice">
                <FileText size={20} aria-hidden="true" />
              </span>
              <span className="hf-whats-new-item-copy">
                <strong>Invoices for freelancers</strong>
                <span>Send an itemised invoice, share a link and collect USDC on Arc.</span>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <button className="hf-whats-new-item" type="button" onClick={() => explore(onPayAnyone)}>
              <span className="hf-whats-new-item-icon">
                <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26L22.827 21.75H16.17l-5.214-6.817-5.968 6.817H1.68l7.73-8.835L1.173 2.25H8l4.713 6.231zM17.083 19.77h1.833L7.005 4.126H5.038z" />
                </svg>
              </span>
              <span className="hf-whats-new-item-copy">
                <strong>Pay an X username</strong>
                <span>No wallet address upfront. Send USDC and share their claim link.</span>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <div className="hf-whats-new-item">
              <span className="hf-whats-new-item-icon"><Zap size={20} aria-hidden="true" /></span>
              <span className="hf-whats-new-item-copy">
                <strong>A smoother experience</strong>
                <span>Refined mobile layouts, clearer quote comparisons and loading feedback.</span>
              </span>
            </div>
          </div>
        </section>
      )}
      <div className="hf-whats-new-launcher">
        <button
          type="button"
          className="hf-whats-new-trigger"
          ref={triggerRef}
          aria-expanded={open}
          aria-controls={open ? 'hf-whats-new-panel' : undefined}
          aria-haspopup="dialog"
          onClick={() => setOpen(!open)}
        >
          <Megaphone size={18} aria-hidden="true" /> What’s new?
        </button>
        <button type="button" className="hf-whats-new-dismiss" aria-label="Dismiss What’s new updates" onClick={dismiss}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>, document.body
  );
}
