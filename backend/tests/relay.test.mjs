import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseAbi } from 'viem';
import express from 'express';
import {readFileSync} from 'node:fs';
process.env.NODE_ENV = 'test';
process.env.RELAY_SLIPPAGE_BPS = '50';
const { validateRelayQuote, relayRequestContext, requestRelayQuote, relayExecutionQuote, fetchRelayStatus, RELAY_DEPOSITORY } = await import('../dist/lib/relayClient.js');
const { relayOrderId } = await import('../dist/lib/relayOrder.js');
const { env } = await import('../dist/config/env.js');
const payer = '0x' + '1'.repeat(40), recipient = '0x' + '2'.repeat(40), attacker = '0x' + '3'.repeat(40);
const zero = '0x' + '0'.repeat(40), requestId = '0x' + 'a'.repeat(64), txHash = '0x' + 'b'.repeat(64);
const usdcBase = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', usdcArc = '0x3600000000000000000000000000000000000000';
const metadata = [
  {id:8453, vmType:'evm', depositEnabled:true, protocol:{v2:{chainId:'base',depository:RELAY_DEPOSITORY}}},
  {id:5042, vmType:'evm', depositEnabled:true, protocol:{v2:{chainId:'arc',depository:RELAY_DEPOSITORY}}},
];
const abi = parseAbi(['function depositNative(address depositor, bytes32 id)', 'function depositErc20(address depositor, address token, uint256 amount, bytes32 id)', 'function approve(address spender, uint256 amount)']);
const payload = {srcChainKey:'base',dstChainKey:'arc',srcTokenAddress:usdcBase,dstTokenAddress:usdcArc,srcWalletAddress:payer,dstWalletAddress:recipient,amount:'100000000'};
test('EVM-only order hash matches a real Relay quote and settlement-sdk 0.0.146 known vector',()=>{
  const vector=JSON.parse(readFileSync(new URL('./fixtures/relay-order-v1.json',import.meta.url),'utf8'));
  assert.equal(relayOrderId(vector.orderData),vector.orderId);
});
function commit(raw) {
  const order = raw.protocol.v2.orderData;
  const id = relayOrderId(order);
  raw.protocol.v2.orderId = id;
  const payment = order.inputs[0].payment;
  const native = payment.currency === zero;
  raw.steps.at(-1).items[0].data.data = encodeFunctionData({abi,functionName:native?'depositNative':'depositErc20',args:native?[payer,id]:[payer,payment.currency,BigInt(payment.amount),id]});
}
function fixture(native = false) {
  const now = Date.now();
  const deadline = Math.floor(now / 1000) + 600;
  const currency = native ? zero : usdcBase;
  const order = {version:'v1',solverChainId:'base',solver:attacker,salt:'0x'+'c'.repeat(64),inputs:[{payment:{chainId:'base',currency,amount:payload.amount,weight:'1'},refunds:[{chainId:'base',recipient:payer,currency,minimumAmount:'1',deadline,extraData:'0x'}]}],output:{chainId:'arc',payments:[{recipient,currency:usdcArc,expectedAmount:'99900000',minimumAmount:'99400500'}],deadline,calls:[],extraData:'0x'},fees:[]};
  const raw = {
    requestId,
    protocol:{v2:{orderId:requestId,orderData:order,paymentDetails:{chainId:'base',currency,amount:payload.amount,depository:RELAY_DEPOSITORY}}},
    steps:[{id:'deposit',kind:'transaction',requestId,items:[{data:{from:payer,chainId:8453,to:RELAY_DEPOSITORY,value:native?payload.amount:'0',data:'0x'}}]}],
    details:{sender:payer,recipient,currencyIn:{amount:payload.amount,amountUsd:'100',currency:{chainId:8453,address:currency}},currencyOut:{amount:'99900000',minimumAmount:'99400500',amountUsd:'99.9',currency:{chainId:5042,address:usdcArc}}},
    fees:{gas:{amountUsd:'0.01'},relayer:{amountUsd:'0.04'},app:{amount:'50000',amountUsd:'0.05'},relayerGas:{amountUsd:'0.01'},relayerService:{amountUsd:'0.03'}},
  };
  commit(raw);
  return {raw,now,context:relayRequestContext({...payload,srcTokenAddress:currency})};
}
test('verified ERC-20 and native deposits preserve exact input and output, count app/relayer fees once, and discard upstream gas overrides', () => {
  for (const native of [false,true]) {
    const {raw,now,context} = fixture(native);
    raw.steps[0].items[0].data.maxFeePerGas = '999999999999999999';
    raw.steps[0].items[0].data.gasLimit = '999999999';
    const q = validateRelayQuote(raw,context,metadata,now);
    assert.equal(q.dstAmount,'99900000');
    assert.equal(q.dstAmountMin,'99400500');
    assert.equal(q.feeUsd,'0.100000');
    assert.equal(q.hopfastFeeUsd,'0.05');
    assert.equal(q.transaction.value,native?payload.amount:'0');
    assert.equal(q.transaction.maxFeePerGas,undefined);
    assert.equal(q.transaction.gasLimit,undefined);
  }
});
const attacks = [
  ['recipient substitution',r=>{r.protocol.v2.orderData.output.payments[0].recipient=attacker;commit(r);}],
  ['wrapped destination token',r=>{r.protocol.v2.orderData.output.payments[0].currency=attacker;commit(r);}],
  ['wrong output chain',r=>{r.protocol.v2.orderData.output.chainId='base';commit(r);}],
  ['larger input amount',r=>{r.protocol.v2.orderData.inputs[0].payment.amount='200000000';commit(r);}],
  ['refund hijack',r=>{r.protocol.v2.orderData.inputs[0].refunds[0].recipient=attacker;commit(r);}],
  ['altered commitment',r=>{r.protocol.v2.orderId=requestId;}],
  ['arbitrary target',r=>{r.steps[0].items[0].data.to=attacker;}],
  ['wrong transaction chain',r=>{r.steps[0].items[0].data.chainId=5042;}],
  ['wrong transaction sender',r=>{r.steps[0].items[0].data.from=attacker;}],
  ['plain transfer',r=>{r.steps[0].items[0].data.data='0x12345678';}],
  ['extra native value',r=>{r.steps[0].items[0].data.value='1';}],
  ['stale order',r=>{r.protocol.v2.orderData.output.deadline=Math.floor(Date.now()/1000)-1;commit(r);}],
  ['excess slippage',r=>{r.protocol.v2.orderData.output.payments[0].minimumAmount='90000000';commit(r);}],
  ['destination call',r=>{r.protocol.v2.orderData.output.calls=['0x1234'];}],
  ['signature/permit',r=>{r.steps[0].kind='signature';}],
  ['missing markup',r=>{r.fees.app.amount='0';r.fees.app.amountUsd='0';}],
  ['extra markup',r=>{r.fees.app.amountUsd='0.1';}],
  ['fake displayed output',r=>{r.details.currencyOut.amount='1000000000';}],
  ['future unsupported order',r=>{r.protocol.v2.orderData.version='v2';}],
];
for (const [name,mutate] of attacks) test(`rejects ${name} even when attacker recomputes the order hash`,()=>{
  const {raw,now,context}=fixture(); mutate(raw);
  assert.throws(()=>validateRelayQuote(raw,context,metadata,now));
});
test('only exact-amount approvals to the pinned depository are accepted',()=>{
  const {raw,now,context}=fixture();
  const approval={id:'approve',kind:'transaction',items:[{data:{from:payer,to:usdcBase,value:'0',chainId:8453,data:encodeFunctionData({abi,functionName:'approve',args:[RELAY_DEPOSITORY,100000000n]})}}]};
  raw.steps.unshift(approval);
  assert.doesNotThrow(()=>validateRelayQuote(raw,context,metadata,now));
  for (const args of [[attacker,100000000n],[RELAY_DEPOSITORY,2n**256n-1n]]) {
    approval.items[0].data.data=encodeFunctionData({abi,functionName:'approve',args});
    assert.throws(()=>validateRelayQuote(raw,context,metadata,now));
  }
});
test('disabled chains and substituted metadata depositories fail closed',()=>{
  for (const mutation of [m=>{m[0].depositEnabled=false;},m=>{m[0].protocol.v2.depository=attacker;}]) {
    const {raw,now,context}=fixture(); const m=structuredClone(metadata); mutation(m);
    assert.throws(()=>validateRelayQuote(raw,context,m,now));
  }
});
test('zero wallet, invalid amounts and identical assets are rejected',()=>{
  for (const change of [{srcWalletAddress:zero},{dstWalletAddress:zero},{amount:'0'},{amount:'-1'},{amount:(2n**256n).toString()},{dstChainKey:'base',dstTokenAddress:usdcBase}]) assert.throws(()=>relayRequestContext({...payload,...change}));
});
test('backend pins fee/refund terms, issues a short-lived route-bound ticket, and cannot be overridden by callers',async()=>{
  const original=global.fetch, savedKey=env.RELAY_API_KEY;
  env.RELAY_API_KEY='fixture-server-key';
  let body;
  global.fetch=async(url,options)=>{
    assert.equal(options.headers['x-api-key'],'fixture-server-key');
    if (String(url).endsWith('/chains')) return new Response(JSON.stringify({chains:metadata}));
    body=JSON.parse(options.body);
    return new Response(JSON.stringify(fixture().raw));
  };
  try {
    const result=await requestRelayQuote({...payload,options:{appFees:[{recipient:attacker,fee:'100'}],recipient:attacker}});
    assert.deepEqual(body.appFees,[{recipient:env.RELAY_FEE_RECIPIENT,fee:'5'}]);
    assert.equal(body.refundTo,payer);
    assert.equal(body.recipient,recipient);
    assert.equal(body.slippageTolerance,'50');
    assert.equal(body.explicitDeposit,true);
    assert.equal(body.usePermit,false);
    assert.equal(body.disableOriginSwaps,true);
    const q=relayExecutionQuote(result.requestId,payload);
    assert.ok(q.expiresAt<=Date.now()+120000);
    assert.throws(()=>relayExecutionQuote(result.requestId,{...payload,dstWalletAddress:attacker}));
    assert.throws(()=>relayExecutionQuote(result.requestId,{...payload,amount:'200000000'}));
    q.expiresAt=Date.now()-1;
    assert.throws(()=>relayExecutionQuote(result.requestId,payload));
  } finally { global.fetch=original;env.RELAY_API_KEY=savedKey; }
});
test('production quotes require a backend key',async()=>{
  const savedKey=env.RELAY_API_KEY,savedMode=env.NODE_ENV;
  env.RELAY_API_KEY=undefined;env.NODE_ENV='production';
  try { await assert.rejects(requestRelayQuote(payload),/Missing RELAY_API_KEY/); }
  finally {env.RELAY_API_KEY=savedKey;env.NODE_ENV=savedMode;}
});
test('HTTP quote and execution-validation endpoints keep the same verified deposit and reject changed wallets',async()=>{
  const original=global.fetch;
  const {default:routes}=await import('../dist/routes/quotes.routes.js');
  const app=express();app.use(express.json());app.use('/api',routes);
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  global.fetch=async(url,options)=>String(url).startsWith('https://api.relay.link/')
    ? new Response(JSON.stringify(String(url).endsWith('/chains')?{chains:metadata}:fixture().raw)) : original(url,options);
  const post=(path,body)=>original(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const response=await post('/quotes?provider=relay',payload);
    assert.equal(response.status,200);
    const result=await response.json();
    const validation=await post('/quotes/relay/validate',{...payload,requestId:result.requestId});
    assert.equal(validation.status,200);
    assert.deepEqual((await validation.json()).transaction,result.quotes[0].transaction);
    assert.equal((await post('/quotes/relay/validate',{...payload,dstWalletAddress:attacker,requestId:result.requestId})).status,400);
    assert.equal((await post('/quotes?provider=relay',{...payload,srcWalletAddress:zero})).status,400);
  } finally {global.fetch=original;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('status cannot complete an unrelated deposit; refunds are not successes',async()=>{
  const original=global.fetch;
  let data={status:'success',inTxHashes:['0x'+'d'.repeat(64)],txHashes:[txHash],originChainId:8453,destinationChainId:5042};
  global.fetch=async()=>new Response(JSON.stringify(data));
  try {
    assert.equal((await fetchRelayStatus(requestId,txHash,8453,5042)).status,'confirming');
    data.inTxHashes=[txHash];
    assert.equal((await fetchRelayStatus(requestId,txHash,8453,5042)).status,'completed');
    data.status='refund';
    assert.equal((await fetchRelayStatus(requestId,txHash,8453,5042)).status,'failed');
    data.originChainId=1;
    await assert.rejects(fetchRelayStatus(requestId,txHash,8453,5042),/chain mismatch/);
  } finally {global.fetch=original;}
});
