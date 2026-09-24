import test from 'node:test';
import assert from 'node:assert/strict';
process.env.LIFI_FEE = '0.0005';
process.env.LIFI_INTEGRATOR = 'test-integration';
const { requestLiFiQuote } = await import('../dist/lib/lifiClient.js');
const { env } = await import('../dist/config/env.js');
const { quotedHopfastFeeUsd } = await import('../dist/lib/hopfastFee.js');
const address = '0x' + '1'.repeat(40);
const routedCalldata = `0x12345678${address.slice(2).padStart(64, '0')}`;
const commission = {
  amountUSD: '0.0122',
  percentage: '0.0005',
  included: true,
};
const quote = {
  estimate: {
    toAmount: '100',
    toAmountMin: '90',
    fromAmountUSD: '24.3031',
    feeCosts: [commission, { amountUSD: '1' }],
    gasCosts: [{ amountUSD: '0.25' }],
  },
  includedSteps: [
    {
      type: 'protocol',
      tool: 'feeCollection',
      estimate: { feeCosts: [commission] },
    },
  ],
  transactionRequest: { from: address, to: address, data: routedCalldata, value: '0x64' },
};
test('five basis points is sent once; commission is displayed without increasing costs or changing transaction/output', async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    const params = new URL(url).searchParams;
    assert.deepEqual(params.getAll('fee'), ['0.0005']);
    assert.equal(params.get('integrator'), 'test-integration');
    return new Response(JSON.stringify(quote));
  };
  try {
    const result = await requestLiFiQuote({
      srcChainKey: 'ethereum',
      dstChainKey: 'base',
      srcTokenAddress: address,
      dstTokenAddress: address,
      srcWalletAddress: address,
      dstWalletAddress: address,
      amount: '100',
    });
    assert.equal(result.quotes[0].hopfastFeeUsd, '0.0122');
    assert.equal(result.quotes[0].feeUsd, '1.262200');
    assert.equal(result.quotes[0].dstAmount, '100');
    assert.equal(result.quotes[0].dstAmountMin, '90');
    assert.deepEqual(
      result.quotes[0].userSteps[0].transaction,
      quote.transactionRequest
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = original;
  }
});
test('commission classification uses the fee-collection step, not free-text fee names', () => {
  assert.equal(quotedHopfastFeeUsd(quote, 0.0005), '0.0122');
  assert.equal(
    quotedHopfastFeeUsd(
      {
        includedSteps: [
          {
            type: 'cross',
            tool: 'bridge',
            estimate: { feeCosts: [{ ...commission, name: 'Integrator Fee' }] },
          },
        ],
      },
      0.0005
    ),
    null
  );
  assert.equal(
    quotedHopfastFeeUsd(
      {
        includedSteps: [
          {
            type: 'protocol',
            tool: 'feeCollection',
            estimate: { feeCosts: [{ ...commission, included: false }] },
          },
        ],
      },
      0.0005
    ),
    null
  );
  assert.equal(quotedHopfastFeeUsd({}, 0), '0');
});
test('missing integrator prevents fee-bearing requests', async () => {
  const saved = env.LIFI_INTEGRATOR;
  env.LIFI_INTEGRATOR = undefined;
  try {
    await assert.rejects(requestLiFiQuote({}), /Missing LIFI_INTEGRATOR/);
  } finally {
    env.LIFI_INTEGRATOR = saved;
  }
});

test('portal UUIDs are rejected before requesting a fee-bearing quote', async () => {
  const saved = env.LIFI_INTEGRATOR;
  env.LIFI_INTEGRATOR = 'c640a044-a109-4387-ade0-6752bd0bf110';
  try {
    await assert.rejects(
      requestLiFiQuote({}),
      /integration string.*maximum 23/
    );
  } finally {
    env.LIFI_INTEGRATOR = saved;
  }
});

test('combined LI.FI platform and Hopfast fees display only the five-bps share', () => {
  const combined = {
    includedSteps: [
      {
        type: 'protocol',
        tool: 'feeCollection',
        estimate: {
          feeCosts: [
            { amountUSD: '0.0729', percentage: '0.0030', included: true },
          ],
        },
      },
    ],
  };
  assert.equal(quotedHopfastFeeUsd(combined, 0.0005), '0.01215');
  combined.includedSteps[0].estimate.feeCosts[0].percentage = '0.0025';
  assert.equal(quotedHopfastFeeUsd(combined, 0.0005), null);
});

test('Arc quotes retain six-decimal USDC amounts and use mainnet 5042', async () => {
  const original = global.fetch;
  const arcUsdc = '0x3600000000000000000000000000000000000000';
  global.fetch = async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('fromChain'), '8453');
    assert.equal(params.get('toChain'), '5042');
    assert.equal(params.get('toToken'), arcUsdc);
    assert.equal(params.get('fromAmount'), '100000000');
    return new Response(
      JSON.stringify({
        ...quote,
        estimate: {
          ...quote.estimate,
          toAmount: '99700000',
          toAmountMin: '99600000',
        },
      })
    );
  };
  try {
    const result = await requestLiFiQuote({
      srcChainKey: 'base',
      dstChainKey: 'arc',
      srcTokenAddress: address,
      dstTokenAddress: arcUsdc,
      srcWalletAddress: address,
      amount: '100000000',
    });
    assert.equal(result.quotes[0].dstAmount, '99700000');
    assert.equal(result.quotes[0].dstAmountMin, '99600000');
  } finally {
    global.fetch = original;
  }
});
test('Squid Arc routes are forwarded when the live Squid registry lists Arc', async () => {
  const { requestSquidQuote } = await import('../dist/lib/squidClient.js');
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).endsWith('/v2/chains')) {
      return new Response(JSON.stringify({ chains: [{ chainId: '5042' }] }));
    }
    const body = JSON.parse(options.body);
    assert.equal(body.fromChain, '8453');
    assert.equal(body.toChain, '5042');
    return new Response(
      JSON.stringify({
        route: {
          quoteId: 'squid-arc',
          estimate: { toAmount: '99000000', toAmountMin: '98000000' },
          transactionRequest: { target: address, data: routedCalldata },
        },
      })
    );
  };
  try {
    const result = await requestSquidQuote({
      srcChainKey: 'base',
      dstChainKey: 'arc',
      srcTokenAddress: address,
      dstTokenAddress: address,
      srcWalletAddress: address,
      amount: '100000000',
    });
    assert.equal(result.quotes[0].id, 'squid-arc');
  } finally {
    global.fetch = original;
  }
});
test('explicit integrator split gives its precise quote valuation rather than a share of rounded platform USD', () => {
  const fee = {
    amountUSD: '0.2989',
    percentage: '0.0030',
    included: true,
    feeSplit: { integratorFee: '50000' },
    token: { decimals: 6, priceUSD: '0.9964693258' },
  };
  assert.equal(
    quotedHopfastFeeUsd(
      {
        includedSteps: [
          {
            type: 'protocol',
            tool: 'feeCollection',
            estimate: { feeCosts: [fee] },
          },
        ],
      },
      0.0005
    ),
    '0.04982346629'
  );
});
