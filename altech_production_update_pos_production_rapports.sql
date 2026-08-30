-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  MISE À JOUR — POS « production à la vente » + comptes rendus & historiques
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS :
--    1. altech_production_supabase.sql
--    2. altech_production_update_2026.sql
--    3. altech_production_update_achat_bon_matricule.sql
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  CONTENU
--   01. productions : origine (manuelle / point de vente) + vente d'origine
--   02. RPC create_sale_with_productions()
--       -> le POS lance la production, l'envoie au comptoir et crée la vente
--          dans UNE SEULE transaction
--   03. RPC update_sale()      — modifier une facture de vente (historique client)
--   04. RPC update_purchase()  — modifier une facture d'achat (historique fournisseur)
--   05. Vues de contrôle : productions issues du POS, relevés de période
-- ============================================================================


-- ============================================================================
-- 01. PRODUCTIONS — ORIGINE ET VENTE LIÉE
-- ----------------------------------------------------------------------------
--  `origin` = 'manual' (écran Production) ou 'pos' (créée depuis le point de
--  vente au moment de la vente). Les deux apparaissent dans /production.
-- ============================================================================

alter table public.productions
  add column if not exists origin         text default 'manual',
  add column if not exists sale_id        uuid,
  add column if not exists sale_reference text;

update public.productions set origin = 'manual' where origin is null;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'productions_origin_check') then
    alter table public.productions
      add constraint productions_origin_check check (origin in ('manual', 'pos'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'productions_sale_id_fkey') then
    alter table public.productions
      add constraint productions_sale_id_fkey
      foreign key (sale_id) references public.sales(id) on delete set null;
  end if;
end
$do$;

comment on column public.productions.origin         is 'manual = ecran Production / pos = lancee automatiquement depuis le point de vente';
comment on column public.productions.sale_id        is 'Vente qui a declenche la production (origine pos)';
comment on column public.productions.sale_reference is 'Reference lisible de la vente d origine (VNT-AAAA-000)';

create index if not exists productions_origin_idx  on public.productions (origin);
create index if not exists productions_sale_id_idx on public.productions (sale_id);


-- ============================================================================
-- 02. RPC create_sale_with_productions()
-- ----------------------------------------------------------------------------
--  Bouton « Valider la vente » du point de vente.
--
--  p_payload :
--  {
--    "client_id": uuid | null,
--    "date": "YYYY-MM-DD",
--    "reduction": numeric,
--    "total_amount": numeric,
--    "final_amount": numeric,
--    "paid_amount": numeric,
--    "products": [                       -- lignes de la vente
--      { "line_key": text | null,        -- rapprochement avec "productions"
--        "comptoir_id": uuid | null, "product_id": uuid | null,
--        "product_name": text, "quantity": numeric,
--        "selling_price": numeric, "base_price": numeric,
--        "sell_by_unit": bool, "unit": text }
--    ],
--    "productions": [                    -- lignes « fiche technique » du POS
--      { "line_key": text,
--        "fiche_technic_id": uuid,
--        "name": text, "description": text,
--        "category_id": uuid, "category_name": text,
--        "output_quantity": numeric,     -- quantité que la production va rendre
--        "unit_price": numeric,          -- prix de vente unitaire appliqué
--        "sell_by_unit": bool, "sell_unit": text,
--        "used_products": [ { product_id, product_name, quantity_used,
--                             source_type, unit, unit_cost, line_cost } ] }
--    ]
--  }
--
--  Pour chaque entrée de "productions" :
--    a) create_production()               -> consomme le stock des ingrédients
--    b) transfer_production_to_comptoir() -> crée l'article de comptoir
--    c) la ligne de vente correspondante (même line_key) reçoit le comptoir_id
--  Puis create_sale() écrit la vente, décrémente le comptoir, encaisse la
--  caisse et crée la dette client si nécessaire.
-- ============================================================================

