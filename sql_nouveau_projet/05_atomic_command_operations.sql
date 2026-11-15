-- Apply AFTER 04_atomic_reference_allocator.sql and the supported 01/02/03 path.
-- Additive upgrade: old RPC signatures remain available. Never run against a
-- production database as a benchmark. Re-running this migration is supported.
begin;

create table if not exists public.command_operations (
  operation_id uuid primary key,
  actor_id uuid not null,
  kind text not null check (kind in ('command', 'delivery')),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.command_operations enable row level security;
revoke all on public.command_operations from public, anon, authenticated;
comment on table public.command_operations is
  'Durable idempotency receipts. Retain while clients may retry. Do not purge during rollout or restore.';

-- Used by the targeted receipt query; existing FK indexes remain unchanged.
create index if not exists command_deliveries_command_updated_idx
  on public.command_deliveries(command_id, updated_at, id);
create index if not exists command_delivery_items_line_delivery_idx
  on public.command_delivery_items(command_item_id, delivery_id);

-- Preserve the proven accounting implementation, including its stock movement,
-- cash, debt and audit helpers. Only the public entry point adds serialization
-- and validation. Re-run must not rename the wrapper onto itself.
do $migration$
begin
  if to_regprocedure('public.create_command_delivery_accounting_v1(jsonb)') is null then
    alter function public.create_command_delivery(jsonb)
      rename to create_command_delivery_accounting_v1;
  end if;
  if to_regprocedure('public.update_command_delivery_accounting_v1(uuid,jsonb)') is null then
    alter function public.update_command_delivery(uuid,jsonb) rename to update_command_delivery_accounting_v1;
  end if;
end;
$migration$;
revoke all on function public.update_command_delivery_accounting_v1(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.create_command_delivery_accounting_v1(jsonb)
  from public, anon, authenticated;

-- Validate exact line IDs (never match a duplicate product by name), aggregate
-- repeated submitted IDs, and lock the actual stock rows in a stable order.
create or replace function public.validate_command_delivery_v2(p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_cmd public.commands;
  r record;
  v_requirements jsonb;
  v_available numeric;
begin
  select * into v_cmd from public.commands
    where id = (p_payload->>'command_id')::uuid for update;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;
  if v_cmd.status = 'cancelled' then raise exception 'Commande annulee'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array'
     or (jsonb_array_length(p_payload->'items') = 0 and nullif(p_payload->>'delivery_id','') is null) then
    raise exception 'Aucune ligne a livrer';
  end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'items') j
    where coalesce((j->>'quantity')::numeric,0)<=0
       or j->>'quantity' in ('NaN','Infinity','-Infinity')) then
    raise exception 'Quantite de livraison invalide';
  end if;
  for r in
    select (j->>'command_item_id')::uuid as id,
           sum((j->>'quantity')::numeric) as quantity
      from jsonb_array_elements(p_payload->'items') j
     group by (j->>'command_item_id')::uuid
  loop
    if r.id is null or r.quantity is null or r.quantity <= 0
       or r.quantity::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Ligne de livraison invalide';
    end if;
    select greatest(0, ci.quantity - coalesce(ci.cancelled_quantity, 0)
                      - coalesce(ci.delivered_quantity, 0)
                      + coalesce((select sum(di.quantity) from public.command_delivery_items di
                           where di.command_item_id=ci.id and di.delivery_id=nullif(p_payload->>'delivery_id','')::uuid),0)) into v_available
      from public.command_items ci where ci.id = r.id and ci.command_id = v_cmd.id
      for update;
    if not found then raise exception 'Ligne etrangere a la commande'; end if;
    if r.quantity > v_available + 0.0001 then
      raise exception 'Quantite restante insuffisante pour la ligne %', r.id;
    end if;
  end loop;
  -- Historical entries must preserve the existing no-current-stock rule.
  if coalesce(v_cmd.is_historical, false) then return; end if;
  with submitted as (
    select ci.*, q.quantity as delivered
      from (select (j->>'command_item_id')::uuid id, sum((j->>'quantity')::numeric) quantity
              from jsonb_array_elements(p_payload->'items') j
             group by (j->>'command_item_id')::uuid) q
      join public.command_items ci on ci.id = q.id
  ), requirements as (
    select public.resolve_stock_product(f.product_id, f.product_name) product_id,
           f.product_name, f.quantity, true as required
      from submitted s
      cross join lateral public.fiche_stock_requirements(s.fiche_technic_id, s.delivered) f
     where s.fiche_technic_id is not null
    union all
    select public.resolve_stock_product(s.product_id, s.product_name),
           s.product_name, s.delivered, false
      from submitted s where s.fiche_technic_id is null
  )
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_requirements
    from (select product_id, max(product_name) product_name,
                 sum(quantity) quantity, bool_or(required) required
            from requirements where quantity > 0 group by product_id) q;
  if exists(select 1 from jsonb_array_elements(v_requirements) j
             where j->>'product_id' is null and (j->>'required')::boolean) then
    raise exception 'Matiere introuvable dans le stock';
  end if;
  perform p.id from public.products p
    where p.id in (select (j->>'product_id')::uuid from jsonb_array_elements(v_requirements) j)
    order by p.id for update;
  for r in select * from jsonb_to_recordset(v_requirements)
    as x(product_id uuid, product_name text, quantity numeric, required boolean)
  loop
    if r.product_id is null then continue; end if;
    select p.current_quantity + coalesce((select sum(cc.quantity)
      from public.command_delivery_consumptions cc
      where cc.product_id=p.id and cc.delivery_id=nullif(p_payload->>'delivery_id','')::uuid),0)
      into v_available from public.products p where p.id = r.product_id;
    if v_available is null or v_available + 0.0001 < r.quantity then
      raise exception 'Stock insuffisant : % (disponible %, demande %)',
        r.product_name, coalesce(v_available, 0), r.quantity;
    end if;
  end loop;
end;
$fn$;
revoke all on function public.validate_command_delivery_v2(jsonb) from public, anon, authenticated;

create or replace function public.create_command_delivery(p_payload jsonb)
returns public.command_deliveries language plpgsql security definer set search_path = public as $fn$
declare v_client uuid;
begin
  if not (public.has_perm('clients', 'edit') or public.has_perm('clients', 'create')) then
    raise exception 'Vous n''avez pas la permission de livrer une commande';
  end if;
  select client_id into v_client from public.commands
    where id = (p_payload->>'command_id')::uuid for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if v_client is not null then
    perform 1 from public.clients where id = v_client for update;
  end if;
  perform public.validate_command_delivery_v2(p_payload);
  return public.create_command_delivery_accounting_v1(p_payload);
end;
$fn$;

-- The same safe entry point also covers older clients editing a delivery.
create or replace function public.update_command_delivery(p_id uuid,p_payload jsonb)
returns public.command_deliveries language plpgsql security definer set search_path=public as $fn$
declare v_cmd uuid; v_client uuid; v_payload jsonb:=p_payload;
begin
  if not public.has_perm('clients','edit') then raise exception 'Modification non autorisee'; end if;
  select command_id into v_cmd from public.command_deliveries where id=p_id;
  if not found then raise exception 'Livraison introuvable'; end if;
  select client_id into v_client from public.commands where id=v_cmd for update;
  perform 1 from public.command_deliveries where id=p_id for update;
  if v_client is not null then perform 1 from public.clients where id=v_client for update; end if;
  if not (v_payload ? 'items') then
    v_payload:=v_payload || jsonb_build_object('items',coalesce((
      select jsonb_agg(to_jsonb(i)) from public.command_delivery_items i where i.delivery_id=p_id),'[]'::jsonb));
  end if;
  perform public.validate_command_delivery_v2(v_payload || jsonb_build_object('command_id',v_cmd,'delivery_id',p_id));
  return public.update_command_delivery_accounting_v1(p_id,p_payload);
end;
$fn$;

-- Existing POS/legacy credit RPCs must take the same party lock BEFORE reading
-- the available credit. Updating a row only after reading its old balance is
-- insufficient when another cashier submits concurrently.
do $migration$
declare v_name text; v_sql text;
begin
  foreach v_name in array array['apply_credit_to_sale', 'apply_credit_to_command'] loop
    select pg_get_functiondef(p.oid) into v_sql from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=v_name and p.pronargs=2;
    if v_sql is null then raise exception 'Missing required credit helper: %', v_name; end if;
    v_sql := replace(v_sql,
      'from public.clients where id = v_sale.client_id;',
      'from public.clients where id = v_sale.client_id for update;');
    v_sql := replace(v_sql,
      'from public.clients where id = v_cmd.client_id;',
      'from public.clients where id = v_cmd.client_id for update;');
    if v_name='apply_credit_to_command' then
      v_sql := replace(v_sql, 'from public.commands where id = p_command_id;',
                              'from public.commands where id = p_command_id for update;');
    else
      if position('for update of c' in v_sql)=0 then
        v_sql := replace(v_sql, 'select * into v_sale from public.sales where id = p_sale_id;',
          'perform 1 from public.commands c join public.sales s on s.command_id=c.id where s.id=p_sale_id for update of c;' || chr(10) ||
          'select * into v_sale from public.sales where id = p_sale_id;');
        v_sql := replace(v_sql, 'from public.clients where id = v_sale.client_id for update;',
          'from public.clients where id = v_sale.client_id for update;' || chr(10) ||
          'select * into v_sale from public.sales where id=p_sale_id for update;');
      end if;
    end if;
    execute v_sql;
  end loop;
end;
$migration$;

-- Previous implementation called command_advance_available (an aggregate over
-- all BLs) inside every iteration. Preserve its oldest-first, increase-only
-- allocation semantics using one aggregate and one candidate pass.
create or replace function public.settle_command_deliveries(p_command_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_left numeric; v_take numeric; r record;
begin
  if p_command_id is null then return; end if;
  perform 1 from public.commands where id = p_command_id for update;
  v_left := public.command_advance_available(p_command_id, null);
  for r in
    select d.id, coalesce(d.total_ttc,0) ttc, coalesce(d.cash_paid,0) cash,
           coalesce(d.advance_applied,0) adv
      from public.command_deliveries d where d.command_id=p_command_id
       and coalesce(d.advance_applied,0) < greatest(0, coalesce(d.total_ttc,0)-coalesce(d.cash_paid,0))
     order by d.delivered_at, d.created_at, d.id
  loop
    exit when v_left <= 0;
    v_take := least(v_left + r.adv, greatest(0,r.ttc-r.cash));
    if v_take <> r.adv then
      update public.command_deliveries set advance_applied=v_take, updated_at=now() where id=r.id;
      v_left := v_left - (v_take-r.adv);
      perform public.apply_delivery_sale(r.id);
    end if;
  end loop;
  perform public.recompute_command_payments(p_command_id);
end;
$fn$;

-- One receipt contains exactly the newly created command and documents touched
-- by this transaction. No global history read is needed to confirm or print.
create or replace function public.command_operation_result_v2(
  p_command_id uuid, p_delivery_id uuid, p_credit numeric
) returns jsonb language sql security definer set search_path = public as $fn$
  select jsonb_build_object(
    'command', to_jsonb(c) || jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position,i.created_at,i.id)
                         from public.command_items i where i.command_id=c.id),'[]'::jsonb),
      'command_payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.date,p.id)
                          from public.command_payments p where p.command_id=c.id),'[]'::jsonb)),
    'delivery', (select to_jsonb(d) || jsonb_build_object('items',
       coalesce((select jsonb_agg(to_jsonb(i) order by ci.position,i.id)
                   from public.command_delivery_items i
                   left join public.command_items ci on ci.id=i.command_item_id
                  where i.delivery_id=d.id),'[]'::jsonb))
       from public.command_deliveries d where d.id=p_delivery_id),
    'deliveries', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('items',
       coalesce((select jsonb_agg(to_jsonb(i) order by ci.position,i.id)
                   from public.command_delivery_items i
                   left join public.command_items ci on ci.id=i.command_item_id
                  where i.delivery_id=d.id),'[]'::jsonb)) order by d.delivered_at,d.id)
       from public.command_deliveries d
       where d.command_id=c.id and (d.id=p_delivery_id or d.updated_at>=transaction_timestamp())),'[]'::jsonb),
    'sales', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
       'sale_lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id)
                               from public.sale_lines l where l.sale_id=s.id),'[]'::jsonb),
       'sale_payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.date,p.id)
                                  from public.sale_payments p where p.sale_id=s.id),'[]'::jsonb)))
       from public.command_deliveries d join public.sales s on s.delivery_id=d.id
       where d.command_id=c.id and (d.id=p_delivery_id or d.updated_at>=transaction_timestamp())),'[]'::jsonb),
    'client',(select to_jsonb(cl) from public.clients cl where cl.id=c.client_id),
    'credit_applied',coalesce(p_credit,0), 'replayed',false
  ) from public.commands c where c.id=p_command_id;
