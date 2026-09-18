import test from 'node:test';
import assert from 'node:assert/strict';
import { fundingAmounts } from '../src/lib/builderFunding';

test('envelopes deduct a 2.5% fee at deposit', () => {
  assert.deepEqual(fundingAmounts('25', 250), {
    amount: '24.375',
    fee: '0.625',
    total: '25',
  });
});
test('micro-grants deduct a 1.5% fee from the contribution', () => {
  assert.deepEqual(fundingAmounts('25', 150), {
    amount: '24.625',
    fee: '0.375',
    total: '25',
  });
  assert.deepEqual(fundingAmounts('500', 150), {
    amount: '492.5',
    fee: '7.5',
    total: '500',
  });
  assert.equal(fundingAmounts('0.000001', 150), null);
});
test('fees round to USDC precision without floating-point drift', () => {
  assert.equal(fundingAmounts('0.000001', 250), null);
  assert.deepEqual(fundingAmounts('0.000041', 250), {amount:'0.000039',fee:'0.000002',total:'0.000041'});
});
test('invalid, negative, zero and over-precision amounts cannot produce a fee preview', () => {
  for (const input of ['', '0', '-1', '1e2', 'abc', '0.0000001', '1000001'])
    assert.equal(fundingAmounts(input, 250), null);
});
