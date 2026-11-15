-- READ ONLY, psql: psql "$STAGING_DATABASE_URL" -v command_id=<fixture UUID> -f diagnostics/command_cost.sql
-- Use a representative staging order. EXPLAIN ANALYZE below executes SELECTs only.
-- Does NOT call delivery/stock/payment RPCs or allocate document references.
\set ON_ERROR_STOP on
begin transaction read only;
select :'command_id'::uuid selected_command;

select t.relname, i.indexrelid::regclass index_name, pg_get_indexdef(i.indexrelid) definition
from pg_index i join pg_class t on t.oid=i.indrelid
where t.relnamespace='public'::regnamespace and t.relname in
 ('command_items','command_deliveries','command_delivery_items','command_delivery_consumptions',
  'sales','sale_lines','sale_payments','command_payments','document_reference_counters')
order by t.relname,i.indexrelid::regclass::text;

-- Quantity recalculation: parent and line identity joins, including repeated products.
explain (analyze, buffers, format text)
select ci.id, coalesce((select sum(di.quantity)
  from public.command_delivery_items di join public.command_deliveries d on d.id=di.delivery_id
  where di.command_item_id=ci.id and d.command_id=ci.command_id),0) delivered
from public.command_items ci where ci.command_id=:'command_id'::uuid;

-- Advance and confirmed payment aggregates remain proportional to the selected
-- order's BL count. No unrelated history should be visited through these paths.
explain (analyze, buffers, format text)
select sum(d.advance_applied),
  sum(greatest(0,coalesce(s.paid_amount,d.paid_amount,0)-coalesce(d.advance_applied,0)))
from public.command_deliveries d left join public.sales s on s.delivery_id=d.id
where d.command_id=:'command_id'::uuid;

-- Receipt candidates: newly inserted / changed older BLs only (not global history).
explain (analyze, buffers, format text)
select d.id,d.sale_id from public.command_deliveries d
where d.command_id=:'command_id'::uuid and d.updated_at>=transaction_timestamp();

select p.proname,pg_get_functiondef(p.oid) definition from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('settle_command_deliveries','resettle_command_deliveries','command_advance_available',
  'recompute_command_delivery','apply_command_delivery_stock','apply_delivery_sale');
commit;
