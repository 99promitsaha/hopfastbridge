import { useEffect, useState } from 'react';
import { getTokenPrices } from '../services/priceService';

export function usePrices(fromTokenSymbol: string, toTokenSymbol: string) {
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    getTokenPrices().then(setPrices).catch(() => {});
  }, [fromTokenSymbol, toTokenSymbol]);

  useEffect(() => {
    const interval = setInterval(() => {
      getTokenPrices().then(setPrices).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  return prices;
}
