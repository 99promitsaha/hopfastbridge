import test from 'node:test';
import assert from 'node:assert/strict';
import { compareQuotes, getBestQuote } from '../src/lib/quoteRanking';
import type { QuoteResult } from '../src/services/quoteService';

function quote(provider: QuoteResult['provider'], amount: string, feeUsd: number): QuoteResult {
  return { id: provider, provider, destinationAmount: amount, feeUsd,
    route: provider, hopfastFeeUsd: null, feePercent: 0, etaSeconds: 15 };
}

test('screenshot amounts mean received USDC: 0.185 beats 0.178', () => {
  const lifi = quote('lifi-api', '0.185', 0.02);
  const relay = quote('relay-api', '0.178', 0.01);
  assert.equal(getBestQuote([relay, lifi]), lifi);
  assert.deepEqual([relay, lifi].sort(compareQuotes), [lifi, relay]);
});

test('Relay wins when its destination output is higher, regardless of fee labels', () => {
  const lifi = quote('lifi-api', '0.185', 0.01);
  const relay = quote('relay-api', '0.19', 0.02);
  assert.equal(getBestQuote([lifi, relay]), relay);
});

test('equal outputs use estimated fees, with stable ties and no missing-fee advantage', () => {
  const lifi = quote('lifi-api', '1.00', 0.01);
  const relay = quote('relay-api', '1', 0.02);
  assert.equal(getBestQuote([relay, lifi]), lifi);
  for (const fee of [NaN, Infinity, -1]) {
    assert.equal(getBestQuote([quote('relay-api', '1', fee), lifi]), lifi);
  }
  assert.equal(compareQuotes(lifi, lifi), 0);
  assert.equal(compareQuotes(lifi, { ...relay, feeUsd: lifi.feeUsd }), 0);
  assert.equal(getBestQuote([]), null);
});

test('ranking retains tiny token amounts and precision beyond floating point', () => {
  for (const [lower, higher] of [
    ['0.000000000000000001', '0.000000000000000002'],
    ['9007199254740992.000000000000000001', '9007199254740992.000000000000000002'],
    ['0.100000000000000001', '0.100000000000000002'],
  ]) {
    const lifi = quote('lifi-api', lower, 0);
    const relay = quote('relay-api', higher, 1);
    assert.equal(getBestQuote([lifi, relay]), relay);
  }
});
