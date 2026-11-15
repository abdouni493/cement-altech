// Mocked browser transport tests. No request may reach a real Supabase project.
// Start Vite first, then: node tests/command-actions.mjs
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseUrl = process.env.TEST_APP_URL || 'http://127.0.0.1:5173';
const commandId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const deliveryId = '44444444-4444-4444-8444-444444444444';
const oldDeliveryId = '55555555-5555-4555-8555-555555555555';
const command = {
  id: commandId, reference: 'CMD-2026-1000', created_at: '2026-11-15T12:00:00Z',
  client_id: clientId, client_name: 'Local fixture', client_address: 'Fixture address',
  receive_date: '2026-11-16', receive_hour: '14', receive_minute: '30',
  total_amount: 200, total_ttc: 238, tva_enabled: true, tva_rate: 19, tva_amount: 38,
  advance_paid: 10, credit_applied: 5, paid_amount: 15, rest_amount: 223, status: 'pending',
  items: [
    { id: itemId, position: 0, product_name: 'Same product', quantity: 10, delivered_quantity: 0, unit_price: 10, total_price: 100 },
    { id: '66666666-6666-4666-8666-666666666666', position: 1, product_name: 'Same product', quantity: 5, delivered_quantity: 0, unit_price: 20, total_price: 100 },
  ], payments: [],
};
const delivery = {
  id: deliveryId, command_id: commandId, reference: 'BL-CMD-2026-1000-100',
  date: '2026-11-15', delivered_at: '2026-11-15T13:00:00Z',
  sale_id: '77777777-7777-4777-8777-777777777777', sale_reference: 'VNT-2026-1000',
  total_ht: 20, total_ttc: 23.8, tva_enabled: true, tva_rate: 19, tva_amount: 3.8,
  advance_applied: 10, cash_paid: 3, paid_amount: 18, rest_amount: 5.8,
  driver_name: 'Fixture driver', driver_plate: 'Fixture plate', location: 'Fixture location',
  items: [{ command_item_id: itemId, product_name: 'Same product', quantity: 2 }],
};
const response = {
  command,
  client: { id: clientId, name: 'Local fixture', address: 'Fixture address', credit_amount: 0 },
  deliveries: [], sales: [], credit_applied: 5,
};
const requests = [];
let mode = 'success';
let loadGate = null;
let uiMode = false;
let uiDelivered = false;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
 const page = await browser.newPage();
 await page.route('https://*.supabase.co/**', async (route) => {
   const request = route.request();
   const path = new URL(request.url()).pathname;
   requests.push({ path, body: request.postDataJSON() });
   if (uiMode) {
     if (path.endsWith('/list_command_summaries')) return route.fulfill({json:{
       rows:[{...command,ordered_quantity:15,delivered_quantity:0,cancelled_quantity:0}],total_count:1,
       stats:{totalValue:238,totalPaid:15,totalRest:223,pendingDelivery:1},counts:{partial:0,delivered:0,undelivered:1,paid:0,debt:1},
     }});
     if (path === '/rest/v1/commands') return route.fulfill({json:{...command,command_items:command.items,command_payments:[]}});
     if (path === '/rest/v1/command_deliveries') return route.fulfill({json:uiDelivered ? [{...delivery,command_delivery_items:delivery.items}] : []});
     if (path === '/rest/v1/clients') return route.fulfill({json:[response.client]});
     if (path === '/rest/v1/fiche_technics') return route.fulfill({json:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Fixture recipe',unit_price:10,output_quantity:1}]});
     if (path === '/rest/v1/store_settings') return route.fulfill({json:{id:true,name:'Fixture store'}});
     if (path.endsWith('/create_command_delivery_v2')) uiDelivered = true;
   }
   if (path === '/rest/v1/commands' && loadGate) await loadGate;
   if (path.endsWith('/create_command_v2') || path.endsWith('/create_command_delivery_v2')) {
     if (mode === 'lost') return route.abort('failed');
     if (mode === 'rejected') return route.fulfill({ status: 400, json: { code: 'P0001', message: 'Not enough stock' } });
     const isDelivery = path.endsWith('/create_command_delivery_v2');
     const updated = { ...command, items: command.items.map((i) => ({ ...i, delivered_quantity: i.id === itemId ? 2 : 0 })) };
     return route.fulfill({ status: 200, json: isDelivery ? {
       ...response, command: updated, delivery,
       deliveries: [{ ...delivery, id: oldDeliveryId, advance_applied: 0 }, delivery],
       sales: [{ id: delivery.sale_id, reference: delivery.sale_reference, final_amount: 23.8, rest_amount: 5.8,
         sale_lines: [{ id: 'line', product_name: 'Same product', quantity: 2, selling_price: 10 }], sale_payments: [] }],
     } : response });
   }
   return route.fulfill({ status: 200, json: path.endsWith('/admin_account_exists') ? true : [] });
 });
 await page.goto(baseUrl + '/login');
 await page.locator('input[type="password"]').waitFor();
 await page.waitForTimeout(300);
 const baseline = requests.length;
 const created = await page.evaluate(async ({clientId}) => {
   const { useCommandStore } = await import('/src/store/commandStore.ts');
   const { newOperation, operationConfirmed } = await import('/src/lib/commandOperation.ts');
   const operation = newOperation('browser-test-create');
   const data = { clientId, clientName: 'Local fixture', clientAddress: 'Fixture address', receiveDate: '2026-11-16', receiveHour: '14', receiveMinute: '30', totalAmount: 200, advancePaid: 10, requestedCredit: 5, items: [{productName:'Same product',quantity:10,unitPrice:10,totalPrice:100}], operation };
   const result = await useCommandStore.getState().addCommand(data);
   operationConfirmed(operation, 'command');
   return result;
 }, {clientId});
 assert.equal(created.reference, 'CMD-2026-1000');
 assert.equal(created.items.length, 2);
 assert.notEqual(created.items[0].id, created.items[1].id);
 assert.equal(created.items[1].unitPrice, 20);
 assert.deepEqual(requests.slice(baseline).map((r) => r.path), ['/rest/v1/rpc/create_command_v2']);
 const beforeDelivery = requests.length;
 const delivered = await page.evaluate(async ({commandId,itemId}) => {
   const { useCommandStore } = await import('/src/store/commandStore.ts');
   const { newOperation, operationConfirmed } = await import('/src/lib/commandOperation.ts');
   const operation = newOperation('browser-test-delivery');
   const result = await useCommandStore.getState().addDelivery(commandId, [{commandItemId:itemId,productName:'Same product',quantity:2}], '2026-11-15T13:00:00Z', '', {driverName:'Fixture driver',location:'Fixture location'}, {cashPaid:3,advanceApplied:10,creditUsed:5,priceOverrides:[{commandItemId:itemId,unitPrice:10}],operation});
   operationConfirmed(operation, 'delivery');
   return { result, state: useCommandStore.getState(), timings: globalThis.__commandTimings };
 }, {commandId,itemId});
 assert.equal(delivered.result.reference, 'BL-CMD-2026-1000-100');
 assert.equal(delivered.result.saleReference, 'VNT-2026-1000');
 assert.equal(delivered.result.creditApplied, 5);
 assert.equal(delivered.result.restAmount, 5.8);
 assert.equal(delivered.state.commands[0].items[0].deliveredQuantity, 2);
 assert.equal(delivered.state.commands[0].items[1].deliveredQuantity, 0);
 assert.equal(delivered.state.deliveries.find((d) => d.id === oldDeliveryId).advanceApplied, 0);
 assert.deepEqual(requests.slice(beforeDelivery).map((r) => r.path), ['/rest/v1/rpc/create_command_delivery_v2']);
 // A failed transport response must retain the same durable operation across remount/retry.
 mode = 'lost';
 const pending = await page.evaluate(async ({clientId}) => {
   const { useCommandStore } = await import('/src/store/commandStore.ts');
   const { newOperation } = await import('/src/lib/commandOperation.ts');
   const operation = newOperation('browser-test-lost');
   try { await useCommandStore.getState().addCommand({clientId,clientName:'Local fixture',receiveDate:'2026-11-16',receiveHour:'14',receiveMinute:'30',totalAmount:10,items:[],operation}); } catch {}
   return { id:operation.id, restored:newOperation('browser-test-lost') };
 }, {clientId});
 assert.equal(pending.restored.id, pending.id);
 assert.ok(pending.restored.payload);
 mode = 'success';
 const beforeRecovery = requests.length;
 const recovered = await page.evaluate(async () => {
   const { useCommandStore } = await import('/src/store/commandStore.ts');
   const { newOperation, operationConfirmed } = await import('/src/lib/commandOperation.ts');
   const operation = newOperation('browser-test-lost');
   const result = await useCommandStore.getState().recoverOperation(operation, 'command');
   operationConfirmed(operation, 'command');
   return result;
 });
 assert.equal(recovered.id, commandId);
 assert.equal(requests[beforeRecovery].body.p_operation_id, pending.id);
 assert.ok(requests.filter((r) => r.body?.p_operation_id === pending.id).every((r) => r.path.endsWith('/create_command_v2')));
 // A read begun before a commit may not replace the new confirmed order.
 let releaseLoads;
 loadGate = new Promise((resolve) => { releaseLoads = resolve; });
 const readStarted = page.waitForRequest((r) => new URL(r.url()).pathname === '/rest/v1/commands');
 await page.evaluate(async () => {
   const { useCommandStore } = await import('/src/store/commandStore.ts');
   globalThis.__testLoading = useCommandStore.getState().load();
 });
 await readStarted;
 await page.evaluate(async ({clientId}) => {
   const { useCommandStore } = await import('/src/store/commandStore.ts');
   await useCommandStore.getState().addCommand({clientId,clientName:'Local fixture',receiveDate:'2026-11-16',receiveHour:'14',receiveMinute:'30',totalAmount:10,items:[]});
 }, {clientId});
 releaseLoads();
 const stale = await page.evaluate(async () => {
   await globalThis.__testLoading;
   const { useCommandStore } = await import('/src/store/commandStore.ts');
   return useCommandStore.getState().commands.length;
 });
 assert.equal(stale,1);
 // Actual operator controls, including double click, immediate print and reprint.
 const uiTimingStart=await page.evaluate(()=>globalThis.__commandTimings?.length ?? 0);
 loadGate = null; uiMode = true;
 const pageErrors=[]; page.on('pageerror', error => pageErrors.push(error.message));
 await page.evaluate(async () => {
   const {useAuthStore}=await import('/src/store/authStore.ts');
   useAuthStore.setState({isAuthenticated:true,isBootstrapping:false,user:{id:'99999999-9999-4999-8999-999999999999',name:'Fixture admin',username:'fixture',role:'admin',permissions:'all'},language:'fr'});
   history.pushState({},'', '/commands'); dispatchEvent(new PopStateEvent('popstate'));
 });
 await page.getByRole('heading',{name:'Commandes clients',exact:true}).waitFor();
 await page.getByRole('button',{name:'Nouvelle commande',exact:true}).waitFor();
 await page.evaluate(async ({clientId}) => {
   const {useClientStore}=await import('/src/store/clientStore.ts');
   const {useFicheTechnicStore}=await import('/src/store/ficheTechnicStore.ts');
   useClientStore.setState({clients:[{id:clientId,name:'Local fixture',address:'Fixture address',creditAmount:5}]});
   useFicheTechnicStore.setState({ficheTechnics:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Fixture recipe',unitPrice:10,usedProducts:[],outputQuantity:1}]});
 },{clientId});
 await page.getByRole('button',{name:'Nouvelle commande',exact:true}).click();
 await page.getByPlaceholder('Rechercher un client…').fill('Local fixture');
 await page.getByRole('button',{name:/Local fixture/}).click();
 await page.getByPlaceholder('Rechercher une fiche technique / formule…').fill('Fixture recipe');
 await page.getByRole('button',{name:/Fixture recipe/}).click();
 const saveStart=requests.length;
 await page.getByRole('button',{name:'Enregistrer la commande',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.getByRole('heading',{name:'Commande enregistrée',exact:true}).waitFor();
 assert.deepEqual(requests.slice(saveStart).map(r=>r.path),['/rest/v1/rpc/create_command_v2']);
 await page.getByRole('button',{name:'Imprimer',exact:true}).last().click();
 await page.locator('#altech-print-preview iframe').waitFor();
 assert.match(await page.locator('#altech-print-preview iframe').getAttribute('srcdoc'),/CMD-2026-1000/);
 await page.evaluate(async()=>{(await import('/src/lib/printWindow.ts')).closePrintPreview();});
 await page.getByTitle('Actions',{exact:true}).first().click();
 await page.getByRole('button',{name:'Nouvelle livraison',exact:true}).evaluate(button=>button.click());
 await page.getByRole('button',{name:'Valider la livraison',exact:true}).waitFor();
 const deliveryStart=requests.length;
 await page.getByRole('button',{name:'Valider la livraison',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.getByRole('heading',{name:'Livraison enregistrée',exact:true}).waitFor();
 assert.deepEqual(requests.slice(deliveryStart).map(r=>r.path),['/rest/v1/rpc/create_command_delivery_v2']);
 await page.getByRole('button',{name:'Imprimer',exact:true}).last().click();
 await page.getByRole('button',{name:'Imprimer',exact:true}).last().click();
 await page.locator('#altech-print-preview iframe').waitFor();
 const firstPrint=await page.locator('#altech-print-preview iframe').getAttribute('srcdoc');
 assert.match(firstPrint,/BL-CMD-2026-1000-100/); assert.match(firstPrint,/Fixture driver/); assert.match(firstPrint,/Fixture location/i);
 await page.evaluate(async()=>{(await import('/src/lib/printWindow.ts')).closePrintPreview();});
 await page.getByTitle('Actions',{exact:true}).first().click();
 await page.getByRole('button',{name:/^Livraisons \(/}).evaluate(button=>button.click());
 await page.getByTitle('Imprimer le bon de livraison',{exact:true}).last().click();
 await page.getByRole('button',{name:'Imprimer',exact:true}).last().click();
 await page.locator('#altech-print-preview iframe').waitFor();
 assert.match(await page.locator('#altech-print-preview iframe').getAttribute('srcdoc'),/BL-CMD-2026-1000-100/);
 assert.deepEqual(pageErrors,[]);
 await page.evaluate(async()=>{(await import('/src/store/authStore.ts')).useAuthStore.getState().setLanguage('ar');});
 assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
 assert.equal(await page.locator('html').getAttribute('lang'),'ar');
 const uiTimings=await page.evaluate(start=>globalThis.__commandTimings.slice(start),uiTimingStart);
 writeFileSync('tests/browser-ui-results.json',JSON.stringify({conditions:'Chromium local Vite; intercepted Supabase fixtures, no injected latency; actual create/deliver controls, double clicks, title dialog, print iframe/reprint; not hosted latency',passed:true,timings:uiTimings},null,2)+'\n');
 console.log('PASS actual UI: create, double-click guard, command print, deliver, double-click guard, BL title/print, reprint; no history reads on save.');
 console.log(JSON.stringify({passed: ['one-RPC command save','one-RPC delivery save','no unfiltered save/background reads','ordered duplicate product lines','immediate invoice/print data','older advance allocations reconciled','lost response durable operation replay','stale reads do not replace committed rows'], timings: delivered.timings},null,2));
} finally { await browser.close(); }