create or replace function public.create_sale_with_productions(p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod_line jsonb;
  v_prod      public.productions;
  v_item      public.comptoir_items;
  v_sale      public.sales;
  v_map       jsonb := '{}'::jsonb;   -- line_key -> { comptoir_id, production_id }
  v_out       jsonb := '[]'::jsonb;
  v_line      jsonb;
  v_key       text;
  v_cid       text;
  v_qty       numeric;
begin
  -- a/b) une production par ligne « fiche technique » du panier
  for v_prod_line in
    select * from jsonb_array_elements(coalesce(p_payload -> 'productions', '[]'::jsonb))
  loop
    v_qty := coalesce((v_prod_line ->> 'output_quantity')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Quantite de production invalide pour %',
        coalesce(v_prod_line ->> 'name', 'la production');
    end if;

    v_prod := public.create_production(
      jsonb_build_object(
        'name',             coalesce(v_prod_line ->> 'name', 'Production'),
        'description',      coalesce(v_prod_line ->> 'description', ''),
        'date',             coalesce(p_payload ->> 'date', to_char(current_date, 'YYYY-MM-DD')),
        'hour',             to_char(now(), 'HH24:MI'),
        'category_id',      v_prod_line ->> 'category_id',
        'category_name',    v_prod_line ->> 'category_name',
        'fiche_technic_id', v_prod_line ->> 'fiche_technic_id',
        'output_quantity',  v_qty,
        'unit_price',       coalesce((v_prod_line ->> 'unit_price')::numeric, 0),
        'sell_by_unit',     coalesce((v_prod_line ->> 'sell_by_unit')::boolean, false),
        'sell_unit',        v_prod_line ->> 'sell_unit',
        'used_products',    coalesce(v_prod_line -> 'used_products', '[]'::jsonb)
      )
    );

    update public.productions
       set origin = 'pos', updated_at = now()
     where id = v_prod.id;

    -- output_quantity est stocke en numeric(14,3) : on transfere la valeur
    -- reellement enregistree pour ne jamais depasser le lot produit.
    v_item := public.transfer_production_to_comptoir(v_prod.id, v_prod.output_quantity);

    v_key := coalesce(v_prod_line ->> 'line_key', v_prod_line ->> 'fiche_technic_id');
    v_map := v_map || jsonb_build_object(
      v_key, jsonb_build_object('comptoir_id', v_item.id, 'production_id', v_prod.id)
    );
  end loop;

  -- c) les lignes de vente reçoivent l'article de comptoir qui vient d'être créé
  for v_line in
    select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb))
  loop
    v_key := v_line ->> 'line_key';
    if v_key is not null and v_map ? v_key then
      v_cid  := v_map -> v_key ->> 'comptoir_id';
      v_line := v_line || jsonb_build_object('comptoir_id', v_cid, 'product_id', null);
    end if;
    v_out := v_out || jsonb_build_array(v_line);
  end loop;

  v_sale := public.create_sale(
    jsonb_build_object(
      'client_id',    p_payload ->> 'client_id',
      'date',         p_payload ->> 'date',
      'reduction',    coalesce((p_payload ->> 'reduction')::numeric, 0),
      'total_amount', (p_payload ->> 'total_amount')::numeric,
      'final_amount', (p_payload ->> 'final_amount')::numeric,
      'paid_amount',  coalesce((p_payload ->> 'paid_amount')::numeric, 0),
      'note',         p_payload ->> 'note',
      'products',     v_out
    )
  );

  -- rattache les productions créées à la vente (affichage dans /production)
  for v_prod_line in
    select * from jsonb_array_elements(coalesce(p_payload -> 'productions', '[]'::jsonb))
  loop
    v_key := coalesce(v_prod_line ->> 'line_key', v_prod_line ->> 'fiche_technic_id');
    if v_map ? v_key then
      update public.productions
         set sale_id        = v_sale.id,
             sale_reference = v_sale.reference,
             updated_at     = now()
       where id = (v_map -> v_key ->> 'production_id')::uuid;
    end if;
  end loop;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$fn$;

