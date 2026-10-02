import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { privateKeyToAccount } from 'viem/accounts';

process.env.NODE_ENV = 'test';
process.env.ARC_RPC_URL = 'http://127.0.0.1:12345';
process.env.INVOICE_ESCROW_ADDRESS = '';
process.env.INVOICE_SIGNER_KEY = '';
const { ArchitectAuth, PaymentProfile } = await import('../dist/models/ArchitectEnvelope.js');
const { Invoice, InvoiceBusiness } = await import('../dist/models/Invoice.js');
const { default: routes } = await import('../dist/routes/invoices.routes.js');

test('invoice API enforces signed sessions, ownership, private drafts and fail-closed publishing', async () => {
  // Exercise actual Express handlers and real wallet signatures with an isolated model adapter.
  // This tests authorization boundaries; production Mongo persistence is a separate integration check.
  const auth = [], invoices = [], businesses = [];
  const match = (record, query) => Object.entries(query).every(([key,value]) => value?.$gt ? record[key] > value.$gt : value?.$in ? value.$in.includes(record[key]) : record[key] === value);
  const replacements = [];
  function stub(object,key,value) { replacements.push([object,key,object[key]]); object[key] = value; }
  const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection,'readyState');
  Object.defineProperty(mongoose.connection,'readyState',{ configurable:true, get:()=>1 });
  stub(ArchitectAuth,'create',async input=>{const doc={...input,_id:String(auth.length)};auth.push(doc);return doc;});
  stub(ArchitectAuth,'findOne',async query=>auth.find(record=>match(record,query)));
  stub(ArchitectAuth,'findOneAndDelete',async query=>{const index=auth.findIndex(record=>match(record,query));return index < 0 ? null : auth.splice(index,1)[0];});
  stub(InvoiceBusiness,'findOne',async query=>businesses.find(record=>match(record,query)));
  stub(InvoiceBusiness,'findOneAndUpdate',async(query,update)=>{let record=businesses.find(record=>match(record,query));if(!record){record={...query};businesses.push(record);}Object.assign(record,update);return record;});
  stub(Invoice,'create',async input=>{const doc={...input,state:'draft',_id:String(invoices.length),async save(){return this;}};invoices.push(doc);return doc;});
  stub(Invoice,'findOne',async query=>invoices.find(record=>match(record,query)));
  stub(Invoice,'findOneAndDelete',async query=>{const index=invoices.findIndex(record=>match(record,query));return index<0?null:invoices.splice(index,1)[0];});
  stub(Invoice,'findOneAndUpdate',async(query,update)=>{const record=invoices.find(record=>match(record,query));if(record)Object.assign(record,update.$set);return record;});
  stub(PaymentProfile,'findOne',async()=>null);
  const app=express();app.use(express.json({limit:'64kb'}));app.use('/api',routes);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/invoices`;
  async function request(path,token='',body,method){const res=await fetch(base+path,{method:method??(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,body:await res.json()};}
  const a=privateKeyToAccount('0x'+'11'.repeat(32)), b=privateKeyToAccount('0x'+'22'.repeat(32));
  async function login(account){const {body:challenge}=await request('/challenge','',{wallet:account.address});const signature=await account.signMessage({message:challenge.message});const result=await request('/session','',{nonce:challenge.nonce,signature});assert.equal(result.status,200);assert.notEqual((await request('/session','',{nonce:challenge.nonce,signature})).status,200);return result.body.session;}
  try {
    assert.notEqual((await request('/business')).status,200);
    const {body:challenge}=await request('/challenge','',{wallet:a.address});const wrong=await b.signMessage({message:challenge.message});assert.notEqual((await request('/session','',{nonce:challenge.nonce,signature:wrong})).status,200);
    const sessionA=await login(a), sessionB=await login(b);
    const details={name:'A business',email:'',address:'Private billing address',clients:[]};assert.equal((await request('/business',sessionA,details,'PUT')).status,200);assert.equal((await request('/business',sessionB)).body.details,null);
    const input={number:'INV-001',client:{name:'Client',email:'',address:'Client address'},issueDate:'2026-10-02',dueDate:'2026-10-30',lines:[{description:'Consulting',quantity:'1',rate:'100'}],discount:'0',taxBps:0,notes:''};
    const created=await request('',sessionA,{...input,owner:b.address,state:'paid'});assert.equal(created.status,201);const id=created.body.invoice.invoiceId;assert.equal(created.body.invoice.owner,a.address.toLowerCase());assert.equal(created.body.invoice.state,'draft');
    assert.equal((await request('/'+id)).status,404);
    for(const state of ['draft','open','cancelling','funded','paid','recovered']) { invoices[0].state=state; assert.notEqual((await request('/'+id,sessionA,undefined,'DELETE')).status,200); }
    invoices[0].state='draft';
    assert.notEqual((await request(`/${id}/cancel`,sessionB,{})).status,200);assert.notEqual((await request(`/${id}/publish`,sessionB,{})).status,200);assert.notEqual((await request('/admin',sessionB)).status,200);
    const publish=await request(`/${id}/publish`,sessionA,{});assert.notEqual(publish.status,200);assert.match(publish.body.error,/Hopfast ID/);
    assert.notEqual((await request(`/${id}/authorize`,sessionA,{})).status,200);
    assert.equal((await request(`/${id}/cancel`,sessionA,{})).body.invoice.state,'cancelled');assert.equal((await request('/'+id)).status,404);
    assert.notEqual((await request('/'+id,sessionB,undefined,'DELETE')).status,200);
    assert.equal((await request('/'+id,sessionA,undefined,'DELETE')).body.deleted,true);
    assert.equal(invoices.length,0); assert.equal((await request('/'+id)).status,404);
    const session=auth.find(record=>record.kind==='invoice_session'&&record.wallet===a.address.toLowerCase());session.expiresAt=new Date(0);assert.notEqual((await request('/business',sessionA)).status,200);
  } finally { await new Promise(resolve=>server.close(resolve));for(const [object,key,value] of replacements)object[key]=value;if(descriptor)Object.defineProperty(mongoose.connection,'readyState',descriptor);else delete mongoose.connection.readyState; }
});
