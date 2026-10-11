import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData,parseAbi} from 'viem';
import {assertRelayExecution,relayExecutionPayload} from '../src/lib/relay';
import type {SwapDraft} from '../src/types';
import type {QuoteResult} from '../src/services/quoteService';
const wallet='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
const depository='0x4cd00e387622c35bddb9b4c962c136462338bc31';
const orderId=('0x'+'a'.repeat(64)) as `0x${string}`;
const abi=parseAbi(['function depositNative(address depositor, bytes32 id)','function depositErc20(address depositor,address token,uint256 amount,bytes32 id)']);
const draft:SwapDraft={fromChain:'base',toChain:'arc',fromTokenSymbol:'USDC',toTokenSymbol:'USDC',amount:'100'};
function fixture(d:SwapDraft=draft):QuoteResult {
  const p=relayExecutionPayload(d,wallet);
  const native=d.fromTokenSymbol==='ETH';
  const src=native?'0x0000000000000000000000000000000000000000':p.srcTokenAddress;
  return {
    id:'fixture',provider:'relay-api',route:'Relay',feeUsd:0.1,hopfastFeeUsd:'0.05',feePercent:0.1,etaSeconds:1,destinationAmount:'99.9',
    relayOrderId:orderId,expiresAt:Date.now()+120000,
    context:{fromChainId:8453,toChainId:5042,sender:wallet,recipient:wallet,srcToken:src,dstToken:p.dstTokenAddress,amount:p.amount},
    transactionRequest:{to:depository,value:native?p.amount:'0',data:encodeFunctionData({abi,functionName:native?'depositNative':'depositErc20',args:native?[wallet as `0x${string}`,orderId]:[wallet as `0x${string}`,src as `0x${string}`,BigInt(p.amount),orderId]})},
  };
}
test('browser enforces exact native and ERC-20 deposits with correct decimal units',()=>{
  for(const d of [draft,{...draft,fromTokenSymbol:'ETH',amount:'0.001'}]) assert.doesNotThrow(()=>assertRelayExecution(fixture(d),d,wallet));
  assert.equal(relayExecutionPayload(draft,wallet).amount,'100000000');
  assert.equal(relayExecutionPayload({...draft,fromTokenSymbol:'ETH',amount:'0.001'},wallet).amount,'1000000000000000');
});
test('account, amount, source token and destination chain changes stop execution',()=>{
  const q=fixture();
  assert.throws(()=>assertRelayExecution(q,draft,other));
  for(const changed of [{...draft,amount:'200'},{...draft,fromTokenSymbol:'ETH'},{...draft,toChain:'ethereum' as const}]) assert.throws(()=>assertRelayExecution(q,changed,wallet));
});
test('expired quotes and tampered deposits cannot be signed',()=>{
  const mutations=[
    (q:QuoteResult)=>{q.expiresAt=Date.now()+9000;},
    (q:QuoteResult)=>{q.transactionRequest!.to=other;},
    (q:QuoteResult)=>{q.transactionRequest!.data='0x1234';},
    (q:QuoteResult)=>{q.transactionRequest!.value='1';},
    (q:QuoteResult)=>{q.context!.recipient=other;},
    (q:QuoteResult)=>{q.context!.dstToken=other;},
    (q:QuoteResult)=>{q.relayOrderId='0x'+'b'.repeat(64);},
  ];
  for(const mutate of mutations){const q=fixture();mutate(q);assert.throws(()=>assertRelayExecution(q,draft,wallet));}
});