grant execute on function public.create_sale_with_productions(jsonb) to authenticated, service_role;


-- ============================================================================
-- 03. RPC update_sale() — modifier une facture de vente
-- ----------------------------------------------------------------------------
--  Bouton « Modifier » de l'historique des ventes d'un client.
--  Modifie l'en-tête commercial (date, réduction, montant payé) ; les lignes
--  et les mouvements de stock déjà effectués ne sont pas touchés.
--  Le paiement et l'écriture de caisse associée sont recalculés
--  (trg_sale_payment_caisse à l'insertion, trg_sale_payments_caisse_del à la
--  suppression).
-- ============================================================================

create or replace function public.update_sale(p_id uuid, p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale   public.sales;
  v_total  numeric;
  v_red    numeric;
  v_final  numeric;
  v_paid   numeric;
  v_rest   numeric;
  v_date   date;
  v_status public.sale_status;
begin
  select * into v_sale from public.sales where id = p_id;
  if v_sale.id is null then
    raise exception 'Vente introuvable (%)', p_id;
  end if;

  v_date  := coalesce(nullif(p_payload ->> 'date', '')::date, v_sale.date);
  v_red   := greatest(0, coalesce((p_payload ->> 'reduction')::numeric, v_sale.reduction));
  v_total := coalesce(
    (select sum(quantity * selling_price) from public.sale_lines where sale_id = p_id),
    v_sale.total_amount);
  v_red   := least(v_red, v_total);
  v_final := greatest(0, v_total - v_red);
  v_paid  := least(greatest(0, coalesce((p_payload ->> 'paid_amount')::numeric, v_sale.paid_amount)), v_final);
  v_rest  := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  -- le trigger de suppression retire aussi les écritures de caisse liées
  delete from public.sale_payments where sale_id = p_id;
  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (p_id, v_date, v_paid, 'Paiement vente (modifie)');
  end if;

  update public.sales
     set date         = v_date,
         total_amount = v_total,
         reduction    = v_red,
         final_amount = v_final,
         paid_amount  = v_paid,
         rest_amount  = v_rest,
         status       = v_status,
         note         = coalesce(p_payload ->> 'note', note),
         updated_at   = now()
   where id = p_id
  returning * into v_sale;

  -- la dette client générée par cette vente suit le nouveau reste
  delete from public.client_debts
   where description = 'Reste vente ' || v_sale.reference
     and coalesce(total_paid, 0) = 0;
  if v_rest > 0 and v_sale.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_sale.client_id, c.name, c.phone, v_rest, v_rest, v_date,
           'Reste vente ' || v_sale.reference, public.current_username()
      from public.clients c where c.id = v_sale.client_id;
  end if;

  perform public.log_activity('sales', 'update', 'sales', p_id, p_payload);
  return v_sale;
end;
$fn$;

grant execute on function public.update_sale(uuid, jsonb) to authenticated, service_role;


-- ============================================================================
-- 04. RPC update_purchase() — modifier une facture d'achat
-- ----------------------------------------------------------------------------
--  Bouton « Modifier » de l'historique des factures d'un fournisseur.
--  Modifie la date, le n° de bon, le matricule et le montant payé.
--  Les lignes (et donc le stock déjà entré) ne sont pas touchées.
-- ============================================================================

create or replace function public.update_purchase(p_id uuid, p_payload jsonb)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pur   public.purchases;
  v_total numeric;
  v_paid  numeric;
  v_date  date;
begin
  select * into v_pur from public.purchases where id = p_id;
  if v_pur.id is null then
    raise exception 'Facture d achat introuvable (%)', p_id;
  end if;

  v_date  := coalesce(nullif(p_payload ->> 'date', '')::date, v_pur.date);
  v_total := coalesce(
    (select sum(quantity * purchase_price) from public.purchase_lines where purchase_id = p_id),
    v_pur.total_amount);
  v_paid  := least(greatest(0, coalesce((p_payload ->> 'paid_amount')::numeric, v_pur.paid_amount)), v_total);

  delete from public.purchase_payments where purchase_id = p_id;
  if v_paid > 0 then
    insert into public.purchase_payments (purchase_id, date, amount, description)
    values (p_id, v_date, v_paid, 'Reglement achat (modifie)');
  end if;

  update public.purchases
     set date         = v_date,
         bon_number   = nullif(btrim(coalesce(p_payload ->> 'bon_number', coalesce(bon_number, ''))), ''),
         driver_plate = nullif(upper(btrim(coalesce(p_payload ->> 'driver_plate', coalesce(driver_plate, '')))), ''),
         total_amount = v_total,
         paid_amount  = v_paid,
         rest_amount  = greatest(0, v_total - v_paid),
         note         = coalesce(p_payload ->> 'note', note),
         updated_at   = now()
   where id = p_id
  returning * into v_pur;

  perform public.log_activity('purchase', 'update', 'purchases', p_id, p_payload);
  return v_pur;
end;
$fn$;

grant execute on function public.update_purchase(uuid, jsonb) to authenticated, service_role;


-- ============================================================================
-- 05. VUES DE CONTRÔLE
-- ============================================================================

-- Productions lancées automatiquement depuis le point de vente
create or replace view public.v_pos_productions as
select p.id,
       p.name,
       p.date,
       p.hour,
       p.origin,
       p.sale_id,
       p.sale_reference,
       s.client_id,
       c.name as client_name,
       p.output_quantity,
       p.sell_unit,
       p.unit_price,
       p.total_cost,
       p.total_value,
       (p.total_value - p.total_cost) as gains
  from public.productions p
  left join public.sales   s on s.id = p.sale_id
  left join public.clients c on c.id = s.client_id
 where p.origin = 'pos'
 order by p.date desc, p.created_at desc;

alter view public.v_pos_productions set (security_invoker = true);
grant select on public.v_pos_productions to authenticated, service_role;


-- Relevé client : ventes + règlements (base des comptes rendus de période)
create or replace view public.v_client_statement as
select c.id           as client_id,
       c.name         as client_name,
       'sale'::text   as kind,
       s.date         as entry_date,
       s.reference    as reference,
       s.final_amount as amount,
       s.paid_amount  as paid,
       s.rest_amount  as rest,
       null::text     as notes
  from public.clients c
  join public.sales   s on s.client_id = c.id
union all
select c.id, c.name, 'payment'::text,
       p.paid_at::date, null::text, p.amount, p.amount, 0::numeric, p.notes
  from public.clients c
  join public.client_payments p on p.client_id = c.id;

alter view public.v_client_statement set (security_invoker = true);
grant select on public.v_client_statement to authenticated, service_role;


-- Relevé fournisseur : achats + règlements
create or replace view public.v_supplier_statement as
select s.id            as supplier_id,
       s.name          as supplier_name,
       'purchase'::text as kind,
       p.date          as entry_date,
       p.reference     as reference,
       p.total_amount  as amount,
       p.paid_amount   as paid,
       p.rest_amount   as rest,
       null::text      as notes
  from public.suppliers s
  join public.purchases p on p.supplier_id = s.id
union all
select s.id, s.name, 'payment'::text,
       sp.paid_at::date, null::text, sp.amount, sp.amount, 0::numeric, sp.notes
  from public.suppliers s
  join public.supplier_payments sp on sp.supplier_id = s.id;

alter view public.v_supplier_statement set (security_invoker = true);
grant select on public.v_supplier_statement to authenticated, service_role;

-- ============================================================================
--  FIN DE LA MISE À JOUR
-- ============================================================================
