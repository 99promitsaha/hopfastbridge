import { useEffect, useState } from 'react';

export const ERROR_DISMISS_MS = 7000;

/** Only dismiss the notice, never the error state used by payment safeguards. */
export function TransientError({ message, className, as: Tag = 'p' }: {
  message: string;
  className?: string;
  as?: 'p' | 'span' | 'small';
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    if (!message) return;
    const timer = window.setTimeout(() => setVisible(false), ERROR_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message || !visible) return null;
  return <Tag className={className} role="alert">{message}</Tag>;
}
