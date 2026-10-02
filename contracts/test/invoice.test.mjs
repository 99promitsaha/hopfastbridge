import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, Wallet, keccak256, toUtf8Bytes, ZeroAddress } from 'ethers';

const artifact = JSON.parse(fs.readFileSync('artifacts/InvoiceEscrow.json'));
const tokenArtifact = JSON.parse(fs.readFileSync('artifacts/MockUSDC.json'));
const types = { InvoicePayment: [{ name:'invoiceId',type:'bytes32' },{ name:'issuer',type:'address' },{ name:'payer',type:'address' },{ name:'amount',type:'uint256' },{ name:'detailsHash',type:'bytes32' },{ name:'deadline',type:'uint256' }] };
async function rejects(transaction) { await assert.rejects(async () => { const result = await transaction; if (typeof result?.wait === 'function') await result.wait(); }); }
async function setup(adversarial = false) {
  const rpc = ganache.provider({ logging:{quiet:true}, chain:{chainId:5042}, wallet:{totalAccounts:6} });
  const provider = new BrowserProvider(rpc); provider.pollingInterval = 10;
  const [admin,payer,issuer,treasury,attacker] = await Promise.all([0,1,2,3,4].map(i=>provider.getSigner(i)));
  const signer = Wallet.createRandom();
  const tokenBuild = adversarial ? JSON.parse(fs.readFileSync('artifacts/InvoiceTestToken.json')) : tokenArtifact;
  const token = await new ContractFactory(tokenBuild.abi,tokenBuild.evm.bytecode.object,admin).deploy(); await token.waitForDeployment();
  const escrow = await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,admin).deploy(await token.getAddress(),await admin.getAddress(),await treasury.getAddress(),signer.address); await escrow.waitForDeployment();
  await (await token.mint(await payer.getAddress(),1000000000n)).wait(); await (await token.connect(payer).approve(await escrow.getAddress(),1000000000n)).wait();
  const id = keccak256(toUtf8Bytes('invoice')), detailsHash = keccak256(toUtf8Bytes('published snapshot'));
  const domain = {name:'HopfastInvoiceEscrow',version:'1',chainId:5042,verifyingContract:await escrow.getAddress()};
  async function authorization(overrides={},authorizer=signer) { const payload={invoiceId:id,issuer:await issuer.getAddress(),payer:await payer.getAddress(),amount:500000000n,detailsHash,deadline:BigInt((await provider.getBlock('latest')).timestamp+120),...overrides}; const signature=await authorizer.signTypedData(domain,types,payload); return {payload,args:[payload.invoiceId,payload.issuer,payload.amount,payload.detailsHash,payload.deadline,signature]}; }
  const fund = async (overrides={}) => { const auth=await authorization(overrides); await(await escrow.connect(payer).pay(...auth.args)).wait(); return auth; };
  return {rpc,provider,admin,payer,issuer,treasury,attacker,signer,token,escrow,id,detailsHash,domain,authorization,fund};
}
async function scenario(name,run) { test(name,async()=> {const s=await setup(); try {await run(s);} finally {await s.rpc.disconnect();}}); }
scenario('invoice holds full deposit, then deducts once at issuer release',async s=>{
  await s.fund(); assert.equal(await s.escrow.totalEscrow(),500000000n); assert.equal(await s.token.balanceOf(await s.treasury.getAddress()),0n);
  await(await s.escrow.connect(s.issuer).release(s.id)).wait();
  assert.equal(await s.token.balanceOf(await s.issuer.getAddress()),497500000n);assert.equal(await s.token.balanceOf(await s.treasury.getAddress()),2500000n);assert.equal(await s.escrow.totalEscrow(),0n);
  await rejects(s.escrow.connect(s.issuer).release(s.id));await rejects(s.escrow.recover(s.id,await s.admin.getAddress(),s.detailsHash));
});
scenario('owner recovers full escrow and cannot recover or release it twice',async s=>{
  await s.fund();await rejects(s.escrow.connect(s.attacker).recover(s.id,await s.attacker.getAddress(),s.detailsHash));
  await(await s.escrow.recover(s.id,await s.payer.getAddress(),s.detailsHash)).wait();
  assert.equal(await s.token.balanceOf(await s.payer.getAddress()),1000000000n);assert.equal(await s.token.balanceOf(await s.treasury.getAddress()),0n);assert.equal(await s.escrow.totalEscrow(),0n);
  await rejects(s.escrow.connect(s.issuer).release(s.id));await rejects(s.escrow.recover(s.id,await s.admin.getAddress(),s.detailsHash));
});
scenario('signed invoice amount, issuer, snapshot, ID and payer cannot be substituted',async s=>{
  const {args}=await s.authorization();
  for(const [index,value] of [[0,keccak256(toUtf8Bytes('other'))],[1,await s.attacker.getAddress()],[2,100000000n],[3,keccak256(toUtf8Bytes('tampered'))]]) {const changed=[...args];changed[index]=value;await rejects(s.escrow.connect(s.payer).pay(...changed));}
  await rejects(s.escrow.connect(s.attacker).pay(...args));
  const fake=await s.authorization({},Wallet.createRandom());await rejects(s.escrow.connect(s.payer).pay(...fake.args));assert.equal(await s.escrow.totalEscrow(),0n);
});
scenario('expired, other-chain, other-contract and duplicate authorizations fail',async s=>{
  const auth=await s.authorization();const message=auth.payload;
  for(const domain of [{...s.domain,chainId:1},{...s.domain,verifyingContract:await s.token.getAddress()}]) {const signature=await s.signer.signTypedData(domain,types,message);await rejects(s.escrow.connect(s.payer).pay(...auth.args.slice(0,5),signature));}
  const expired=await s.authorization({deadline:1n});await rejects(s.escrow.connect(s.payer).pay(...expired.args));
  await(await s.escrow.connect(s.payer).pay(...auth.args)).wait();await rejects(s.escrow.connect(s.payer).pay(...auth.args));
});
scenario('only issuer releases; pause blocks pay and release, but allows owner recovery',async s=>{
  await s.fund();await rejects(s.escrow.connect(s.payer).release(s.id));await rejects(s.escrow.connect(s.attacker).setPaused(true));
  await(await s.escrow.setPaused(true)).wait();await rejects(s.escrow.connect(s.issuer).release(s.id));
  const other=await s.authorization({invoiceId:keccak256(toUtf8Bytes('next'))});await rejects(s.escrow.connect(s.payer).pay(...other.args));
  await(await s.escrow.recover(s.id,await s.admin.getAddress(),s.detailsHash)).wait();assert.equal(await s.token.balanceOf(await s.admin.getAddress()),500000000n);
});
scenario('rescue cannot raid any invoice; revoked authorizations cannot be paid',async s=>{
  await s.fund();await rejects(s.escrow.rescueToken(await s.token.getAddress(),await s.admin.getAddress(),1n));
  await(await s.token.mint(await s.escrow.getAddress(),123n)).wait();await(await s.escrow.rescueToken(await s.token.getAddress(),await s.admin.getAddress(),123n)).wait();assert.equal(await s.escrow.totalEscrow(),500000000n);
  const other=await s.authorization({invoiceId:keccak256(toUtf8Bytes('cancelled'))});await(await s.escrow.revoke(other.payload.invoiceId)).wait();await rejects(s.escrow.connect(s.payer).pay(...other.args));
  await rejects(s.escrow.recover(s.id,ZeroAddress,s.detailsHash));await rejects(s.escrow.renounceOwnership());
});
scenario('fee rounding and multiple invoices preserve exact escrow liabilities',async s=>{
  for(const amount of [2n,199n,200n,201n,1000001n]) {const id=keccak256(toUtf8Bytes(String(amount)));await s.fund({invoiceId:id,amount});const expected=(amount*50n+9999n)/10000n;assert.equal(await s.escrow.feeFor(amount),expected);await(await s.escrow.connect(s.issuer).release(id)).wait();assert.equal(await s.escrow.totalEscrow(),0n);}
  const tiny=await s.authorization({amount:1n});await rejects(s.escrow.connect(s.payer).pay(...tiny.args));
  await s.fund({amount:1000000n});const otherId=keccak256(toUtf8Bytes('second'));await s.fund({invoiceId:otherId,amount:2000000n});await(await s.escrow.recover(s.id,await s.payer.getAddress(),s.detailsHash)).wait();assert.equal(await s.escrow.totalEscrow(),2000000n);await(await s.escrow.connect(s.issuer).release(otherId)).wait();assert.equal(await s.escrow.totalEscrow(),0n);
});
test('fee-on-transfer token cannot create an undercollateralized invoice', async () => {
  const s = await setup(true); try { await(await s.token.configure(1,ZeroAddress,'0x')).wait(); await rejects(s.fund()); assert.equal(await s.escrow.totalEscrow(),0n); assert.equal((await s.escrow.invoices(s.id)).state,0n); assert.equal(await s.token.balanceOf(await s.payer.getAddress()),1000000000n); } finally {await s.rpc.disconnect();}
});
test('token callback reentrancy is rejected by the guard', async () => {
  const s = await setup(true); try { await(await s.token.configure(2,await s.escrow.getAddress(),s.escrow.interface.encodeFunctionData('release',[s.id]))).wait(); await s.fund(); assert.equal(await s.token.attackSucceeded(),false);assert.equal((await s.token.attackResult()).slice(0,10),keccak256(toUtf8Bytes('ReentrancyGuardReentrantCall()')).slice(0,10));assert.equal(await s.escrow.totalEscrow(),500000000n); } finally {await s.rpc.disconnect();}
});
test('failed transfer rolls back release and preserves full escrow', async () => {
  const s = await setup(true); try { await s.fund();await(await s.token.configure(3,ZeroAddress,'0x')).wait();await rejects(s.escrow.connect(s.issuer).release(s.id));assert.equal(await s.escrow.totalEscrow(),500000000n);assert.equal((await s.escrow.invoices(s.id)).state,1n);assert.equal(await s.token.balanceOf(await s.treasury.getAddress()),0n); } finally {await s.rpc.disconnect();}
});
