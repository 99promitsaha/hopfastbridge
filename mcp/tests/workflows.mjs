import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from '../../backend/node_modules/express/index.js';
import { Client } from '../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
const folder=mkdtempSync(join(tmpdir(),'hopfast-mcp-'));
process.env.PAYMENT_STORE_PATH=join(folder,'payments.json');
const {default: paymentRoutes}=await import('../../backend/dist/routes/payments.routes.js');
const {default: quoteRoutes}=await import('../../backend/dist/routes/quotes.routes.js');
const app=express();app.use(express.json());app.use('/api',paymentRoutes);app.use('/api',quoteRoutes);
const listener=app.listen(0, '127.0.0.1');await new Promise(r=>listener.once('listening',r));
const base=`http://127.0.0.1:${listener.address().port}`;
process.env.HOPFAST_API_URL=base;
const {createHopFastMcpServer}=await import('../dist/server.js');
const server=createHopFastMcpServer();const client=new Client({name:'smoke',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
try {
 const {tools}=await client.listTools();assert.equal(tools.length,11);assert.ok(!tools.some(t=>/earn|yield/i.test(t.name)));
 const detail={walletAddress:'0x'+'1'.repeat(40),recipient:'0x'+'2'.repeat(40),amount:'1.25',memo:'Smoke review'};
 const result=await client.callTool({name:'prepare_arc_payment',arguments:detail});assert.ok(!result.isError,JSON.stringify(result));
 const prepared=JSON.parse(result.content[0].text);assert.ok(prepared.reviewUrl);const id=prepared.payment.id;
 let response=await fetch(`${base}/api/payments/${id}`);assert.equal(response.status,404);
 response=await fetch(`${base}/api/payments/${id}`,{headers:{Authorization:`Bearer ${prepared.accessToken}`}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const status=await client.callTool({name:'get_payment_status',arguments:{paymentId:id,accessToken:prepared.accessToken}});assert.ok(!status.isError,JSON.stringify(status));
 response=await fetch(`${base}/api/payments/${id}/cancel`,{method:'POST',headers:{Authorization:`Bearer ${prepared.accessToken}`}});assert.equal((await response.json()).status,'cancelled');
 response=await fetch(`${base}/api/quotes/compare`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(response.status,400);
 for (const provider of ['debridge', 'relay']) {
   response = await fetch(`${base}/api/quotes?provider=${provider}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
   assert.equal(response.status, 400);
   const toolResult = await client.callTool({ name: 'get_swap_quote', arguments: { provider, fromChain: 'ethereum', toChain: 'base', fromToken: 'ETH', toToken: 'ETH', amount: '1', walletAddress: detail.walletAddress } });
   assert.ok(toolResult.isError);
 }
 console.log('HTTP/MCP smoke passed: 11 tools, payment preparation/read/cancel, capability enforcement, quote input validation.');
}finally{await client.close();await server.close();listener.close();rmSync(folder,{recursive:true,force:true});}
