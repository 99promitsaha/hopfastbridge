export interface UserTransactionRecord {
  _id?: string;
  userAddress: string;
  txHash: string;
  quoteId?: string;
  provider?: string;
  fromChain: string;
  toChain: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  amount: string;
  status?: string;
  metadata?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_HOPFAST_API_BASE_URL;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.replace(/\/$/, '');
  }

  if (
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    return 'http://localhost:8080/api';
  }

  return '';
}

export async function fetchUserTransactionHistory(
  userAddress: string,
  limit = 50
): Promise<UserTransactionRecord[]> {
  const base = resolveApiBaseUrl();
  if (!base) {
    throw new Error('Backend API URL unavailable.');
  }

  const params = new URLSearchParams({
    userAddress,
    limit: String(limit)
  });

  const response = await fetch(`${base}/transactions?${params.toString()}`, {
    method: 'GET'
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Failed to fetch transaction history (${response.status}).`);
  }

  const payload = (await response.json()) as {
    records?: UserTransactionRecord[];
  };

  return payload.records ?? [];
}
