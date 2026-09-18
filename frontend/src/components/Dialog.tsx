import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Dialog({
  title,
  onClose,
  className = '',
  children,
  headerExtra,
}: {
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const root = document.getElementById('root');
    const wasInert = root?.hasAttribute('inert') ?? false;
    root?.setAttribute('inert', '');
    const panel = ref.current;
    const controls = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, a[href], [tabindex="0"]'
        ) ?? []
      );
    (
      panel?.querySelector<HTMLElement>('input') ??
      controls()[0] ??
      panel
    )?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (!items.length) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      if (!wasInert) root?.removeAttribute('inert');
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="hf-dropdown-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`hf-dropdown-panel ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="hf-dropdown-header">
          <h2>{title}</h2>
          <div className="hf-dialog-actions">
            {headerExtra}
            <button
              className="hf-dropdown-close"
              aria-label={`Close ${title.toLowerCase()}`}
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
