-- CORRECTIF : « Enregistrement impossible — Stock insuffisant : EAU ... »
-- A executer dans le SQL Editor de Supabase APRES 05_atomic_command_operations.sql.
-- La livraison ne doit jamais etre bloquee par un manque de stock : comme avant,
-- la matiere est ramenee a zero (avertissement deja affiche dans la fenetre de
-- livraison). Re-executable sans risque.
begin;
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
  -- Business rule (unchanged from the original delivery flow): a shortage never
  -- blocks a delivery. The movement clamps the material to zero, as announced
  -- by the delivery screen. Unknown materials are skipped like before. Only
  -- lock the stock rows in a stable order to serialize concurrent deliveries.
  perform p.id from public.products p
    where p.id in (select (j->>'product_id')::uuid from jsonb_array_elements(v_requirements) j
                    where j->>'product_id' is not null)
    order by p.id for update;
end;
$fn$;
revoke all on function public.validate_command_delivery_v2(jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