$fn$;
revoke all on function public.command_operation_result_v2(uuid,uuid,numeric) from public, anon, authenticated;

create or replace function public.create_command_v2(p_operation_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_actor uuid := auth.uid(); v_existing public.command_operations;
  v_cmd public.commands; v_credit numeric := 0; v_result jsonb; j jsonb;
begin
  if v_actor is null or not public.has_perm('clients','create') then
    raise exception 'Vous n''avez pas la permission de creer une commande';
  end if;
  if p_operation_id is null then raise exception 'Identifiant operation obligatoire'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'Demande operation invalide' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,529091));
  select * into v_existing from public.command_operations where operation_id=p_operation_id;
  if found then
    if v_existing.actor_id<>v_actor or v_existing.kind<>'command' or v_existing.payload<>p_payload then
      raise exception 'Identifiant operation reutilise avec une autre demande' using errcode='22023';
    end if;
    if not exists(select 1 from public.commands where id=(v_existing.result#>>'{command,id}')::uuid)
       or (v_existing.result#>>'{delivery,id}' is not null and not exists(
         select 1 from public.command_deliveries where id=(v_existing.result#>>'{delivery,id}')::uuid)) then
      raise exception 'Document confirme absent apres restauration/suppression : verifier avant toute nouvelle saisie'
        using errcode='55000';
    end if;
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array'
     or jsonb_array_length(p_payload->'items')=0 then raise exception 'Commande sans lignes'; end if;
  for j in select * from jsonb_array_elements(p_payload->'items') loop
    if coalesce((j->>'quantity')::numeric,0)<=0 or coalesce((j->>'unit_price')::numeric,-1)<0
       or (j->>'quantity') in ('NaN','Infinity','-Infinity')
       or (j->>'unit_price') in ('NaN','Infinity','-Infinity') then
      raise exception 'Ligne de commande invalide';
    end if;
  end loop;
  if nullif(p_payload->>'client_id','') is not null then
    perform 1 from public.clients where id=(p_payload->>'client_id')::uuid for update;
    if not found then raise exception 'Client introuvable'; end if;
  end if;
  v_cmd := public.create_command(p_payload);
  if coalesce((p_payload->>'requested_credit')::numeric,0)>0 then
    v_credit := public.apply_credit_to_command(v_cmd.id,(p_payload->>'requested_credit')::numeric);
  end if;
  v_result := public.command_operation_result_v2(v_cmd.id,null,v_credit);
  insert into public.command_operations(operation_id,actor_id,kind,payload,result)
    values(p_operation_id,v_actor,'command',p_payload,v_result);
  return v_result;
end;
$fn$;

create or replace function public.create_command_delivery_v2(p_operation_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_actor uuid := auth.uid(); v_existing public.command_operations;
  v_cmd public.commands; v_del public.command_deliveries; v_credit numeric:=0;
  v_result jsonb; j jsonb; r record; v_price_changed boolean:=false;
begin
  if v_actor is null or not (public.has_perm('clients','create') or public.has_perm('clients','edit')) then
    raise exception 'Vous n''avez pas la permission de livrer une commande';
  end if;
  if p_operation_id is null then raise exception 'Identifiant operation obligatoire'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'Demande operation invalide' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,529091));
  select * into v_existing from public.command_operations where operation_id=p_operation_id;
  if found then
    if v_existing.actor_id<>v_actor or v_existing.kind<>'delivery' or v_existing.payload<>p_payload then
      raise exception 'Identifiant operation reutilise avec une autre demande' using errcode='22023';
    end if;
    if not exists(select 1 from public.commands where id=(v_existing.result#>>'{command,id}')::uuid)
       or (v_existing.result#>>'{delivery,id}' is not null and not exists(
         select 1 from public.command_deliveries where id=(v_existing.result#>>'{delivery,id}')::uuid)) then
      raise exception 'Document confirme absent apres restauration/suppression : verifier avant toute nouvelle saisie'
        using errcode='55000';
    end if;
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;
  select * into v_cmd from public.commands where id=(p_payload->>'command_id')::uuid for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if v_cmd.client_id is not null then
    perform 1 from public.clients where id=v_cmd.client_id for update;
  end if;
  -- A price change is the same operator action as delivery. Keep line IDs and
  -- positions, and revalue previous linked invoices just as update_command did.
  for j in select * from jsonb_array_elements(coalesce(p_payload->'price_overrides','[]'::jsonb)) loop
    if coalesce((j->>'unit_price')::numeric,-1)<0 or (j->>'unit_price') in ('NaN','Infinity','-Infinity') then
      raise exception 'Prix unitaire invalide';
    end if;
    if not exists(select 1 from public.command_items where id=(j->>'command_item_id')::uuid and command_id=v_cmd.id) then
      raise exception 'Prix : ligne etrangere a la commande';
    end if;
    if exists(select 1 from public.command_items where id=(j->>'command_item_id')::uuid
                and unit_price is distinct from (j->>'unit_price')::numeric)
       and not public.has_perm('clients','edit') then
      raise exception 'Vous n''avez pas la permission de modifier le prix de la commande';
    end if;
    update public.command_items set unit_price=(j->>'unit_price')::numeric
      where id=(j->>'command_item_id')::uuid and unit_price is distinct from (j->>'unit_price')::numeric;
    v_price_changed := v_price_changed or found;
  end loop;
  if v_price_changed then
    perform public.recompute_command_amounts(v_cmd.id);
    perform public.resettle_command_deliveries(v_cmd.id);
  end if;
  if nullif(p_payload->>'delivery_id','') is not null then
    if not exists(select 1 from public.command_deliveries
      where id=(p_payload->>'delivery_id')::uuid and command_id=v_cmd.id) then
      raise exception 'Livraison etrangere a la commande';
    end if;
    v_del := public.update_command_delivery((p_payload->>'delivery_id')::uuid,p_payload);
  else
    v_del := public.create_command_delivery(p_payload);
  end if;
  if coalesce((p_payload->>'requested_credit')::numeric,0)>0 and v_del.sale_id is not null then
    v_credit := public.apply_credit_to_sale(v_del.sale_id,(p_payload->>'requested_credit')::numeric);
  end if;
  v_result := public.command_operation_result_v2(v_cmd.id,v_del.id,v_credit);
  insert into public.command_operations(operation_id,actor_id,kind,payload,result)
    values(p_operation_id,v_actor,'delivery',p_payload,v_result);
  return v_result;
end;
$fn$;

-- PostgreSQL defaults new functions to PUBLIC EXECUTE: explicitly close every
-- new internal helper and expose only permission-checked entry points.
revoke all on function public.create_command_v2(uuid,jsonb) from public, anon;
revoke all on function public.create_command_delivery_v2(uuid,jsonb) from public, anon;
revoke all on function public.create_command_delivery(jsonb) from public, anon;
revoke all on function public.update_command_delivery(uuid,jsonb) from public, anon;
grant execute on function public.create_command_v2(uuid,jsonb),
  public.create_command_delivery_v2(uuid,jsonb), public.create_command_delivery(jsonb),
  public.update_command_delivery(uuid,jsonb)
  to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
