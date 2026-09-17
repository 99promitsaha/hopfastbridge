/**
 * HopFast API Client
 *
 * Thin wrapper around the HopFast REST API.
 * Configure HOPFAST_API_URL env var to point at your backend instance.
 * Defaults to http://localhost:8080 (local dev).
 */

export const HOPFAST_API_URL =
  process.env.HOPFAST_API_URL ?? 'http://localhost:8080';

export class HopFastApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HopFastApiError';
  }
}

export async function hopfastFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${HOPFAST_API_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new HopFastApiError(
      response.status,
      `HopFast API error (${response.status} ${path}): ${text}`,
    );
  }

  return response.json() as Promise<T>;
}
