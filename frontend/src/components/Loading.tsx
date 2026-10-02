export function LoadingSpinner({ size = 16 }: { size?: number }) {
  return <span className="hf-loading-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function LoadingState({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return <div className="hf-loading-state" role="status" aria-live="polite" aria-busy="true">
    <p><LoadingSpinner /> {label}</p>
    <div className="hf-loading-skeletons" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => <div className="hf-loading-skeleton" key={index}><span /><span /></div>)}
    </div>
  </div>;
}
