-- READ ONLY. Run with psql (or paste in Supabase SQL Editor) before deployment.
-- Does not allocate numbers, run business RPCs, change data, or install anything.
begin transaction read only;

-- Installed definitions, including legacy callers and import paths. Compare
-- effective definitions, not the earliest occurrence in a concatenated SQL file.
select p.oid::regprocedure as signature, pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer, p.proacl as grants,
       pg_get_functiondef(p.oid) as installed_definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and (p.proname in ('create_command','create_command_delivery','apply_delivery_sale',
    'create_sale','create_sale_with_productions','create_purchase','create_purchase_order',
    'backup_restore','_backup_insert','recycle_restore','next_document_reference',
    'create_command_v2','create_command_delivery_v2','create_command_delivery_accounting_v1',
    'sync_document_reference_counters')
    or p.prosrc ~* '(insert into|update)[[:space:]]+public\.(commands|command_deliveries|sales|purchases|purchase_orders)')
order by p.oid::regprocedure::text;

select tablename, indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename in
 ('commands','command_items','command_deliveries','command_delivery_items','sales',
  'sale_lines','purchases','purchase_orders','document_reference_counters')
order by tablename, indexname;

-- Full numeric suffix usage: MAX, not row count, determines the next number.
-- Prefix includes date/year or the entire order reference for a BL.
with refs as (
 select 'commands' source, reference, regexp_match(reference, '^(CMD-[0-9]{4}-)([0-9]+)$') m from public.commands
 union all select 'sales', reference, regexp_match(reference, '^(VNT-[0-9]{4}-)([0-9]+)$') from public.sales
 union all select 'purchases', reference, regexp_match(reference, '^(ACH-[0-9]{4}-)([0-9]+)$') from public.purchases
 union all select 'purchase_orders', reference, regexp_match(reference, '^(BC-[0-9]{4}-)([0-9]+)$') from public.purchase_orders
 union all select 'command_deliveries', reference, regexp_match(reference, '^(BL-.+-)([0-9]+)$') from public.command_deliveries
)
select source, m[1] prefix, count(*) rows, count(distinct m[2]::numeric) distinct_suffixes,
       min(m[2]::numeric) min_suffix, max(m[2]::numeric) max_suffix,
       max(m[2]::numeric) - count(distinct m[2]::numeric) missing_suffixes_to_max,
       count(*) filter (where length(m[2]) > case when source = 'command_deliveries' then 2 else 3 end) beyond_old_width
from refs where m is not null group by source,m[1] order by source,prefix;

-- Nonstandard legacy references are retained verbatim, excluded from generated
-- suffix counters. Review BLs whose prefix differs from their current order.
select 'commands' source, reference from public.commands where reference !~ '^CMD-[0-9]{4}-[0-9]+$'
union all select 'sales', reference from public.sales where reference !~ '^VNT-[0-9]{4}-[0-9]+$'
union all select 'purchases', reference from public.purchases where reference !~ '^ACH-[0-9]{4}-[0-9]+$'
union all select 'purchase_orders', reference from public.purchase_orders where reference !~ '^BC-[0-9]{4}-[0-9]+$'
union all select 'command_deliveries', d.reference from public.command_deliveries d
 join public.commands c on c.id = d.command_id
 where left(d.reference, length('BL-' || c.reference || '-')) <> 'BL-' || c.reference || '-'
    or substring(d.reference from length('BL-' || c.reference || '-') + 1) !~ '^[0-9]+$';

-- Any rows here block the new BL uniqueness constraint; never auto-renumber.
select reference, count(*), array_agg(id order by id) ids
from public.command_deliveries group by reference having count(*) > 1;

select lpad('1000',3,'0') old_cmd_bug, lpad('100',2,'0') old_bl_bug,
 lpad('1000',greatest(3,length('1000')),'0') correct_minimum_width;

-- Useful only if track_functions is enabled. Times are cumulative, not a benchmark.
select funcname, calls, total_time, self_time from pg_stat_user_functions
where schemaname = 'public' and funcname in ('create_command','create_command_delivery',
 'apply_delivery_sale','settle_command_deliveries','command_advance_available',
 'apply_command_delivery_stock','recompute_command_delivery');
commit;
