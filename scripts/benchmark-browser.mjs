// Deterministic HTTP simulation, NOT hosted latency. No Supabase traffic escapes.
import { chromium } from 'playwright';
import { mkdtempSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const root=process.cwd(), baseline=mkdtempSync(`${tmpdir()}/cement-waterfall-`);
const archive=spawnSync('git',['archive','d8ae668'],{maxBuffer:32*1024*1024});
if(archive.status!==0) throw new Error('Baseline commit d8ae668 is required');
if(spawnSync('tar',['-x','-C',baseline],{input:archive.stdout}).status!==0) throw new Error('Cannot extract baseline');
symlinkSync(resolve(root,'node_modules'),resolve(baseline,'node_modules'),'dir');
const servers=[]; const runs=Number(process.env.BENCHMARK_RUNS || 15);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const uid='11111111-1111-4111-8111-111111111111', line='33333333-3333-4333-8333-333333333333';
const raw={id:uid,reference:'CMD-2026-001',created_at:'2026-11-15T12:00:00Z',client_name:'Fixture',total_amount:10000,total_ttc:10000,advance_paid:100,paid_amount:100,rest_amount:9900,status:'pending',command_items:[{id:line,position:0,product_name:'Fixture',quantity:1000,delivered_quantity:0,unit_price:10,total_price:10000}],command_payments:[]};
const bl={id:'44444444-4444-4444-8444-444444444444',command_id:uid,reference:'BL-CMD-2026-001-01',delivered_at:'2026-11-15T13:00:00Z',sale_id:'77777777-7777-4777-8777-777777777777',sale_reference:'VNT-2026-001',total_ht:10,total_ttc:10,paid_amount:10,rest_amount:0,items:[{command_item_id:line,product_name:'Fixture',quantity:1}]};
const percentile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.ceil(q*a.length)-1];};
let browser;
try {
 for(const [cwd,port] of [[baseline,5174],[root,5175]]) {
  const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd,env:{...process.env,BROWSER:'none'},stdio:'ignore'}); servers.push(server);
  for(let n=0;;n++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok)break;}catch{} if(n>120)throw new Error('Vite not ready');await pause(250);}
 }
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
 const results=[];
 for(const [version,port] of [['before',5174],['after',5175]]) for(const size of [10,800]) {
  const page=await browser.newPage(); let entries=[]; let capture=false;
  await page.route('https://*.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   const rpc=path.split('/rpc/')[1]; let data=[];
   if(rpc==='admin_account_exists')data=true;
   else if(rpc==='create_command')data=raw;
   else if(rpc==='create_command_delivery')data=bl;
   else if(rpc==='create_command_v2')data={command:raw,deliveries:[],sales:[],credit_applied:0};
   else if(rpc==='create_command_delivery_v2')data={command:raw,delivery:bl,deliveries:[bl],sales:[],credit_applied:0};
   else if(path==='/rest/v1/commands')data=url.searchParams.has('id')?raw:Array.from({length:size},(_,i)=>({...raw,id:i===0?uid:`history-${i}`}));
   else if(path==='/rest/v1/command_deliveries')data=size===800?Array.from({length:80},(_,i)=>({...bl,id:i===0?bl.id:`bl-${i}`,command_delivery_items:bl.items})): [{...bl,command_delivery_items:bl.items}];
   const body=JSON.stringify(data),start=performance.now();
   // 40ms request latency + 1 MB/s response bandwidth, identical for both versions.
   await pause(40+Buffer.byteLength(body)/1000);
   const entry={path,query:url.search,bytes:Buffer.byteLength(body),start,end:performance.now()};
   if(capture)entries.push(entry);
   await route.fulfill({status:200,contentType:'application/json',body});
  });
  await page.goto(`http://127.0.0.1:${port}/login`);await page.locator('input[type=password]').waitFor();await pause(150);
  for(const kind of ['command','delivery']){
   const samples=[];let example;
   for(let n=0;n<runs;n++){
    entries=[];capture=true;
    const timing=await page.evaluate(async({kind,uid,line})=>{
     const {useCommandStore}=await import('/src/store/commandStore.ts');
     const start=performance.now();
     if(kind==='command')await useCommandStore.getState().addCommand({clientId:'',clientName:'Fixture',receiveDate:'2026-11-16',receiveHour:'14',receiveMinute:'30',totalAmount:10,items:[{productName:'Fixture',quantity:1,unitPrice:10,totalPrice:10}]});
     else await useCommandStore.getState().addDelivery(uid,[{commandItemId:line,productName:'Fixture',quantity:1}],'2026-11-15T13:00:00Z');
     const confirmed=performance.now(); await new Promise(requestAnimationFrame);
     return {storeMs:confirmed-start,readyMs:performance.now()-start};
    },{kind,uid,line});
    await pause(150);capture=false;
    const base=entries[0]?.start||0,rpc=entries.find(e=>e.path.includes('/rpc/'));
    const history=entries.filter(e=>!e.path.includes('/rpc/')&&!e.query.includes('id=eq.'));
    samples.push({...timing,rpcTransportMs:rpc?rpc.end-rpc.start:0,requests:entries.length,unfilteredReads:history.length});
    example=entries.map(e=>({...e,start:e.start-base,end:e.end-base}));
   }
   results.push({version,kind,historyOrders:size,BLsOnSelectedOrder:size===800?80:0,runs,median:Object.fromEntries(Object.keys(samples[0]).map(k=>[k,percentile(samples.map(s=>s[k]),.5)])),p95:Object.fromEntries(Object.keys(samples[0]).map(k=>[k,percentile(samples.map(s=>s[k]),.95)])),samples,waterfall:example});
   console.log(`${version} ${kind} ${size}: ${results.at(-1).median.readyMs.toFixed(1)}ms simulated store-to-frame, ${samples[0].unfilteredReads} unfiltered reads`);
  } await page.close();
 }
 writeFileSync('tests/browser-benchmark-results.json',JSON.stringify({baseline:'d8ae668',role:'no-auth local store harness',conditions:'Chromium; intercepted HTTP 40ms +1MB/s; zero database execution; same payloads per version; store-call-to-next-frame, not UI click',runs,results},null,2)+'\n');
}finally{await browser?.close();servers.forEach(p=>p.kill());rmSync(baseline,{recursive:true,force:true});}
