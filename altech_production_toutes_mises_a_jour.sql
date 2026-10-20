-- Toutes les mises a jour, dans l'ordre. A executer UNE fois apres altech_production_supabase.sql.


-- ===== altech_production_update_2026.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  MISE À JOUR 2026 — nouvelles fonctionnalités
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS `altech_production_supabase.sql`
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  CONTENU
--   01. Fiches techniques        : RPC create / update (persistance réelle)
--   02. Produits                 : code-barres / marque / catégorie optionnels
--   03. Règlements fournisseurs  : supplier_payments (+ caisse + imputation)
--   04. Règlements clients       : client_payments   (+ caisse + imputation)
--   05. Livraisons de commandes  : command_deliveries + lignes
--   06. Heures supplémentaires   : worker_overtimes  (+ paiement groupé)
--   07. Bons de commande         : purchase_orders + lignes  (/expenses)
--   08. Ventes                   : prix unitaire modifiable (déjà supporté)
--   09. Vues                     : dettes, heures sup., livraisons
--   10. RLS / GRANTS des nouvelles tables
-- ============================================================================


-- ============================================================================
-- 01. FICHES TECHNIQUES — persistance complète
-- ============================================================================

-- Bouton « Créer la Fiche » (/production > Fiches Techniques)
create or replace function public.create_fiche_technic(p_payload jsonb)
returns public.fiche_technics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiche public.fiche_technics;
  v_line  jsonb;
  v_cat   uuid;
begin
  if not public.has_perm('production', 'create') then
    raise exception 'Vous n''avez pas la permission de créer une fiche technique';
  end if;

  -- la catégorie est libre : on la crée à la volée si elle n'existe pas
  v_cat := nullif(p_payload ->> 'category_id', '')::uuid;
  if v_cat is null and coalesce(p_payload ->> 'category_name', '') <> '' then
    insert into public.fiche_categories (name)
    values (p_payload ->> 'category_name')
    on conflict (name) do update set name = excluded.name
    returning id into v_cat;
  end if;

  insert into public.fiche_technics (
    name, category_id, category_name, description, sell_by_unit, sell_unit,
    usable_in_production, product_unit, output_quantity, unit_price,
    total_cost, cost_per_unit, total_value, gains_per_unit, total_gains, created_by)
  values (
    coalesce(p_payload ->> 'name', 'Fiche'),
    v_cat,
    p_payload ->> 'category_name',
    coalesce(p_payload ->> 'description', ''),
    coalesce((p_payload ->> 'sell_by_unit')::boolean, false),
    p_payload ->> 'sell_unit',
    coalesce((p_payload ->> 'usable_in_production')::boolean, false),
    p_payload ->> 'product_unit',
    coalesce((p_payload ->> 'output_quantity')::numeric, 1),
    coalesce((p_payload ->> 'unit_price')::numeric, 0),
    coalesce((p_payload ->> 'total_cost')::numeric, 0),
    coalesce((p_payload ->> 'cost_per_unit')::numeric, 0),
    coalesce((p_payload ->> 'total_value')::numeric, 0),
    coalesce((p_payload ->> 'gains_per_unit')::numeric, 0),
    coalesce((p_payload ->> 'total_gains')::numeric, 0),
    public.current_username())
  returning * into v_fiche;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    insert into public.fiche_technic_lines (
      fiche_technic_id, product_id, product_name, quantity_used, source_type, unit, unit_cost, line_cost)
    values (
      v_fiche.id,
      nullif(v_line ->> 'product_id', '')::uuid,
      coalesce(v_line ->> 'product_name', 'Ingrédient'),
      coalesce((v_line ->> 'quantity_used')::numeric, 0),
      coalesce((v_line ->> 'source_type')::public.used_source_type, 'stock'),
      v_line ->> 'unit',
      coalesce((v_line ->> 'unit_cost')::numeric, 0),
      coalesce((v_line ->> 'line_cost')::numeric, 0));
  end loop;

  perform public.log_activity('production', 'create-fiche', 'fiche_technics', v_fiche.id, null);
  return v_fiche;
end;
$$;

-- Bouton « Mettre à jour » d'une fiche technique
create or replace function public.update_fiche_technic(p_id uuid, p_payload jsonb)
returns public.fiche_technics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiche public.fiche_technics;
  v_line  jsonb;
  v_cat   uuid;
begin
  v_cat := nullif(p_payload ->> 'category_id', '')::uuid;
  if v_cat is null and coalesce(p_payload ->> 'category_name', '') <> '' then
    insert into public.fiche_categories (name)
    values (p_payload ->> 'category_name')
    on conflict (name) do update set name = excluded.name
    returning id into v_cat;
  end if;

  update public.fiche_technics set
    name                 = coalesce(p_payload ->> 'name', name),
    category_id          = coalesce(v_cat, category_id),
    category_name        = coalesce(p_payload ->> 'category_name', category_name),
    description          = coalesce(p_payload ->> 'description', description),
    sell_by_unit         = coalesce((p_payload ->> 'sell_by_unit')::boolean, sell_by_unit),
    sell_unit            = p_payload ->> 'sell_unit',
    usable_in_production = coalesce((p_payload ->> 'usable_in_production')::boolean, usable_in_production),
    product_unit         = p_payload ->> 'product_unit',
    output_quantity      = coalesce((p_payload ->> 'output_quantity')::numeric, output_quantity),
    unit_price           = coalesce((p_payload ->> 'unit_price')::numeric, unit_price),
    total_cost           = coalesce((p_payload ->> 'total_cost')::numeric, total_cost),
    cost_per_unit        = coalesce((p_payload ->> 'cost_per_unit')::numeric, cost_per_unit),
    total_value          = coalesce((p_payload ->> 'total_value')::numeric, total_value),
    gains_per_unit       = coalesce((p_payload ->> 'gains_per_unit')::numeric, gains_per_unit),
    total_gains          = coalesce((p_payload ->> 'total_gains')::numeric, total_gains),
    updated_at           = now()
  where id = p_id
  returning * into v_fiche;

  if v_fiche.id is null then
    raise exception 'Fiche technique introuvable (%)', p_id;
  end if;

  if p_payload ? 'used_products' then
    delete from public.fiche_technic_lines where fiche_technic_id = p_id;
    for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
      insert into public.fiche_technic_lines (
        fiche_technic_id, product_id, product_name, quantity_used, source_type, unit, unit_cost, line_cost)
      values (
        p_id,
        nullif(v_line ->> 'product_id', '')::uuid,
        coalesce(v_line ->> 'product_name', 'Ingrédient'),
        coalesce((v_line ->> 'quantity_used')::numeric, 0),
        coalesce((v_line ->> 'source_type')::public.used_source_type, 'stock'),
        v_line ->> 'unit',
        coalesce((v_line ->> 'unit_cost')::numeric, 0),
        coalesce((v_line ->> 'line_cost')::numeric, 0));
    end loop;
  end if;

  return v_fiche;
end;
$$;

-- Les catégories de fiches doivent être lisibles/écrivables comme les autres
create or replace function public.upsert_fiche_category(p_name text)
returns public.fiche_categories
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.fiche_categories;
begin
  insert into public.fiche_categories (name) values (p_name)
  on conflict (name) do update set name = excluded.name
  returning * into v_row;
  return v_row;
end;
$$;


-- ============================================================================
-- 02. PRODUITS — code-barres / marque / catégorie devenus optionnels
-- ----------------------------------------------------------------------------
--  La création d'un produit ne demande plus que : nom, description, unité,
--  quantités et prix d'achat. Les anciennes colonnes restent en base pour ne
--  rien casser mais ne sont plus obligatoires.
-- ============================================================================

alter table public.products alter column barcode     drop not null;
alter table public.products alter column marque_id   drop not null;
alter table public.products alter column category_id drop not null;

-- l'unité devient l'information principale du produit
alter table public.products add column if not exists unit_enabled boolean not null default true;
alter table public.products alter column unit_enabled set default true;
update public.products set unit_enabled = true where unit is not null and unit <> '';

-- toutes les unités utilisées par les produits existent dans la liste `units`
insert into public.units (name)
select distinct trim(unit) from public.products
where unit is not null and trim(unit) <> ''
on conflict (name) do nothing;


-- ============================================================================
-- 03. RÈGLEMENTS FOURNISSEURS  (/suppliers > « Payer la dette »)
-- ============================================================================

create table if not exists public.supplier_payments (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references public.suppliers(id) on delete cascade,
  supplier_name text,
  amount        numeric(14,2) not null default 0,
  date          date not null default current_date,
  paid_at       timestamptz not null default now(),   -- date + heure du règlement
  notes         text default '',
  created_by    text default public.current_username(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists supplier_payments_supplier_idx on public.supplier_payments (supplier_id, paid_at desc);

-- Impute un montant sur les factures non soldées du fournisseur (FIFO)
create or replace function public.allocate_supplier_payment(p_supplier_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left numeric := coalesce(p_amount, 0);
  v_take numeric;
  r      record;
begin
  if v_left <= 0 then return; end if;
  for r in
    select id, rest_amount from public.purchases
     where supplier_id = p_supplier_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.purchases
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
end;
$$;

-- Retire un montant précédemment imputé (annulation / modification)
create or replace function public.deallocate_supplier_payment(p_supplier_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left numeric := coalesce(p_amount, 0);
  v_take numeric;
  r      record;
begin
  if v_left <= 0 then return; end if;
  for r in
    select id, paid_amount from public.purchases
     where supplier_id = p_supplier_id and paid_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.purchases
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = total_amount - greatest(0, paid_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
end;
$$;

-- Bouton « Payer la dette » d'une carte fournisseur
create or replace function public.pay_supplier(
  p_supplier_id uuid, p_amount numeric,
  p_paid_at timestamptz default now(), p_notes text default ''
) returns public.supplier_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.supplier_payments;
  v_name text;
begin
  if not public.has_perm('suppliers', 'pay') and not public.has_perm('suppliers', 'edit') then
    raise exception 'Vous n''avez pas la permission de régler un fournisseur';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;
  select name into v_name from public.suppliers where id = p_supplier_id;

  insert into public.supplier_payments (supplier_id, supplier_name, amount, date, paid_at, notes)
  values (p_supplier_id, v_name, p_amount,
          coalesce(p_paid_at, now())::date, coalesce(p_paid_at, now()), coalesce(p_notes, ''))
  returning * into v_row;

  perform public.allocate_supplier_payment(p_supplier_id, p_amount);
  perform public.log_activity('suppliers', 'pay', 'supplier_payments', v_row.id,
                              jsonb_build_object('amount', p_amount));
  return v_row;
end;
$$;

-- Bouton « Modifier » d'un règlement (dans l'historique fournisseur)
create or replace function public.update_supplier_payment(
  p_id uuid, p_amount numeric, p_paid_at timestamptz default null, p_notes text default null
) returns public.supplier_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.supplier_payments;
  v_row public.supplier_payments;
begin
  select * into v_old from public.supplier_payments where id = p_id;
  if v_old.id is null then raise exception 'Règlement introuvable'; end if;

  perform public.deallocate_supplier_payment(v_old.supplier_id, v_old.amount);

  update public.supplier_payments
     set amount     = coalesce(p_amount, amount),
         paid_at    = coalesce(p_paid_at, paid_at),
         date       = coalesce(p_paid_at, paid_at)::date,
         notes      = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_id
  returning * into v_row;

  perform public.allocate_supplier_payment(v_row.supplier_id, v_row.amount);
  return v_row;
end;
$$;

-- Bouton « Supprimer » d'un règlement
create or replace function public.delete_supplier_payment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_old public.supplier_payments;
begin
  select * into v_old from public.supplier_payments where id = p_id;
  if v_old.id is null then return; end if;
  perform public.deallocate_supplier_payment(v_old.supplier_id, v_old.amount);
  delete from public.supplier_payments where id = p_id;
end;
$$;

-- Le règlement fournisseur sort de la caisse
create or replace function public.trg_supplier_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caisse_transactions
    (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('withdrawal', new.amount, new.date,
          'Règlement fournisseur: ' || coalesce(new.supplier_name, ''),
          'Fournisseurs', 'supplier_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do update
     set amount = excluded.amount, date = excluded.date, updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_supplier_payment_caisse on public.supplier_payments;
create trigger trg_supplier_payment_caisse
  after insert or update of amount, date on public.supplier_payments
  for each row execute function public.trg_supplier_payment_to_caisse();

drop trigger if exists trg_supplier_payment_caisse_del on public.supplier_payments;
create trigger trg_supplier_payment_caisse_del
  before delete on public.supplier_payments
  for each row execute function public.trg_delete_linked_caisse();


-- ============================================================================
-- 04. RÈGLEMENTS CLIENTS  (/clients > « Payer la dette »)
-- ============================================================================

create table if not exists public.client_payments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  client_name text,
  amount      numeric(14,2) not null default 0,
  date        date not null default current_date,
  paid_at     timestamptz not null default now(),
  notes       text default '',
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists client_payments_client_idx on public.client_payments (client_id, paid_at desc);

-- Impute un versement sur les ventes puis les commandes non soldées (FIFO)
create or replace function public.allocate_client_payment(p_client_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left numeric := coalesce(p_amount, 0);
  v_take numeric;
  r      record;
begin
  if v_left <= 0 then return; end if;

  for r in
    select id, rest_amount from public.sales
     where client_id = p_client_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.sales
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           status      = case when greatest(0, rest_amount - v_take) <= 0 then 'paid'::public.sale_status
                              else 'debt'::public.sale_status end,
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, rest_amount from public.commands
     where client_id = p_client_id and rest_amount > 0
     order by created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.commands
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
end;
$$;

create or replace function public.deallocate_client_payment(p_client_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left numeric := coalesce(p_amount, 0);
  v_take numeric;
  r      record;
begin
  if v_left <= 0 then return; end if;

  for r in
    select id, paid_amount from public.commands
     where client_id = p_client_id and paid_amount > 0
     order by created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.commands
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = total_amount - greatest(0, paid_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, paid_amount from public.sales
     where client_id = p_client_id and paid_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.sales
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = final_amount - greatest(0, paid_amount - v_take),
           status      = case when final_amount - greatest(0, paid_amount - v_take) <= 0
                              then 'paid'::public.sale_status else 'debt'::public.sale_status end,
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
end;
$$;

create or replace function public.pay_client(
  p_client_id uuid, p_amount numeric,
  p_paid_at timestamptz default now(), p_notes text default ''
) returns public.client_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.client_payments;
  v_name text;
begin
  if not public.has_perm('clients', 'pay') and not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission d''encaisser un client';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;
  select name into v_name from public.clients where id = p_client_id;

  insert into public.client_payments (client_id, client_name, amount, date, paid_at, notes)
  values (p_client_id, v_name, p_amount,
          coalesce(p_paid_at, now())::date, coalesce(p_paid_at, now()), coalesce(p_notes, ''))
  returning * into v_row;

  perform public.allocate_client_payment(p_client_id, p_amount);
  perform public.log_activity('clients', 'pay', 'client_payments', v_row.id,
                              jsonb_build_object('amount', p_amount));
  return v_row;
end;
$$;

create or replace function public.update_client_payment(
  p_id uuid, p_amount numeric, p_paid_at timestamptz default null, p_notes text default null
) returns public.client_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.client_payments;
  v_row public.client_payments;
begin
  select * into v_old from public.client_payments where id = p_id;
  if v_old.id is null then raise exception 'Règlement introuvable'; end if;

  perform public.deallocate_client_payment(v_old.client_id, v_old.amount);

  update public.client_payments
     set amount     = coalesce(p_amount, amount),
         paid_at    = coalesce(p_paid_at, paid_at),
         date       = coalesce(p_paid_at, paid_at)::date,
         notes      = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_id
  returning * into v_row;

  perform public.allocate_client_payment(v_row.client_id, v_row.amount);
  return v_row;
end;
$$;

create or replace function public.delete_client_payment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_old public.client_payments;
begin
  select * into v_old from public.client_payments where id = p_id;
  if v_old.id is null then return; end if;
  perform public.deallocate_client_payment(v_old.client_id, v_old.amount);
  delete from public.client_payments where id = p_id;
end;
$$;

-- Le règlement client entre en caisse
create or replace function public.trg_client_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caisse_transactions
    (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('deposit', new.amount, new.date,
          'Règlement client: ' || coalesce(new.client_name, ''),
          'Clients', 'client_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do update
     set amount = excluded.amount, date = excluded.date, updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_client_payment_caisse on public.client_payments;
create trigger trg_client_payment_caisse
  after insert or update of amount, date on public.client_payments
  for each row execute function public.trg_client_payment_to_caisse();

drop trigger if exists trg_client_payment_caisse_del on public.client_payments;
create trigger trg_client_payment_caisse_del
  before delete on public.client_payments
  for each row execute function public.trg_delete_linked_caisse();


-- ============================================================================
-- 05. LIVRAISONS DE COMMANDES  (/commands > « Livraison »)
-- ----------------------------------------------------------------------------
--  Une commande peut être livrée en plusieurs fois : chaque livraison stocke la
--  quantité effectivement livrée par produit. La commande passe en « finalisée »
--  seulement quand TOUTES les quantités commandées ont été livrées.
-- ============================================================================

alter table public.command_items
  add column if not exists delivered_quantity numeric(14,3) not null default 0;

-- Les commandes déjà marquées « finalisées » avant cette mise à jour sont
-- considérées comme entièrement livrées, sinon elles réapparaîtraient en alerte.
update public.command_items ci
   set delivered_quantity = ci.quantity
  from public.commands c
 where c.id = ci.command_id
   and c.status = 'finalised'
   and ci.delivered_quantity = 0;

create table if not exists public.command_deliveries (
  id          uuid primary key default gen_random_uuid(),
  command_id  uuid not null references public.commands(id) on delete cascade,
  reference   text not null,
  date        date not null default current_date,
  delivered_at timestamptz not null default now(),
  notes       text default '',
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists command_deliveries_cmd_idx on public.command_deliveries (command_id, delivered_at desc);

create table if not exists public.command_delivery_items (
  id              uuid primary key default gen_random_uuid(),
  delivery_id     uuid not null references public.command_deliveries(id) on delete cascade,
  command_item_id uuid references public.command_items(id) on delete set null,
  product_name    text not null,
  quantity        numeric(14,3) not null default 0,
  sell_unit       text,
  created_at      timestamptz not null default now()
);
create index if not exists command_delivery_items_idx on public.command_delivery_items (delivery_id);

-- recalcule delivered_quantity de chaque ligne + le statut de la commande
create or replace function public.recompute_command_delivery(p_command_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_pending int;
begin
  update public.command_items ci
     set delivered_quantity = coalesce((
       select sum(di.quantity)
         from public.command_delivery_items di
         join public.command_deliveries d on d.id = di.delivery_id
        where di.command_item_id = ci.id and d.command_id = p_command_id), 0)
   where ci.command_id = p_command_id;

  select count(*) into v_pending
    from public.command_items
   where command_id = p_command_id and delivered_quantity < quantity;

  update public.commands
     set status = case when v_pending = 0 then 'finalised'::public.command_status
                       else 'pending'::public.command_status end,
         updated_at = now()
   where id = p_command_id and status <> 'cancelled';
end;
$$;

-- Bouton « Valider la livraison »
create or replace function public.create_command_delivery(p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_del  public.command_deliveries;
  v_cmd  public.commands;
  v_item jsonb;
  v_ref  text;
  v_seq  int;
begin
  if not public.has_perm('clients', 'edit') and not public.has_perm('clients', 'create') then
    raise exception 'Vous n''avez pas la permission de livrer une commande';
  end if;
  select * into v_cmd from public.commands where id = (p_payload ->> 'command_id')::uuid;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  select count(*) + 1 into v_seq from public.command_deliveries where command_id = v_cmd.id;
  v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');

  insert into public.command_deliveries (command_id, reference, date, delivered_at, notes)
  values (v_cmd.id, v_ref,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now())::date,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now()),
          coalesce(p_payload ->> 'notes', ''))
  returning * into v_del;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
      insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
      values (v_del.id,
              nullif(v_item ->> 'command_item_id', '')::uuid,
              coalesce(v_item ->> 'product_name', 'Produit'),
              coalesce((v_item ->> 'quantity')::numeric, 0),
              v_item ->> 'sell_unit');
    end if;
  end loop;

  perform public.recompute_command_delivery(v_cmd.id);
  perform public.log_activity('clients', 'deliver', 'command_deliveries', v_del.id, p_payload);
  return v_del;
end;
$$;

-- Bouton « Modifier » d'une livraison
create or replace function public.update_command_delivery(p_id uuid, p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_del  public.command_deliveries;
  v_item jsonb;
begin
  update public.command_deliveries
     set delivered_at = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at),
         date         = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at)::date,
         notes        = coalesce(p_payload ->> 'notes', notes),
         updated_at   = now()
   where id = p_id
  returning * into v_del;

  if v_del.id is null then raise exception 'Livraison introuvable'; end if;

  if p_payload ? 'items' then
    delete from public.command_delivery_items where delivery_id = p_id;
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
      if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
        insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
        values (p_id,
                nullif(v_item ->> 'command_item_id', '')::uuid,
                coalesce(v_item ->> 'product_name', 'Produit'),
                coalesce((v_item ->> 'quantity')::numeric, 0),
                v_item ->> 'sell_unit');
      end if;
    end loop;
  end if;

  perform public.recompute_command_delivery(v_del.command_id);
  return v_del;
end;
$$;

-- Bouton « Supprimer » d'une livraison
create or replace function public.delete_command_delivery(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_cmd uuid;
begin
  select command_id into v_cmd from public.command_deliveries where id = p_id;
  delete from public.command_deliveries where id = p_id;
  if v_cmd is not null then perform public.recompute_command_delivery(v_cmd); end if;
end;
$$;


-- ============================================================================
-- 06. HEURES SUPPLÉMENTAIRES  (/workers > « Heures sup. »)
-- ============================================================================

alter table public.worker_payments
  add column if not exists kind text not null default 'salary';   -- salary | overtime

create table if not exists public.worker_overtimes (
  id                  uuid primary key default gen_random_uuid(),
  worker_id           uuid not null references public.workers(id) on delete cascade,
  date                date not null default current_date,
  work_end_hour       int  not null default 0,     -- fin du travail normal
  work_end_minute     int  not null default 0,
  overtime_end_hour   int  not null default 0,     -- fin des heures sup.
  overtime_end_minute int  not null default 0,
  hours               numeric(10,2) not null default 0,   -- durée calculée (décimale)
  hourly_rate         numeric(14,2) not null default 0,
  amount              numeric(14,2) not null default 0,   -- total (modifiable)
  description         text default '',
  is_paid             boolean not null default false,
  paid_at             timestamptz,
  payment_id          uuid references public.worker_payments(id) on delete set null,
  created_by          text default public.current_username(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists worker_overtimes_worker_idx on public.worker_overtimes (worker_id, date desc);
create index if not exists worker_overtimes_unpaid_idx on public.worker_overtimes (worker_id) where not is_paid;

create or replace function public.add_worker_overtime(p_payload jsonb)
returns public.worker_overtimes
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.worker_overtimes;
begin
  if not public.has_perm('workers', 'create') then
    raise exception 'Vous n''avez pas la permission d''ajouter des heures supplémentaires';
  end if;

  insert into public.worker_overtimes (
    worker_id, date, work_end_hour, work_end_minute,
    overtime_end_hour, overtime_end_minute, hours, hourly_rate, amount, description)
  values (
    (p_payload ->> 'worker_id')::uuid,
    coalesce((p_payload ->> 'date')::date, current_date),
    coalesce((p_payload ->> 'work_end_hour')::int, 0),
    coalesce((p_payload ->> 'work_end_minute')::int, 0),
    coalesce((p_payload ->> 'overtime_end_hour')::int, 0),
    coalesce((p_payload ->> 'overtime_end_minute')::int, 0),
    coalesce((p_payload ->> 'hours')::numeric, 0),
    coalesce((p_payload ->> 'hourly_rate')::numeric, 0),
    coalesce((p_payload ->> 'amount')::numeric, 0),
    coalesce(p_payload ->> 'description', ''))
  returning * into v_row;

  perform public.log_activity('workers', 'overtime', 'worker_overtimes', v_row.id, p_payload);
  return v_row;
end;
$$;

create or replace function public.update_worker_overtime(p_id uuid, p_payload jsonb)
returns public.worker_overtimes
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.worker_overtimes;
begin
  update public.worker_overtimes set
    date                = coalesce((p_payload ->> 'date')::date, date),
    work_end_hour       = coalesce((p_payload ->> 'work_end_hour')::int, work_end_hour),
    work_end_minute     = coalesce((p_payload ->> 'work_end_minute')::int, work_end_minute),
    overtime_end_hour   = coalesce((p_payload ->> 'overtime_end_hour')::int, overtime_end_hour),
    overtime_end_minute = coalesce((p_payload ->> 'overtime_end_minute')::int, overtime_end_minute),
    hours               = coalesce((p_payload ->> 'hours')::numeric, hours),
    hourly_rate         = coalesce((p_payload ->> 'hourly_rate')::numeric, hourly_rate),
    amount              = coalesce((p_payload ->> 'amount')::numeric, amount),
    description         = coalesce(p_payload ->> 'description', description),
    updated_at          = now()
  where id = p_id and not is_paid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Heures supplémentaires introuvables ou déjà payées';
  end if;
  return v_row;
end;
$$;

create or replace function public.delete_worker_overtime(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.worker_overtimes where id = p_id;
$$;

-- Bouton « Payer les heures supplémentaires » — sort de la caisse et marque
-- les lignes comme payées afin qu'elles disparaissent de l'écran Paiement.
create or replace function public.pay_worker_overtimes(
  p_worker_id uuid, p_ids uuid[] default null,
  p_date date default current_date, p_description text default ''
) returns public.worker_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total   numeric := 0;
  v_payment public.worker_payments;
  v_ids     uuid[];
begin
  if not public.has_perm('workers', 'pay') and not public.has_perm('workers', 'edit') then
    raise exception 'Vous n''avez pas la permission de payer un employé';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    select array_agg(id) into v_ids
      from public.worker_overtimes where worker_id = p_worker_id and not is_paid;
  else
    v_ids := p_ids;
  end if;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'Aucune heure supplémentaire à payer';
  end if;

  select coalesce(sum(amount), 0) into v_total
    from public.worker_overtimes
   where id = any(v_ids) and worker_id = p_worker_id and not is_paid;

  if v_total <= 0 then
    raise exception 'Montant à payer nul';
  end if;

  insert into public.worker_payments (worker_id, date, period, amount, description, kind)
  values (p_worker_id, coalesce(p_date, current_date),
          to_char(coalesce(p_date, current_date), 'YYYY-MM'),
          v_total,
          coalesce(nullif(p_description, ''), 'Paiement heures supplémentaires'),
          'overtime')
  returning * into v_payment;

  update public.worker_overtimes
     set is_paid = true, paid_at = now(), payment_id = v_payment.id, updated_at = now()
   where id = any(v_ids) and worker_id = p_worker_id and not is_paid;

  return v_payment;
end;
$$;

-- Supprimer un paiement d'heures sup. remet les lignes en « non payées »
create or replace function public.trg_unpay_overtimes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.worker_overtimes
     set is_paid = false, paid_at = null, payment_id = null
   where payment_id = old.id;
  return old;
end;
$$;
drop trigger if exists trg_worker_payment_unpay_overtime on public.worker_payments;
create trigger trg_worker_payment_unpay_overtime
  before delete on public.worker_payments
  for each row execute function public.trg_unpay_overtimes();


-- ============================================================================
-- 07. BONS DE COMMANDE  (/expenses > « Bon de commande »)
-- ============================================================================

create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  date          date not null default current_date,
  supplier_name text default '',
  notes         text default '',
  created_by    text default public.current_username(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.purchase_orders(id) on delete cascade,
  product_name text not null,
  description  text default '',
  quantity     numeric(14,3) not null default 0,
  unit         text,
  created_at   timestamptz not null default now()
);
create index if not exists purchase_order_items_idx on public.purchase_order_items (order_id);

create or replace function public.create_purchase_order(p_payload jsonb)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.purchase_orders;
  v_item  jsonb;
  v_ref   text;
  v_seq   int;
  v_date  date := coalesce((p_payload ->> 'date')::date, current_date);
begin
  if not public.has_perm('expenses', 'create') then
    raise exception 'Vous n''avez pas la permission de créer un bon de commande';
  end if;

  select count(*) + 1 into v_seq from public.purchase_orders;
  v_ref := 'BC-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.purchase_orders where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'BC-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  insert into public.purchase_orders (reference, date, supplier_name, notes)
  values (v_ref, v_date, coalesce(p_payload ->> 'supplier_name', ''), coalesce(p_payload ->> 'notes', ''))
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    insert into public.purchase_order_items (order_id, product_name, description, quantity, unit)
    values (v_order.id,
            coalesce(v_item ->> 'product_name', 'Produit'),
            coalesce(v_item ->> 'description', ''),
            coalesce((v_item ->> 'quantity')::numeric, 0),
            v_item ->> 'unit');
  end loop;

  return v_order;
end;
$$;

create or replace function public.update_purchase_order(p_id uuid, p_payload jsonb)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.purchase_orders;
  v_item  jsonb;
begin
  update public.purchase_orders
     set date          = coalesce((p_payload ->> 'date')::date, date),
         supplier_name = coalesce(p_payload ->> 'supplier_name', supplier_name),
         notes         = coalesce(p_payload ->> 'notes', notes),
         updated_at    = now()
   where id = p_id
  returning * into v_order;

  if v_order.id is null then raise exception 'Bon de commande introuvable'; end if;

  if p_payload ? 'items' then
    delete from public.purchase_order_items where order_id = p_id;
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
      insert into public.purchase_order_items (order_id, product_name, description, quantity, unit)
      values (p_id,
              coalesce(v_item ->> 'product_name', 'Produit'),
              coalesce(v_item ->> 'description', ''),
              coalesce((v_item ->> 'quantity')::numeric, 0),
              v_item ->> 'unit');
    end loop;
  end if;

  return v_order;
end;
$$;


-- ============================================================================
-- 08. VENTES — prix unitaire modifiable à la vente
-- ----------------------------------------------------------------------------
--  `sale_lines.selling_price` est déjà renseigné par create_sale() avec le prix
--  saisi au POS : il suffit d'exposer aussi le prix d'origine du comptoir pour
--  pouvoir afficher « prix catalogue » vs « prix appliqué ».
-- ============================================================================

alter table public.sale_lines add column if not exists base_price numeric(14,2);

-- create_sale() enrichi : la ligne mémorise aussi le prix catalogue (base_price)
create or replace function public.create_sale(p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale   public.sales;
  v_ref    text;
  v_line   jsonb;
  v_total  numeric := 0;
  v_red    numeric := coalesce((p_payload ->> 'reduction')::numeric, 0);
  v_final  numeric;
  v_paid   numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_rest   numeric;
  v_date   date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_status public.sale_status;
  v_seq    int;
  v_pid    uuid;
  v_cid    uuid;
  v_qty    numeric;
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.sales;
  v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.sales where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_line ->> 'quantity')::numeric, 0)
                       * coalesce((v_line ->> 'selling_price')::numeric, 0);
  end loop;
  v_total  := coalesce((p_payload ->> 'total_amount')::numeric, v_total);
  v_final  := coalesce((p_payload ->> 'final_amount')::numeric, greatest(0, v_total - v_red));
  v_rest   := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  insert into public.sales (reference, client_id, date, total_amount, reduction, final_amount,
                            paid_amount, rest_amount, status, note, created_by)
  values (v_ref, nullif(p_payload ->> 'client_id', '')::uuid, v_date,
          v_total, v_red, v_final, v_paid, v_rest, v_status,
          p_payload ->> 'note', public.current_username())
  returning * into v_sale;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_pid := nullif(v_line ->> 'product_id', '')::uuid;
    v_cid := nullif(v_line ->> 'comptoir_id', '')::uuid;
    v_qty := coalesce((v_line ->> 'quantity')::numeric, 0);

    insert into public.sale_lines (sale_id, product_id, comptoir_id, product_name, quantity,
                                   selling_price, base_price, sell_by_unit, unit)
    values (v_sale.id, v_pid, v_cid,
            coalesce(v_line ->> 'product_name', 'Produit'), v_qty,
            coalesce((v_line ->> 'selling_price')::numeric, 0),
            nullif(v_line ->> 'base_price', '')::numeric,
            coalesce((v_line ->> 'sell_by_unit')::boolean, false),
            v_line ->> 'unit');

    if v_cid is not null then
      update public.comptoir_items
         set quantity = greatest(0, quantity - v_qty), updated_at = now()
       where id = v_cid;
    elsif v_pid is not null then
      perform public.consume_stock(v_pid, v_qty, 'sale', 'sales', v_sale.id);
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, v_date, v_paid, 'Paiement vente');
  end if;

  if v_rest > 0 and v_sale.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_sale.client_id, c.name, c.phone, v_rest, v_rest, v_date,
           'Reste vente ' || v_ref, public.current_username()
      from public.clients c where c.id = v_sale.client_id;
  end if;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$$;

create or replace function public.trg_sale_line_base_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.base_price is null and new.comptoir_id is not null then
    select unit_price into new.base_price from public.comptoir_items where id = new.comptoir_id;
  end if;
  if new.base_price is null and new.product_id is not null then
    select purchase_price into new.base_price from public.products where id = new.product_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sale_line_base on public.sale_lines;
create trigger trg_sale_line_base
  before insert on public.sale_lines
  for each row execute function public.trg_sale_line_base_price();


-- ============================================================================
-- 09. VUES — soldes clients / fournisseurs, heures sup., livraisons
-- ============================================================================

create or replace view public.v_supplier_debts as
select
  s.id                                                              as supplier_id,
  s.name                                                            as supplier_name,
  s.phone,
  s.address,
  coalesce((select sum(p.total_amount) from public.purchases p where p.supplier_id = s.id), 0) as total_debt,
  coalesce((select sum(p.paid_amount)  from public.purchases p where p.supplier_id = s.id), 0) as total_paid,
  coalesce((select sum(p.rest_amount)  from public.purchases p where p.supplier_id = s.id), 0) as rest_amount,
  coalesce((select count(*) from public.purchases p where p.supplier_id = s.id), 0)            as purchases_count,
  coalesce((select count(*) from public.supplier_payments sp where sp.supplier_id = s.id), 0)  as payments_count
from public.suppliers s;

create or replace view public.v_client_debts as
select
  c.id                                                              as client_id,
  c.name                                                            as client_name,
  c.phone,
  coalesce((select sum(sa.final_amount) from public.sales sa where sa.client_id = c.id), 0)
  + coalesce((select sum(cm.total_amount) from public.commands cm where cm.client_id = c.id), 0) as total_debt,
  coalesce((select sum(sa.paid_amount) from public.sales sa where sa.client_id = c.id), 0)
  + coalesce((select sum(cm.paid_amount) from public.commands cm where cm.client_id = c.id), 0)  as total_paid,
  coalesce((select sum(sa.rest_amount) from public.sales sa where sa.client_id = c.id), 0)
  + coalesce((select sum(cm.rest_amount) from public.commands cm where cm.client_id = c.id), 0)  as rest_amount,
  coalesce((select count(*) from public.sales sa where sa.client_id = c.id), 0)                  as sales_count,
  coalesce((select count(*) from public.commands cm where cm.client_id = c.id), 0)               as commands_count
from public.clients c;

create or replace view public.v_worker_overtime_summary as
select
  w.id                                                       as worker_id,
  w.full_name,
  coalesce(sum(o.hours), 0)                                  as total_hours,
  coalesce(sum(o.amount), 0)                                 as total_amount,
  coalesce(sum(o.amount) filter (where not o.is_paid), 0)    as unpaid_amount,
  coalesce(sum(o.hours)  filter (where not o.is_paid), 0)    as unpaid_hours,
  count(o.id)                                                as entries
from public.workers w
left join public.worker_overtimes o on o.worker_id = w.id
group by w.id, w.full_name;

create or replace view public.v_command_delivery_status as
select
  c.id                                                    as command_id,
  c.reference,
  c.client_name,
  coalesce(sum(ci.quantity), 0)                           as ordered_quantity,
  coalesce(sum(ci.delivered_quantity), 0)                 as delivered_quantity,
  coalesce(sum(ci.quantity - ci.delivered_quantity), 0)   as remaining_quantity,
  bool_and(ci.delivered_quantity >= ci.quantity)          as fully_delivered
from public.commands c
left join public.command_items ci on ci.command_id = c.id
group by c.id, c.reference, c.client_name;

do $$
declare v record;
begin
  for v in select table_name from information_schema.views where table_schema = 'public'
  loop
    begin
      execute format('alter view public.%I set (security_invoker = true)', v.table_name);
    exception when others then null;
    end;
  end loop;
end
$$;


-- ============================================================================
-- 10. RLS & GRANTS DES NOUVELLES TABLES
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select * from (values
      ('supplier_payments',     'suppliers'),
      ('client_payments',       'clients'),
      ('command_deliveries',    'clients'),
      ('command_delivery_items','clients'),
      ('worker_overtimes',      'workers'),
      ('purchase_orders',       'expenses'),
      ('purchase_order_items',  'expenses')
    ) as t(tbl, module)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    execute format('drop policy if exists %I on public.%I', r.tbl || '_sel', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_ins', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_upd', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_del', r.tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_perm(%L, ''view''))',
      r.tbl || '_sel', r.tbl, r.module);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_perm(%L, ''create''))',
      r.tbl || '_ins', r.tbl, r.module);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_perm(%L, ''edit'')) with check (public.has_perm(%L, ''edit''))',
      r.tbl || '_upd', r.tbl, r.module, r.module);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_perm(%L, ''delete''))',
      r.tbl || '_del', r.tbl, r.module);
  end loop;
end
$$;

-- les catégories de fiches techniques suivent le module production
alter table public.fiche_categories enable row level security;
drop policy if exists fiche_categories_sel on public.fiche_categories;
drop policy if exists fiche_categories_ins on public.fiche_categories;
drop policy if exists fiche_categories_upd on public.fiche_categories;
drop policy if exists fiche_categories_del on public.fiche_categories;
create policy fiche_categories_sel on public.fiche_categories
  for select to authenticated using (public.has_perm('production', 'view'));
create policy fiche_categories_ins on public.fiche_categories
  for insert to authenticated with check (public.has_perm('production', 'create'));
create policy fiche_categories_upd on public.fiche_categories
  for update to authenticated using (public.has_perm('production', 'edit'))
  with check (public.has_perm('production', 'edit'));
create policy fiche_categories_del on public.fiche_categories
  for delete to authenticated using (public.has_perm('production', 'delete'));

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- le créateur brut de comptes auth reste interdit au navigateur
revoke execute on function public.create_auth_account(text, text, jsonb) from anon, authenticated, public;
grant execute on function public.resolve_login_email(text)                    to anon, authenticated;
grant execute on function public.admin_account_exists()                       to anon, authenticated;
grant execute on function public.create_admin_account(text, text, text, text) to anon, authenticated;

-- rafraîchissement temps réel des nouveaux écrans
do $$
declare t text;
begin
  for t in select unnest(array[
      'supplier_payments','client_payments','command_deliveries','command_delivery_items',
      'worker_overtimes','purchase_orders','purchase_order_items','fiche_technics','fiche_technic_lines'])
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
              when undefined_object then null;
    end;
  end loop;
end
$$;


-- ============================================================================
--  FIN — Mise à jour 2026 appliquée.
-- ============================================================================

;


-- ===== altech_production_update_achat_bon_matricule.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  MISE À JOUR — ACHATS : n° de bon de livraison + matricule du chauffeur
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS `altech_production_supabase.sql`
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  CONTENU
--   01. Colonnes bon_number / driver_plate sur public.purchases
--   02. RPC create_purchase() : enregistre les deux nouveaux champs
--   03. Vue de contrôle des bons d'achat (optionnelle)
-- ============================================================================


-- ============================================================================
-- 01. NOUVELLES COLONNES SUR LES FACTURES D'ACHAT
-- ============================================================================

alter table public.purchases
  add column if not exists bon_number  text,
  add column if not exists driver_plate text;

comment on column public.purchases.bon_number   is 'N° du bon de livraison remis par le fournisseur';
comment on column public.purchases.driver_plate is 'Immatriculation du camion / chauffeur ayant livré';

-- Recherche rapide par n° de bon ou par matricule (/purchase > barre de recherche)
create index if not exists purchases_bon_number_idx
  on public.purchases (lower(bon_number));
create index if not exists purchases_driver_plate_idx
  on public.purchases (lower(driver_plate));


-- ============================================================================
-- 02. RPC create_purchase() — prise en compte du bon et du matricule
-- ----------------------------------------------------------------------------
--  Bouton « Créer la facture & mettre à jour le stock » (CreatePurchase)
--  Crée la facture, ses lignes, son premier paiement et met à jour le stock
--  dans une seule transaction.
-- ============================================================================

create or replace function public.create_purchase(p_payload jsonb)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.purchases;
  v_ref      text;
  v_line     jsonb;
  v_total    numeric := 0;
  v_paid     numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_date     date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_seq      int;
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.purchases;
  v_ref := 'ACH-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.purchases where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'ACH-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_line ->> 'quantity')::numeric, 0)
                       * coalesce((v_line ->> 'purchase_price')::numeric, 0);
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  insert into public.purchases (reference, supplier_id, date, bon_number, driver_plate,
                                total_amount, paid_amount, rest_amount, note, created_by)
  values (v_ref,
          nullif(p_payload ->> 'supplier_id', '')::uuid,
          v_date,
          nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), ''),
          nullif(upper(btrim(coalesce(p_payload ->> 'driver_plate', ''))), ''),
          v_total, v_paid, greatest(0, v_total - v_paid),
          p_payload ->> 'note',
          public.current_username())
  returning * into v_purchase;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    insert into public.purchase_lines (
      purchase_id, product_id, product_name, quantity, purchase_price,
      min_alert_quantity, unit_enabled, unit, expiration_enabled, expiration_date)
    values (
      v_purchase.id,
      nullif(v_line ->> 'product_id', '')::uuid,
      coalesce(v_line ->> 'product_name', 'Produit'),
      coalesce((v_line ->> 'quantity')::numeric, 0),
      coalesce((v_line ->> 'purchase_price')::numeric, 0),
      nullif(v_line ->> 'min_alert_quantity', '')::numeric,
      coalesce((v_line ->> 'unit_enabled')::boolean, false),
      v_line ->> 'unit',
      coalesce((v_line ->> 'expiration_enabled')::boolean, false),
      nullif(v_line ->> 'expiration_date', '')::date
    );
  end loop;

  if v_paid > 0 then
    insert into public.purchase_payments (purchase_id, date, amount, description)
    values (v_purchase.id, v_date, v_paid, 'Acompte achat');
  end if;

  perform public.log_activity('purchase', 'create', 'purchases', v_purchase.id, p_payload);
  select * into v_purchase from public.purchases where id = v_purchase.id;
  return v_purchase;
end;
$$;

grant execute on function public.create_purchase(jsonb) to authenticated, service_role;


-- ============================================================================
-- 03. VUE DE CONTRÔLE — bons d'achat par fournisseur / camion
-- ============================================================================

create or replace view public.v_purchase_bons as
select p.id,
       p.reference,
       p.date,
       p.bon_number,
       p.driver_plate,
       s.name as supplier_name,
       p.total_amount,
       p.paid_amount,
       p.rest_amount
  from public.purchases p
  left join public.suppliers s on s.id = p.supplier_id
 order by p.date desc, p.reference desc;

-- comme toutes les vues du projet : les droits RLS de l'utilisateur s'appliquent
alter view public.v_purchase_bons set (security_invoker = true);
grant select on public.v_purchase_bons to authenticated, service_role;

-- ============================================================================
--  FIN DE LA MISE À JOUR
-- ============================================================================

;


-- ===== altech_production_update_pos_production_rapports.sql =====
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

;


-- ===== altech_production_update_fix_categorie_production.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  CORRECTIF — « Enregistrement impossible — un élément lié est introuvable »
--              (violates foreign key constraint "productions_category_id_fkey")
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS :
--    1. altech_production_supabase.sql
--    2. altech_production_update_2026.sql
--    3. altech_production_update_achat_bon_matricule.sql
--    4. altech_production_update_pos_production_rapports.sql
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  LE PROBLÈME
--   `fiche_technics.category_id` pointe sur `fiche_categories`
--   `productions.category_id`    pointe sur `production_categories`
--   Le point de vente (et l'écran Production quand la production part d'une
--   fiche technique) recopiait la catégorie de la fiche dans la production :
--   l'identifiant n'existe pas dans `production_categories`, la clé étrangère
--   `productions_category_id_fkey` refuse l'insertion et la vente échoue (409).
--
--  LA CORRECTION
--   `resolve_production_category()` traduit l'identifiant reçu en catégorie de
--   production : la même par son nom si elle existe, sinon elle est créée à la
--   volée ; à défaut seul le libellé est conservé. `create_production()`
--   l'appelle systématiquement, donc les deux écrans (point de vente et
--   Production) sont réparés en une seule fois.
-- ----------------------------------------------------------------------------
--  CONTENU
--   01. Fonction resolve_production_category()
--   02. create_production() — catégorie traduite avant l'insertion
--   03. Rattrapage des productions déjà enregistrées sans catégorie liée
-- ============================================================================


-- ============================================================================
-- 01. RESOLVE_PRODUCTION_CATEGORY() — traduit une catégorie « étrangère »
-- ----------------------------------------------------------------------------
--  Renvoie toujours un id valide de `production_categories`, ou NULL quand
--  aucun nom exploitable n'est fourni (la production garde alors son libellé).
-- ============================================================================

create or replace function public.resolve_production_category(
  p_category_id uuid, p_category_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id   uuid;
  v_name text;
begin
  -- 1) l'id est déjà une catégorie de production : rien à faire
  if p_category_id is not null then
    select id into v_id from public.production_categories where id = p_category_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- 2) sinon on cherche un nom : celui transmis, sinon celui de la catégorie
  --    réellement désignée par l'id (fiche technique, puis stock)
  v_name := nullif(btrim(coalesce(p_category_name, '')), '');
  if v_name is null and p_category_id is not null then
    select name into v_name from public.fiche_categories where id = p_category_id;
  end if;
  if v_name is null and p_category_id is not null then
    select name into v_name from public.categories where id = p_category_id;
  end if;
  if v_name is null then
    return null;
  end if;

  -- 3) même nom côté production, créée à la volée si elle n'existe pas encore
  select id into v_id
    from public.production_categories
   where lower(btrim(name)) = lower(v_name)
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.production_categories (name)
  values (v_name)
  on conflict (name) do update set name = excluded.name
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.resolve_production_category(uuid, text) is
  'Traduit une categorie venant d un autre module (fiche technique, stock) en categorie de production valide';

grant execute on function public.resolve_production_category(uuid, text) to authenticated, service_role;


-- ============================================================================
-- 02. CREATE_PRODUCTION() — la catégorie est traduite avant l'insertion
-- ----------------------------------------------------------------------------
--  Identique à la version d'origine, aux lignes `v_cat` / `v_cat_name` près.
--  Corrige d'un coup « Lancer la production » (écran Production à partir d'une
--  fiche technique) et le point de vente, dont create_sale_with_productions()
--  appelle cette fonction pour chaque ligne « fiche technique » du panier.
-- ============================================================================

create or replace function public.create_production(p_payload jsonb)
returns public.productions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod     public.productions;
  v_line     jsonb;
  v_cost     numeric := 0;
  v_out      numeric := coalesce((p_payload ->> 'output_quantity')::numeric, 0);
  v_price    numeric := coalesce((p_payload ->> 'unit_price')::numeric, 0);
  v_cat      uuid;
  v_cat_name text;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    v_cost := v_cost + coalesce((v_line ->> 'line_cost')::numeric,
                coalesce((v_line ->> 'quantity_used')::numeric, 0) * coalesce((v_line ->> 'unit_cost')::numeric, 0));
  end loop;

  -- la categorie recue peut venir d une fiche technique : elle est traduite en
  -- categorie de production, sinon la cle etrangere refuse l insertion
  v_cat := public.resolve_production_category(
             nullif(p_payload ->> 'category_id', '')::uuid,
             p_payload ->> 'category_name');
  v_cat_name := coalesce(
    nullif(btrim(coalesce(p_payload ->> 'category_name', '')), ''),
    (select name from public.production_categories where id = v_cat));

  insert into public.productions (name, description, date, hour, category_id, category_name,
                                  fiche_technic_id, total_cost, output_quantity, unit_price,
                                  total_value, sell_by_unit, sell_unit, sent_to_comptoir,
                                  has_loss, expected_quantity, loss_quantity, loss_description,
                                  loss_value, created_by)
  values (coalesce(p_payload ->> 'name', 'Production'),
          coalesce(p_payload ->> 'description', ''),
          coalesce((p_payload ->> 'date')::date, current_date),
          coalesce(p_payload ->> 'hour', to_char(now(), 'HH24:MI')),
          v_cat,
          v_cat_name,
          nullif(p_payload ->> 'fiche_technic_id', '')::uuid,
          v_cost, v_out, v_price, v_out * v_price,
          coalesce((p_payload ->> 'sell_by_unit')::boolean, false),
          p_payload ->> 'sell_unit',
          0,
          coalesce((p_payload ->> 'has_loss')::boolean, false),
          nullif(p_payload ->> 'expected_quantity', '')::numeric,
          coalesce((p_payload ->> 'loss_quantity')::numeric, 0),
          p_payload ->> 'loss_description',
          coalesce((p_payload ->> 'loss_value')::numeric, 0),
          public.current_username())
  returning * into v_prod;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    insert into public.production_used_products (production_id, product_id, product_name,
                                                 quantity_used, source_type, unit, unit_cost, line_cost)
    values (v_prod.id,
            nullif(v_line ->> 'product_id', '')::uuid,
            coalesce(v_line ->> 'product_name', 'Ingrédient'),
            coalesce((v_line ->> 'quantity_used')::numeric, 0),
            coalesce((v_line ->> 'source_type')::public.used_source_type, 'stock'),
            v_line ->> 'unit',
            coalesce((v_line ->> 'unit_cost')::numeric, 0),
            coalesce((v_line ->> 'line_cost')::numeric, 0));

    -- seuls les ingredients pris sur le stock sont decrementes
    -- (une source 'fiche' est un semi-fini deja produit)
    if coalesce(v_line ->> 'source_type', 'stock') = 'stock'
       and nullif(v_line ->> 'product_id', '') is not null then
      perform public.consume_stock((v_line ->> 'product_id')::uuid,
                                   coalesce((v_line ->> 'quantity_used')::numeric, 0),
                                   'production', 'productions', v_prod.id);
    end if;
  end loop;

  perform public.log_activity('production', 'create', 'productions', v_prod.id, p_payload);
  return v_prod;
end;
$fn$;

grant execute on function public.create_production(jsonb) to authenticated, service_role;


-- ============================================================================
-- 03. RATTRAPAGE — productions enregistrées avec un libellé mais sans catégorie
-- ----------------------------------------------------------------------------
--  Les productions déjà saisies dont le nom de catégorie correspond à une
--  catégorie de production existante retrouvent leur lien (filtres, rapports).
-- ============================================================================

update public.productions p
   set category_id = pc.id,
       updated_at  = now()
  from public.production_categories pc
 where p.category_id is null
   and p.category_name is not null
   and lower(btrim(p.category_name)) = lower(btrim(pc.name));

-- Les articles de comptoir issus de ces productions suivent le même lien
update public.comptoir_items ci
   set category_id = p.category_id,
       updated_at  = now()
  from public.productions p
 where ci.production_id = p.id
   and p.category_id is not null
   and ci.category_id is distinct from p.category_id;


-- ============================================================================
--  FIN DU CORRECTIF
-- ============================================================================

;


-- ===== altech_production_update_pos_commande_bon.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  MISE À JOUR — POS : commandes depuis le point de vente
--                      + n° de bon de commande manuel (ventes & commandes)
--                      + date de création éditable des commandes
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS `altech_production_supabase.sql`
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  CONTENU
--   01. Colonne bon_number sur public.sales et public.commands
--   02. RPC create_command()  : bon_number + date de création + acompte daté
--   03. RPC create_sale()      : bon_number
--   04. RPC create_sale_with_productions() : transmet le bon_number
-- ============================================================================


-- ============================================================================
-- 01. NOUVELLE COLONNE « N° BON DE COMMANDE »
-- ----------------------------------------------------------------------------
--  Numéro de bon de commande saisi manuellement par l'opérateur (indépendant
--  de la référence automatique VNT-/CMD-). Sert de repère client et permet la
--  recherche dans /sales et /clients/commands.
-- ============================================================================

alter table public.sales
  add column if not exists bon_number text;

alter table public.commands
  add column if not exists bon_number text;

comment on column public.sales.bon_number    is 'N° bon de commande saisi manuellement (repère client)';
comment on column public.commands.bon_number is 'N° bon de commande saisi manuellement (repère client)';

-- Recherche rapide par n° de bon
create index if not exists sales_bon_number_idx    on public.sales    (lower(bon_number));
create index if not exists commands_bon_number_idx on public.commands (lower(bon_number));


-- ============================================================================
-- 02. RPC create_command() — bon de commande manuel + date de création éditable
-- ----------------------------------------------------------------------------
--  Bouton « Enregistrer la commande » (Commandes clients ET point de vente).
--   - `bon_number` : numéro saisi à la main (facultatif)
--   - `created_at` : date/heure de création choisie par l'opérateur (facultatif)
--     → la référence CMD-AAAA-NNN et la date de l'acompte suivent cette date.
-- ============================================================================

create or replace function public.create_command(p_payload jsonb)
returns public.commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cmd     public.commands;
  v_ref     text;
  v_item    jsonb;
  v_total   numeric := 0;
  v_advance numeric := coalesce((p_payload ->> 'advance_paid')::numeric, 0);
  v_seq     int;
  v_created timestamptz := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());
  v_bon     text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
  v_year    text := to_char(v_created, 'YYYY');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.commands;
  v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.commands where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_item ->> 'total_price')::numeric,
                 coalesce((v_item ->> 'quantity')::numeric, 0) * coalesce((v_item ->> 'unit_price')::numeric, 0));
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  insert into public.commands (reference, client_id, client_name, client_phone, receive_date,
                               receive_hour, receive_minute, total_amount, advance_paid,
                               paid_amount, rest_amount, status, notes, bon_number,
                               created_at, updated_at, created_by)
  values (v_ref,
          nullif(p_payload ->> 'client_id', '')::uuid,
          coalesce(p_payload ->> 'client_name', 'Client'),
          p_payload ->> 'client_phone',
          nullif(p_payload ->> 'receive_date', '')::date,
          p_payload ->> 'receive_hour',
          p_payload ->> 'receive_minute',
          v_total, v_advance, v_advance, greatest(0, v_total - v_advance),
          'pending', p_payload ->> 'notes', v_bon,
          v_created, v_created, public.current_username())
  returning * into v_cmd;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    insert into public.command_items (command_id, product_id, fiche_technic_id, product_name,
                                      quantity, unit_price, total_price, sell_by_unit, sell_unit)
    values (v_cmd.id,
            nullif(v_item ->> 'product_id', '')::uuid,
            nullif(v_item ->> 'fiche_technic_id', '')::uuid,
            coalesce(v_item ->> 'product_name', 'Produit'),
            coalesce((v_item ->> 'quantity')::numeric, 0),
            coalesce((v_item ->> 'unit_price')::numeric, 0),
            coalesce((v_item ->> 'total_price')::numeric, 0),
            coalesce((v_item ->> 'sell_by_unit')::boolean, false),
            v_item ->> 'sell_unit');
  end loop;

  if v_advance > 0 then
    insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
    values ('deposit', v_advance, v_created::date,
            'Acompte commande ' || v_ref, 'Commande', 'commands', v_cmd.id);
  end if;

  return v_cmd;
end;
$$;

grant execute on function public.create_command(jsonb) to authenticated, service_role;


-- ============================================================================
-- 03. RPC create_sale() — n° bon de commande manuel
-- ----------------------------------------------------------------------------
--  Bouton « Valider la vente » (point de vente) et ventes internes.
--  La date de la vente (`date`) est déjà éditable ; on ajoute `bon_number`.
-- ============================================================================

create or replace function public.create_sale(p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale   public.sales;
  v_ref    text;
  v_line   jsonb;
  v_total  numeric := 0;
  v_red    numeric := coalesce((p_payload ->> 'reduction')::numeric, 0);
  v_final  numeric;
  v_paid   numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_rest   numeric;
  v_date   date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_status public.sale_status;
  v_seq    int;
  v_pid    uuid;
  v_cid    uuid;
  v_qty    numeric;
  v_bon    text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.sales;
  v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.sales where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_line ->> 'quantity')::numeric, 0)
                       * coalesce((v_line ->> 'selling_price')::numeric, 0);
  end loop;
  v_total  := coalesce((p_payload ->> 'total_amount')::numeric, v_total);
  v_final  := coalesce((p_payload ->> 'final_amount')::numeric, greatest(0, v_total - v_red));
  v_rest   := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  insert into public.sales (reference, client_id, date, total_amount, reduction, final_amount,
                            paid_amount, rest_amount, status, note, bon_number, created_by)
  values (v_ref, nullif(p_payload ->> 'client_id', '')::uuid, v_date,
          v_total, v_red, v_final, v_paid, v_rest, v_status,
          p_payload ->> 'note', v_bon, public.current_username())
  returning * into v_sale;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_pid := nullif(v_line ->> 'product_id', '')::uuid;
    v_cid := nullif(v_line ->> 'comptoir_id', '')::uuid;
    v_qty := coalesce((v_line ->> 'quantity')::numeric, 0);

    insert into public.sale_lines (sale_id, product_id, comptoir_id, product_name, quantity,
                                   selling_price, sell_by_unit, unit)
    values (v_sale.id, v_pid, v_cid,
            coalesce(v_line ->> 'product_name', 'Produit'), v_qty,
            coalesce((v_line ->> 'selling_price')::numeric, 0),
            coalesce((v_line ->> 'sell_by_unit')::boolean, false),
            v_line ->> 'unit');

    -- stock / comptoir decrement
    if v_cid is not null then
      update public.comptoir_items
         set quantity = greatest(0, quantity - v_qty), updated_at = now()
       where id = v_cid;
    elsif v_pid is not null then
      perform public.consume_stock(v_pid, v_qty, 'sale', 'sales', v_sale.id);
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, v_date, v_paid, 'Paiement vente');
  end if;

  -- unpaid rest becomes a tracked client debt
  if v_rest > 0 and v_sale.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_sale.client_id, c.name, c.phone, v_rest, v_rest, v_date,
           'Reste vente ' || v_ref, public.current_username()
      from public.clients c where c.id = v_sale.client_id;
  end if;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$$;

grant execute on function public.create_sale(jsonb) to authenticated, service_role;


-- ============================================================================
-- 04. RPC create_sale_with_productions() — transmet le n° de bon de commande
-- ----------------------------------------------------------------------------
--  Point de vente avec fiches techniques : on relaie simplement `bon_number`
--  à create_sale(). (Corps identique à la version précédente, une seule ligne
--  ajoutée dans l'appel à create_sale.)
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
      'bon_number',   p_payload ->> 'bon_number',
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
--  FIN DE LA MISE À JOUR
-- ============================================================================

;


-- ===== altech_production_update_commandes_stock_versements.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE À JOUR
--  « Commandes (adresse + chauffeur) · Stock POS · Versements clients »
-- ----------------------------------------------------------------------------
--  À exécuter EN UNE SEULE FOIS dans Supabase → SQL Editor.
--  Le script est idempotent : il peut être relancé sans risque.
--
--  Contenu :
--    01. commands           : client_address, driver_name, driver_plate
--    02. command_deliveries : driver_name, driver_plate
--    03. RPC create_command()            — adresse + chauffeur + matricule
--    04. RPC create_command_delivery()   — chauffeur de CETTE livraison
--    05. RPC update_command_delivery()   — modification du chauffeur
--    06. consume_stock()                 — CORRECTIF : la matière est retrouvée
--        par son nom quand l'identifiant est périmé, et une erreur explicite
--        est levée si elle reste introuvable (avant : décrément silencieux
--        ignoré → les quantités du stock ne bougeaient pas).
--    06bis. resolve_production_category() — rappel (prerequis)
--    07. create_production()             — transmet le nom de la matière à
--        consume_stock(), enregistre l'identifiant réellement décrémenté et
--        refuse une production dont une matière « stock » est introuvable.
--    07bis. create_sale() — meme rattrapage pour les ventes de stock
--    08. RÉPARATION des données          — ré-attache les lignes de fiches
--        techniques et de productions dont l'identifiant produit est périmé.
--    09. Diagnostic                      — vue des lignes encore orphelines.
--    10. Reprise de l'adresse des commandes déjà enregistrées.
-- ============================================================================

begin;

-- ============================================================================
-- 01. COMMANDES — adresse de livraison + chauffeur
-- ----------------------------------------------------------------------------
--  L'adresse est demandée à CHAQUE création de commande (écran « Commandes
--  clients » et point de vente) ; elle est imprimée sur le bon de commande et
--  reprise sur les bons de livraison.
-- ============================================================================

alter table public.commands
  add column if not exists bon_number     text,
  add column if not exists client_address text,
  add column if not exists driver_name    text,
  add column if not exists driver_plate   text;

comment on column public.commands.client_address is
  'Adresse de livraison saisie à la création de la commande';
comment on column public.commands.driver_name is
  'Chauffeur prévu pour emmener la commande';
comment on column public.commands.driver_plate is
  'Immatriculation du camion (facultative)';


-- ============================================================================
-- 02. LIVRAISONS — chauffeur propre à chaque livraison
-- ----------------------------------------------------------------------------
--  Une commande peut partir en plusieurs voyages : chaque bon de livraison
--  garde le chauffeur qui l'a effectivement transportée (le même que la
--  commande par défaut, ou un autre).
-- ============================================================================

alter table public.command_deliveries
  add column if not exists driver_name  text,
  add column if not exists driver_plate text;

comment on column public.command_deliveries.driver_name is
  'Chauffeur de cette livraison (repris de la commande par défaut)';
comment on column public.command_deliveries.driver_plate is
  'Immatriculation du camion de cette livraison (facultative)';


-- ============================================================================
-- 03. RPC create_command() — adresse de livraison, chauffeur et matricule
-- ----------------------------------------------------------------------------
--  Bouton « Enregistrer la commande » (Commandes clients ET point de vente).
--  Reprend la version précédente (bon_number + date de création éditable) et
--  ajoute client_address / driver_name / driver_plate.
-- ============================================================================

create or replace function public.create_command(p_payload jsonb)
returns public.commands
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd     public.commands;
  v_ref     text;
  v_item    jsonb;
  v_total   numeric := 0;
  v_advance numeric := coalesce((p_payload ->> 'advance_paid')::numeric, 0);
  v_seq     int;
  v_created timestamptz := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());
  v_bon     text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
  v_addr    text := nullif(btrim(coalesce(p_payload ->> 'client_address', '')), '');
  v_driver  text := nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '');
  v_plate   text := nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '');
  v_client  uuid := nullif(p_payload ->> 'client_id', '')::uuid;
  v_year    text := to_char(v_created, 'YYYY');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.commands;
  v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.commands where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_item ->> 'total_price')::numeric,
                 coalesce((v_item ->> 'quantity')::numeric, 0) * coalesce((v_item ->> 'unit_price')::numeric, 0));
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  -- à défaut d'adresse saisie, on reprend celle connue sur la fiche client
  if v_addr is null and v_client is not null then
    select nullif(btrim(address), '') into v_addr from public.clients where id = v_client;
  end if;

  insert into public.commands (reference, client_id, client_name, client_phone, client_address,
                               driver_name, driver_plate, receive_date,
                               receive_hour, receive_minute, total_amount, advance_paid,
                               paid_amount, rest_amount, status, notes, bon_number,
                               created_at, updated_at, created_by)
  values (v_ref,
          v_client,
          coalesce(p_payload ->> 'client_name', 'Client'),
          p_payload ->> 'client_phone',
          v_addr, v_driver, v_plate,
          nullif(p_payload ->> 'receive_date', '')::date,
          p_payload ->> 'receive_hour',
          p_payload ->> 'receive_minute',
          v_total, v_advance, v_advance, greatest(0, v_total - v_advance),
          'pending', p_payload ->> 'notes', v_bon,
          v_created, v_created, public.current_username())
  returning * into v_cmd;

  -- l'adresse saisie devient l'adresse de référence du client
  if v_addr is not null and v_client is not null then
    update public.clients
       set address = v_addr, updated_at = now()
     where id = v_client and coalesce(nullif(btrim(address), ''), '') is distinct from v_addr;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    insert into public.command_items (command_id, product_id, fiche_technic_id, product_name,
                                      quantity, unit_price, total_price, sell_by_unit, sell_unit)
    values (v_cmd.id,
            nullif(v_item ->> 'product_id', '')::uuid,
            nullif(v_item ->> 'fiche_technic_id', '')::uuid,
            coalesce(v_item ->> 'product_name', 'Produit'),
            coalesce((v_item ->> 'quantity')::numeric, 0),
            coalesce((v_item ->> 'unit_price')::numeric, 0),
            coalesce((v_item ->> 'total_price')::numeric, 0),
            coalesce((v_item ->> 'sell_by_unit')::boolean, false),
            v_item ->> 'sell_unit');
  end loop;

  if v_advance > 0 then
    insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
    values ('deposit', v_advance, v_created::date,
            'Acompte commande ' || v_ref, 'Commande', 'commands', v_cmd.id);
  end if;

  return v_cmd;
end;
$fn$;

grant execute on function public.create_command(jsonb) to authenticated, service_role;


-- ============================================================================
-- 04. RPC create_command_delivery() — chauffeur de cette livraison
-- ----------------------------------------------------------------------------
--  Bouton « Valider la livraison ». Si aucun chauffeur n'est fourni, celui de
--  la commande est repris automatiquement.
-- ============================================================================

create or replace function public.create_command_delivery(p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del    public.command_deliveries;
  v_cmd    public.commands;
  v_item   jsonb;
  v_ref    text;
  v_seq    int;
  v_driver text := nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '');
  v_plate  text := nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '');
begin
  if not public.has_perm('clients', 'edit') and not public.has_perm('clients', 'create') then
    raise exception 'Vous n''avez pas la permission de livrer une commande';
  end if;
  select * into v_cmd from public.commands where id = (p_payload ->> 'command_id')::uuid;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  -- par défaut : le chauffeur prévu sur la commande
  v_driver := coalesce(v_driver, nullif(btrim(coalesce(v_cmd.driver_name, '')), ''));
  v_plate  := coalesce(v_plate,  nullif(btrim(coalesce(v_cmd.driver_plate, '')), ''));

  select count(*) + 1 into v_seq from public.command_deliveries where command_id = v_cmd.id;
  v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');

  insert into public.command_deliveries (command_id, reference, date, delivered_at, notes,
                                         driver_name, driver_plate)
  values (v_cmd.id, v_ref,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now())::date,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now()),
          coalesce(p_payload ->> 'notes', ''),
          v_driver, v_plate)
  returning * into v_del;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
      insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
      values (v_del.id,
              nullif(v_item ->> 'command_item_id', '')::uuid,
              coalesce(v_item ->> 'product_name', 'Produit'),
              coalesce((v_item ->> 'quantity')::numeric, 0),
              v_item ->> 'sell_unit');
    end if;
  end loop;

  perform public.recompute_command_delivery(v_cmd.id);
  perform public.log_activity('clients', 'deliver', 'command_deliveries', v_del.id, p_payload);
  return v_del;
end;
$fn$;

grant execute on function public.create_command_delivery(jsonb) to authenticated, service_role;


-- ============================================================================
-- 05. RPC update_command_delivery() — modification du chauffeur
-- ============================================================================

create or replace function public.update_command_delivery(p_id uuid, p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del  public.command_deliveries;
  v_item jsonb;
begin
  update public.command_deliveries
     set delivered_at = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at),
         date         = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at)::date,
         notes        = coalesce(p_payload ->> 'notes', notes),
         driver_name  = case when p_payload ? 'driver_name'
                             then nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '')
                             else driver_name end,
         driver_plate = case when p_payload ? 'driver_plate'
                             then nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '')
                             else driver_plate end,
         updated_at   = now()
   where id = p_id
  returning * into v_del;

  if v_del.id is null then raise exception 'Livraison introuvable'; end if;

  if p_payload ? 'items' then
    delete from public.command_delivery_items where delivery_id = p_id;
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
      if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
        insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
        values (p_id,
                nullif(v_item ->> 'command_item_id', '')::uuid,
                coalesce(v_item ->> 'product_name', 'Produit'),
                coalesce((v_item ->> 'quantity')::numeric, 0),
                v_item ->> 'sell_unit');
      end if;
    end loop;
  end if;

  perform public.recompute_command_delivery(v_del.command_id);
  return v_del;
end;
$fn$;

grant execute on function public.update_command_delivery(uuid, jsonb) to authenticated, service_role;


-- ============================================================================
-- 06. CORRECTIF STOCK — consume_stock()
-- ----------------------------------------------------------------------------
--  PROBLÈME : la fonction faisait
--      update public.products set current_quantity = ... where id = p_product_id;
--  sans vérifier qu'une ligne avait bien été touchée. Quand la fiche technique
--  référençait un produit supprimé puis recréé (identifiant périmé), l'UPDATE
--  ne trouvait aucune ligne : AUCUNE erreur n'était levée et le stock restait
--  inchangé. C'est exactement le symptôme constaté au point de vente : la
--  production partait, la vente s'enregistrait, mais les quantités des
--  matières premières ne diminuaient pas.
--
--  CORRECTIF :
--    · la matière est d'abord cherchée par identifiant,
--    · à défaut par son NOM (insensible à la casse et aux espaces),
--    · si elle reste introuvable → exception explicite (plus de silence),
--    · la fonction renvoie l'identifiant réellement décrémenté.
-- ============================================================================

drop function if exists public.consume_stock(uuid, numeric, text, text, uuid);

create or replace function public.consume_stock(
  p_product_id   uuid,
  p_quantity     numeric,
  p_reason       text,
  p_ref_table    text default null,
  p_ref_id       uuid default null,
  p_product_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pid  uuid;
  v_left numeric;
begin
  if coalesce(p_quantity, 0) <= 0 then
    return null;
  end if;

  -- 1) par identifiant, uniquement s'il existe encore
  if p_product_id is not null then
    select id into v_pid from public.products where id = p_product_id;
  end if;

  -- 2) sinon par nom — rattrape les fiches dont l'identifiant est périmé
  if v_pid is null and coalesce(btrim(p_product_name), '') <> '' then
    select id into v_pid
      from public.products
     where lower(btrim(name)) = lower(btrim(p_product_name))
     order by is_active desc, current_quantity desc, created_at asc
     limit 1;
  end if;

  if v_pid is null then
    raise exception
      'Matière introuvable dans le stock : % — impossible de déduire la quantité (%).',
      coalesce(nullif(btrim(p_product_name), ''), p_product_id::text, 'produit inconnu'),
      p_reason;
  end if;

  update public.products
     set current_quantity = greatest(0, current_quantity - p_quantity),
         updated_at = now()
   where id = v_pid
  returning current_quantity into v_left;

  insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
  values (v_pid, -p_quantity, p_reason, p_ref_table, p_ref_id, v_left);

  return v_pid;
end;
$fn$;

grant execute on function public.consume_stock(uuid, numeric, text, text, uuid, text)
  to authenticated, service_role;


-- ============================================================================
-- 06 bis. resolve_production_category() — rappel (utilisée par create_production)
-- ----------------------------------------------------------------------------
--  Reprise à l'identique de la mise à jour « catégorie de production » afin que
--  ce script soit exécutable même s'il est lancé en premier. Renvoie toujours un
--  id valide de `production_categories`, ou NULL quand aucun nom exploitable
--  n'est fourni.
-- ============================================================================

create or replace function public.resolve_production_category(
  p_category_id uuid, p_category_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id   uuid;
  v_name text;
begin
  -- 1) l'id est deja une categorie de production : rien a faire
  if p_category_id is not null then
    select id into v_id from public.production_categories where id = p_category_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- 2) sinon on cherche un nom : celui transmis, sinon celui de la categorie
  --    reellement designee par l id (fiche technique, puis stock)
  v_name := nullif(btrim(coalesce(p_category_name, '')), '');
  if v_name is null and p_category_id is not null then
    select name into v_name from public.fiche_categories where id = p_category_id;
  end if;
  if v_name is null and p_category_id is not null then
    select name into v_name from public.categories where id = p_category_id;
  end if;
  if v_name is null then
    return null;
  end if;

  -- 3) meme nom cote production, creee a la volee si elle n existe pas encore
  select id into v_id
    from public.production_categories
   where lower(btrim(name)) = lower(v_name)
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.production_categories (name)
  values (v_name)
  on conflict (name) do update set name = excluded.name
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function public.resolve_production_category(uuid, text) to authenticated, service_role;


-- ============================================================================
-- 07. create_production() — le stock est réellement décrémenté
-- ----------------------------------------------------------------------------
--  Reprend la version « catégorie traduite » et y ajoute :
--    · le NOM de la matière est transmis à consume_stock() (rattrapage),
--    · l'identifiant réellement décrémenté est enregistré sur la ligne
--      production_used_products (traçabilité + rapports justes),
--    · une matière « stock » sans identifiant ET sans nom exploitable fait
--      échouer la production au lieu de passer silencieusement.
--
--  Cette fonction est appelée par « Lancer la production » ET par le point de
--  vente (create_sale_with_productions), donc les deux écrans sont corrigés.
-- ============================================================================

create or replace function public.create_production(p_payload jsonb)
returns public.productions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod     public.productions;
  v_line     jsonb;
  v_cost     numeric := 0;
  v_out      numeric := coalesce((p_payload ->> 'output_quantity')::numeric, 0);
  v_price    numeric := coalesce((p_payload ->> 'unit_price')::numeric, 0);
  v_cat      uuid;
  v_cat_name text;
  v_lineid   uuid;
  v_used     uuid;
  v_qty      numeric;
  v_name     text;
  v_src      text;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    v_cost := v_cost + coalesce((v_line ->> 'line_cost')::numeric,
                coalesce((v_line ->> 'quantity_used')::numeric, 0) * coalesce((v_line ->> 'unit_cost')::numeric, 0));
  end loop;

  -- la categorie recue peut venir d une fiche technique : elle est traduite en
  -- categorie de production, sinon la cle etrangere refuse l insertion
  v_cat := public.resolve_production_category(
             nullif(p_payload ->> 'category_id', '')::uuid,
             p_payload ->> 'category_name');
  v_cat_name := coalesce(
    nullif(btrim(coalesce(p_payload ->> 'category_name', '')), ''),
    (select name from public.production_categories where id = v_cat));

  insert into public.productions (name, description, date, hour, category_id, category_name,
                                  fiche_technic_id, total_cost, output_quantity, unit_price,
                                  total_value, sell_by_unit, sell_unit, sent_to_comptoir,
                                  has_loss, expected_quantity, loss_quantity, loss_description,
                                  loss_value, created_by)
  values (coalesce(p_payload ->> 'name', 'Production'),
          coalesce(p_payload ->> 'description', ''),
          coalesce((p_payload ->> 'date')::date, current_date),
          coalesce(p_payload ->> 'hour', to_char(now(), 'HH24:MI')),
          v_cat,
          v_cat_name,
          nullif(p_payload ->> 'fiche_technic_id', '')::uuid,
          v_cost, v_out, v_price, v_out * v_price,
          coalesce((p_payload ->> 'sell_by_unit')::boolean, false),
          p_payload ->> 'sell_unit',
          0,
          coalesce((p_payload ->> 'has_loss')::boolean, false),
          nullif(p_payload ->> 'expected_quantity', '')::numeric,
          coalesce((p_payload ->> 'loss_quantity')::numeric, 0),
          p_payload ->> 'loss_description',
          coalesce((p_payload ->> 'loss_value')::numeric, 0),
          public.current_username())
  returning * into v_prod;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    v_qty  := coalesce((v_line ->> 'quantity_used')::numeric, 0);
    v_name := coalesce(v_line ->> 'product_name', 'Ingrédient');
    v_src  := coalesce(v_line ->> 'source_type', 'stock');

    insert into public.production_used_products (production_id, product_id, product_name,
                                                 quantity_used, source_type, unit, unit_cost, line_cost)
    values (v_prod.id,
            nullif(v_line ->> 'product_id', '')::uuid,
            v_name,
            v_qty,
            coalesce(v_src::public.used_source_type, 'stock'),
            v_line ->> 'unit',
            coalesce((v_line ->> 'unit_cost')::numeric, 0),
            coalesce((v_line ->> 'line_cost')::numeric, 0))
    returning id into v_lineid;

    -- seuls les ingredients pris sur le stock sont decrementes
    -- (une source 'fiche' est un semi-fini deja produit)
    if v_src = 'stock' and v_qty > 0 then
      v_used := public.consume_stock(
                  nullif(v_line ->> 'product_id', '')::uuid,
                  v_qty,
                  'production', 'productions', v_prod.id,
                  v_name);

      -- on garde l'identifiant du produit REELLEMENT decremente
      if v_used is not null then
        update public.production_used_products
           set product_id = v_used
         where id = v_lineid and product_id is distinct from v_used;
      end if;
    end if;
  end loop;

  perform public.log_activity('production', 'create', 'productions', v_prod.id, p_payload);
  return v_prod;
end;
$fn$;

grant execute on function public.create_production(jsonb) to authenticated, service_role;


-- ============================================================================
-- 07 bis. create_sale() — le nom du produit est transmis à consume_stock()
-- ----------------------------------------------------------------------------
--  Ventes directes de produits du stock (hors comptoir) : la matière est
--  également retrouvée par son nom si son identifiant est périmé. Corps
--  identique à la version précédente (n° de bon de commande compris), à la
--  seule ligne `consume_stock` près.
-- ============================================================================

create or replace function public.create_sale(p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale   public.sales;
  v_ref    text;
  v_line   jsonb;
  v_total  numeric := 0;
  v_red    numeric := coalesce((p_payload ->> 'reduction')::numeric, 0);
  v_final  numeric;
  v_paid   numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_rest   numeric;
  v_date   date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_status public.sale_status;
  v_seq    int;
  v_pid    uuid;
  v_cid    uuid;
  v_qty    numeric;
  v_bon    text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.sales;
  v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.sales where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_line ->> 'quantity')::numeric, 0)
                       * coalesce((v_line ->> 'selling_price')::numeric, 0);
  end loop;
  v_total  := coalesce((p_payload ->> 'total_amount')::numeric, v_total);
  v_final  := coalesce((p_payload ->> 'final_amount')::numeric, greatest(0, v_total - v_red));
  v_rest   := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  insert into public.sales (reference, client_id, date, total_amount, reduction, final_amount,
                            paid_amount, rest_amount, status, note, bon_number, created_by)
  values (v_ref, nullif(p_payload ->> 'client_id', '')::uuid, v_date,
          v_total, v_red, v_final, v_paid, v_rest, v_status,
          p_payload ->> 'note', v_bon, public.current_username())
  returning * into v_sale;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_pid := nullif(v_line ->> 'product_id', '')::uuid;
    v_cid := nullif(v_line ->> 'comptoir_id', '')::uuid;
    v_qty := coalesce((v_line ->> 'quantity')::numeric, 0);

    insert into public.sale_lines (sale_id, product_id, comptoir_id, product_name, quantity,
                                   selling_price, sell_by_unit, unit)
    values (v_sale.id, v_pid, v_cid,
            coalesce(v_line ->> 'product_name', 'Produit'), v_qty,
            coalesce((v_line ->> 'selling_price')::numeric, 0),
            coalesce((v_line ->> 'sell_by_unit')::boolean, false),
            v_line ->> 'unit');

    -- stock / comptoir decrement
    if v_cid is not null then
      update public.comptoir_items
         set quantity = greatest(0, quantity - v_qty), updated_at = now()
       where id = v_cid;
    elsif v_pid is not null then
      perform public.consume_stock(v_pid, v_qty, 'sale', 'sales', v_sale.id,
                                   v_line ->> 'product_name');
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, v_date, v_paid, 'Paiement vente');
  end if;

  -- unpaid rest becomes a tracked client debt
  if v_rest > 0 and v_sale.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_sale.client_id, c.name, c.phone, v_rest, v_rest, v_date,
           'Reste vente ' || v_ref, public.current_username()
      from public.clients c where c.id = v_sale.client_id;
  end if;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$fn$;

grant execute on function public.create_sale(jsonb) to authenticated, service_role;


-- ============================================================================
-- 08. RÉPARATION DES DONNÉES — identifiants produits périmés
-- ----------------------------------------------------------------------------
--  Les lignes de fiches techniques (et l'historique des productions) qui
--  pointent vers un produit supprimé/recréé sont ré-attachées au produit du
--  stock portant le même nom. C'est la cause d'origine du stock qui ne
--  diminuait pas au point de vente.
-- ============================================================================

update public.fiche_technic_lines l
   set product_id = p.id
  from public.products p
 where l.source_type = 'stock'
   and lower(btrim(l.product_name)) = lower(btrim(p.name))
   and (l.product_id is null
        or not exists (select 1 from public.products x where x.id = l.product_id));

update public.production_used_products u
   set product_id = p.id
  from public.products p
 where u.source_type = 'stock'
   and lower(btrim(u.product_name)) = lower(btrim(p.name))
   and (u.product_id is null
        or not exists (select 1 from public.products x where x.id = u.product_id));


-- ============================================================================
-- 09. DIAGNOSTIC — matières de fiches techniques encore introuvables
-- ----------------------------------------------------------------------------
--  À consulter si une vente est refusée avec « Matière introuvable » :
--      select * from public.v_fiche_lines_orphelines;
--  Chaque ligne listée doit être rattachée à un produit du stock depuis
--  l'écran « Production > Fiches techniques ».
-- ============================================================================

create or replace view public.v_fiche_lines_orphelines as
select f.id            as fiche_id,
       f.name          as fiche_name,
       l.id            as line_id,
       l.product_name  as matiere,
       l.quantity_used as quantite,
       l.unit          as unite
  from public.fiche_technic_lines l
  join public.fiche_technics f on f.id = l.fiche_technic_id
 where l.source_type = 'stock'
   and not exists (select 1 from public.products p where p.id = l.product_id);

grant select on public.v_fiche_lines_orphelines to authenticated, service_role;


-- ============================================================================
-- 10. REPRISE — adresse des commandes déjà enregistrées
-- ----------------------------------------------------------------------------
--  Les commandes créées avant cette mise à jour récupèrent l'adresse connue
--  sur la fiche du client, pour que les impressions restent complètes.
-- ============================================================================

update public.commands c
   set client_address = nullif(btrim(cl.address), '')
  from public.clients cl
 where cl.id = c.client_id
   and coalesce(btrim(c.client_address), '') = ''
   and coalesce(btrim(cl.address), '') <> '';

-- Les livraisons déjà saisies héritent du chauffeur de leur commande.
update public.command_deliveries d
   set driver_name  = coalesce(d.driver_name,  nullif(btrim(c.driver_name), '')),
       driver_plate = coalesce(d.driver_plate, nullif(btrim(c.driver_plate), ''))
  from public.commands c
 where c.id = d.command_id
   and (d.driver_name is null or d.driver_plate is null)
   and (coalesce(btrim(c.driver_name), '') <> '' or coalesce(btrim(c.driver_plate), '') <> '');

commit;

-- ----------------------------------------------------------------------------
--  Recharge le cache de schéma de PostgREST pour que les nouvelles colonnes
--  et fonctions soient visibles immédiatement par l'application.
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
--  FIN DE LA MISE À JOUR
-- ============================================================================

;


-- ===== altech_production_update_anciens_achats_ventes_tva.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE À JOUR
--  « Anciens achats · Anciennes ventes (caisse rétroactive) · Option TVA »
-- ----------------------------------------------------------------------------
--  À exécuter EN UNE SEULE FOIS dans Supabase → SQL Editor.
--  Le script est idempotent : il peut être relancé sans risque.
--
--  Contenu :
--    01. purchases.is_historical      — « ancien achat » (saisie rétroactive)
--    02. sales.is_historical + TVA    — « ancienne vente » et option TVA
--    03. trg_purchase_line_to_stock() — un ancien achat n'alimente PAS le stock
--    04. trg_purchase_payment_to_caisse() — ni la caisse
--    05. trg_sale_payment_to_caisse()     — idem pour une ancienne vente
--    06. RPC create_purchase()        — enregistre le drapeau « ancien achat »
--    07. RPC create_sale()            — drapeau « ancienne vente » + TVA, et
--        surtout : AUCUN décrément du comptoir ni du stock en mode rétroactif
--    08. RPC create_sale_with_productions() — relaie les nouveaux champs
--    09. RPC update_sale()            — la TVA est conservée à la modification
--    10. Vues de contrôle             — saisies rétroactives et TVA collectée
--    11. Cohérence des ventes déjà enregistrées
--
--  RÈGLE MÉTIER (les deux modes rétroactifs) :
--    · le document est enregistré à SA DATE D'ORIGINE ;
--    · il alimente l'historique du fournisseur / du client, les dettes et les
--      rapports généraux ;
--    · il ne touche NI au stock actuel, NI au comptoir, NI à la caisse.
--
--  RÈGLE TVA :
--      base HT = total des lignes − réduction
--      TVA     = base HT × taux / 100      (19 % par défaut, taux modifiable)
--      TTC     = base HT + TVA             → c'est `sales.final_amount`
--    Le montant payé et le reste dû portent donc toujours sur le TTC.
-- ============================================================================

begin;

-- ============================================================================
-- 01. ACHATS — drapeau « ancien achat »
-- ----------------------------------------------------------------------------
--  Bouton « Ancien achat » de l'écran /purchase : même formulaire que l'achat
--  normal, mais les quantités ne rejoignent pas le stock actuel.
-- ============================================================================

alter table public.purchases
  add column if not exists is_historical boolean not null default false;

comment on column public.purchases.is_historical is
  'Ancien achat saisi a posteriori : la facture alimente l''historique du fournisseur et les rapports, mais n''ajoute rien au stock actuel et ne genere aucune ecriture de caisse.';

create index if not exists purchases_historical_idx
  on public.purchases (is_historical) where is_historical;


-- ============================================================================
-- 02. VENTES — drapeau « ancienne vente » + option TVA
-- ----------------------------------------------------------------------------
--  Bouton « Ancienne vente » du point de vente, et interrupteur TVA présent
--  sur la caisse normale COMME sur la caisse rétroactive.
-- ============================================================================

alter table public.sales
  add column if not exists is_historical boolean       not null default false,
  add column if not exists tva_enabled   boolean       not null default false,
  add column if not exists tva_rate      numeric(6,2)  not null default 0,
  add column if not exists tva_amount    numeric(14,2) not null default 0;

comment on column public.sales.is_historical is
  'Ancienne vente saisie a posteriori : elle alimente l''historique du client et les rapports, mais ne deduit rien du comptoir ni du stock et ne genere aucune ecriture de caisse.';
comment on column public.sales.tva_enabled is
  'TVA activee sur cette vente (option de la caisse).';
comment on column public.sales.tva_rate is
  'Taux de TVA applique, en pourcentage — 19 par defaut, modifiable.';
comment on column public.sales.tva_amount is
  'Montant de TVA = (total_amount - reduction) * tva_rate / 100. final_amount contient le NET A PAYER TTC.';

create index if not exists sales_historical_idx
  on public.sales (is_historical) where is_historical;


-- ============================================================================
-- 03. STOCK — un ancien achat n'alimente jamais le stock actuel
-- ----------------------------------------------------------------------------
--  Le déclencheur reste identique pour un achat normal ; il sort simplement
--  sans rien faire lorsque la facture parente est marquée « ancien achat ».
-- ============================================================================

create or replace function public.trg_purchase_line_to_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_left numeric;
  v_hist boolean;
begin
  if new.product_id is null then
    return new;
  end if;

  -- « Ancien achat » : la marchandise a été reçue et consommée dans le passé,
  -- le stock d'aujourd'hui ne doit surtout pas être gonflé.
  select coalesce(is_historical, false) into v_hist
    from public.purchases where id = new.purchase_id;
  if coalesce(v_hist, false) then
    return new;
  end if;

  update public.products
     set current_quantity   = current_quantity + new.quantity,
         principal_quantity = principal_quantity + new.quantity,
         min_alert_quantity = coalesce(new.min_alert_quantity, min_alert_quantity),
         purchase_price     = case when new.purchase_price > 0 then new.purchase_price else purchase_price end,
         expiration_date    = coalesce(new.expiration_date, expiration_date),
         expiration_enabled = case when new.expiration_date is not null then true else expiration_enabled end,
         unit_enabled       = case when new.unit_enabled then true else unit_enabled end,
         unit               = case when new.unit_enabled then coalesce(new.unit, unit) else unit end,
         updated_at         = now()
   where id = new.product_id
  returning current_quantity into v_left;

  insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
  values (new.product_id, new.quantity, 'purchase', 'purchase_lines', new.id, v_left);

  return new;
end;
$fn$;

drop trigger if exists trg_purchase_line_stock on public.purchase_lines;
create trigger trg_purchase_line_stock
  after insert on public.purchase_lines
  for each row execute function public.trg_purchase_line_to_stock();


-- ============================================================================
-- 04. CAISSE — un règlement d'ancien achat n'est pas un décaissement du jour
-- ============================================================================

create or replace function public.trg_purchase_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref  text;
  v_hist boolean;
begin
  select reference, coalesce(is_historical, false)
    into v_ref, v_hist
    from public.purchases where id = new.purchase_id;

  -- l'argent est sorti de la caisse dans le passé, hors du logiciel
  if coalesce(v_hist, false) then
    return new;
  end if;

  insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('withdrawal', new.amount, new.date,
          coalesce(new.description, 'Règlement fournisseur') || ' ' || coalesce(v_ref, ''),
          'Achat', 'purchase_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trg_purchase_payment_caisse on public.purchase_payments;
create trigger trg_purchase_payment_caisse
  after insert on public.purchase_payments
  for each row execute function public.trg_purchase_payment_to_caisse();


-- ============================================================================
-- 05. CAISSE — un encaissement d'ancienne vente n'entre pas dans le tiroir
-- ============================================================================

create or replace function public.trg_sale_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref  text;
  v_hist boolean;
begin
  select reference, coalesce(is_historical, false)
    into v_ref, v_hist
    from public.sales where id = new.sale_id;

  -- l'argent a été encaissé dans le passé, hors du logiciel
  if coalesce(v_hist, false) then
    return new;
  end if;

  insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('deposit', new.amount, new.date,
          coalesce(new.description, 'Paiement vente') || ' ' || coalesce(v_ref, ''),
          'Vente', 'sale_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trg_sale_payment_caisse on public.sale_payments;
create trigger trg_sale_payment_caisse
  after insert on public.sale_payments
  for each row execute function public.trg_sale_payment_to_caisse();


-- ============================================================================
-- 06. RPC create_purchase() — enregistre le drapeau « ancien achat »
-- ----------------------------------------------------------------------------
--  Corps identique à la version précédente (bon de livraison + matricule),
--  avec la seule colonne `is_historical` en plus.
-- ============================================================================

create or replace function public.create_purchase(p_payload jsonb)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_purchase public.purchases;
  v_ref      text;
  v_line     jsonb;
  v_total    numeric := 0;
  v_paid     numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_date     date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_hist     boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_seq      int;
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.purchases;
  v_ref := 'ACH-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.purchases where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'ACH-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_line ->> 'quantity')::numeric, 0)
                       * coalesce((v_line ->> 'purchase_price')::numeric, 0);
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  -- la facture est écrite AVANT ses lignes : le déclencheur de stock peut donc
  -- lire `is_historical` et se désactiver pour un ancien achat.
  insert into public.purchases (reference, supplier_id, date, bon_number, driver_plate,
                                is_historical, total_amount, paid_amount, rest_amount,
                                note, created_by)
  values (v_ref,
          nullif(p_payload ->> 'supplier_id', '')::uuid,
          v_date,
          nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), ''),
          nullif(upper(btrim(coalesce(p_payload ->> 'driver_plate', ''))), ''),
          v_hist,
          v_total, v_paid, greatest(0, v_total - v_paid),
          p_payload ->> 'note',
          public.current_username())
  returning * into v_purchase;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    insert into public.purchase_lines (
      purchase_id, product_id, product_name, quantity, purchase_price,
      min_alert_quantity, unit_enabled, unit, expiration_enabled, expiration_date)
    values (
      v_purchase.id,
      nullif(v_line ->> 'product_id', '')::uuid,
      coalesce(v_line ->> 'product_name', 'Produit'),
      coalesce((v_line ->> 'quantity')::numeric, 0),
      coalesce((v_line ->> 'purchase_price')::numeric, 0),
      nullif(v_line ->> 'min_alert_quantity', '')::numeric,
      coalesce((v_line ->> 'unit_enabled')::boolean, false),
      v_line ->> 'unit',
      coalesce((v_line ->> 'expiration_enabled')::boolean, false),
      nullif(v_line ->> 'expiration_date', '')::date
    );
  end loop;

  if v_paid > 0 then
    insert into public.purchase_payments (purchase_id, date, amount, description)
    values (v_purchase.id, v_date, v_paid,
            case when v_hist then 'Acompte ancien achat' else 'Acompte achat' end);
  end if;

  perform public.log_activity('purchase', 'create', 'purchases', v_purchase.id, p_payload);
  select * into v_purchase from public.purchases where id = v_purchase.id;
  return v_purchase;
end;
$fn$;

grant execute on function public.create_purchase(jsonb) to authenticated, service_role;


-- ============================================================================
-- 07. RPC create_sale() — « ancienne vente » + TVA
-- ----------------------------------------------------------------------------
--  · is_historical = true → ni le comptoir ni le stock ne sont décrémentés.
--  · tva_enabled   = true → le montant de TVA est recalculé côté serveur pour
--    rester cohérent, et `final_amount` devient le NET À PAYER TTC.
--  Le reste du corps est identique à la version précédente (n° de bon de
--  commande, consume_stock par nom, dette client).
-- ============================================================================

create or replace function public.create_sale(p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale     public.sales;
  v_ref      text;
  v_line     jsonb;
  v_total    numeric := 0;
  v_red      numeric := coalesce((p_payload ->> 'reduction')::numeric, 0);
  v_base     numeric;
  v_tva_on   boolean := coalesce((p_payload ->> 'tva_enabled')::boolean, false);
  v_tva_rate numeric := coalesce((p_payload ->> 'tva_rate')::numeric, 0);
  v_tva      numeric := 0;
  v_final    numeric;
  v_paid     numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_rest     numeric;
  v_date     date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_hist     boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_status   public.sale_status;
  v_seq      int;
  v_pid      uuid;
  v_cid      uuid;
  v_qty      numeric;
  v_bon      text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.sales;
  v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.sales where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_line ->> 'quantity')::numeric, 0)
                       * coalesce((v_line ->> 'selling_price')::numeric, 0);
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  -- ---- TVA : base HT → montant → net TTC ---------------------------------
  if not v_tva_on then
    v_tva_rate := 0;
  end if;
  v_red   := least(greatest(0, v_red), v_total);
  v_base  := greatest(0, v_total - v_red);
  v_tva   := case when v_tva_on then round(v_base * v_tva_rate / 100, 2) else 0 end;
  v_final := v_base + v_tva;

  v_rest   := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  -- la vente est écrite AVANT ses lignes et son paiement : les déclencheurs
  -- de caisse peuvent donc lire `is_historical`.
  insert into public.sales (reference, client_id, date, total_amount, reduction, final_amount,
                            paid_amount, rest_amount, status, note, bon_number,
                            is_historical, tva_enabled, tva_rate, tva_amount, created_by)
  values (v_ref, nullif(p_payload ->> 'client_id', '')::uuid, v_date,
          v_total, v_red, v_final, v_paid, v_rest, v_status,
          p_payload ->> 'note', v_bon,
          v_hist, v_tva_on, v_tva_rate, v_tva, public.current_username())
  returning * into v_sale;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_pid := nullif(v_line ->> 'product_id', '')::uuid;
    v_cid := nullif(v_line ->> 'comptoir_id', '')::uuid;
    v_qty := coalesce((v_line ->> 'quantity')::numeric, 0);

    insert into public.sale_lines (sale_id, product_id, comptoir_id, product_name, quantity,
                                   selling_price, sell_by_unit, unit)
    values (v_sale.id, v_pid, v_cid,
            coalesce(v_line ->> 'product_name', 'Produit'), v_qty,
            coalesce((v_line ->> 'selling_price')::numeric, 0),
            coalesce((v_line ->> 'sell_by_unit')::boolean, false),
            v_line ->> 'unit');

    -- Décrément comptoir / stock — SAUTÉ pour une ancienne vente : la
    -- marchandise est sortie du magasin dans le passé, hors du logiciel.
    if not v_hist then
      if v_cid is not null then
        update public.comptoir_items
           set quantity = greatest(0, quantity - v_qty), updated_at = now()
         where id = v_cid;
      elsif v_pid is not null then
        perform public.consume_stock(v_pid, v_qty, 'sale', 'sales', v_sale.id,
                                     v_line ->> 'product_name');
      end if;
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, v_date, v_paid,
            case when v_hist then 'Paiement ancienne vente' else 'Paiement vente' end);
  end if;

  -- le reste impayé devient une dette client suivie (y compris en rétroactif :
  -- c'est justement ce qui permet de reconstituer l'ardoise d'un client)
  if v_rest > 0 and v_sale.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_sale.client_id, c.name, c.phone, v_rest, v_rest, v_date,
           'Reste vente ' || v_ref, public.current_username()
      from public.clients c where c.id = v_sale.client_id;
  end if;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$fn$;

grant execute on function public.create_sale(jsonb) to authenticated, service_role;


-- ============================================================================
-- 08. RPC create_sale_with_productions() — relaie les nouveaux champs
-- ----------------------------------------------------------------------------
--  Corps identique à la version précédente ; seules les lignes
--  `is_historical` / `tva_*` sont ajoutées à l'appel de create_sale().
--  (En pratique le point de vente n'envoie jamais de production pour une
--   ancienne vente ; le relais est conservé par sécurité.)
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
      'client_id',     p_payload ->> 'client_id',
      'date',          p_payload ->> 'date',
      'reduction',     coalesce((p_payload ->> 'reduction')::numeric, 0),
      'total_amount',  (p_payload ->> 'total_amount')::numeric,
      'paid_amount',   coalesce((p_payload ->> 'paid_amount')::numeric, 0),
      'note',          p_payload ->> 'note',
      'bon_number',    p_payload ->> 'bon_number',
      'is_historical', coalesce((p_payload ->> 'is_historical')::boolean, false),
      'tva_enabled',   coalesce((p_payload ->> 'tva_enabled')::boolean, false),
      'tva_rate',      coalesce((p_payload ->> 'tva_rate')::numeric, 0),
      'products',      v_out
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
-- 09. RPC update_sale() — la TVA survit à la modification d'une facture
-- ----------------------------------------------------------------------------
--  Sans ce correctif, modifier la date ou le montant payé d'une vente TTC
--  recalculait `final_amount = total − réduction` et effaçait la TVA.
--  Le payload peut aussi changer l'option (`tva_enabled`) et le taux.
-- ============================================================================

create or replace function public.update_sale(p_id uuid, p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale     public.sales;
  v_total    numeric;
  v_red      numeric;
  v_base     numeric;
  v_tva_on   boolean;
  v_tva_rate numeric;
  v_tva      numeric;
  v_final    numeric;
  v_paid     numeric;
  v_rest     numeric;
  v_date     date;
  v_status   public.sale_status;
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
  v_base  := greatest(0, v_total - v_red);

  v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_sale.tva_enabled, false));
  v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric, coalesce(v_sale.tva_rate, 0));
  if not v_tva_on then
    v_tva_rate := 0;
  end if;
  v_tva   := case when v_tva_on then round(v_base * v_tva_rate / 100, 2) else 0 end;
  v_final := v_base + v_tva;

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
         tva_enabled  = v_tva_on,
         tva_rate     = v_tva_rate,
         tva_amount   = v_tva,
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
-- 10. VUES DE CONTRÔLE — saisies rétroactives & TVA collectée
-- ----------------------------------------------------------------------------
--  Utiles pour vérifier depuis Supabase ce que l'écran « Rapports » affiche.
-- ============================================================================

drop view if exists public.v_saisies_retroactives;
create view public.v_saisies_retroactives as
select 'Ancienne vente'::text                    as type_document,
       s.reference,
       s.date,
       coalesce(c.name, 'Client de passage')     as tiers,
       s.final_amount                            as total_amount,
       s.paid_amount,
       s.rest_amount,
       s.created_by
  from public.sales s
  left join public.clients c on c.id = s.client_id
 where coalesce(s.is_historical, false)
union all
select 'Ancien achat'::text,
       p.reference,
       p.date,
       coalesce(f.name, '—'),
       p.total_amount,
       p.paid_amount,
       p.rest_amount,
       p.created_by
  from public.purchases p
  left join public.suppliers f on f.id = p.supplier_id
 where coalesce(p.is_historical, false);

alter view public.v_saisies_retroactives set (security_invoker = true);
grant select on public.v_saisies_retroactives to authenticated, service_role;

comment on view public.v_saisies_retroactives is
  'Anciens achats et anciennes ventes : documents saisis a posteriori qui alimentent l''historique des tiers et les rapports sans avoir touche au stock actuel ni a la caisse.';


drop view if exists public.v_tva_ventes;
create view public.v_tva_ventes as
select s.id,
       s.reference,
       s.date,
       coalesce(c.name, 'Client de passage')     as client_name,
       s.is_historical,
       s.total_amount                            as total_brut,
       s.reduction,
       greatest(0, s.total_amount - s.reduction) as base_ht,
       s.tva_rate,
       s.tva_amount,
       s.final_amount                            as net_ttc
  from public.sales s
  left join public.clients c on c.id = s.client_id
 where coalesce(s.tva_enabled, false);

alter view public.v_tva_ventes set (security_invoker = true);
grant select on public.v_tva_ventes to authenticated, service_role;

comment on view public.v_tva_ventes is
  'Ventes soumises a la TVA : base imposable, taux applique, montant collecte et net a payer TTC.';


-- ============================================================================
-- 11. COHÉRENCE DES VENTES DÉJÀ ENREGISTRÉES
-- ----------------------------------------------------------------------------
--  Toutes les ventes antérieures à cette mise à jour ont été établies sans TVA
--  et en temps réel : les valeurs par défaut sont déjà correctes, on se
--  contente de neutraliser d'éventuelles valeurs incohérentes.
-- ============================================================================

update public.sales
   set tva_rate   = 0,
       tva_amount = 0
 where coalesce(tva_enabled, false) = false
   and (coalesce(tva_rate, 0) <> 0 or coalesce(tva_amount, 0) <> 0);

commit;

-- ============================================================================
--  FIN DE LA MISE À JOUR
--  Vérifications rapides :
--    select * from public.v_saisies_retroactives;
--    select * from public.v_tva_ventes;
--    select reference, date, is_historical from public.purchases order by date desc limit 10;
--    select reference, date, is_historical, tva_enabled, tva_rate, tva_amount,
--           total_amount, reduction, final_amount
--      from public.sales order by date desc limit 10;
-- ============================================================================

;


-- ===== altech_production_update_versements_modes_reglement.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE À JOUR
--  « Versements fournisseurs · Modes de règlement (espèces / chèque /
--    virement) · Dettes recalculées à chaque versement »
-- ----------------------------------------------------------------------------
--  À exécuter EN UNE SEULE FOIS dans Supabase → SQL Editor.
--  Le script est idempotent : il peut être relancé sans risque.
--
--  Contenu :
--    01. Colonnes « mode de règlement » sur client_payments et supplier_payments
--    02. payment_method_label()      — libellé unique, réutilisé partout
--    03. pay_client()                — versement client + mode de règlement
--    04. update_client_payment()     — modification d'un versement client
--    05. pay_supplier()              — versement fournisseur + mode de règlement
--    06. update_supplier_payment()   — modification d'un versement fournisseur
--    07. Écritures de caisse         — le mode de règlement apparaît au libellé
--    08. Imputation renforcée        — le versement DIMINUE toujours la dette
--    09. Vues de contrôle            — versements et dettes par tiers
--    10. Cohérence des versements déjà enregistrés
--
--  RÈGLE MÉTIER — VERSEMENT :
--    · le montant est enregistré dans l'historique du tiers ;
--    · il est imputé (FIFO) sur les ventes puis les commandes non soldées du
--      client, ou sur les factures d'achat non soldées du fournisseur ;
--    · la dette du tiers diminue donc IMMÉDIATEMENT du montant versé ;
--    · l'excédent éventuel reste en avance sur le compte du tiers ;
--    · l'écriture de caisse est créée automatiquement (entrée pour un client,
--      sortie pour un fournisseur).
--
--  RÈGLE MÉTIER — MODE DE RÈGLEMENT :
--      especes  → aucune référence bancaire
--      cheque   → n° de chèque   (facultatif) + banque (facultative)
--      virement → n° de virement (facultatif) + banque (facultative)
-- ============================================================================

begin;

-- ============================================================================
-- 01. COLONNES « MODE DE RÈGLEMENT »
-- ----------------------------------------------------------------------------
--  Les versements déjà enregistrés basculent en « especes », qui reste le mode
--  par défaut de la saisie.
-- ============================================================================

alter table public.client_payments
  add column if not exists method           text not null default 'especes',
  add column if not exists cheque_number    text,
  add column if not exists virement_number  text,
  add column if not exists bank_name        text;

alter table public.supplier_payments
  add column if not exists method           text not null default 'especes',
  add column if not exists cheque_number    text,
  add column if not exists virement_number  text,
  add column if not exists bank_name        text;

update public.client_payments   set method = 'especes' where method is null or btrim(method) = '';
update public.supplier_payments set method = 'especes' where method is null or btrim(method) = '';

alter table public.client_payments   drop constraint if exists client_payments_method_chk;
alter table public.client_payments
  add  constraint client_payments_method_chk
  check (method in ('especes', 'cheque', 'virement'));

alter table public.supplier_payments drop constraint if exists supplier_payments_method_chk;
alter table public.supplier_payments
  add  constraint supplier_payments_method_chk
  check (method in ('especes', 'cheque', 'virement'));

comment on column public.client_payments.method is
  'Mode de reglement du versement client : especes, cheque (bancaire) ou virement (bancaire).';
comment on column public.client_payments.cheque_number is
  'Numero du cheque bancaire — facultatif, renseigne uniquement quand method = cheque.';
comment on column public.client_payments.virement_number is
  'Numero du virement bancaire — facultatif, renseigne uniquement quand method = virement.';
comment on column public.client_payments.bank_name is
  'Banque emettrice ou receptrice — facultative, pour un cheque comme pour un virement.';

comment on column public.supplier_payments.method is
  'Mode de reglement du versement fournisseur : especes, cheque (bancaire) ou virement (bancaire).';
comment on column public.supplier_payments.cheque_number is
  'Numero du cheque bancaire — facultatif, renseigne uniquement quand method = cheque.';
comment on column public.supplier_payments.virement_number is
  'Numero du virement bancaire — facultatif, renseigne uniquement quand method = virement.';
comment on column public.supplier_payments.bank_name is
  'Banque emettrice ou receptrice — facultative, pour un cheque comme pour un virement.';

create index if not exists client_payments_method_idx   on public.client_payments (method);
create index if not exists supplier_payments_method_idx on public.supplier_payments (method);


-- ============================================================================
-- 02. LIBELLÉ D'UN MODE DE RÈGLEMENT
-- ----------------------------------------------------------------------------
--  Une seule définition, utilisée par les écritures de caisse et les vues de
--  contrôle : « Espèces », « Chèque bancaire n° 4587123 — BNA »…
-- ============================================================================

create or replace function public.payment_method_label(
  p_method text,
  p_cheque_number text default null,
  p_virement_number text default null,
  p_bank_name text default null
) returns text
language sql
immutable
as $$
  select case coalesce(nullif(btrim(p_method), ''), 'especes')
    when 'cheque' then
      'Chèque bancaire'
      || coalesce(' n° ' || nullif(btrim(p_cheque_number), ''), '')
      || coalesce(' — ' || nullif(btrim(p_bank_name), ''), '')
    when 'virement' then
      'Virement bancaire'
      || coalesce(' n° ' || nullif(btrim(p_virement_number), ''), '')
      || coalesce(' — ' || nullif(btrim(p_bank_name), ''), '')
    else 'Espèces'
  end;
$$;

comment on function public.payment_method_label(text, text, text, text) is
  'Libelle imprimable d''un mode de reglement, numero de cheque / de virement et banque compris.';


-- ============================================================================
-- 03. VERSEMENT D'UN CLIENT  (/clients > bouton « Versement »)
-- ----------------------------------------------------------------------------
--  L'ancienne signature à 4 arguments est supprimée : PostgREST choisirait
--  sinon l'une ou l'autre au hasard et le mode de règlement serait perdu.
-- ============================================================================

drop function if exists public.pay_client(uuid, numeric, timestamptz, text);

create or replace function public.pay_client(
  p_client_id uuid,
  p_amount numeric,
  p_paid_at timestamptz default now(),
  p_notes text default '',
  p_method text default 'especes',
  p_cheque_number text default null,
  p_virement_number text default null,
  p_bank_name text default null
) returns public.client_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.client_payments;
  v_name   text;
  v_method text := lower(coalesce(nullif(btrim(p_method), ''), 'especes'));
begin
  if not public.has_perm('clients', 'pay') and not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission d''encaisser un client';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de règlement inconnu : %', p_method;
  end if;

  select name into v_name from public.clients where id = p_client_id;

  insert into public.client_payments (
    client_id, client_name, amount, date, paid_at, notes,
    method, cheque_number, virement_number, bank_name
  )
  values (
    p_client_id, v_name, p_amount,
    coalesce(p_paid_at, now())::date, coalesce(p_paid_at, now()), coalesce(p_notes, ''),
    v_method,
    case when v_method = 'cheque'   then nullif(btrim(p_cheque_number), '')   end,
    case when v_method = 'virement' then nullif(btrim(p_virement_number), '') end,
    case when v_method <> 'especes' then nullif(btrim(p_bank_name), '')       end
  )
  returning * into v_row;

  -- le versement DIMINUE la dette : ventes puis commandes non soldées (FIFO)
  perform public.allocate_client_payment(p_client_id, p_amount);

  perform public.log_activity('clients', 'pay', 'client_payments', v_row.id,
    jsonb_build_object('amount', p_amount, 'method', v_method));
  return v_row;
end;
$$;

comment on function public.pay_client(uuid, numeric, timestamptz, text, text, text, text, text) is
  'Versement d''un client : enregistre le reglement (avec son mode), l''impute sur les ventes puis les commandes non soldees et alimente la caisse.';


-- ============================================================================
-- 04. MODIFICATION D'UN VERSEMENT CLIENT
-- ----------------------------------------------------------------------------
--  L'ancienne imputation est annulée puis refaite avec le nouveau montant, de
--  sorte que la dette du client reste toujours juste.
--  Un paramètre à NULL signifie « ne pas toucher » ; une chaîne vide efface la
--  référence bancaire correspondante.
-- ============================================================================

drop function if exists public.update_client_payment(uuid, numeric, timestamptz, text);

create or replace function public.update_client_payment(
  p_id uuid,
  p_amount numeric,
  p_paid_at timestamptz default null,
  p_notes text default null,
  p_method text default null,
  p_cheque_number text default null,
  p_virement_number text default null,
  p_bank_name text default null
) returns public.client_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    public.client_payments;
  v_row    public.client_payments;
  v_method text;
begin
  select * into v_old from public.client_payments where id = p_id;
  if v_old.id is null then raise exception 'Versement introuvable'; end if;

  v_method := lower(coalesce(nullif(btrim(p_method), ''), v_old.method, 'especes'));
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de règlement inconnu : %', p_method;
  end if;

  -- on retire l'ancienne imputation avant de reposer la nouvelle
  perform public.deallocate_client_payment(v_old.client_id, v_old.amount);

  update public.client_payments
     set amount          = coalesce(p_amount, amount),
         paid_at         = coalesce(p_paid_at, paid_at),
         date            = coalesce(p_paid_at, paid_at)::date,
         notes           = coalesce(p_notes, notes),
         method          = v_method,
         cheque_number   = case
                             when v_method <> 'cheque' then null
                             when p_cheque_number is null then cheque_number
                             else nullif(btrim(p_cheque_number), '')
                           end,
         virement_number = case
                             when v_method <> 'virement' then null
                             when p_virement_number is null then virement_number
                             else nullif(btrim(p_virement_number), '')
                           end,
         bank_name       = case
                             when v_method = 'especes' then null
                             when p_bank_name is null then bank_name
                             else nullif(btrim(p_bank_name), '')
                           end,
         updated_at      = now()
   where id = p_id
  returning * into v_row;

  perform public.allocate_client_payment(v_row.client_id, v_row.amount);
  return v_row;
end;
$$;


-- ============================================================================
-- 05. VERSEMENT D'UN FOURNISSEUR  (/suppliers > bouton « Versement »)
-- ----------------------------------------------------------------------------
--  Exactement le même bouton que celui des clients : le montant est libre, il
--  est imputé sur les factures d'achat non soldées et la dette du fournisseur
--  diminue d'autant. L'excédent reste en avance sur son compte.
-- ============================================================================

drop function if exists public.pay_supplier(uuid, numeric, timestamptz, text);

create or replace function public.pay_supplier(
  p_supplier_id uuid,
  p_amount numeric,
  p_paid_at timestamptz default now(),
  p_notes text default '',
  p_method text default 'especes',
  p_cheque_number text default null,
  p_virement_number text default null,
  p_bank_name text default null
) returns public.supplier_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.supplier_payments;
  v_name   text;
  v_method text := lower(coalesce(nullif(btrim(p_method), ''), 'especes'));
begin
  if not public.has_perm('suppliers', 'pay') and not public.has_perm('suppliers', 'edit') then
    raise exception 'Vous n''avez pas la permission de régler un fournisseur';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de règlement inconnu : %', p_method;
  end if;

  select name into v_name from public.suppliers where id = p_supplier_id;

  insert into public.supplier_payments (
    supplier_id, supplier_name, amount, date, paid_at, notes,
    method, cheque_number, virement_number, bank_name
  )
  values (
    p_supplier_id, v_name, p_amount,
    coalesce(p_paid_at, now())::date, coalesce(p_paid_at, now()), coalesce(p_notes, ''),
    v_method,
    case when v_method = 'cheque'   then nullif(btrim(p_cheque_number), '')   end,
    case when v_method = 'virement' then nullif(btrim(p_virement_number), '') end,
    case when v_method <> 'especes' then nullif(btrim(p_bank_name), '')       end
  )
  returning * into v_row;

  -- le versement DIMINUE la dette : factures d'achat non soldées (FIFO)
  perform public.allocate_supplier_payment(p_supplier_id, p_amount);

  perform public.log_activity('suppliers', 'pay', 'supplier_payments', v_row.id,
    jsonb_build_object('amount', p_amount, 'method', v_method));
  return v_row;
end;
$$;

comment on function public.pay_supplier(uuid, numeric, timestamptz, text, text, text, text, text) is
  'Versement a un fournisseur : enregistre le reglement (avec son mode), l''impute sur les factures d''achat non soldees et sort le montant de la caisse.';


-- ============================================================================
-- 06. MODIFICATION D'UN VERSEMENT FOURNISSEUR
-- ============================================================================

drop function if exists public.update_supplier_payment(uuid, numeric, timestamptz, text);

create or replace function public.update_supplier_payment(
  p_id uuid,
  p_amount numeric,
  p_paid_at timestamptz default null,
  p_notes text default null,
  p_method text default null,
  p_cheque_number text default null,
  p_virement_number text default null,
  p_bank_name text default null
) returns public.supplier_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    public.supplier_payments;
  v_row    public.supplier_payments;
  v_method text;
begin
  select * into v_old from public.supplier_payments where id = p_id;
  if v_old.id is null then raise exception 'Versement introuvable'; end if;

  v_method := lower(coalesce(nullif(btrim(p_method), ''), v_old.method, 'especes'));
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de règlement inconnu : %', p_method;
  end if;

  perform public.deallocate_supplier_payment(v_old.supplier_id, v_old.amount);

  update public.supplier_payments
     set amount          = coalesce(p_amount, amount),
         paid_at         = coalesce(p_paid_at, paid_at),
         date            = coalesce(p_paid_at, paid_at)::date,
         notes           = coalesce(p_notes, notes),
         method          = v_method,
         cheque_number   = case
                             when v_method <> 'cheque' then null
                             when p_cheque_number is null then cheque_number
                             else nullif(btrim(p_cheque_number), '')
                           end,
         virement_number = case
                             when v_method <> 'virement' then null
                             when p_virement_number is null then virement_number
                             else nullif(btrim(p_virement_number), '')
                           end,
         bank_name       = case
                             when v_method = 'especes' then null
                             when p_bank_name is null then bank_name
                             else nullif(btrim(p_bank_name), '')
                           end,
         updated_at      = now()
   where id = p_id
  returning * into v_row;

  perform public.allocate_supplier_payment(v_row.supplier_id, v_row.amount);
  return v_row;
end;
$$;


-- ============================================================================
-- 07. ÉCRITURES DE CAISSE — le mode de règlement figure au libellé
-- ----------------------------------------------------------------------------
--  Un versement client ENTRE en caisse, un versement fournisseur en SORT.
--  Le libellé rappelle désormais s'il s'agit d'espèces, d'un chèque ou d'un
--  virement, avec son numéro s'il a été saisi.
-- ============================================================================

create or replace function public.trg_client_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caisse_transactions
    (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('deposit', new.amount, new.date,
          'Versement client: ' || coalesce(new.client_name, '')
            || ' (' || public.payment_method_label(
                 new.method, new.cheque_number, new.virement_number, new.bank_name) || ')',
          'Clients', 'client_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do update
     set amount      = excluded.amount,
         date        = excluded.date,
         description = excluded.description,
         updated_at  = now();
  return new;
end;
$$;

drop trigger if exists trg_client_payment_caisse on public.client_payments;
create trigger trg_client_payment_caisse
  after insert or update of amount, date, method, cheque_number, virement_number, bank_name
  on public.client_payments
  for each row execute function public.trg_client_payment_to_caisse();

create or replace function public.trg_supplier_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caisse_transactions
    (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('withdrawal', new.amount, new.date,
          'Versement fournisseur: ' || coalesce(new.supplier_name, '')
            || ' (' || public.payment_method_label(
                 new.method, new.cheque_number, new.virement_number, new.bank_name) || ')',
          'Fournisseurs', 'supplier_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do update
     set amount      = excluded.amount,
         date        = excluded.date,
         description = excluded.description,
         updated_at  = now();
  return new;
end;
$$;

drop trigger if exists trg_supplier_payment_caisse on public.supplier_payments;
create trigger trg_supplier_payment_caisse
  after insert or update of amount, date, method, cheque_number, virement_number, bank_name
  on public.supplier_payments
  for each row execute function public.trg_supplier_payment_to_caisse();


-- ============================================================================
-- 08. IMPUTATION — le versement diminue TOUJOURS la dette
-- ----------------------------------------------------------------------------
--  Les fonctions d'imputation sont réécrites à l'identique de leur logique
--  d'origine, avec deux garde-fous : le statut de la vente est recalculé sur
--  la valeur réellement écrite, et le reste dû ne peut jamais devenir négatif.
-- ============================================================================

create or replace function public.allocate_client_payment(p_client_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left numeric := coalesce(p_amount, 0);
  v_take numeric;
  v_new  numeric;
  r      record;
begin
  if v_left <= 0 then return; end if;

  for r in
    select id, rest_amount, paid_amount, final_amount from public.sales
     where client_id = p_client_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    v_new  := greatest(0, r.rest_amount - v_take);
    update public.sales
       set paid_amount = paid_amount + v_take,
           rest_amount = v_new,
           status      = case when v_new <= 0 then 'paid'::public.sale_status
                              else 'debt'::public.sale_status end,
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, rest_amount from public.commands
     where client_id = p_client_id and rest_amount > 0
     order by created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.commands
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
end;
$$;

comment on function public.allocate_client_payment(uuid, numeric) is
  'Impute un versement client sur ses ventes puis ses commandes non soldees (FIFO) : c''est ce qui fait BAISSER sa dette.';

create or replace function public.allocate_supplier_payment(p_supplier_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left numeric := coalesce(p_amount, 0);
  v_take numeric;
  r      record;
begin
  if v_left <= 0 then return; end if;
  for r in
    select id, rest_amount from public.purchases
     where supplier_id = p_supplier_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.purchases
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
end;
$$;

comment on function public.allocate_supplier_payment(uuid, numeric) is
  'Impute un versement fournisseur sur ses factures d''achat non soldees (FIFO) : c''est ce qui fait BAISSER sa dette.';


-- ============================================================================
-- 09. VUES DE CONTRÔLE
-- ----------------------------------------------------------------------------
--  · v_versements_clients / v_versements_fournisseurs : chaque versement avec
--    son mode de règlement lisible ;
--  · v_dettes_tiers : la dette réellement restante, client par client et
--    fournisseur par fournisseur — pratique pour vérifier qu'un versement a
--    bien été déduit.
-- ============================================================================

create or replace view public.v_versements_clients as
select p.id,
       p.paid_at,
       p.date,
       coalesce(c.name, p.client_name)  as client,
       c.phone                          as telephone,
       p.amount                         as montant,
       p.method                         as mode,
       p.cheque_number                  as numero_cheque,
       p.virement_number                as numero_virement,
       p.bank_name                      as banque,
       public.payment_method_label(p.method, p.cheque_number, p.virement_number, p.bank_name)
                                        as mode_libelle,
       p.notes,
       p.created_by
  from public.client_payments p
  left join public.clients c on c.id = p.client_id;

alter view public.v_versements_clients set (security_invoker = true);
grant select on public.v_versements_clients to authenticated, service_role;

create or replace view public.v_versements_fournisseurs as
select p.id,
       p.paid_at,
       p.date,
       coalesce(s.name, p.supplier_name) as fournisseur,
       s.phone                           as telephone,
       p.amount                          as montant,
       p.method                          as mode,
       p.cheque_number                   as numero_cheque,
       p.virement_number                 as numero_virement,
       p.bank_name                       as banque,
       public.payment_method_label(p.method, p.cheque_number, p.virement_number, p.bank_name)
                                         as mode_libelle,
       p.notes,
       p.created_by
  from public.supplier_payments p
  left join public.suppliers s on s.id = p.supplier_id;

alter view public.v_versements_fournisseurs set (security_invoker = true);
grant select on public.v_versements_fournisseurs to authenticated, service_role;

create or replace view public.v_dettes_tiers as
select 'client'::text as type_tiers,
       c.id           as tiers_id,
       c.name         as tiers,
       coalesce((select sum(s.final_amount) from public.sales s    where s.client_id = c.id), 0)
         + coalesce((select sum(k.total_amount) from public.commands k where k.client_id = c.id), 0) as total_facture,
       coalesce((select sum(s.paid_amount) from public.sales s    where s.client_id = c.id), 0)
         + coalesce((select sum(k.paid_amount) from public.commands k where k.client_id = c.id), 0)  as total_paye,
       coalesce((select sum(s.rest_amount) from public.sales s    where s.client_id = c.id), 0)
         + coalesce((select sum(k.rest_amount) from public.commands k where k.client_id = c.id), 0)  as reste_du,
       coalesce((select sum(p.amount) from public.client_payments p where p.client_id = c.id), 0)    as total_versements,
       coalesce((select count(*) from public.client_payments p where p.client_id = c.id), 0)         as nb_versements
  from public.clients c
union all
select 'fournisseur'::text,
       f.id,
       f.name,
       coalesce((select sum(a.total_amount) from public.purchases a where a.supplier_id = f.id), 0),
       coalesce((select sum(a.paid_amount)  from public.purchases a where a.supplier_id = f.id), 0),
       coalesce((select sum(a.rest_amount)  from public.purchases a where a.supplier_id = f.id), 0),
       coalesce((select sum(p.amount) from public.supplier_payments p where p.supplier_id = f.id), 0),
       coalesce((select count(*) from public.supplier_payments p where p.supplier_id = f.id), 0)
  from public.suppliers f;

alter view public.v_dettes_tiers set (security_invoker = true);
grant select on public.v_dettes_tiers to authenticated, service_role;

comment on view public.v_dettes_tiers is
  'Situation de dette de chaque tiers : total facture, total paye, reste du et cumul des versements. Le reste du doit toujours baisser du montant d''un nouveau versement.';


-- ============================================================================
-- 10. COHÉRENCE DES VERSEMENTS DÉJÀ ENREGISTRÉS
-- ----------------------------------------------------------------------------
--  Aucun versement antérieur n'avait de mode de règlement : ils sont tous
--  passés en « espèces » et leurs références bancaires sont vidées.
--  Les libellés de caisse correspondants sont régénérés au passage.
-- ============================================================================

update public.client_payments
   set cheque_number   = null,
       virement_number = null,
       bank_name       = null
 where method = 'especes'
   and (cheque_number is not null or virement_number is not null or bank_name is not null);

update public.supplier_payments
   set cheque_number   = null,
       virement_number = null,
       bank_name       = null
 where method = 'especes'
   and (cheque_number is not null or virement_number is not null or bank_name is not null);

update public.caisse_transactions t
   set description = 'Versement client: ' || coalesce(p.client_name, '')
                     || ' (' || public.payment_method_label(
                          p.method, p.cheque_number, p.virement_number, p.bank_name) || ')',
       updated_at  = now()
  from public.client_payments p
 where t.ref_table = 'client_payments' and t.ref_id = p.id;

update public.caisse_transactions t
   set description = 'Versement fournisseur: ' || coalesce(p.supplier_name, '')
                     || ' (' || public.payment_method_label(
                          p.method, p.cheque_number, p.virement_number, p.bank_name) || ')',
       updated_at  = now()
  from public.supplier_payments p
 where t.ref_table = 'supplier_payments' and t.ref_id = p.id;

-- Un reste dû ne peut jamais être négatif ni dépasser le total facturé.
update public.purchases
   set rest_amount = greatest(0, total_amount - paid_amount),
       updated_at  = now()
 where rest_amount <> greatest(0, total_amount - paid_amount);

update public.commands
   set rest_amount = greatest(0, total_amount - paid_amount),
       updated_at  = now()
 where rest_amount <> greatest(0, total_amount - paid_amount);

update public.sales
   set rest_amount = greatest(0, final_amount - paid_amount),
       status      = case when greatest(0, final_amount - paid_amount) <= 0
                          then 'paid'::public.sale_status else 'debt'::public.sale_status end,
       updated_at  = now()
 where rest_amount <> greatest(0, final_amount - paid_amount);


-- ============================================================================
-- 11. DROITS
-- ============================================================================

grant execute on all functions in schema public to authenticated, service_role;

commit;

-- ============================================================================
--  FIN DE LA MISE À JOUR
--
--  Vérifications rapides :
--    select * from public.v_versements_clients      order by paid_at desc limit 20;
--    select * from public.v_versements_fournisseurs order by paid_at desc limit 20;
--    select * from public.v_dettes_tiers where reste_du > 0 order by reste_du desc;
--
--  Test complet d'un versement fournisseur (la dette doit baisser) :
--    select reste_du from public.v_dettes_tiers
--     where type_tiers = 'fournisseur' and tiers = 'NOM DU FOURNISSEUR';
--    select public.pay_supplier('<uuid-fournisseur>', 5000, now(), 'test',
--                               'cheque', '4587123', null, 'BNA');
--    select reste_du from public.v_dettes_tiers
--     where type_tiers = 'fournisseur' and tiers = 'NOM DU FOURNISSEUR';
-- ============================================================================

;


-- ===== altech_production_update_pos_fiche_production_stock.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « Caisse -> Fiche technique : la production est REELLEMENT lancee et les
--    matieres premieres sont REELLEMENT deduites du stock »
-- ----------------------------------------------------------------------------
--  A executer EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est idempotent : il peut etre relance sans risque.
--
--  PROBLEME CORRIGE
--  ----------------
--  Quand le caissier vendait une FICHE TECHNIQUE depuis la caisse (sans passer
--  par « Lancer la production » de l'ecran Production) :
--    · la vente etait bien enregistree,
--    · MAIS aucune production n'apparaissait dans l'ecran Production,
--    · ET les quantites des matieres premieres n'etaient pas retirees du stock.
--
--  Trois causes, toutes traitees ici :
--    1. `create_sale_with_productions()` estampillait `origin = 'pos'` par un
--       UPDATE effectue APRES l'insertion. Si la colonne manquait (base pas a
--       jour), l'appel entier echouait et l'application basculait sur un
--       chemin de secours ou la production n'etait plus rattachee a la vente.
--    2. Quand la production n'etait pas lancee, la ligne de vente partait avec
--       l'identifiant de la FICHE TECHNIQUE dans `product_id`. `consume_stock()`
--       ne trouvait aucun produit portant cet identifiant et ne decrementait
--       donc rien — silencieusement.
--    3. Rien ne permettait de savoir, apres coup, qu'une ligne de vente venait
--       d'une fiche technique : impossible de rattraper les ventes deja
--       enregistrees.
--
--  CONTENU
--  -------
--    01. Tracabilite : colonnes sur `sale_lines` et `productions`
--    02. consume_stock()                  — deduction garantie ou erreur claire
--    03. create_production()              — `origin` / vente d'origine au INSERT
--    04. transfer_production_to_comptoir()— tolerance d'arrondi
--    05. create_sale()                    — une ligne « fiche » ne casse plus le stock
--    06. create_sale_with_productions()   — chaine complete et VERIFIEE
--    07. repair_pos_sale_productions()    — rattrapage d'une vente deja saisie
--    08. Vues de controle + reclassement des lignes existantes
--    09. Droits
--
--  REGLE METIER — VENTE D'UNE FICHE TECHNIQUE A LA CAISSE
--  ------------------------------------------------------
--    a) une PRODUCTION est creee (origin = 'pos', rattachee a la vente) ;
--    b) chaque matiere « stock » de la fiche est DEDUITE de `products`
--       (quantite actuelle de l'ecran Gestion de stock) et tracee dans
--       `stock_movements` ;
--    c) le lot produit passe au comptoir puis est immediatement vendu ;
--    d) la vente apparait dans l'historique des ventes et dans celui du client.
--  Une « ancienne vente » (is_historical) ne declenche rien de tout cela.
-- ============================================================================

begin;

-- ============================================================================
-- 01. TRACABILITE — colonnes manquantes
-- ----------------------------------------------------------------------------
--  `sale_lines.fiche_technic_id` est la piece maitresse : c'est elle qui dit
--  qu'une ligne de vente vient d'une fiche technique. Sans elle, impossible de
--  distinguer une ligne « matiere premiere » d'une ligne « fiche » et donc
--  impossible de rattraper les ventes deja enregistrees.
-- ============================================================================

alter table public.sale_lines
  add column if not exists fiche_technic_id uuid,
  add column if not exists production_id    uuid,
  add column if not exists line_key         text,
  add column if not exists base_price       numeric(14,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sale_lines_fiche_technic_id_fkey') then
    alter table public.sale_lines
      add constraint sale_lines_fiche_technic_id_fkey
      foreign key (fiche_technic_id) references public.fiche_technics(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sale_lines_production_id_fkey') then
    alter table public.sale_lines
      add constraint sale_lines_production_id_fkey
      foreign key (production_id) references public.productions(id) on delete set null;
  end if;
end $$;

create index if not exists sale_lines_fiche_idx      on public.sale_lines (fiche_technic_id);
create index if not exists sale_lines_production_idx on public.sale_lines (production_id);

comment on column public.sale_lines.fiche_technic_id is
  'Fiche technique vendue sur cette ligne (vente caisse) — la production associee consomme le stock';
comment on column public.sale_lines.production_id is
  'Production (lot) lancee pour honorer cette ligne de vente';
comment on column public.sale_lines.line_key is
  'Cle de la ligne du panier de la caisse — relie la ligne de vente a sa production';

-- rappel des colonnes de la mise a jour « POS / rapports » (au cas ou elle
-- n'aurait pas ete executee : ce script doit pouvoir tourner seul)
alter table public.productions
  add column if not exists origin         text default 'manual',
  add column if not exists sale_id        uuid,
  add column if not exists sale_reference text;

update public.productions set origin = 'manual' where origin is null;

do $$
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
end $$;

create index if not exists productions_origin_idx  on public.productions (origin);
create index if not exists productions_sale_id_idx on public.productions (sale_id);

-- rappel des colonnes des mises a jour « n° de bon » et « anciennes ventes /
-- TVA » : create_sale() les ecrit, ce script doit donc pouvoir tourner seul
alter table public.sales
  add column if not exists bon_number    text,
  add column if not exists is_historical boolean       not null default false,
  add column if not exists tva_enabled   boolean       not null default false,
  add column if not exists tva_rate      numeric(6,2)  not null default 0,
  add column if not exists tva_amount    numeric(14,2) not null default 0;

create index if not exists sales_bon_number_idx on public.sales (lower(bon_number));


-- ============================================================================
-- 02. consume_stock() — la deduction est garantie, ou une erreur est levee
-- ----------------------------------------------------------------------------
--  Recherche la matiere par identifiant, puis par NOM (rattrape une fiche dont
--  l'identifiant est perime), et refuse de continuer en silence.
--  Renvoie l'identifiant du produit REELLEMENT decremente.
-- ============================================================================

drop function if exists public.consume_stock(uuid, numeric, text, text, uuid);

create or replace function public.consume_stock(
  p_product_id   uuid,
  p_quantity     numeric,
  p_reason       text,
  p_ref_table    text default null,
  p_ref_id       uuid default null,
  p_product_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pid  uuid;
  v_left numeric;
begin
  if coalesce(p_quantity, 0) <= 0 then
    return null;
  end if;

  -- 1) par identifiant, uniquement s'il designe encore un produit du stock
  if p_product_id is not null then
    select id into v_pid from public.products where id = p_product_id;
  end if;

  -- 2) sinon par nom — rattrape les fiches dont l'identifiant est perime
  if v_pid is null and coalesce(btrim(p_product_name), '') <> '' then
    select id into v_pid
      from public.products
     where lower(btrim(name)) = lower(btrim(p_product_name))
     order by is_active desc, current_quantity desc, created_at asc
     limit 1;
  end if;

  if v_pid is null then
    raise exception
      'Matiere introuvable dans le stock : % — impossible de deduire la quantite (%).',
      coalesce(nullif(btrim(p_product_name), ''), p_product_id::text, 'produit inconnu'),
      p_reason;
  end if;

  update public.products
     set current_quantity = greatest(0, current_quantity - p_quantity),
         updated_at = now()
   where id = v_pid
  returning current_quantity into v_left;

  insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
  values (v_pid, -p_quantity, p_reason, p_ref_table, p_ref_id, v_left);

  return v_pid;
end;
$fn$;


-- ============================================================================
-- 03. create_production() — l'origine est ecrite DES l'insertion
-- ----------------------------------------------------------------------------
--  Nouveautes du payload (toutes facultatives) :
--     "origin"         : 'manual' (defaut) ou 'pos'
--     "sale_id"        : vente qui declenche le lot
--     "sale_reference" : sa reference lisible
--  Ecrire l'origine au moment de l'INSERT supprime l'UPDATE de rattrapage qui
--  faisait echouer tout l'appel quand la colonne manquait.
-- ============================================================================

create or replace function public.create_production(p_payload jsonb)
returns public.productions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod     public.productions;
  v_line     jsonb;
  v_cost     numeric := 0;
  v_out      numeric := coalesce((p_payload ->> 'output_quantity')::numeric, 0);
  v_price    numeric := coalesce((p_payload ->> 'unit_price')::numeric, 0);
  v_cat      uuid;
  v_cat_name text;
  v_origin   text := lower(coalesce(nullif(btrim(p_payload ->> 'origin'), ''), 'manual'));
  v_lineid   uuid;
  v_used     uuid;
  v_qty      numeric;
  v_name     text;
  v_src      text;
begin
  if v_origin not in ('manual', 'pos') then
    v_origin := 'manual';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    v_cost := v_cost + coalesce((v_line ->> 'line_cost')::numeric,
                coalesce((v_line ->> 'quantity_used')::numeric, 0)
              * coalesce((v_line ->> 'unit_cost')::numeric, 0));
  end loop;

  -- la categorie recue peut venir d'une fiche technique : elle est traduite en
  -- categorie de production, sinon la cle etrangere refuse l'insertion
  v_cat := public.resolve_production_category(
             nullif(p_payload ->> 'category_id', '')::uuid,
             p_payload ->> 'category_name');
  v_cat_name := coalesce(
    nullif(btrim(coalesce(p_payload ->> 'category_name', '')), ''),
    (select name from public.production_categories where id = v_cat));

  insert into public.productions (name, description, date, hour, category_id, category_name,
                                  fiche_technic_id, total_cost, output_quantity, unit_price,
                                  total_value, sell_by_unit, sell_unit, sent_to_comptoir,
                                  has_loss, expected_quantity, loss_quantity, loss_description,
                                  loss_value, origin, sale_id, sale_reference, created_by)
  values (coalesce(nullif(btrim(p_payload ->> 'name'), ''), 'Production'),
          coalesce(p_payload ->> 'description', ''),
          coalesce((p_payload ->> 'date')::date, current_date),
          coalesce(p_payload ->> 'hour', to_char(now(), 'HH24:MI')),
          v_cat,
          v_cat_name,
          nullif(p_payload ->> 'fiche_technic_id', '')::uuid,
          v_cost, v_out, v_price, v_out * v_price,
          coalesce((p_payload ->> 'sell_by_unit')::boolean, false),
          p_payload ->> 'sell_unit',
          0,
          coalesce((p_payload ->> 'has_loss')::boolean, false),
          nullif(p_payload ->> 'expected_quantity', '')::numeric,
          coalesce((p_payload ->> 'loss_quantity')::numeric, 0),
          p_payload ->> 'loss_description',
          coalesce((p_payload ->> 'loss_value')::numeric, 0),
          v_origin,
          nullif(p_payload ->> 'sale_id', '')::uuid,
          nullif(btrim(coalesce(p_payload ->> 'sale_reference', '')), ''),
          public.current_username())
  returning * into v_prod;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    v_qty  := coalesce((v_line ->> 'quantity_used')::numeric, 0);
    v_name := coalesce(nullif(btrim(v_line ->> 'product_name'), ''), 'Ingredient');
    v_src  := coalesce(nullif(btrim(v_line ->> 'source_type'), ''), 'stock');

    insert into public.production_used_products (production_id, product_id, product_name,
                                                 quantity_used, source_type, unit, unit_cost, line_cost)
    values (v_prod.id,
            nullif(v_line ->> 'product_id', '')::uuid,
            v_name,
            v_qty,
            coalesce(v_src::public.used_source_type, 'stock'),
            v_line ->> 'unit',
            coalesce((v_line ->> 'unit_cost')::numeric, 0),
            coalesce((v_line ->> 'line_cost')::numeric, 0))
    returning id into v_lineid;

    -- seules les matieres prises sur le STOCK sont decrementees ; une source
    -- 'fiche' est un semi-fini deja produit (son propre lot a deja consomme).
    if v_src = 'stock' and v_qty > 0 then
      v_used := public.consume_stock(
                  nullif(v_line ->> 'product_id', '')::uuid,
                  v_qty,
                  'production', 'productions', v_prod.id,
                  v_name);

      -- on garde l'identifiant du produit REELLEMENT decremente
      if v_used is not null then
        update public.production_used_products
           set product_id = v_used
         where id = v_lineid and product_id is distinct from v_used;
      end if;
    end if;
  end loop;

  perform public.log_activity('production', 'create', 'productions', v_prod.id, p_payload);
  return v_prod;
end;
$fn$;


-- ============================================================================
-- 04. transfer_production_to_comptoir() — tolerance d'arrondi
-- ----------------------------------------------------------------------------
--  `output_quantity` est stockee en numeric(14,3). Transferer « tout le lot »
--  depuis l'application pouvait depasser le plafond d'un millieme et faire
--  echouer toute la vente. La quantite est desormais bornee au reste.
-- ============================================================================

create or replace function public.transfer_production_to_comptoir(
  p_production_id uuid, p_quantity numeric
) returns public.comptoir_items
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod public.productions;
  v_item public.comptoir_items;
  v_left numeric;
  v_qty  numeric;
begin
  select * into v_prod from public.productions where id = p_production_id;
  if v_prod.id is null then
    raise exception 'Production introuvable (%)', p_production_id;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantite invalide';
  end if;

  v_left := v_prod.output_quantity - v_prod.sent_to_comptoir;
  v_qty  := p_quantity;

  -- ecart d'arrondi (<= 1 millieme) : on borne au reste au lieu d'echouer
  if v_qty > v_left and v_qty - v_left <= 0.001 then
    v_qty := v_left;
  end if;

  if v_qty > v_left then
    raise exception 'La quantite depasse la quantite produite (disponible: %)', v_left;
  end if;

  update public.productions
     set sent_to_comptoir = sent_to_comptoir + v_qty, updated_at = now()
   where id = p_production_id;

  select * into v_item from public.comptoir_items where production_id = p_production_id limit 1;

  if v_item.id is not null then
    update public.comptoir_items
       set quantity = quantity + v_qty, updated_at = now()
     where id = v_item.id
    returning * into v_item;
  else
    insert into public.comptoir_items (production_id, product_name, description, quantity, unit_price,
                                       date, category_id, category_name, sell_by_unit, unit, created_by)
    values (v_prod.id, v_prod.name, v_prod.description, v_qty, v_prod.unit_price,
            current_date, v_prod.category_id, v_prod.category_name,
            v_prod.sell_by_unit, case when v_prod.sell_by_unit then v_prod.sell_unit end,
            public.current_username())
    returning * into v_item;
  end if;

  perform public.log_activity('production', 'transfer', 'comptoir_items', v_item.id,
                              jsonb_build_object('quantity', v_qty));
  return v_item;
end;
$fn$;


-- ============================================================================
-- 05. create_sale() — une ligne « fiche technique » ne casse plus le stock
-- ----------------------------------------------------------------------------
--  Ajouts par rapport a la version precedente (« ancienne vente » + TVA) :
--    · les lignes memorisent `fiche_technic_id`, `production_id` et `line_key` ;
--    · GARDE-FOU : un identifiant de FICHE TECHNIQUE arrive dans `product_id`
--      (ancien bug de la caisse) n'est plus traite comme une matiere premiere ;
--      il est reclasse en `fiche_technic_id` et ne declenche aucune deduction
--      de stock (c'est la production du lot qui consomme les matieres).
--    · `base_price` est ecrit explicitement.
-- ============================================================================

create or replace function public.create_sale(p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale     public.sales;
  v_ref      text;
  v_line     jsonb;
  v_total    numeric := 0;
  v_red      numeric := coalesce((p_payload ->> 'reduction')::numeric, 0);
  v_base     numeric;
  v_tva_on   boolean := coalesce((p_payload ->> 'tva_enabled')::boolean, false);
  v_tva_rate numeric := coalesce((p_payload ->> 'tva_rate')::numeric, 0);
  v_tva      numeric := 0;
  v_final    numeric;
  v_paid     numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_rest     numeric;
  v_date     date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_hist     boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_status   public.sale_status;
  v_seq      int;
  v_pid      uuid;
  v_cid      uuid;
  v_fid      uuid;
  v_prid     uuid;
  v_qty      numeric;
  v_bon      text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.sales;
  v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.sales where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_line ->> 'quantity')::numeric, 0)
                       * coalesce((v_line ->> 'selling_price')::numeric, 0);
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  -- ---- TVA : base HT -> montant -> net TTC -------------------------------
  if not v_tva_on then
    v_tva_rate := 0;
  end if;
  v_red   := least(greatest(0, v_red), v_total);
  v_base  := greatest(0, v_total - v_red);
  v_tva   := case when v_tva_on then round(v_base * v_tva_rate / 100, 2) else 0 end;
  v_final := v_base + v_tva;

  v_rest   := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  -- la vente est ecrite AVANT ses lignes et son paiement : les declencheurs
  -- de caisse peuvent donc lire `is_historical`.
  insert into public.sales (reference, client_id, date, total_amount, reduction, final_amount,
                            paid_amount, rest_amount, status, note, bon_number,
                            is_historical, tva_enabled, tva_rate, tva_amount, created_by)
  values (v_ref, nullif(p_payload ->> 'client_id', '')::uuid, v_date,
          v_total, v_red, v_final, v_paid, v_rest, v_status,
          p_payload ->> 'note', v_bon,
          v_hist, v_tva_on, v_tva_rate, v_tva, public.current_username())
  returning * into v_sale;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_pid  := nullif(v_line ->> 'product_id', '')::uuid;
    v_cid  := nullif(v_line ->> 'comptoir_id', '')::uuid;
    v_fid  := nullif(v_line ->> 'fiche_technic_id', '')::uuid;
    v_prid := nullif(v_line ->> 'production_id', '')::uuid;
    v_qty  := coalesce((v_line ->> 'quantity')::numeric, 0);

    -- GARDE-FOU : `product_id` qui n'est pas un produit du stock mais une
    -- fiche technique -> on le reclasse. Sans cela la vente tenterait de
    -- deduire une « matiere » inexistante et ne deduirait donc RIEN.
    if v_pid is not null
       and not exists (select 1 from public.products where id = v_pid)
       and exists (select 1 from public.fiche_technics where id = v_pid) then
      v_fid := coalesce(v_fid, v_pid);
      v_pid := null;
    end if;

    insert into public.sale_lines (sale_id, product_id, comptoir_id, fiche_technic_id, production_id,
                                   line_key, product_name, quantity, selling_price, base_price,
                                   sell_by_unit, unit)
    values (v_sale.id, v_pid, v_cid, v_fid, v_prid,
            nullif(btrim(coalesce(v_line ->> 'line_key', '')), ''),
            coalesce(nullif(btrim(v_line ->> 'product_name'), ''), 'Produit'), v_qty,
            coalesce((v_line ->> 'selling_price')::numeric, 0),
            nullif(v_line ->> 'base_price', '')::numeric,
            coalesce((v_line ->> 'sell_by_unit')::boolean, false),
            v_line ->> 'unit');

    -- Decrement comptoir / stock — SAUTE pour une ancienne vente : la
    -- marchandise est sortie du magasin dans le passe, hors du logiciel.
    if not v_hist then
      if v_cid is not null then
        update public.comptoir_items
           set quantity = greatest(0, quantity - v_qty), updated_at = now()
         where id = v_cid;
      elsif v_pid is not null then
        perform public.consume_stock(v_pid, v_qty, 'sale', 'sales', v_sale.id,
                                     v_line ->> 'product_name');
      end if;
      -- une ligne « fiche technique » sans article de comptoir ne consomme
      -- rien ici : ce sont les matieres de SA production qui sont deduites.
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, v_date, v_paid,
            case when v_hist then 'Paiement ancienne vente' else 'Paiement vente' end);
  end if;

  -- le reste impaye devient une dette client suivie (y compris en retroactif :
  -- c'est justement ce qui permet de reconstituer l'ardoise d'un client)
  if v_rest > 0 and v_sale.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_sale.client_id, c.name, c.phone, v_rest, v_rest, v_date,
           'Reste vente ' || v_ref, public.current_username()
      from public.clients c where c.id = v_sale.client_id;
  end if;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$fn$;


-- ============================================================================
-- 06. create_sale_with_productions() — chaine complete et VERIFIEE
-- ----------------------------------------------------------------------------
--  Point d'entree de la caisse des qu'une FICHE TECHNIQUE est au panier.
--  Pour CHAQUE ligne « fiche technique » :
--    a) create_production()               -> le lot est cree (origin = 'pos')
--                                            ET les matieres sont deduites du
--                                            stock (gestion de stock a jour)
--    b) transfer_production_to_comptoir() -> le lot passe au comptoir
--    c) la ligne de vente recoit cet article de comptoir
--  Puis create_sale() ecrit la vente (qui vide l'article du comptoir), et les
--  productions sont rattachees a la vente dans les DEUX sens.
--
--  VERIFICATION FINALE : si une production demandee n'a pas ete creee ou n'a
--  pas ete rattachee, la transaction ECHOUE. Plus jamais de vente « fantome »
--  sans production et sans deduction de stock.
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
  v_map       jsonb := '{}'::jsonb;   -- line_key -> { comptoir_id, production_id, fiche_technic_id }
  v_out       jsonb := '[]'::jsonb;
  v_line      jsonb;
  v_key       text;
  v_qty       numeric;
  v_date      date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_hist      boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_asked     int     := jsonb_array_length(coalesce(p_payload -> 'productions', '[]'::jsonb));
  v_made      int;
begin
  -- Une ancienne vente ne lance jamais de production : elle consommerait le
  -- stock d'aujourd'hui pour une marchandise sortie il y a des mois.
  if v_hist then
    v_asked := 0;
  end if;

  -- a/b) une production par ligne « fiche technique » du panier
  if not v_hist then
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
          'date',             to_char(v_date, 'YYYY-MM-DD'),
          'hour',             coalesce(v_prod_line ->> 'hour', to_char(now(), 'HH24:MI')),
          'category_id',      v_prod_line ->> 'category_id',
          'category_name',    v_prod_line ->> 'category_name',
          'fiche_technic_id', v_prod_line ->> 'fiche_technic_id',
          'output_quantity',  v_qty,
          'unit_price',       coalesce((v_prod_line ->> 'unit_price')::numeric, 0),
          'sell_by_unit',     coalesce((v_prod_line ->> 'sell_by_unit')::boolean, false),
          'sell_unit',        v_prod_line ->> 'sell_unit',
          'origin',           'pos',
          'used_products',    coalesce(v_prod_line -> 'used_products', '[]'::jsonb)
        )
      );

      -- output_quantity est stockee en numeric(14,3) : on transfere la valeur
      -- reellement enregistree pour ne jamais depasser le lot produit.
      v_item := public.transfer_production_to_comptoir(v_prod.id, v_prod.output_quantity);

      -- jsonb_build_object refuse une cle NULL : on retombe sur l'identifiant
      -- du lot, qui est toujours renseigne.
      v_key := coalesce(v_prod_line ->> 'line_key',
                        v_prod_line ->> 'fiche_technic_id',
                        v_prod.id::text);
      v_map := v_map || jsonb_build_object(
        v_key, jsonb_build_object(
          'comptoir_id',      v_item.id,
          'production_id',    v_prod.id,
          'fiche_technic_id', v_prod.fiche_technic_id
        )
      );
    end loop;
  end if;

  -- c) les lignes de vente recoivent l'article de comptoir qui vient d'etre cree
  for v_line in
    select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb))
  loop
    v_key := v_line ->> 'line_key';
    if v_key is not null and v_map ? v_key then
      v_line := v_line || jsonb_build_object(
        'comptoir_id',      v_map -> v_key ->> 'comptoir_id',
        'production_id',    v_map -> v_key ->> 'production_id',
        'fiche_technic_id', coalesce(v_map -> v_key ->> 'fiche_technic_id',
                                     v_line ->> 'fiche_technic_id'),
        'product_id',       null::text
      );
    elsif v_key is not null then
      -- ligne « fiche » sans lot (ancienne vente) : surtout pas de product_id,
      -- sinon la vente essaierait de deduire une matiere inexistante.
      v_line := v_line || jsonb_build_object(
        'fiche_technic_id', coalesce(v_line ->> 'fiche_technic_id', v_line ->> 'product_id'),
        'product_id',       null::text
      );
    end if;
    v_out := v_out || jsonb_build_array(v_line);
  end loop;

  v_sale := public.create_sale(
    jsonb_build_object(
      'client_id',     p_payload ->> 'client_id',
      'date',          to_char(v_date, 'YYYY-MM-DD'),
      'reduction',     coalesce((p_payload ->> 'reduction')::numeric, 0),
      'total_amount',  (p_payload ->> 'total_amount')::numeric,
      'paid_amount',   coalesce((p_payload ->> 'paid_amount')::numeric, 0),
      'note',          p_payload ->> 'note',
      'bon_number',    p_payload ->> 'bon_number',
      'is_historical', v_hist,
      'tva_enabled',   coalesce((p_payload ->> 'tva_enabled')::boolean, false),
      'tva_rate',      coalesce((p_payload ->> 'tva_rate')::numeric, 0),
      'products',      v_out
    )
  );

  -- rattache les productions creees a la vente (affichage dans /production).
  -- On parcourt la CARTE des lots reellement crees, pas le payload : la cle
  -- reste ainsi coherente meme si la caisse n'a pas envoye de `line_key`.
  for v_line in select value from jsonb_each(v_map) loop
    update public.productions
       set origin         = 'pos',
           sale_id        = v_sale.id,
           sale_reference = v_sale.reference,
           updated_at     = now()
     where id = (v_line ->> 'production_id')::uuid;
  end loop;

  -- ---- VERIFICATION : autant de lots crees que demandes -------------------
  select count(*) into v_made
    from public.productions
   where sale_id = v_sale.id and origin = 'pos';

  if v_made <> v_asked then
    raise exception
      'Incoherence caisse/production : % production(s) demandee(s), % creee(s) pour la vente %.',
      v_asked, v_made, v_sale.reference;
  end if;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$fn$;


-- ============================================================================
-- 07. repair_pos_sale_productions() — rattrapage d'une vente deja enregistree
-- ----------------------------------------------------------------------------
--  Filet de securite appele par la caisse quand, apres l'enregistrement, elle
--  constate qu'aucune production n'a ete rattachee a la vente (base ancienne,
--  vente saisie avant cette mise a jour, incident reseau...).
--
--  Pour chaque production manquante :
--    · le lot est cree (origin = 'pos', rattache a la vente)  -> ecran Production
--    · ses matieres sont deduites du stock                    -> gestion de stock
--    · le lot passe au comptoir puis la quantite vendue en est retiree
--      (la marchandise est deja partie avec la vente)
--    · la ligne de vente est reliee au lot
--
--  Payload : { "sale_id": uuid, "productions": [ ... meme format que la caisse ] }
--  Renvoie le nombre de productions effectivement creees.
--  Idempotent : une production deja rattachee a cette vente n'est jamais
--  recreee, donc le stock ne peut pas etre deduit deux fois.
-- ============================================================================

create or replace function public.repair_pos_sale_productions(p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale      public.sales;
  v_prod_line jsonb;
  v_prod      public.productions;
  v_item      public.comptoir_items;
  v_sale_id   uuid := nullif(p_payload ->> 'sale_id', '')::uuid;
  v_key       text;
  v_qty       numeric;
  v_sold      numeric;
  v_made      int := 0;
begin
  select * into v_sale from public.sales where id = v_sale_id;
  if v_sale.id is null then
    raise exception 'Vente introuvable (%)', v_sale_id;
  end if;
  if coalesce(v_sale.is_historical, false) then
    -- une ancienne vente ne doit jamais consommer le stock d'aujourd'hui
    return 0;
  end if;

  for v_prod_line in
    select * from jsonb_array_elements(coalesce(p_payload -> 'productions', '[]'::jsonb))
  loop
    -- '' est une sentinelle : create_sale() n'enregistre jamais une line_key
    -- vide, donc `is not distinct from ''` ne peut pas matcher par accident.
    v_key := coalesce(v_prod_line ->> 'line_key', v_prod_line ->> 'fiche_technic_id', '');
    v_qty := coalesce((v_prod_line ->> 'output_quantity')::numeric, 0);
    if v_qty <= 0 then
      continue;
    end if;

    -- deja rattachee ? on ne refait rien (idempotence) — meme predicat que la
    -- mise a jour finale, sinon un second passage creerait un lot en double
    -- et deduirait le stock deux fois.
    if exists (
      select 1 from public.sale_lines sl
       where sl.sale_id = v_sale.id
         and sl.production_id is not null
         and (sl.line_key is not distinct from v_key
              or (sl.line_key is null
                  and lower(btrim(sl.product_name))
                      = lower(btrim(coalesce(v_prod_line ->> 'name', '')))))
    ) then
      continue;
    end if;

    v_prod := public.create_production(
      jsonb_build_object(
        'name',             coalesce(v_prod_line ->> 'name', 'Production'),
        'description',      coalesce(v_prod_line ->> 'description', ''),
        'date',             to_char(v_sale.date, 'YYYY-MM-DD'),
        'hour',             coalesce(v_prod_line ->> 'hour', to_char(now(), 'HH24:MI')),
        'category_id',      v_prod_line ->> 'category_id',
        'category_name',    v_prod_line ->> 'category_name',
        'fiche_technic_id', v_prod_line ->> 'fiche_technic_id',
        'output_quantity',  v_qty,
        'unit_price',       coalesce((v_prod_line ->> 'unit_price')::numeric, 0),
        'sell_by_unit',     coalesce((v_prod_line ->> 'sell_by_unit')::boolean, false),
        'sell_unit',        v_prod_line ->> 'sell_unit',
        'origin',           'pos',
        'sale_id',          v_sale.id::text,
        'sale_reference',   v_sale.reference,
        'used_products',    coalesce(v_prod_line -> 'used_products', '[]'::jsonb)
      )
    );

    v_item := public.transfer_production_to_comptoir(v_prod.id, v_prod.output_quantity);

    -- la marchandise est deja partie avec la vente : on retire du comptoir la
    -- quantite reellement vendue sur cette ligne
    select coalesce(sum(sl.quantity), 0) into v_sold
      from public.sale_lines sl
     where sl.sale_id = v_sale.id
       and (sl.line_key is not distinct from v_key
            or (sl.line_key is null and lower(btrim(sl.product_name)) = lower(btrim(v_prod.name))));

    if v_sold > 0 then
      update public.comptoir_items
         set quantity = greatest(0, quantity - v_sold), updated_at = now()
       where id = v_item.id;
    end if;

    -- la ligne de vente pointe desormais vers son lot
    update public.sale_lines sl
       set production_id    = v_prod.id,
           fiche_technic_id = coalesce(sl.fiche_technic_id, v_prod.fiche_technic_id),
           comptoir_id      = coalesce(sl.comptoir_id, v_item.id),
           product_id       = case
                                when sl.product_id is not null
                                 and not exists (select 1 from public.products p where p.id = sl.product_id)
                                then null else sl.product_id end
     where sl.sale_id = v_sale.id
       and sl.production_id is null
       and (sl.line_key is not distinct from v_key
            or (sl.line_key is null and lower(btrim(sl.product_name)) = lower(btrim(v_prod.name))));

    v_made := v_made + 1;
  end loop;

  if v_made > 0 then
    perform public.log_activity('pos', 'repair', 'sales', v_sale.id, p_payload);
  end if;
  return v_made;
end;
$fn$;


-- ============================================================================
-- 08. VUES DE CONTROLE
-- ============================================================================

-- Productions lancees par la caisse, avec leur vente et leur cout
drop view if exists public.v_pos_productions;
create view public.v_pos_productions as
select p.id,
       p.date,
       p.hour,
       p.name,
       p.category_name,
       p.origin,
       p.sale_id,
       p.sale_reference,
       s.client_id,
       c.name as client_name,
       p.output_quantity,
       p.unit_price,
       p.total_value,
       p.total_cost,
       p.total_value - p.total_cost as gains,
       p.created_by,
       p.created_at
  from public.productions p
  left join public.sales   s on s.id = p.sale_id
  left join public.clients c on c.id = s.client_id
 where p.origin = 'pos'
 order by p.date desc, p.created_at desc;

alter view public.v_pos_productions set (security_invoker = true);

-- Matieres reellement consommees par les productions de la caisse
drop view if exists public.v_pos_production_matieres;
create view public.v_pos_production_matieres as
select p.id            as production_id,
       p.date,
       p.name          as production_name,
       p.sale_reference,
       u.product_id,
       u.product_name,
       u.source_type,
       u.quantity_used,
       u.unit,
       u.unit_cost,
       u.line_cost,
       pr.current_quantity as stock_restant
  from public.productions p
  join public.production_used_products u on u.production_id = p.id
  left join public.products pr on pr.id = u.product_id
 where p.origin = 'pos'
 order by p.date desc;

alter view public.v_pos_production_matieres set (security_invoker = true);

-- Ventes de fiche technique dont le lot n'a PAS ete cree (a rattraper)
drop view if exists public.v_ventes_fiche_sans_production;
create view public.v_ventes_fiche_sans_production as
select s.id            as sale_id,
       s.reference,
       s.date,
       s.client_id,
       c.name          as client_name,
       sl.id           as sale_line_id,
       sl.product_name,
       sl.quantity,
       sl.selling_price,
       sl.fiche_technic_id
  from public.sale_lines sl
  join public.sales   s on s.id = sl.sale_id
  left join public.clients c on c.id = s.client_id
 where coalesce(s.is_historical, false) = false
   and sl.production_id is null
   and (
        sl.fiche_technic_id is not null
        or (sl.product_id is not null
            and not exists (select 1 from public.products p where p.id = sl.product_id)
            and exists (select 1 from public.fiche_technics f where f.id = sl.product_id))
       );

alter view public.v_ventes_fiche_sans_production set (security_invoker = true);


-- ============================================================================
-- 08 bis. RECLASSEMENT DES LIGNES DEJA ENREGISTREES
-- ----------------------------------------------------------------------------
--  Les ventes passees ou l'identifiant de la fiche technique avait atterri
--  dans `product_id` sont corrigees : la ligne devient explicitement une ligne
--  « fiche technique ». Aucun stock n'est touche ici — c'est
--  `repair_pos_sale_productions()` qui lance les lots manquants.
-- ============================================================================

update public.sale_lines sl
   set fiche_technic_id = sl.product_id,
       product_id       = null
 where sl.fiche_technic_id is null
   and sl.product_id is not null
   and not exists (select 1 from public.products p where p.id = sl.product_id)
   and exists (select 1 from public.fiche_technics f where f.id = sl.product_id);

-- Les productions deja rattachees a une vente sont marquees comme venant de
-- la caisse (certaines bases ont pu garder origin = 'manual').
update public.productions
   set origin = 'pos'
 where sale_id is not null and coalesce(origin, 'manual') <> 'pos';


-- ============================================================================
-- 09. DROITS
-- ============================================================================

grant execute on function public.consume_stock(uuid, numeric, text, text, uuid, text)
  to authenticated, service_role;
grant execute on function public.create_production(jsonb)             to authenticated, service_role;
grant execute on function public.transfer_production_to_comptoir(uuid, numeric)
  to authenticated, service_role;
grant execute on function public.create_sale(jsonb)                   to authenticated, service_role;
grant execute on function public.create_sale_with_productions(jsonb)  to authenticated, service_role;
grant execute on function public.repair_pos_sale_productions(jsonb)   to authenticated, service_role;

grant select on public.v_pos_productions              to authenticated, service_role;
grant select on public.v_pos_production_matieres      to authenticated, service_role;
grant select on public.v_ventes_fiche_sans_production to authenticated, service_role;

commit;

-- ============================================================================
--  VERIFICATION APRES EXECUTION
-- ----------------------------------------------------------------------------
--  1) Les ventes de fiche technique sans lot (doit rester vide) :
--       select * from public.v_ventes_fiche_sans_production;
--
--  2) Les productions lancees par la caisse :
--       select * from public.v_pos_productions order by created_at desc limit 20;
--
--  3) Les matieres deduites par ces productions :
--       select * from public.v_pos_production_matieres order by date desc limit 50;
--
--  4) Les mouvements de stock correspondants :
--       select * from public.stock_movements
--        where reason = 'production' order by created_at desc limit 50;
-- ============================================================================

;


-- ===== altech_production_update_livraison_stock_historique.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « La LIVRAISON d'une commande deduit REELLEMENT les matieres premieres
--    du stock — la commande, elle, ne touche a rien. »
-- ----------------------------------------------------------------------------
--  A executer EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est idempotent : il peut etre relance sans risque.
--
--  PROBLEME CORRIGE
--  ----------------
--  A la creation d'un BON DE LIVRAISON, les quantites de matieres premieres
--  consommees par la production livree n'etaient PAS retirees de « Gestion de
--  stock ». Seules les quantites livrees de la commande etaient mises a jour.
--
--  REGLE METIER APPLIQUEE PAR CE SCRIPT
--  ------------------------------------
--    1. CREATION D'UNE COMMANDE  -> AUCUN mouvement de stock.
--       La commande est une promesse de vente : rien n'est produit, rien n'est
--       consomme. (`create_command()` n'a jamais touche au stock : ce script le
--       verifie et le documente.)
--
--    2. CREATION D'UNE LIVRAISON -> DEDUCTION REELLE DU STOCK.
--       Pour chaque ligne livree :
--         · si la ligne de commande pointe une FICHE TECHNIQUE, la recette est
--           « depliee » (y compris les fiches imbriquees) et chaque matiere est
--           deduite AU PRORATA de la quantite livree :
--                quantite_deduite = quantite_recette x quantite_livree
--                                   ---------------------------------
--                                        quantite_produite_fiche
--         · sinon, si la ligne pointe (ou porte le nom d')un produit du stock,
--           c'est ce produit qui est deduit de la quantite livree.
--       Chaque deduction est tracee dans `stock_movements` ET dans la nouvelle
--       table `command_delivery_consumptions`.
--
--    3. MODIFICATION D'UNE LIVRAISON -> le stock est d'abord REMIS puis
--       rededuit avec les nouvelles quantites (aucun double comptage).
--
--    4. SUPPRESSION D'UNE LIVRAISON (ou de sa commande) -> le stock est REMIS
--       automatiquement par un declencheur.
--
--  CONTENU
--  -------
--    01. Table `command_delivery_consumptions` (+ index, RLS, temps reel)
--    02. fiche_stock_requirements()      — depliage d'une fiche technique
--    02b. resolve_stock_product()        — retrouve la matiere (id puis nom)
--    03. restore_stock()                 — remise en stock tracee
--    04. revert_command_delivery_stock() — annule la deduction d'une livraison
--    05. apply_command_delivery_stock()  — calcule et applique la deduction
--    06. Declencheur de remise en stock a la suppression
--    07. create_command_delivery()       — deduit le stock
--    08. update_command_delivery()       — recalcule la deduction
--    09. delete_command_delivery()       — remise en stock (via declencheur)
--    10. create_command()                — confirme : aucun mouvement de stock
--    11. Vues de controle
--    12. Droits
-- ============================================================================

begin;


-- ============================================================================
-- 01. TABLE — ce qui a ete deduit du stock pour une livraison
-- ----------------------------------------------------------------------------
--  Sans cette trace, impossible de remettre les quantites en stock quand la
--  livraison est modifiee ou supprimee.
-- ============================================================================

create table if not exists public.command_delivery_consumptions (
  id                 uuid primary key default gen_random_uuid(),
  delivery_id        uuid not null references public.command_deliveries(id) on delete cascade,
  command_item_id    uuid references public.command_items(id) on delete set null,
  fiche_technic_id   uuid,
  product_id         uuid,
  product_name       text not null,
  unit               text,
  delivered_quantity numeric(14,3) not null default 0,  -- quantite livree de la ligne
  quantity           numeric(14,3) not null default 0,  -- quantite RETIREE du stock
  unit_cost          numeric(14,2) not null default 0,
  line_cost          numeric(14,2) not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists command_delivery_consumptions_del_idx
  on public.command_delivery_consumptions (delivery_id);
create index if not exists command_delivery_consumptions_prod_idx
  on public.command_delivery_consumptions (product_id);

comment on table public.command_delivery_consumptions is
  'Matieres premieres reellement retirees du stock par un bon de livraison. Sert a annuler la deduction quand la livraison est modifiee ou supprimee.';


-- ============================================================================
-- 02. fiche_stock_requirements() — depliage d'une fiche technique
-- ----------------------------------------------------------------------------
--  Renvoie, pour `p_quantity` unites produites d'une fiche, la liste des
--  matieres du STOCK a consommer. Les lignes « fiche » (semi-finis) sont
--  depliees recursivement — sinon une recette imbriquee ne deduirait rien.
-- ============================================================================

create or replace function public.fiche_stock_requirements(
  p_fiche_technic_id uuid,
  p_quantity         numeric,
  p_depth            int default 0
) returns table (
  product_id   uuid,
  product_name text,
  unit         text,
  quantity     numeric,
  unit_cost    numeric
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_out    numeric;
  v_factor numeric;
  v_line   record;
begin
  if p_fiche_technic_id is null or coalesce(p_quantity, 0) <= 0 or p_depth > 5 then
    return;
  end if;

  select nullif(f.output_quantity, 0) into v_out
    from public.fiche_technics f where f.id = p_fiche_technic_id;
  if v_out is null then
    v_out := 1;               -- fiche introuvable ou rendement nul : 1 pour 1
  end if;
  v_factor := p_quantity / v_out;

  for v_line in
    select l.product_id, l.product_name, l.unit, l.quantity_used, l.unit_cost, l.source_type
      from public.fiche_technic_lines l
     where l.fiche_technic_id = p_fiche_technic_id
  loop
    if v_line.source_type = 'fiche' then
      -- semi-fini : on descend dans sa propre recette
      return query
        select r.product_id, r.product_name, r.unit, r.quantity, r.unit_cost
          from public.fiche_stock_requirements(
                 v_line.product_id,
                 coalesce(v_line.quantity_used, 0) * v_factor,
                 p_depth + 1) r;
    else
      return query
        select v_line.product_id,
               coalesce(nullif(btrim(v_line.product_name), ''), 'Ingredient'),
               v_line.unit,
               coalesce(v_line.quantity_used, 0) * v_factor,
               coalesce(v_line.unit_cost, 0);
    end if;
  end loop;
end;
$fn$;

comment on function public.fiche_stock_requirements(uuid, numeric, int) is
  'Matieres du stock necessaires pour produire p_quantity unites d''une fiche technique.';


-- ============================================================================
-- 02 bis. resolve_stock_product() — retrouve la matiere visee
-- ----------------------------------------------------------------------------
--  Meme recherche que `consume_stock()` : d'abord par identifiant, puis par
--  NOM (rattrape une fiche dont l'identifiant est perime). Sert a connaitre la
--  quantite DISPONIBLE avant la deduction, pour n'enregistrer que ce qui a
--  reellement quitte le stock.
-- ============================================================================

create or replace function public.resolve_stock_product(
  p_product_id   uuid,
  p_product_name text default null
) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare v_pid uuid;
begin
  if p_product_id is not null then
    select p.id into v_pid from public.products p where p.id = p_product_id;
  end if;

  if v_pid is null and coalesce(btrim(p_product_name), '') <> '' then
    select p.id into v_pid
      from public.products p
     where lower(btrim(p.name)) = lower(btrim(p_product_name))
     order by p.is_active desc, p.current_quantity desc, p.created_at asc
     limit 1;
  end if;

  return v_pid;
end;
$fn$;


-- ============================================================================
-- 03. restore_stock() — remise en stock, tracee comme un mouvement
-- ============================================================================

create or replace function public.restore_stock(
  p_product_id uuid,
  p_quantity   numeric,
  p_reason     text,
  p_ref_table  text default null,
  p_ref_id     uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_left numeric;
begin
  if p_product_id is null or coalesce(p_quantity, 0) <= 0 then
    return;
  end if;

  update public.products
     set current_quantity = current_quantity + p_quantity,
         updated_at = now()
   where id = p_product_id
  returning current_quantity into v_left;

  if not found then
    return;                    -- produit supprime entre temps : rien a remettre
  end if;

  insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
  values (p_product_id, p_quantity, p_reason, p_ref_table, p_ref_id, v_left);
end;
$fn$;


-- ============================================================================
-- 04. revert_command_delivery_stock() — annule la deduction d'une livraison
-- ============================================================================

create or replace function public.revert_command_delivery_stock(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row record;
begin
  if p_delivery_id is null then return; end if;

  for v_row in
    select product_id, quantity
      from public.command_delivery_consumptions
     where delivery_id = p_delivery_id
  loop
    perform public.restore_stock(v_row.product_id, v_row.quantity,
                                 'command_delivery_cancel', 'command_deliveries', p_delivery_id);
  end loop;

  delete from public.command_delivery_consumptions where delivery_id = p_delivery_id;
end;
$fn$;


-- ============================================================================
-- 05. apply_command_delivery_stock() — LE COEUR DE LA CORRECTION
-- ----------------------------------------------------------------------------
--  Recalcule integralement la deduction de stock d'une livraison :
--    · on remet d'abord ce qui avait deja ete deduit (idempotence),
--    · puis, ligne livree par ligne livree, on deduit les matieres au prorata.
-- ============================================================================

create or replace function public.apply_command_delivery_stock(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del   public.command_deliveries;
  v_item  record;
  v_ci    public.command_items;
  v_req   record;
  v_pid   uuid;
  v_price numeric;
  v_unit  text;
  v_cost  numeric;
  v_avail numeric;
  v_taken numeric;
begin
  select * into v_del from public.command_deliveries where id = p_delivery_id;
  if v_del.id is null then return; end if;

  -- jamais deux deductions pour la meme livraison
  perform public.revert_command_delivery_stock(p_delivery_id);

  for v_item in
    select di.command_item_id, di.product_name, di.quantity
      from public.command_delivery_items di
     where di.delivery_id = p_delivery_id
       and coalesce(di.quantity, 0) > 0
  loop
    v_ci := null;

    if v_item.command_item_id is not null then
      select * into v_ci from public.command_items where id = v_item.command_item_id;
    end if;
    -- la ligne peut avoir ete recreee (edition de la commande) : on rattrape
    -- par le nom du produit a l'interieur de la meme commande
    if v_ci.id is null then
      select * into v_ci
        from public.command_items
       where command_id = v_del.command_id
         and lower(btrim(product_name)) = lower(btrim(coalesce(v_item.product_name, '')))
       order by created_at asc
       limit 1;
    end if;

    if v_ci.id is not null and v_ci.fiche_technic_id is not null then
      -- ---------------------------------------------------------------------
      -- Ligne issue d'une FICHE TECHNIQUE : on deplie la recette au prorata
      -- ---------------------------------------------------------------------
      for v_req in
        select r.product_id,
               r.product_name,
               max(r.unit)      as unit,
               sum(r.quantity)  as quantity,
               max(r.unit_cost) as unit_cost
          from public.fiche_stock_requirements(v_ci.fiche_technic_id, v_item.quantity) r
         group by r.product_id, r.product_name
      loop
        if coalesce(v_req.quantity, 0) <= 0 then
          continue;
        end if;

        -- disponible AVANT la deduction : `consume_stock()` borne le stock a
        -- zero, on ne doit donc jamais enregistrer plus que ce qui est sorti,
        -- sinon la suppression de la livraison creerait du stock ex nihilo.
        v_pid  := public.resolve_stock_product(v_req.product_id, v_req.product_name);
        v_avail := null;
        if v_pid is not null then
          select p.current_quantity into v_avail from public.products p where p.id = v_pid;
        end if;

        v_pid := public.consume_stock(
                   coalesce(v_pid, v_req.product_id), v_req.quantity,
                   'command_delivery', 'command_deliveries', p_delivery_id,
                   v_req.product_name);

        v_taken := least(v_req.quantity, coalesce(v_avail, v_req.quantity));

        select p.purchase_price, p.unit into v_price, v_unit
          from public.products p where p.id = v_pid;

        v_cost := coalesce(nullif(v_req.unit_cost, 0), v_price, 0);

        insert into public.command_delivery_consumptions
          (delivery_id, command_item_id, fiche_technic_id, product_id, product_name,
           unit, delivered_quantity, quantity, unit_cost, line_cost)
        values (p_delivery_id, v_ci.id, v_ci.fiche_technic_id, v_pid, v_req.product_name,
                coalesce(v_req.unit, v_unit), v_item.quantity, v_taken,
                v_cost, round(v_taken * v_cost, 2));
      end loop;

    else
      -- ---------------------------------------------------------------------
      -- Ligne sans fiche : si elle designe un produit du stock, il est deduit
      -- tel quel. Sinon (article du comptoir sans contrepartie stock) rien
      -- n'est deduit — et surtout aucune erreur bloquante.
      -- ---------------------------------------------------------------------
      v_pid := null;
      if v_ci.id is not null and v_ci.product_id is not null then
        select p.id into v_pid from public.products p where p.id = v_ci.product_id;
      end if;
      if v_pid is null then
        select p.id into v_pid
          from public.products p
         where lower(btrim(p.name)) = lower(btrim(coalesce(v_item.product_name, '')))
         order by p.is_active desc, p.current_quantity desc, p.created_at asc
         limit 1;
      end if;

      if v_pid is not null then
        select p.current_quantity into v_avail from public.products p where p.id = v_pid;

        perform public.consume_stock(v_pid, v_item.quantity,
                  'command_delivery', 'command_deliveries', p_delivery_id, v_item.product_name);

        v_taken := least(v_item.quantity, coalesce(v_avail, v_item.quantity));

        select p.purchase_price, p.unit into v_price, v_unit
          from public.products p where p.id = v_pid;

        insert into public.command_delivery_consumptions
          (delivery_id, command_item_id, fiche_technic_id, product_id, product_name,
           unit, delivered_quantity, quantity, unit_cost, line_cost)
        values (p_delivery_id, v_ci.id, null, v_pid, v_item.product_name,
                v_unit, v_item.quantity, v_taken,
                coalesce(v_price, 0), round(v_taken * coalesce(v_price, 0), 2));
      end if;
    end if;
  end loop;
end;
$fn$;


-- ============================================================================
-- 06. DECLENCHEUR — supprimer une livraison remet les matieres en stock
-- ----------------------------------------------------------------------------
--  Couvre aussi la suppression d'une COMMANDE : les livraisons partent en
--  cascade et ce declencheur s'execute pour chacune d'elles.
-- ============================================================================

create or replace function public.trg_command_delivery_restore_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.revert_command_delivery_stock(old.id);
  return old;
end;
$fn$;

drop trigger if exists command_deliveries_restore_stock on public.command_deliveries;
create trigger command_deliveries_restore_stock
  before delete on public.command_deliveries
  for each row execute function public.trg_command_delivery_restore_stock();


-- ============================================================================
-- 07. create_command_delivery() — la livraison DEDUIT le stock
-- ----------------------------------------------------------------------------
--  Reprend la version precedente (chauffeur / matricule de la livraison) et
--  ajoute l'appel a apply_command_delivery_stock().
-- ============================================================================

create or replace function public.create_command_delivery(p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del    public.command_deliveries;
  v_cmd    public.commands;
  v_item   jsonb;
  v_ref    text;
  v_seq    int;
  v_driver text := nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '');
  v_plate  text := nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '');
begin
  if not public.has_perm('clients', 'edit') and not public.has_perm('clients', 'create') then
    raise exception 'Vous n''avez pas la permission de livrer une commande';
  end if;

  select * into v_cmd from public.commands where id = (p_payload ->> 'command_id')::uuid;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  -- par defaut : le chauffeur prevu sur la commande
  v_driver := coalesce(v_driver, nullif(btrim(coalesce(v_cmd.driver_name, '')), ''));
  v_plate  := coalesce(v_plate,  nullif(btrim(coalesce(v_cmd.driver_plate, '')), ''));

  select count(*) + 1 into v_seq from public.command_deliveries where command_id = v_cmd.id;
  v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  while exists (select 1 from public.command_deliveries where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  end loop;

  insert into public.command_deliveries (command_id, reference, date, delivered_at, notes,
                                         driver_name, driver_plate)
  values (v_cmd.id, v_ref,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now())::date,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now()),
          coalesce(p_payload ->> 'notes', ''),
          v_driver, v_plate)
  returning * into v_del;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
      insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
      values (v_del.id,
              nullif(v_item ->> 'command_item_id', '')::uuid,
              coalesce(v_item ->> 'product_name', 'Produit'),
              coalesce((v_item ->> 'quantity')::numeric, 0),
              v_item ->> 'sell_unit');
    end if;
  end loop;

  -- ---- LA LIVRAISON RETIRE LES MATIERES DU STOCK ----
  perform public.apply_command_delivery_stock(v_del.id);

  perform public.recompute_command_delivery(v_cmd.id);
  perform public.log_activity('clients', 'deliver', 'command_deliveries', v_del.id, p_payload);
  return v_del;
end;
$fn$;


-- ============================================================================
-- 08. update_command_delivery() — la deduction suit les nouvelles quantites
-- ============================================================================

create or replace function public.update_command_delivery(p_id uuid, p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del  public.command_deliveries;
  v_item jsonb;
begin
  update public.command_deliveries
     set delivered_at = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at),
         date         = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at)::date,
         notes        = coalesce(p_payload ->> 'notes', notes),
         driver_name  = case when p_payload ? 'driver_name'
                             then nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '')
                             else driver_name end,
         driver_plate = case when p_payload ? 'driver_plate'
                             then nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '')
                             else driver_plate end,
         updated_at   = now()
   where id = p_id
  returning * into v_del;

  if v_del.id is null then raise exception 'Livraison introuvable'; end if;

  if p_payload ? 'items' then
    delete from public.command_delivery_items where delivery_id = p_id;
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
      if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
        insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
        values (p_id,
                nullif(v_item ->> 'command_item_id', '')::uuid,
                coalesce(v_item ->> 'product_name', 'Produit'),
                coalesce((v_item ->> 'quantity')::numeric, 0),
                v_item ->> 'sell_unit');
      end if;
    end loop;
  end if;

  -- ---- stock remis puis rededuit avec les nouvelles quantites ----
  perform public.apply_command_delivery_stock(p_id);

  perform public.recompute_command_delivery(v_del.command_id);
  perform public.log_activity('clients', 'deliver_update', 'command_deliveries', v_del.id, p_payload);
  return v_del;
end;
$fn$;


-- ============================================================================
-- 09. delete_command_delivery() — remise en stock via le declencheur
-- ============================================================================

create or replace function public.delete_command_delivery(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_cmd uuid;
begin
  select command_id into v_cmd from public.command_deliveries where id = p_id;
  -- le declencheur `command_deliveries_restore_stock` remet les matieres
  delete from public.command_deliveries where id = p_id;
  if v_cmd is not null then perform public.recompute_command_delivery(v_cmd); end if;
end;
$fn$;


-- ============================================================================
-- 10. create_command() — CONFIRMATION : aucune ecriture de stock
-- ----------------------------------------------------------------------------
--  Fonction identique a la version precedente (adresse, chauffeur, matricule,
--  n° de bon, date de creation editable, acompte en caisse). Elle est reprise
--  ici a l'identique pour garantir qu'aucune version anterieure ne consomme le
--  stock : la commande n'est qu'un engagement, la matiere ne part qu'a la
--  LIVRAISON.
-- ============================================================================

create or replace function public.create_command(p_payload jsonb)
returns public.commands
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd     public.commands;
  v_ref     text;
  v_item    jsonb;
  v_total   numeric := 0;
  v_advance numeric := coalesce((p_payload ->> 'advance_paid')::numeric, 0);
  v_seq     int;
  v_created timestamptz := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());
  v_bon     text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
  v_addr    text := nullif(btrim(coalesce(p_payload ->> 'client_address', '')), '');
  v_driver  text := nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '');
  v_plate   text := nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '');
  v_client  uuid := nullif(p_payload ->> 'client_id', '')::uuid;
  v_year    text := to_char(v_created, 'YYYY');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.commands;
  v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.commands where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_item ->> 'total_price')::numeric,
                 coalesce((v_item ->> 'quantity')::numeric, 0) * coalesce((v_item ->> 'unit_price')::numeric, 0));
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  if v_addr is null and v_client is not null then
    select nullif(btrim(address), '') into v_addr from public.clients where id = v_client;
  end if;

  insert into public.commands (reference, client_id, client_name, client_phone, client_address,
                               driver_name, driver_plate, receive_date,
                               receive_hour, receive_minute, total_amount, advance_paid,
                               paid_amount, rest_amount, status, notes, bon_number,
                               created_at, updated_at, created_by)
  values (v_ref,
          v_client,
          coalesce(p_payload ->> 'client_name', 'Client'),
          p_payload ->> 'client_phone',
          v_addr, v_driver, v_plate,
          nullif(p_payload ->> 'receive_date', '')::date,
          p_payload ->> 'receive_hour',
          p_payload ->> 'receive_minute',
          v_total, v_advance, v_advance, greatest(0, v_total - v_advance),
          'pending', p_payload ->> 'notes', v_bon,
          v_created, v_created, public.current_username())
  returning * into v_cmd;

  if v_addr is not null and v_client is not null then
    update public.clients
       set address = v_addr, updated_at = now()
     where id = v_client and coalesce(nullif(btrim(address), ''), '') is distinct from v_addr;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    insert into public.command_items (command_id, product_id, fiche_technic_id, product_name,
                                      quantity, unit_price, total_price, sell_by_unit, sell_unit)
    values (v_cmd.id,
            nullif(v_item ->> 'product_id', '')::uuid,
            nullif(v_item ->> 'fiche_technic_id', '')::uuid,
            coalesce(v_item ->> 'product_name', 'Produit'),
            coalesce((v_item ->> 'quantity')::numeric, 0),
            coalesce((v_item ->> 'unit_price')::numeric, 0),
            coalesce((v_item ->> 'total_price')::numeric, 0),
            coalesce((v_item ->> 'sell_by_unit')::boolean, false),
            v_item ->> 'sell_unit');
  end loop;

  -- ---- AUCUN consume_stock() ICI : la matiere ne part qu'a la livraison ----

  if v_advance > 0 then
    insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
    values ('deposit', v_advance, v_created::date,
            'Acompte commande ' || v_ref, 'Commande', 'commands', v_cmd.id);
  end if;

  return v_cmd;
end;
$fn$;


-- ============================================================================
-- 11. VUES DE CONTROLE
-- ============================================================================

-- Ce que chaque livraison a retire du stock
create or replace view public.v_command_delivery_stock as
select d.id            as delivery_id,
       d.reference     as delivery_reference,
       d.delivered_at,
       c.id            as command_id,
       c.reference     as command_reference,
       c.client_name,
       cc.product_name,
       cc.unit,
       cc.quantity     as quantity_removed,
       cc.line_cost
  from public.command_deliveries d
  join public.commands c                            on c.id = d.command_id
  left join public.command_delivery_consumptions cc on cc.delivery_id = d.id;

-- Livraisons qui n'ont retire AUCUNE matiere (a surveiller)
create or replace view public.v_command_delivery_without_stock as
select d.id, d.reference, d.delivered_at, c.reference as command_reference, c.client_name
  from public.command_deliveries d
  join public.commands c on c.id = d.command_id
 where not exists (select 1 from public.command_delivery_consumptions cc where cc.delivery_id = d.id);


-- ============================================================================
-- 12. RLS, DROITS ET TEMPS REEL
-- ============================================================================

alter table public.command_delivery_consumptions enable row level security;

drop policy if exists command_delivery_consumptions_sel on public.command_delivery_consumptions;
drop policy if exists command_delivery_consumptions_ins on public.command_delivery_consumptions;
drop policy if exists command_delivery_consumptions_upd on public.command_delivery_consumptions;
drop policy if exists command_delivery_consumptions_del on public.command_delivery_consumptions;

create policy command_delivery_consumptions_sel on public.command_delivery_consumptions
  for select to authenticated using (public.has_perm('clients', 'view'));
create policy command_delivery_consumptions_ins on public.command_delivery_consumptions
  for insert to authenticated with check (public.has_perm('clients', 'create'));
create policy command_delivery_consumptions_upd on public.command_delivery_consumptions
  for update to authenticated using (public.has_perm('clients', 'edit'))
  with check (public.has_perm('clients', 'edit'));
create policy command_delivery_consumptions_del on public.command_delivery_consumptions
  for delete to authenticated using (public.has_perm('clients', 'delete'));

grant select, insert, update, delete on public.command_delivery_consumptions to authenticated, service_role;
grant select on public.v_command_delivery_stock         to authenticated, service_role;
grant select on public.v_command_delivery_without_stock to authenticated, service_role;

grant execute on function public.fiche_stock_requirements(uuid, numeric, int)   to authenticated, service_role;
grant execute on function public.resolve_stock_product(uuid, text)              to authenticated, service_role;
grant execute on function public.restore_stock(uuid, numeric, text, text, uuid) to authenticated, service_role;
grant execute on function public.revert_command_delivery_stock(uuid)            to authenticated, service_role;
grant execute on function public.apply_command_delivery_stock(uuid)             to authenticated, service_role;
grant execute on function public.create_command_delivery(jsonb)                 to authenticated, service_role;
grant execute on function public.update_command_delivery(uuid, jsonb)           to authenticated, service_role;
grant execute on function public.delete_command_delivery(uuid)                  to authenticated, service_role;
grant execute on function public.create_command(jsonb)                          to authenticated, service_role;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.command_delivery_consumptions';
  exception when duplicate_object then null;
            when undefined_object then null;
  end;
end
$$;

commit;

-- ============================================================================
--  FIN — Les livraisons deduisent desormais reellement le stock.
--
--  VERIFICATIONS RAPIDES (a lancer apres une livraison de test) :
--    select * from public.v_command_delivery_stock         limit 50;
--    select * from public.v_command_delivery_without_stock limit 50;
--    select name, current_quantity from public.products order by updated_at desc limit 20;
--    select * from public.stock_movements where reason like 'command_delivery%'
--     order by created_at desc limit 50;
-- ============================================================================

;


-- ===== altech_production_update_anciennes_dettes_avances.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « ANCIENNES DETTES des clients / fournisseurs
--    + AVANCE (excedent) quand un client verse PLUS que sa dette,
--    avec le bouton qui lui rend son excedent. »
-- ----------------------------------------------------------------------------
--  A executer EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est idempotent : il peut etre relance sans risque.
--
--  PROBLEMES CORRIGES
--  ------------------
--  1. TROP-PERCU INVISIBLE.
--     Quand un client devait 10 000 DA et versait 15 000 DA, `pay_client()`
--     imputait 10 000 DA sur ses ventes / commandes et PERDAIT les 5 000 DA
--     restants : la carte du client affichait « dette 0 » et l'excedent
--     n'apparaissait nulle part. Desormais l'excedent est conserve dans
--     `clients.credit_amount` (une AVANCE du client sur l'entreprise), affiche
--     en positif sur sa carte et sur son compte rendu, et un bouton permet de
--     le lui RENDRE (sortie de caisse tracee).
--
--  2. AUCUNE FACON DE SAISIR UNE ARDOISE ANTERIEURE.
--     Impossible d'enregistrer « ce client me devait deja 80 000 DA avant le
--     logiciel ». La nouvelle table `party_old_debts` porte ces ANCIENNES
--     DETTES pour un client OU un fournisseur (montant, description, date).
--     Elles entrent dans le calcul de la dette, se soldent par les versements
--     habituels et apparaissent dans l'historique, le compte rendu, la caisse
--     et les rapports.
--
--  REGLES METIER APPLIQUEES
--  ------------------------
--   · Un versement client s'impute dans cet ordre :
--        1) ANCIENNES DETTES (la plus ancienne d'abord)
--        2) VENTES non soldees
--        3) COMMANDES non soldees
--        4) le reliquat devient une AVANCE (`clients.credit_amount`)
--     La suppression / modification d'un versement reprend exactement dans
--     l'ordre inverse (avance, commandes, ventes, anciennes dettes) : la dette
--     du tiers reste donc toujours juste.
--
--   · Une ANCIENNE DETTE ne genere AUCUNE ecriture de caisse : aucun argent
--     n'a bouge, c'est une ardoise reprise du passe. C'est son REGLEMENT
--     (bouton « Versement ») qui alimente la caisse, comme pour une facture.
--
--   · Un REMBOURSEMENT d'excedent, lui, EST un mouvement d'argent :
--        - client    -> SORTIE de caisse (on lui rend son argent)
--        - fournisseur -> ENTREE de caisse (il nous rend le trop-verse)
--
--  CONTENU
--  -------
--    01. clients.credit_amount / suppliers.credit_amount  — l'avance du tiers
--    02. Table `party_old_debts`      — anciennes dettes client / fournisseur
--    03. Table `party_credit_refunds` — remboursement d'un excedent
--    04. Imputation client   : allocate_ / deallocate_client_payment()
--    05. Imputation fournisseur : allocate_ / deallocate_supplier_payment()
--    06. RPC anciennes dettes : add / update / delete_party_old_debt()
--    07. RPC excedent        : refund_party_credit() / delete_party_refund()
--    08. Caisse : declencheurs des remboursements
--    09. Nettoyage a la suppression d'un client / fournisseur
--    10. Vues de controle : v_party_old_debts, v_party_balances
--    11. Reconstruction des avances deja encaissees (retroactif)
--    12. RLS, grants et temps reel
-- ============================================================================

begin;

-- ============================================================================
-- 01. L'AVANCE DU TIERS  (excedent verse, non encore impute ni rendu)
-- ============================================================================

alter table public.clients
  add column if not exists credit_amount numeric(14,2) not null default 0;

alter table public.suppliers
  add column if not exists credit_amount numeric(14,2) not null default 0;

comment on column public.clients.credit_amount is
  'Avance du client : montant verse EN PLUS de sa dette, pas encore impute ni rembourse. Affiche en positif sur sa carte (« il a un credit sur l''entreprise »).';
comment on column public.suppliers.credit_amount is
  'Trop-verse au fournisseur : montant paye EN PLUS de ses factures, recuperable ou imputable sur ses prochaines factures.';

create index if not exists clients_credit_idx   on public.clients   (credit_amount) where credit_amount > 0;
create index if not exists suppliers_credit_idx on public.suppliers (credit_amount) where credit_amount > 0;


-- ============================================================================
-- 02. ANCIENNES DETTES  (ardoise reprise du passe, client OU fournisseur)
-- ----------------------------------------------------------------------------
--  Se comporte exactement comme une facture non soldee : montant, montant
--  deja regle, reste du. Aucune ecriture de caisse a la creation.
-- ============================================================================

create table if not exists public.party_old_debts (
  id          uuid primary key default gen_random_uuid(),
  party_type  text not null check (party_type in ('client', 'supplier')),
  party_id    uuid not null,
  party_name  text,
  amount      numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  rest_amount numeric(14,2) not null default 0,
  date        date not null default current_date,
  description text default '',
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists party_old_debts_party_idx on public.party_old_debts (party_type, party_id, date asc);
create index if not exists party_old_debts_rest_idx  on public.party_old_debts (party_id) where rest_amount > 0;

comment on table public.party_old_debts is
  'Anciennes dettes saisies a posteriori : ce qu''un client devait (ou ce qu''on devait a un fournisseur) AVANT l''utilisation du logiciel. Aucun mouvement de caisse a la creation ; le reglement passe par le bouton « Versement ».';


-- ============================================================================
-- 03. REMBOURSEMENT D'UN EXCEDENT
-- ----------------------------------------------------------------------------
--  Le bouton « Rendre l'excedent » d'une carte client (ou « Recuperer
--  l'excedent » d'une carte fournisseur) ecrit une ligne ici : c'est un vrai
--  mouvement d'argent, il alimente donc la caisse.
-- ============================================================================

create table if not exists public.party_credit_refunds (
  id              uuid primary key default gen_random_uuid(),
  party_type      text not null check (party_type in ('client', 'supplier')),
  party_id        uuid not null,
  party_name      text,
  amount          numeric(14,2) not null default 0,
  date            date not null default current_date,
  refunded_at     timestamptz not null default now(),
  notes           text default '',
  method          text not null default 'especes' check (method in ('especes', 'cheque', 'virement')),
  cheque_number   text,
  virement_number text,
  bank_name       text,
  created_by      text default public.current_username(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists party_credit_refunds_party_idx
  on public.party_credit_refunds (party_type, party_id, refunded_at desc);

comment on table public.party_credit_refunds is
  'Restitution d''un excedent : argent rendu a un client (sortie de caisse) ou recupere aupres d''un fournisseur (entree de caisse).';


-- ============================================================================
-- 04. IMPUTATION D'UN VERSEMENT CLIENT
-- ----------------------------------------------------------------------------
--  ORDRE : anciennes dettes -> ventes -> commandes -> AVANCE.
--  Le reliquat n'est plus perdu : il devient l'avance du client.
-- ============================================================================

create or replace function public.allocate_client_payment(p_client_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left numeric := coalesce(p_amount, 0);
  v_take numeric;
  v_new  numeric;
  r      record;
begin
  if p_client_id is null or v_left <= 0 then return; end if;

  -- 1) ANCIENNES DETTES — la plus ancienne d'abord
  for r in
    select id, rest_amount from public.party_old_debts
     where party_type = 'client' and party_id = p_client_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.party_old_debts
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  -- 2) VENTES non soldees
  for r in
    select id, rest_amount from public.sales
     where client_id = p_client_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    v_new  := greatest(0, r.rest_amount - v_take);
    update public.sales
       set paid_amount = paid_amount + v_take,
           rest_amount = v_new,
           status      = case when v_new <= 0 then 'paid'::public.sale_status
                              else 'debt'::public.sale_status end,
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  -- 3) COMMANDES non soldees
  for r in
    select id, rest_amount from public.commands
     where client_id = p_client_id and rest_amount > 0
     order by created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.commands
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  -- 4) LE RELIQUAT DEVIENT UNE AVANCE DU CLIENT
  if v_left > 0 then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + v_left,
           updated_at    = now()
     where id = p_client_id;
  end if;
end;
$$;

comment on function public.allocate_client_payment(uuid, numeric) is
  'Impute un versement client : anciennes dettes, puis ventes, puis commandes ; le reliquat devient une AVANCE (clients.credit_amount).';

create or replace function public.deallocate_client_payment(p_client_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left   numeric := coalesce(p_amount, 0);
  v_take   numeric;
  v_credit numeric;
  r        record;
begin
  if p_client_id is null or v_left <= 0 then return; end if;

  -- Ordre INVERSE de l'imputation : avance -> commandes -> ventes -> anciennes dettes
  select coalesce(credit_amount, 0) into v_credit from public.clients where id = p_client_id;
  if coalesce(v_credit, 0) > 0 then
    v_take := least(v_left, v_credit);
    update public.clients
       set credit_amount = greatest(0, coalesce(credit_amount, 0) - v_take),
           updated_at    = now()
     where id = p_client_id;
    v_left := v_left - v_take;
  end if;

  for r in
    select id, paid_amount from public.commands
     where client_id = p_client_id and paid_amount > 0
     order by created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.commands
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = greatest(0, total_amount - greatest(0, paid_amount - v_take)),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, paid_amount from public.sales
     where client_id = p_client_id and paid_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.sales
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = greatest(0, final_amount - greatest(0, paid_amount - v_take)),
           status      = case when final_amount - greatest(0, paid_amount - v_take) <= 0
                              then 'paid'::public.sale_status else 'debt'::public.sale_status end,
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, paid_amount from public.party_old_debts
     where party_type = 'client' and party_id = p_client_id and paid_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.party_old_debts
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = greatest(0, amount - greatest(0, paid_amount - v_take)),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
end;
$$;

comment on function public.deallocate_client_payment(uuid, numeric) is
  'Annule l''imputation d''un versement client, dans l''ordre inverse : avance, commandes, ventes, anciennes dettes.';


-- ============================================================================
-- 05. IMPUTATION D'UN VERSEMENT FOURNISSEUR
-- ----------------------------------------------------------------------------
--  ORDRE : anciennes dettes -> factures d'achat -> TROP-VERSE.
-- ============================================================================

create or replace function public.allocate_supplier_payment(p_supplier_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left numeric := coalesce(p_amount, 0);
  v_take numeric;
  r      record;
begin
  if p_supplier_id is null or v_left <= 0 then return; end if;

  for r in
    select id, rest_amount from public.party_old_debts
     where party_type = 'supplier' and party_id = p_supplier_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.party_old_debts
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, rest_amount from public.purchases
     where supplier_id = p_supplier_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.purchases
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    update public.suppliers
       set credit_amount = coalesce(credit_amount, 0) + v_left,
           updated_at    = now()
     where id = p_supplier_id;
  end if;
end;
$$;

comment on function public.allocate_supplier_payment(uuid, numeric) is
  'Impute un versement fournisseur : anciennes dettes puis factures d''achat ; le reliquat reste en trop-verse (suppliers.credit_amount).';

create or replace function public.deallocate_supplier_payment(p_supplier_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left   numeric := coalesce(p_amount, 0);
  v_take   numeric;
  v_credit numeric;
  r        record;
begin
  if p_supplier_id is null or v_left <= 0 then return; end if;

  select coalesce(credit_amount, 0) into v_credit from public.suppliers where id = p_supplier_id;
  if coalesce(v_credit, 0) > 0 then
    v_take := least(v_left, v_credit);
    update public.suppliers
       set credit_amount = greatest(0, coalesce(credit_amount, 0) - v_take),
           updated_at    = now()
     where id = p_supplier_id;
    v_left := v_left - v_take;
  end if;

  for r in
    select id, paid_amount from public.purchases
     where supplier_id = p_supplier_id and paid_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.purchases
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = greatest(0, total_amount - greatest(0, paid_amount - v_take)),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, paid_amount from public.party_old_debts
     where party_type = 'supplier' and party_id = p_supplier_id and paid_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.party_old_debts
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = greatest(0, amount - greatest(0, paid_amount - v_take)),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
end;
$$;


-- ============================================================================
-- 06. BOUTON « ANCIENNE DETTE »  (cartes client ET fournisseur)
-- ============================================================================

create or replace function public.add_party_old_debt(
  p_party_type  text,
  p_party_id    uuid,
  p_amount      numeric,
  p_date        date default current_date,
  p_description text default ''
) returns public.party_old_debts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.party_old_debts;
  v_type   text := lower(coalesce(nullif(btrim(p_party_type), ''), 'client'));
  v_module text;
  v_name   text;
  v_credit numeric := 0;
  v_take   numeric;
  v_id     uuid;
begin
  if v_type not in ('client', 'supplier') then
    raise exception 'Type de tiers inconnu : %', p_party_type;
  end if;
  v_module := case when v_type = 'supplier' then 'suppliers' else 'clients' end;

  if not public.has_perm(v_module, 'create') and not public.has_perm(v_module, 'edit') then
    raise exception 'Vous n''avez pas la permission d''enregistrer une ancienne dette';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  if v_type = 'client' then
    select name, coalesce(credit_amount, 0) into v_name, v_credit from public.clients   where id = p_party_id;
  else
    select name, coalesce(credit_amount, 0) into v_name, v_credit from public.suppliers where id = p_party_id;
  end if;
  if v_name is null then raise exception 'Tiers introuvable'; end if;

  insert into public.party_old_debts
    (party_type, party_id, party_name, amount, paid_amount, rest_amount, date, description)
  values
    (v_type, p_party_id, v_name, p_amount, 0, p_amount,
     coalesce(p_date, current_date), coalesce(p_description, ''))
  returning * into v_row;

  v_id := v_row.id;

  -- Si le tiers avait deja une AVANCE, elle solde immediatement cette ardoise
  -- (sinon la carte afficherait en meme temps une dette et un credit).
  if v_credit > 0 then
    v_take := least(v_credit, p_amount);
    if v_type = 'client' then
      update public.clients
         set credit_amount = greatest(0, coalesce(credit_amount, 0) - v_take), updated_at = now()
       where id = p_party_id;
      perform public.allocate_client_payment(p_party_id, v_take);
    else
      update public.suppliers
         set credit_amount = greatest(0, coalesce(credit_amount, 0) - v_take), updated_at = now()
       where id = p_party_id;
      perform public.allocate_supplier_payment(p_party_id, v_take);
    end if;
    select * into v_row from public.party_old_debts where id = v_id;
  end if;

  perform public.log_activity(v_module, 'create', 'party_old_debts', v_row.id,
    jsonb_build_object('amount', p_amount, 'description', p_description));
  return v_row;
end;
$$;

comment on function public.add_party_old_debt(text, uuid, numeric, date, text) is
  'Enregistre une ancienne dette (ardoise d''avant le logiciel) pour un client ou un fournisseur. Aucun mouvement de caisse : seul son reglement en genere un.';

create or replace function public.update_party_old_debt(
  p_id          uuid,
  p_amount      numeric default null,
  p_date        date default null,
  p_description text default null
) returns public.party_old_debts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    public.party_old_debts;
  v_row    public.party_old_debts;
  v_module text;
  v_amount numeric;
  v_paid   numeric;
  v_freed  numeric;
begin
  select * into v_old from public.party_old_debts where id = p_id;
  if v_old.id is null then raise exception 'Ancienne dette introuvable'; end if;

  v_module := case when v_old.party_type = 'supplier' then 'suppliers' else 'clients' end;
  if not public.has_perm(v_module, 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier une ancienne dette';
  end if;

  v_amount := greatest(0, coalesce(p_amount, v_old.amount));
  -- Le montant deja regle ne peut pas depasser le nouveau total : l'excedent
  -- est libere et re-impute (autres dettes, factures, puis avance).
  v_paid  := least(coalesce(v_old.paid_amount, 0), v_amount);
  v_freed := coalesce(v_old.paid_amount, 0) - v_paid;

  update public.party_old_debts
     set amount      = v_amount,
         paid_amount = v_paid,
         rest_amount = greatest(0, v_amount - v_paid),
         date        = coalesce(p_date, date),
         description = coalesce(p_description, description),
         updated_at  = now()
   where id = p_id
  returning * into v_row;

  if v_freed > 0 then
    if v_old.party_type = 'supplier' then
      perform public.allocate_supplier_payment(v_old.party_id, v_freed);
    else
      perform public.allocate_client_payment(v_old.party_id, v_freed);
    end if;
    select * into v_row from public.party_old_debts where id = p_id;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_party_old_debt(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    public.party_old_debts;
  v_module text;
begin
  select * into v_old from public.party_old_debts where id = p_id;
  if v_old.id is null then return; end if;

  v_module := case when v_old.party_type = 'supplier' then 'suppliers' else 'clients' end;
  if not public.has_perm(v_module, 'delete') then
    raise exception 'Vous n''avez pas la permission de supprimer une ancienne dette';
  end if;

  delete from public.party_old_debts where id = p_id;

  -- Ce qui avait ete regle sur cette ardoise est rendu au tiers : on le
  -- re-impute sur ses autres dettes, le reliquat devient une avance.
  if coalesce(v_old.paid_amount, 0) > 0 then
    if v_old.party_type = 'supplier' then
      perform public.allocate_supplier_payment(v_old.party_id, v_old.paid_amount);
    else
      perform public.allocate_client_payment(v_old.party_id, v_old.paid_amount);
    end if;
  end if;
end;
$$;


-- ============================================================================
-- 07. BOUTON « RENDRE L'EXCEDENT »  (visible seulement si avance > 0)
-- ============================================================================

create or replace function public.refund_party_credit(
  p_party_type      text,
  p_party_id        uuid,
  p_amount          numeric,
  p_refunded_at     timestamptz default now(),
  p_notes           text default '',
  p_method          text default 'especes',
  p_cheque_number   text default null,
  p_virement_number text default null,
  p_bank_name       text default null
) returns public.party_credit_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.party_credit_refunds;
  v_type   text := lower(coalesce(nullif(btrim(p_party_type), ''), 'client'));
  v_module text;
  v_method text := lower(coalesce(nullif(btrim(p_method), ''), 'especes'));
  v_name   text;
  v_credit numeric := 0;
begin
  if v_type not in ('client', 'supplier') then
    raise exception 'Type de tiers inconnu : %', p_party_type;
  end if;
  v_module := case when v_type = 'supplier' then 'suppliers' else 'clients' end;

  if not public.has_perm(v_module, 'pay') and not public.has_perm(v_module, 'edit') then
    raise exception 'Vous n''avez pas la permission de rendre un excedent';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de reglement inconnu : %', p_method;
  end if;

  if v_type = 'client' then
    select name, coalesce(credit_amount, 0) into v_name, v_credit from public.clients   where id = p_party_id;
  else
    select name, coalesce(credit_amount, 0) into v_name, v_credit from public.suppliers where id = p_party_id;
  end if;
  if v_name is null then raise exception 'Tiers introuvable'; end if;

  if p_amount > v_credit + 0.005 then
    raise exception 'Excedent disponible insuffisant : % DA', to_char(v_credit, 'FM999999999.00');
  end if;

  if v_type = 'client' then
    update public.clients
       set credit_amount = greatest(0, coalesce(credit_amount, 0) - p_amount), updated_at = now()
     where id = p_party_id;
  else
    update public.suppliers
       set credit_amount = greatest(0, coalesce(credit_amount, 0) - p_amount), updated_at = now()
     where id = p_party_id;
  end if;

  insert into public.party_credit_refunds (
    party_type, party_id, party_name, amount, date, refunded_at, notes,
    method, cheque_number, virement_number, bank_name
  )
  values (
    v_type, p_party_id, v_name, p_amount,
    coalesce(p_refunded_at, now())::date, coalesce(p_refunded_at, now()), coalesce(p_notes, ''),
    v_method,
    case when v_method = 'cheque'   then nullif(btrim(p_cheque_number), '')   end,
    case when v_method = 'virement' then nullif(btrim(p_virement_number), '') end,
    case when v_method <> 'especes' then nullif(btrim(p_bank_name), '')       end
  )
  returning * into v_row;

  perform public.log_activity(v_module, 'pay', 'party_credit_refunds', v_row.id,
    jsonb_build_object('amount', p_amount, 'method', v_method));
  return v_row;
end;
$$;

comment on function public.refund_party_credit(text, uuid, numeric, timestamptz, text, text, text, text, text) is
  'Rend a un client (ou recupere aupres d''un fournisseur) l''excedent verse. Diminue credit_amount et ecrit le mouvement de caisse correspondant.';

create or replace function public.delete_party_refund(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    public.party_credit_refunds;
  v_module text;
begin
  select * into v_old from public.party_credit_refunds where id = p_id;
  if v_old.id is null then return; end if;

  v_module := case when v_old.party_type = 'supplier' then 'suppliers' else 'clients' end;
  if not public.has_perm(v_module, 'delete') then
    raise exception 'Vous n''avez pas la permission de supprimer un remboursement';
  end if;

  -- l'argent n'a finalement pas ete rendu : l'excedent revient au tiers
  if v_old.party_type = 'client' then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + v_old.amount, updated_at = now()
     where id = v_old.party_id;
  else
    update public.suppliers
       set credit_amount = coalesce(credit_amount, 0) + v_old.amount, updated_at = now()
     where id = v_old.party_id;
  end if;

  delete from public.party_credit_refunds where id = p_id;
end;
$$;


-- ============================================================================
-- 08. CAISSE — le remboursement d'un excedent est un VRAI mouvement d'argent
-- ----------------------------------------------------------------------------
--  · client     -> SORTIE  (on lui rend son argent)
--  · fournisseur -> ENTREE (il nous rembourse le trop-verse)
--  Une ANCIENNE DETTE, elle, n'ecrit RIEN en caisse : aucun argent n'a bouge.
-- ============================================================================

-- Filet de securite : `payment_method_label()` vient de la mise a jour
-- « versements / modes de reglement ». Si ce script est joue avant elle, on la
-- cree ici pour que le declencheur de caisse ci-dessous fonctionne.
do $guard$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'payment_method_label'
  ) then
    execute $fn$
      create function public.payment_method_label(
        p_method text,
        p_cheque_number text default null,
        p_virement_number text default null,
        p_bank_name text default null
      ) returns text
      language sql
      immutable
      as $body$
        select case coalesce(nullif(btrim(p_method), ''), 'especes')
          when 'cheque' then
            'Cheque bancaire'
            || coalesce(' n° ' || nullif(btrim(p_cheque_number), ''), '')
            || coalesce(' - ' || nullif(btrim(p_bank_name), ''), '')
          when 'virement' then
            'Virement bancaire'
            || coalesce(' n° ' || nullif(btrim(p_virement_number), ''), '')
            || coalesce(' - ' || nullif(btrim(p_bank_name), ''), '')
          else 'Especes'
        end;
      $body$;
    $fn$;
  end if;
end
$guard$;

create or replace function public.trg_party_refund_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caisse_transactions
    (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values (
    case when new.party_type = 'client' then 'withdrawal'::public.caisse_tx_type
         else 'deposit'::public.caisse_tx_type end,
    new.amount, new.date,
    case when new.party_type = 'client'
         then 'Excedent rendu au client: ' else 'Excedent recupere du fournisseur: ' end
      || coalesce(new.party_name, '')
      || ' (' || public.payment_method_label(
           new.method, new.cheque_number, new.virement_number, new.bank_name) || ')',
    case when new.party_type = 'client' then 'Clients' else 'Fournisseurs' end,
    'party_credit_refunds', new.id, new.created_by)
  on conflict (ref_table, ref_id) do update
     set type        = excluded.type,
         amount      = excluded.amount,
         date        = excluded.date,
         description = excluded.description,
         updated_at  = now();
  return new;
end;
$$;

drop trigger if exists trg_party_refund_caisse on public.party_credit_refunds;
create trigger trg_party_refund_caisse
  after insert or update of amount, date, method, cheque_number, virement_number, bank_name
  on public.party_credit_refunds
  for each row execute function public.trg_party_refund_to_caisse();

drop trigger if exists trg_party_refund_caisse_del on public.party_credit_refunds;
create trigger trg_party_refund_caisse_del
  before delete on public.party_credit_refunds
  for each row execute function public.trg_delete_linked_caisse();


-- ============================================================================
-- 09. NETTOYAGE A LA SUPPRESSION D'UN CLIENT / FOURNISSEUR
-- ----------------------------------------------------------------------------
--  `party_old_debts` et `party_credit_refunds` pointent un client OU un
--  fournisseur : impossible d'utiliser une cle etrangere, on nettoie donc
--  par declencheur.
-- ============================================================================

create or replace function public.trg_purge_party_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_type text := case when tg_table_name = 'suppliers' then 'supplier' else 'client' end;
begin
  delete from public.party_old_debts       where party_type = v_type and party_id = old.id;
  delete from public.party_credit_refunds  where party_type = v_type and party_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_clients_purge_ledger on public.clients;
create trigger trg_clients_purge_ledger
  before delete on public.clients
  for each row execute function public.trg_purge_party_ledger();

drop trigger if exists trg_suppliers_purge_ledger on public.suppliers;
create trigger trg_suppliers_purge_ledger
  before delete on public.suppliers
  for each row execute function public.trg_purge_party_ledger();


-- ============================================================================
-- 10. VUES DE CONTROLE
-- ============================================================================

create or replace view public.v_party_old_debts as
select d.id,
       d.party_type,
       d.party_id,
       d.party_name,
       d.amount,
       d.paid_amount,
       d.rest_amount,
       d.date,
       d.description,
       d.created_by,
       d.created_at
  from public.party_old_debts d
 order by d.date desc, d.created_at desc;

comment on view public.v_party_old_debts is
  'Toutes les anciennes dettes (clients et fournisseurs) avec leur reste du.';

create or replace view public.v_party_balances as
select 'client'::text as party_type,
       c.id           as party_id,
       c.name         as party_name,
       coalesce((select sum(s.final_amount) from public.sales s where s.client_id = c.id), 0)
         + coalesce((select sum(k.total_amount) from public.commands k where k.client_id = c.id), 0)
         + coalesce((select sum(o.amount) from public.party_old_debts o
                      where o.party_type = 'client' and o.party_id = c.id), 0)      as total_du,
       coalesce((select sum(s.rest_amount) from public.sales s where s.client_id = c.id), 0)
         + coalesce((select sum(k.rest_amount) from public.commands k where k.client_id = c.id), 0)
         + coalesce((select sum(o.rest_amount) from public.party_old_debts o
                      where o.party_type = 'client' and o.party_id = c.id), 0)      as reste_du,
       coalesce(c.credit_amount, 0)                                                as avance,
       coalesce((select sum(s.rest_amount) from public.sales s where s.client_id = c.id), 0)
         + coalesce((select sum(k.rest_amount) from public.commands k where k.client_id = c.id), 0)
         + coalesce((select sum(o.rest_amount) from public.party_old_debts o
                      where o.party_type = 'client' and o.party_id = c.id), 0)
         - coalesce(c.credit_amount, 0)                                            as solde_net
  from public.clients c
union all
select 'supplier'::text,
       s.id,
       s.name,
       coalesce((select sum(p.total_amount) from public.purchases p where p.supplier_id = s.id), 0)
         + coalesce((select sum(o.amount) from public.party_old_debts o
                      where o.party_type = 'supplier' and o.party_id = s.id), 0),
       coalesce((select sum(p.rest_amount) from public.purchases p where p.supplier_id = s.id), 0)
         + coalesce((select sum(o.rest_amount) from public.party_old_debts o
                      where o.party_type = 'supplier' and o.party_id = s.id), 0),
       coalesce(s.credit_amount, 0),
       coalesce((select sum(p.rest_amount) from public.purchases p where p.supplier_id = s.id), 0)
         + coalesce((select sum(o.rest_amount) from public.party_old_debts o
                      where o.party_type = 'supplier' and o.party_id = s.id), 0)
         - coalesce(s.credit_amount, 0)
  from public.suppliers s;

comment on view public.v_party_balances is
  'Situation nette de chaque tiers : total du, reste du, avance versee et solde net (negatif = le tiers a un credit sur l''entreprise).';

do $$
declare v record;
begin
  for v in select table_name from information_schema.views where table_schema = 'public'
             and table_name in ('v_party_old_debts', 'v_party_balances')
  loop
    begin
      execute format('alter view public.%I set (security_invoker = true)', v.table_name);
    exception when others then null;
    end;
  end loop;
end
$$;


-- ============================================================================
-- 11. RECONSTRUCTION DES AVANCES DEJA ENCAISSEES  (retroactif)
-- ----------------------------------------------------------------------------
--  Avant cette mise a jour, l'excedent d'un versement etait purement perdu.
--  On le reconstitue :
--      avance = total des versements
--             - ce qui a reellement ete impute sur les factures
--             - ce qui a ete impute sur les anciennes dettes
--             - ce qui a deja ete rembourse
--  « ce qui a ete impute » = montant paye sur les documents MOINS les
--  reglements directs (encaissement a la caisse / acompte de commande), qui
--  eux ne viennent pas d'un versement.
--  Le calcul repart toujours des donnees sources : relancer le script ne
--  fausse rien.
-- ============================================================================

with direct_sales as (
  select s.client_id, coalesce(sum(sp.amount), 0) as direct_paid
    from public.sales s
    join public.sale_payments sp on sp.sale_id = s.id
   where s.client_id is not null
   group by s.client_id
),
paid_sales as (
  select client_id, coalesce(sum(paid_amount), 0) as paid
    from public.sales where client_id is not null group by client_id
),
paid_commands as (
  select client_id,
         coalesce(sum(paid_amount), 0)  as paid,
         coalesce(sum(advance_paid), 0) as advance
    from public.commands where client_id is not null group by client_id
),
paid_old as (
  select party_id, coalesce(sum(paid_amount), 0) as paid
    from public.party_old_debts where party_type = 'client' group by party_id
),
versements as (
  select client_id, coalesce(sum(amount), 0) as versed
    from public.client_payments group by client_id
),
rendus as (
  select party_id, coalesce(sum(amount), 0) as refunded
    from public.party_credit_refunds where party_type = 'client' group by party_id
)
update public.clients c
   set credit_amount = round(greatest(0::numeric,
         coalesce(v.versed, 0)
         - greatest(0, coalesce(ps.paid, 0) - coalesce(ds.direct_paid, 0))
         - greatest(0, coalesce(pc.paid, 0) - coalesce(pc.advance, 0))
         - coalesce(po.paid, 0)
         - coalesce(rd.refunded, 0)), 2)
  from public.clients base
  left join versements    v  on v.client_id  = base.id
  left join paid_sales    ps on ps.client_id = base.id
  left join direct_sales  ds on ds.client_id = base.id
  left join paid_commands pc on pc.client_id = base.id
  left join paid_old      po on po.party_id  = base.id
  left join rendus        rd on rd.party_id  = base.id
 where c.id = base.id;

with direct_purchases as (
  select p.supplier_id, coalesce(sum(pp.amount), 0) as direct_paid
    from public.purchases p
    join public.purchase_payments pp on pp.purchase_id = p.id
   group by p.supplier_id
),
paid_purchases as (
  select supplier_id, coalesce(sum(paid_amount), 0) as paid
    from public.purchases group by supplier_id
),
paid_old as (
  select party_id, coalesce(sum(paid_amount), 0) as paid
    from public.party_old_debts where party_type = 'supplier' group by party_id
),
versements as (
  select supplier_id, coalesce(sum(amount), 0) as versed
    from public.supplier_payments group by supplier_id
),
rendus as (
  select party_id, coalesce(sum(amount), 0) as refunded
    from public.party_credit_refunds where party_type = 'supplier' group by party_id
)
update public.suppliers s
   set credit_amount = round(greatest(0::numeric,
         coalesce(v.versed, 0)
         - greatest(0, coalesce(pp.paid, 0) - coalesce(dp.direct_paid, 0))
         - coalesce(po.paid, 0)
         - coalesce(rd.refunded, 0)), 2)
  from public.suppliers base
  left join versements       v  on v.supplier_id  = base.id
  left join paid_purchases   pp on pp.supplier_id = base.id
  left join direct_purchases dp on dp.supplier_id = base.id
  left join paid_old         po on po.party_id    = base.id
  left join rendus           rd on rd.party_id    = base.id
 where s.id = base.id;


-- ============================================================================
-- 12. RLS, GRANTS ET TEMPS REEL
-- ----------------------------------------------------------------------------
--  Le module de securite depend du type de tiers porte par la ligne :
--  « clients » pour un client, « suppliers » pour un fournisseur.
-- ============================================================================

do $$
declare r record;
begin
  for r in select unnest(array['party_old_debts', 'party_credit_refunds']) as tbl
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    execute format('drop policy if exists %I on public.%I', r.tbl || '_sel', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_ins', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_upd', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_del', r.tbl);

    execute format($p$
      create policy %I on public.%I for select to authenticated
      using (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'view'))
    $p$, r.tbl || '_sel', r.tbl);

    execute format($p$
      create policy %I on public.%I for insert to authenticated
      with check (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'create'))
    $p$, r.tbl || '_ins', r.tbl);

    execute format($p$
      create policy %I on public.%I for update to authenticated
      using (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'edit'))
      with check (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'edit'))
    $p$, r.tbl || '_upd', r.tbl);

    execute format($p$
      create policy %I on public.%I for delete to authenticated
      using (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'delete'))
    $p$, r.tbl || '_del', r.tbl);
  end loop;
end
$$;

grant select, insert, update, delete on public.party_old_debts      to authenticated, service_role;
grant select, insert, update, delete on public.party_credit_refunds to authenticated, service_role;
grant select on public.v_party_old_debts to authenticated, service_role;
grant select on public.v_party_balances  to authenticated, service_role;

grant execute on function public.allocate_client_payment(uuid, numeric)     to authenticated, service_role;
grant execute on function public.deallocate_client_payment(uuid, numeric)   to authenticated, service_role;
grant execute on function public.allocate_supplier_payment(uuid, numeric)   to authenticated, service_role;
grant execute on function public.deallocate_supplier_payment(uuid, numeric) to authenticated, service_role;
grant execute on function public.add_party_old_debt(text, uuid, numeric, date, text)    to authenticated, service_role;
grant execute on function public.update_party_old_debt(uuid, numeric, date, text)       to authenticated, service_role;
grant execute on function public.delete_party_old_debt(uuid)                            to authenticated, service_role;
grant execute on function public.refund_party_credit(text, uuid, numeric, timestamptz, text, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.delete_party_refund(uuid)                              to authenticated, service_role;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.party_old_debts';
  exception when duplicate_object then null;
            when undefined_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.party_credit_refunds';
  exception when duplicate_object then null;
            when undefined_object then null;
  end;
end
$$;

commit;

-- ============================================================================
--  FIN — Anciennes dettes et avances clients / fournisseurs operationnelles.
--
--  VERIFICATIONS RAPIDES :
--    -- situation nette de chaque tiers (solde_net negatif = il a un credit)
--    select * from public.v_party_balances where solde_net <> 0 order by solde_net;
--
--    -- clients qui ont une avance a se faire rendre
--    select name, credit_amount from public.clients where credit_amount > 0;
--
--    -- anciennes dettes saisies
--    select * from public.v_party_old_debts limit 50;
--
--    -- remboursements d'excedent et leur ecriture de caisse
--    select r.party_name, r.amount, r.date, t.type, t.description
--      from public.party_credit_refunds r
--      left join public.caisse_transactions t
--             on t.ref_table = 'party_credit_refunds' and t.ref_id = r.id
--     order by r.refunded_at desc;
-- ============================================================================

;


-- ===== altech_production_update_commandes_anciennes_facturation.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « ANCIENNES COMMANDES / ANCIENNES LIVRAISONS + FACTURATION SARL »
-- ----------------------------------------------------------------------------
--  A executer EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est idempotent : il peut etre relance sans risque.
--
--  CE QUE CE SCRIPT AJOUTE
--  -----------------------
--    1. IDENTIFIANTS FISCAUX DU CLIENT (bloc « DOIT » des factures)
--       clients.rc / clients.nif / clients.nis / clients.article
--
--    2. ANCIENNES COMMANDES (saisie retroactive, statistiques uniquement)
--       commands.is_historical
--         · create_command()  -> aucune ecriture de caisse pour l'acompte
--         · pay_command()      -> aucun encaissement de caisse
--       Elles alimentent l'historique du client / les rapports SANS toucher
--       ni la caisse, ni le stock, ni la production.
--
--    3. ANCIENNES LIVRAISONS (rattachees a une ancienne commande)
--       command_deliveries.is_historical  (herite de la commande)
--       command_deliveries.location       (lieu de livraison par bon)
--         · create_command_delivery() / update_command_delivery()
--           -> AUCUNE deduction de stock ni consommation quand la commande
--              est « ancienne ». Les quantites livrees sont tout de meme
--              comptabilisees (statistiques, compte rendu, bon imprime).
--
--  CONTENU
--  -------
--    01. clients — colonnes fiscales
--    02. commands — is_historical
--    03. command_deliveries — location + is_historical
--    04. create_command()            — acompte hors caisse si ancienne
--    05. pay_command()               — encaissement hors caisse si ancienne
--    06. create_command_delivery()   — livraison sans stock si ancienne
--    07. update_command_delivery()   — idem en modification
--    08. Droits
-- ============================================================================

begin;


-- ============================================================================
-- 01. CLIENTS — identifiants fiscaux (bloc « DOIT » de la facture)
-- ============================================================================

alter table public.clients
  add column if not exists rc      text,
  add column if not exists nif     text,
  add column if not exists nis     text,
  add column if not exists article text;

comment on column public.clients.rc      is 'Registre du commerce du client (imprime dans le bloc DOIT).';
comment on column public.clients.nif     is 'Numero d''identification fiscale du client.';
comment on column public.clients.nis     is 'Numero d''identification statistique du client.';
comment on column public.clients.article is 'Numero d''article d''imposition du client.';


-- ============================================================================
-- 02. COMMANDES — drapeau « ancienne commande »
-- ----------------------------------------------------------------------------
--  Une ancienne commande reconstitue l'historique commercial d'un client sans
--  generer aucune ecriture de caisse ni aucun mouvement de stock / production.
-- ============================================================================

alter table public.commands
  add column if not exists is_historical boolean not null default false;

comment on column public.commands.is_historical is
  'Ancienne commande saisie a posteriori : statistiques / historique uniquement, aucune ecriture de caisse ni de stock.';

create index if not exists commands_historical_idx
  on public.commands (is_historical) where is_historical;


-- ============================================================================
-- 03. LIVRAISONS — lieu de livraison + drapeau « ancienne livraison »
-- ----------------------------------------------------------------------------
--  `location` : lieu reellement livre pour ce bon (Beni Mered, Blida, ...),
--  propose par defaut a l'adresse de la commande, modifiable a chaque bon.
--  `is_historical` : herite de la commande — une ancienne commande ne peut
--  donner que des anciennes livraisons (sans deduction de stock).
-- ============================================================================

alter table public.command_deliveries
  add column if not exists location      text,
  add column if not exists is_historical boolean not null default false;

comment on column public.command_deliveries.location is
  'Lieu de livraison de ce bon (defaut : adresse de la commande).';
comment on column public.command_deliveries.is_historical is
  'Ancienne livraison (commande ancienne) : aucune deduction de stock.';


-- ============================================================================
-- 04. create_command() — l'acompte d'une ANCIENNE commande n'entre pas en caisse
-- ----------------------------------------------------------------------------
--  Reprend la derniere version (adresse, chauffeur, matricule, n° de bon, date
--  de creation editable) et ajoute : la colonne `is_historical`, et la
--  neutralisation de l'ecriture de caisse quand la commande est ancienne.
--  Aucun consume_stock() ici : la matiere ne part qu'a la livraison.
-- ============================================================================

create or replace function public.create_command(p_payload jsonb)
returns public.commands
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd     public.commands;
  v_ref     text;
  v_item    jsonb;
  v_total   numeric := 0;
  v_advance numeric := coalesce((p_payload ->> 'advance_paid')::numeric, 0);
  v_seq     int;
  v_created timestamptz := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());
  v_bon     text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
  v_addr    text := nullif(btrim(coalesce(p_payload ->> 'client_address', '')), '');
  v_driver  text := nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '');
  v_plate   text := nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '');
  v_client  uuid := nullif(p_payload ->> 'client_id', '')::uuid;
  v_hist    boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_year    text := to_char(v_created, 'YYYY');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.commands;
  v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.commands where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_item ->> 'total_price')::numeric,
                 coalesce((v_item ->> 'quantity')::numeric, 0) * coalesce((v_item ->> 'unit_price')::numeric, 0));
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  if v_addr is null and v_client is not null then
    select nullif(btrim(address), '') into v_addr from public.clients where id = v_client;
  end if;

  insert into public.commands (reference, client_id, client_name, client_phone, client_address,
                               driver_name, driver_plate, receive_date,
                               receive_hour, receive_minute, total_amount, advance_paid,
                               paid_amount, rest_amount, status, notes, bon_number,
                               is_historical, created_at, updated_at, created_by)
  values (v_ref,
          v_client,
          coalesce(p_payload ->> 'client_name', 'Client'),
          p_payload ->> 'client_phone',
          v_addr, v_driver, v_plate,
          nullif(p_payload ->> 'receive_date', '')::date,
          p_payload ->> 'receive_hour',
          p_payload ->> 'receive_minute',
          v_total, v_advance, v_advance, greatest(0, v_total - v_advance),
          'pending', p_payload ->> 'notes', v_bon,
          v_hist, v_created, v_created, public.current_username())
  returning * into v_cmd;

  if v_addr is not null and v_client is not null then
    update public.clients
       set address = v_addr, updated_at = now()
     where id = v_client and coalesce(nullif(btrim(address), ''), '') is distinct from v_addr;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    insert into public.command_items (command_id, product_id, fiche_technic_id, product_name,
                                      quantity, unit_price, total_price, sell_by_unit, sell_unit)
    values (v_cmd.id,
            nullif(v_item ->> 'product_id', '')::uuid,
            nullif(v_item ->> 'fiche_technic_id', '')::uuid,
            coalesce(v_item ->> 'product_name', 'Produit'),
            coalesce((v_item ->> 'quantity')::numeric, 0),
            coalesce((v_item ->> 'unit_price')::numeric, 0),
            coalesce((v_item ->> 'total_price')::numeric, 0),
            coalesce((v_item ->> 'sell_by_unit')::boolean, false),
            v_item ->> 'sell_unit');
  end loop;

  -- ---- AUCUN consume_stock() ICI : la matiere ne part qu'a la livraison ----

  -- L'acompte d'une ANCIENNE commande a ete encaisse dans le passe, hors du
  -- logiciel : il ne doit surtout pas gonfler la caisse d'aujourd'hui.
  if v_advance > 0 and not v_hist then
    insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
    values ('deposit', v_advance, v_created::date,
            'Acompte commande ' || v_ref, 'Commande', 'commands', v_cmd.id);
  end if;

  return v_cmd;
end;
$fn$;


-- ============================================================================
-- 05. pay_command() — un reglement d'ANCIENNE commande n'entre pas en caisse
-- ----------------------------------------------------------------------------
--  Reprend la signature existante (id, montant, date) et neutralise l'ecriture
--  de caisse quand la commande est ancienne.
-- ============================================================================

create or replace function public.pay_command(
  p_command_id uuid, p_amount numeric, p_date date default current_date
) returns public.commands
language plpgsql
security definer
set search_path = public
as $fn$
declare v_cmd public.commands;
begin
  update public.commands
     set paid_amount = least(total_amount, paid_amount + p_amount),
         rest_amount = greatest(0, total_amount - least(total_amount, paid_amount + p_amount)),
         updated_at  = now()
   where id = p_command_id
  returning * into v_cmd;

  if v_cmd.id is null then
    raise exception 'Commande introuvable (%)', p_command_id;
  end if;

  -- l'argent d'une ancienne commande a circule hors du logiciel
  if not coalesce(v_cmd.is_historical, false) then
    insert into public.caisse_transactions (type, amount, date, description, category_name)
    values ('deposit', p_amount, coalesce(p_date, current_date),
            'Règlement commande ' || v_cmd.reference, 'Commande');
  end if;

  return v_cmd;
end;
$fn$;


-- ============================================================================
-- 06. create_command_delivery() — pas de stock pour une ANCIENNE livraison
-- ----------------------------------------------------------------------------
--  Reprend la version « deduction reelle du stock » et ajoute :
--    · le lieu de livraison (`location`) du bon,
--    · l'heritage du drapeau `is_historical` de la commande,
--    · le court-circuit de apply_command_delivery_stock() pour une ancienne
--      livraison (aucune matiere retiree, aucune production).
-- ============================================================================

create or replace function public.create_command_delivery(p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del    public.command_deliveries;
  v_cmd    public.commands;
  v_item   jsonb;
  v_ref    text;
  v_seq    int;
  v_driver text := nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '');
  v_plate  text := nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '');
  v_loc    text := nullif(btrim(coalesce(p_payload ->> 'location', '')), '');
begin
  if not public.has_perm('clients', 'edit') and not public.has_perm('clients', 'create') then
    raise exception 'Vous n''avez pas la permission de livrer une commande';
  end if;

  select * into v_cmd from public.commands where id = (p_payload ->> 'command_id')::uuid;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  -- par defaut : le chauffeur prevu et l'adresse de la commande
  v_driver := coalesce(v_driver, nullif(btrim(coalesce(v_cmd.driver_name, '')), ''));
  v_plate  := coalesce(v_plate,  nullif(btrim(coalesce(v_cmd.driver_plate, '')), ''));
  v_loc    := coalesce(v_loc,    nullif(btrim(coalesce(v_cmd.client_address, '')), ''));

  select count(*) + 1 into v_seq from public.command_deliveries where command_id = v_cmd.id;
  v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  while exists (select 1 from public.command_deliveries where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  end loop;

  insert into public.command_deliveries (command_id, reference, date, delivered_at, notes,
                                         driver_name, driver_plate, location, is_historical)
  values (v_cmd.id, v_ref,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now())::date,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now()),
          coalesce(p_payload ->> 'notes', ''),
          v_driver, v_plate, v_loc, coalesce(v_cmd.is_historical, false))
  returning * into v_del;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
      insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
      values (v_del.id,
              nullif(v_item ->> 'command_item_id', '')::uuid,
              coalesce(v_item ->> 'product_name', 'Produit'),
              coalesce((v_item ->> 'quantity')::numeric, 0),
              v_item ->> 'sell_unit');
    end if;
  end loop;

  -- ---- LA LIVRAISON RETIRE LES MATIERES DU STOCK — sauf ancienne livraison ----
  -- Une ancienne livraison ne fait que comptabiliser des quantites deja
  -- livrees dans le passe : aucune matiere ne doit quitter le stock actuel.
  if not coalesce(v_cmd.is_historical, false) then
    perform public.apply_command_delivery_stock(v_del.id);
  end if;

  perform public.recompute_command_delivery(v_cmd.id);
  perform public.log_activity('clients', 'deliver', 'command_deliveries', v_del.id, p_payload);
  return v_del;
end;
$fn$;


-- ============================================================================
-- 07. update_command_delivery() — idem en modification
-- ============================================================================

create or replace function public.update_command_delivery(p_id uuid, p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del  public.command_deliveries;
  v_item jsonb;
begin
  update public.command_deliveries
     set delivered_at = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at),
         date         = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at)::date,
         notes        = coalesce(p_payload ->> 'notes', notes),
         location     = case when p_payload ? 'location'
                             then nullif(btrim(coalesce(p_payload ->> 'location', '')), '')
                             else location end,
         driver_name  = case when p_payload ? 'driver_name'
                             then nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '')
                             else driver_name end,
         driver_plate = case when p_payload ? 'driver_plate'
                             then nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '')
                             else driver_plate end,
         updated_at   = now()
   where id = p_id
  returning * into v_del;

  if v_del.id is null then raise exception 'Livraison introuvable'; end if;

  if p_payload ? 'items' then
    delete from public.command_delivery_items where delivery_id = p_id;
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
      if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
        insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
        values (p_id,
                nullif(v_item ->> 'command_item_id', '')::uuid,
                coalesce(v_item ->> 'product_name', 'Produit'),
                coalesce((v_item ->> 'quantity')::numeric, 0),
                v_item ->> 'sell_unit');
      end if;
    end loop;
  end if;

  -- ---- stock remis puis rededuit — sauf ancienne livraison (rien en stock) ----
  if not coalesce(v_del.is_historical, false) then
    perform public.apply_command_delivery_stock(p_id);
  end if;

  perform public.recompute_command_delivery(v_del.command_id);
  perform public.log_activity('clients', 'deliver_update', 'command_deliveries', v_del.id, p_payload);
  return v_del;
end;
$fn$;


-- ============================================================================
-- 08. DROITS
-- ============================================================================

grant execute on function public.create_command(jsonb)                to authenticated, service_role;
grant execute on function public.pay_command(uuid, numeric, date)     to authenticated, service_role;
grant execute on function public.create_command_delivery(jsonb)       to authenticated, service_role;
grant execute on function public.update_command_delivery(uuid, jsonb) to authenticated, service_role;

commit;

-- ============================================================================
--  FIN
--
--  VERIFICATIONS RAPIDES
--    -- une ancienne commande n'ecrit rien en caisse :
--    select reference, is_historical, paid_amount from public.commands
--     where is_historical order by created_at desc limit 10;
--    -- une ancienne livraison ne retire aucune matiere :
--    select d.reference, d.is_historical, d.location,
--           (select count(*) from public.command_delivery_consumptions c
--             where c.delivery_id = d.id) as matieres_deduites
--      from public.command_deliveries d
--     where d.is_historical order by d.delivered_at desc limit 10;
-- ============================================================================

;


-- ===== altech_production_update_livraison_vente_tva.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « LA LIVRAISON EST UNE VENTE + TVA COMMANDE/LIVRAISON + EN-TETE SOCIETE »
-- ----------------------------------------------------------------------------
--  A executer EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est idempotent : il peut etre relance sans risque.
--
--  CE QUE CE SCRIPT AJOUTE
--  -----------------------
--    1. LA LIVRAISON D'UNE COMMANDE DEVIENT UNE VENTE
--       Chaque bon de livraison genere (et tient a jour) une facture de vente
--       dans `sales` :
--         · elle se comporte exactement comme une vente encaissee a la caisse
--           (ecran /ventes : voir, modifier, supprimer, imprimer, payer),
--         · l'operateur saisit CE QUE LE CLIENT PAIE au moment de la remise,
--           le reste devient automatiquement une DETTE CLIENT,
--         · l'acompte deja verse sur la commande peut etre impute sur la
--           livraison SANS reecrire la caisse (il y est deja entre),
--         · la vente apparait dans l'historique du client, dans les
--           transactions de caisse et dans les rapports.
--
--    2. TVA SUR LA COMMANDE ET SUR LA LIVRAISON
--       commands.tva_enabled / tva_rate / tva_amount / total_ttc
--       command_deliveries.tva_enabled / tva_rate / tva_amount
--       -> activable ou desactivable a la creation comme a la modification ;
--          les documents imprimes n'affichent la TVA que si elle est active.
--
--    3. PAIEMENTS DE VENTE TRACES ET « HORS CAISSE »
--       sale_payments.skip_caisse : une imputation d'acompte ne cree aucune
--       ecriture de caisse (l'argent est deja dans le tiroir).
--       sale_payments.origin      : distingue les reglements generes par la
--       livraison des reglements de dette saisis ensuite.
--
--    4. EN-TETE DES DOCUMENTS IMPRIMES
--       store_settings.activity_place (LIEU D'ACTIVITE) et store_settings.city
--       (« BLIDA LE ... »), repris par tous les modeles d'impression.
--
--  CONTENU
--  -------
--    01. store_settings — lieu d'activite + ville
--    02. sale_payments  — skip_caisse / origin (+ declencheur de caisse)
--    03. sales          — delivery_id / command_id (+ colonnes de securite)
--    04. commands       — TVA, total TTC, extra_paid (+ declencheur de totaux)
--    05. command_deliveries — TVA, valeurs, encaissement, vente liee
--    06. recompute_command_payments()  — acompte + reglements + livraisons
--    07. apply_delivery_sale()         — cree / met a jour la vente du bon
--    08. create_command()              — TVA de la commande
--    09. pay_command()                 — regle sur le TTC
--    10. create_command_delivery()     — livraison encaissee = vente
--    11. update_command_delivery()     — idem en modification
--    12. delete_command_delivery()     — supprime la vente liee
--    13. update_sale() / pay_sale_debt() — pilotent le bon de livraison
--    14. Supprimer la vente d'une livraison supprime le bon
--    15. Reprise des livraisons deja saisies
--    16. Vues de controle + droits
-- ============================================================================

begin;


-- ============================================================================
-- 01. STORE_SETTINGS — lieu d'activite et ville (en-tete des documents)
-- ============================================================================

alter table public.store_settings
  add column if not exists activity_place text,
  add column if not exists city           text;

comment on column public.store_settings.activity_place is
  'Lieu d''activite imprime sous la raison sociale (ex : BAHLI BLIDA).';
comment on column public.store_settings.city is
  'Ville utilisee par la mention « <VILLE> LE jj/mm/aaaa » des documents.';


-- ============================================================================
-- 02. SALE_PAYMENTS — origine du reglement et ecriture de caisse facultative
-- ----------------------------------------------------------------------------
--  Quand l'acompte deja verse sur une commande est impute sur la livraison,
--  l'argent est deja entre en caisse le jour de la commande : le rejouer
--  gonflerait le tiroir. `skip_caisse` neutralise l'ecriture.
--  `origin` permet a apply_delivery_sale() de reconstruire SES deux lignes
--  (acompte impute + encaissement du jour) sans effacer les reglements de
--  dette saisis plus tard, qui ont leur propre date en caisse.
-- ============================================================================

alter table public.sale_payments
  add column if not exists skip_caisse boolean not null default false,
  add column if not exists origin      text;

comment on column public.sale_payments.skip_caisse is
  'Reglement deja encaisse ailleurs (acompte de commande impute sur une livraison) : aucune ecriture de caisse.';
comment on column public.sale_payments.origin is
  'delivery_advance = acompte de commande impute ; delivery_cash = encaissement du bon ; NULL = reglement libre.';

create index if not exists sale_payments_origin_idx
  on public.sale_payments (sale_id, origin);

create or replace function public.trg_sale_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref  text;
  v_hist boolean;
begin
  -- imputation d'un acompte deja encaisse : rien a ecrire
  if coalesce(new.skip_caisse, false) then
    return new;
  end if;

  select reference, coalesce(is_historical, false)
    into v_ref, v_hist
    from public.sales where id = new.sale_id;

  -- l'argent d'une ancienne vente a ete encaisse dans le passe, hors logiciel
  if coalesce(v_hist, false) then
    return new;
  end if;

  insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('deposit', new.amount, new.date,
          coalesce(new.description, 'Paiement vente') || ' ' || coalesce(v_ref, ''),
          'Vente', 'sale_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trg_sale_payment_caisse on public.sale_payments;
create trigger trg_sale_payment_caisse
  after insert on public.sale_payments
  for each row execute function public.trg_sale_payment_to_caisse();


-- ============================================================================
-- 03. SALES — rattachement au bon de livraison et a la commande
-- ----------------------------------------------------------------------------
--  `delivery_id` : la vente EST le bon de livraison. Supprimer le bon supprime
--  la vente (cascade) ; supprimer la vente supprime le bon (section 14).
--  Les colonnes de facturation sont (re)creees par securite : le script reste
--  executable meme si une mise a jour precedente a ete sautee.
-- ============================================================================

alter table public.sales
  add column if not exists bon_number    text,
  add column if not exists is_historical boolean       not null default false,
  add column if not exists tva_enabled   boolean       not null default false,
  add column if not exists tva_rate      numeric(6,2)  not null default 0,
  add column if not exists tva_amount    numeric(14,2) not null default 0,
  add column if not exists delivery_id   uuid,
  add column if not exists command_id    uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_delivery_id_fkey') then
    alter table public.sales
      add constraint sales_delivery_id_fkey
      foreign key (delivery_id) references public.command_deliveries(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_command_id_fkey') then
    alter table public.sales
      add constraint sales_command_id_fkey
      foreign key (command_id) references public.commands(id) on delete set null;
  end if;
end $$;

create unique index if not exists sales_delivery_uidx
  on public.sales (delivery_id) where delivery_id is not null;
create index if not exists sales_command_idx
  on public.sales (command_id) where command_id is not null;

comment on column public.sales.delivery_id is
  'Bon de livraison a l''origine de cette facture de vente (la livraison EST la vente).';
comment on column public.sales.command_id is
  'Commande client a l''origine de la livraison facturee.';


-- ============================================================================
-- 04. COMMANDS — TVA, total TTC et reglements complementaires
-- ----------------------------------------------------------------------------
--  `total_amount` reste le total HORS TAXES des lignes ; `total_ttc` est le net
--  a payer. Le reste du a une commande se calcule TOUJOURS sur le TTC.
--
--  `advance_paid`  : acompte verse a la creation de la commande.
--  `extra_paid`    : reglements encaisses depuis l'ecran « Commandes ».
--  `paid_amount`   : advance_paid + extra_paid + encaissements des livraisons.
-- ============================================================================

alter table public.commands
  add column if not exists tva_enabled boolean       not null default false,
  add column if not exists tva_rate    numeric(6,2)  not null default 0,
  add column if not exists tva_amount  numeric(14,2) not null default 0,
  add column if not exists total_ttc   numeric(14,2) not null default 0,
  add column if not exists extra_paid  numeric(14,2) not null default 0;

-- reprise des commandes existantes : pas de TVA, TTC = HT, reglements = paye - acompte
update public.commands
   set total_ttc = total_amount
 where coalesce(total_ttc, 0) = 0 and coalesce(total_amount, 0) <> 0;

update public.commands
   set extra_paid = greatest(0, coalesce(paid_amount, 0) - coalesce(advance_paid, 0))
 where coalesce(extra_paid, 0) = 0
   and coalesce(paid_amount, 0) > coalesce(advance_paid, 0);

comment on column public.commands.tva_enabled is
  'TVA activee sur la commande — reprise par defaut sur chaque livraison et sur les documents imprimes.';
comment on column public.commands.total_ttc is
  'Net a payer de la commande : total HT + TVA. C''est lui qui determine le reste du.';
comment on column public.commands.extra_paid is
  'Reglements encaisses depuis l''ecran Commandes (hors acompte initial et hors livraisons).';

/**
 * Totaux d'une commande : la TVA, le TTC et le reste du sont TOUJOURS
 * recalcules, que la commande soit ecrite par une RPC ou modifiee ligne a
 * ligne depuis l'ecran d'edition.
 */
create or replace function public.trg_command_totals()
returns trigger
language plpgsql
as $fn$
begin
  if coalesce(new.tva_enabled, false) then
    if coalesce(new.tva_rate, 0) <= 0 then new.tva_rate := 19; end if;
  else
    new.tva_rate := 0;
  end if;
  new.tva_amount  := round(coalesce(new.total_amount, 0) * coalesce(new.tva_rate, 0) / 100, 2);
  new.total_ttc   := coalesce(new.total_amount, 0) + new.tva_amount;
  new.paid_amount := greatest(0, coalesce(new.paid_amount, 0));
  new.rest_amount := greatest(0, new.total_ttc - new.paid_amount);
  return new;
end;
$fn$;

drop trigger if exists trg_commands_totals on public.commands;
create trigger trg_commands_totals
  before insert or update on public.commands
  for each row execute function public.trg_command_totals();


-- ============================================================================
-- 05. COMMAND_DELIVERIES — TVA, valeur livree, encaissement et vente liee
-- ============================================================================

alter table public.command_deliveries
  add column if not exists tva_enabled     boolean       not null default false,
  add column if not exists tva_rate        numeric(6,2)  not null default 0,
  add column if not exists tva_amount      numeric(14,2) not null default 0,
  add column if not exists total_ht        numeric(14,2) not null default 0,
  add column if not exists total_ttc       numeric(14,2) not null default 0,
  add column if not exists advance_applied numeric(14,2) not null default 0,
  add column if not exists cash_paid       numeric(14,2) not null default 0,
  add column if not exists paid_amount     numeric(14,2) not null default 0,
  add column if not exists rest_amount     numeric(14,2) not null default 0,
  add column if not exists sale_id         uuid,
  add column if not exists sale_reference  text;

comment on column public.command_deliveries.total_ht is
  'Valeur hors taxes de la marchandise remise sur ce bon (quantites livrees x P.U. de la commande).';
comment on column public.command_deliveries.advance_applied is
  'Part de l''acompte de la commande imputee sur cette livraison — aucune ecriture de caisse.';
comment on column public.command_deliveries.cash_paid is
  'Argent REELLEMENT encaisse au moment de la remise — entre en caisse.';
comment on column public.command_deliveries.paid_amount is
  'Total credite a la livraison : acompte impute + encaissements (remise + reglements de dette).';
comment on column public.command_deliveries.sale_id is
  'Facture de vente generee par ce bon de livraison.';

create index if not exists command_deliveries_sale_idx
  on public.command_deliveries (sale_id) where sale_id is not null;


-- ============================================================================
-- 06. recompute_command_payments() — ce que le client a verse sur la commande
-- ----------------------------------------------------------------------------
--  paid_amount = acompte initial
--              + reglements encaisses depuis l'ecran « Commandes »
--              + argent REELLEMENT recu par les livraisons
--                (paye de la facture - acompte deja impute dessus).
--  Le declencheur de la section 04 recalcule ensuite le reste du sur le TTC.
-- ============================================================================

create or replace function public.recompute_command_payments(p_command_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.commands c
     set paid_amount = coalesce(c.advance_paid, 0)
                     + coalesce(c.extra_paid, 0)
                     + coalesce((
                         select sum(greatest(0, coalesce(s.paid_amount, d.paid_amount, 0)
                                              - coalesce(d.advance_applied, 0)))
                           from public.command_deliveries d
                           left join public.sales s on s.delivery_id = d.id
                          where d.command_id = c.id), 0),
         updated_at  = now()
   where c.id = p_command_id;
end;
$fn$;

/** Acompte de la commande encore disponible pour etre impute sur un bon. */
create or replace function public.command_advance_available(
  p_command_id uuid, p_exclude_delivery uuid default null
) returns numeric
language sql
stable
security definer
set search_path = public
as $fn$
  select greatest(0,
           coalesce((select c.advance_paid + c.extra_paid from public.commands c
                      where c.id = p_command_id), 0)
         - coalesce((select sum(d.advance_applied) from public.command_deliveries d
                      where d.command_id = p_command_id
                        and (p_exclude_delivery is null or d.id <> p_exclude_delivery)), 0));
$fn$;


-- ============================================================================
-- 07. apply_delivery_sale() — LE BON DE LIVRAISON DEVIENT UNE FACTURE DE VENTE
-- ----------------------------------------------------------------------------
--  Cree la vente si elle n'existe pas encore, la met a jour sinon :
--    · lignes = produits reellement remis, au prix unitaire de la commande,
--    · TVA    = option du bon de livraison,
--    · paye   = acompte impute (hors caisse) + encaissement du jour (caisse)
--               + reglements de dette saisis ensuite (conserves tels quels),
--    · reste  = dette client suivie (carte client, rapports, caisse).
--  AUCUN mouvement de stock ici : les matieres ont deja ete retirees par
--  apply_command_delivery_stock() au moment de la livraison.
-- ============================================================================

create or replace function public.apply_delivery_sale(p_delivery_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del    public.command_deliveries;
  v_cmd    public.commands;
  v_sale   public.sales;
  v_ht     numeric := 0;
  v_tva    numeric := 0;
  v_ttc    numeric := 0;
  v_adv    numeric;
  v_cash   numeric;
  v_extra  numeric := 0;
  v_paid   numeric;
  v_rest   numeric;
  v_ref    text;
  v_seq    int;
  v_status public.sale_status;
  v_hist   boolean;
  v_year   text;
begin
  select * into v_del from public.command_deliveries where id = p_delivery_id;
  if v_del.id is null then return null; end if;
  select * into v_cmd from public.commands where id = v_del.command_id;
  if v_cmd.id is null then return null; end if;

  v_hist := coalesce(v_del.is_historical, coalesce(v_cmd.is_historical, false));

  -- ---- valeur HORS TAXES de ce qui est remis sur ce bon --------------------
  select coalesce(sum(di.quantity * coalesce(px.unit_price, 0)), 0)
    into v_ht
    from public.command_delivery_items di
    left join lateral (
      select ci.unit_price
        from public.command_items ci
       where ci.command_id = v_del.command_id
         and (ci.id = di.command_item_id
              or (di.command_item_id is null and ci.product_name = di.product_name))
       order by (ci.id = di.command_item_id) desc
       limit 1
    ) px on true
   where di.delivery_id = p_delivery_id;

  v_tva := case when coalesce(v_del.tva_enabled, false)
                then round(v_ht * coalesce(v_del.tva_rate, 0) / 100, 2) else 0 end;
  v_ttc := v_ht + v_tva;

  -- ---- la facture de vente -------------------------------------------------
  select * into v_sale from public.sales where delivery_id = p_delivery_id;

  if v_sale.id is null then
    v_year := to_char(coalesce(v_del.delivered_at, now()), 'YYYY');
    select coalesce(count(*), 0) + 1 into v_seq from public.sales;
    v_ref := 'VNT-' || v_year || '-' || lpad(v_seq::text, 3, '0');
    while exists (select 1 from public.sales where reference = v_ref) loop
      v_seq := v_seq + 1;
      v_ref := 'VNT-' || v_year || '-' || lpad(v_seq::text, 3, '0');
    end loop;

    insert into public.sales (reference, client_id, date, total_amount, reduction, final_amount,
                              paid_amount, rest_amount, status, note, bon_number, is_historical,
                              tva_enabled, tva_rate, tva_amount, delivery_id, command_id,
                              created_by, created_at)
    values (v_ref, v_cmd.client_id, coalesce(v_del.delivered_at, now())::date,
            v_ht, 0, v_ttc, 0, v_ttc, 'debt'::public.sale_status,
            nullif(btrim(coalesce(v_del.notes, '')), ''),
            v_cmd.bon_number, v_hist,
            coalesce(v_del.tva_enabled, false), coalesce(v_del.tva_rate, 0), v_tva,
            p_delivery_id, v_cmd.id,
            coalesce(v_del.created_by, public.current_username()),
            coalesce(v_del.delivered_at, now()))
    returning * into v_sale;
  end if;

  -- ---- ce que le client regle sur cette livraison --------------------------
  --  Les reglements « libres » (dette payee apres coup) gardent leur date et
  --  leur ecriture de caisse : on ne recalcule que les deux lignes du bon.
  select coalesce(sum(amount), 0) into v_extra
    from public.sale_payments
   where sale_id = v_sale.id and coalesce(origin, '') not in ('delivery_advance', 'delivery_cash');

  v_adv  := least(greatest(0, coalesce(v_del.advance_applied, 0)), v_ttc);
  v_cash := least(greatest(0, coalesce(v_del.cash_paid, 0)), greatest(0, v_ttc - v_adv));
  v_extra := least(greatest(0, v_extra), greatest(0, v_ttc - v_adv - v_cash));
  v_paid := v_adv + v_cash + v_extra;
  v_rest := greatest(0, v_ttc - v_paid);
  v_status := case when v_rest <= 0 then 'paid'::public.sale_status
                   else 'debt'::public.sale_status end;

  update public.sales
     set client_id     = v_cmd.client_id,
         date          = coalesce(v_del.delivered_at, now())::date,
         total_amount  = v_ht,
         reduction     = 0,
         final_amount  = v_ttc,
         paid_amount   = v_paid,
         rest_amount   = v_rest,
         status        = v_status,
         note          = nullif(btrim(coalesce(v_del.notes, '')), ''),
         bon_number    = v_cmd.bon_number,
         is_historical = v_hist,
         tva_enabled   = coalesce(v_del.tva_enabled, false),
         tva_rate      = coalesce(v_del.tva_rate, 0),
         tva_amount    = v_tva,
         command_id    = v_cmd.id,
         updated_at    = now()
   where id = v_sale.id
  returning * into v_sale;

  -- ---- lignes de la facture = produits remis -------------------------------
  --  Aucune consommation de stock : elle a deja eu lieu a la livraison.
  --
  --  `fiche_technic_id` n'est recopie QUE si la fiche existe encore : une
  --  commande peut porter la reference d'une fiche technique supprimee depuis,
  --  et `sale_lines.fiche_technic_id` est contraint par une cle etrangere.
  delete from public.sale_lines where sale_id = v_sale.id;
  insert into public.sale_lines (sale_id, product_id, comptoir_id, fiche_technic_id,
                                 product_name, quantity, selling_price, base_price,
                                 sell_by_unit, unit)
  select v_sale.id, null, null,
         (select ft.id from public.fiche_technics ft where ft.id = px.fiche_technic_id),
         di.product_name, di.quantity, coalesce(px.unit_price, 0), coalesce(px.unit_price, 0),
         coalesce(px.sell_by_unit, false), coalesce(di.sell_unit, px.sell_unit)
    from public.command_delivery_items di
    left join lateral (
      select ci.unit_price, ci.fiche_technic_id, ci.sell_by_unit, ci.sell_unit
        from public.command_items ci
       where ci.command_id = v_del.command_id
         and (ci.id = di.command_item_id
              or (di.command_item_id is null and ci.product_name = di.product_name))
       order by (ci.id = di.command_item_id) desc
       limit 1
    ) px on true
   where di.delivery_id = p_delivery_id;

  -- ---- les deux reglements du bon (acompte impute + encaissement) ----------
  delete from public.sale_payments
   where sale_id = v_sale.id and coalesce(origin, '') in ('delivery_advance', 'delivery_cash');
  if v_adv > 0 then
    insert into public.sale_payments (sale_id, date, amount, description, skip_caisse, origin)
    values (v_sale.id, v_sale.date, v_adv,
            'Acompte commande ' || v_cmd.reference || ' impute sur ' || v_del.reference,
            true, 'delivery_advance');
  end if;
  if v_cash > 0 then
    insert into public.sale_payments (sale_id, date, amount, description, skip_caisse, origin)
    values (v_sale.id, v_sale.date, v_cash,
            'Encaissement livraison ' || v_del.reference, false, 'delivery_cash');
  end if;

  -- ---- la dette client suivie ---------------------------------------------
  delete from public.client_debts
   where description = 'Reste livraison ' || v_del.reference
     and coalesce(total_paid, 0) = 0;
  if v_rest > 0 and v_cmd.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_cmd.client_id, c.name, c.phone, v_rest, v_rest, v_sale.date,
           'Reste livraison ' || v_del.reference, public.current_username()
      from public.clients c where c.id = v_cmd.client_id;
  end if;

  -- ---- le bon de livraison memorise sa situation ---------------------------
  update public.command_deliveries
     set total_ht        = v_ht,
         tva_amount      = v_tva,
         total_ttc       = v_ttc,
         advance_applied = v_adv,
         cash_paid       = v_cash,
         paid_amount     = v_paid,
         rest_amount     = v_rest,
         sale_id         = v_sale.id,
         sale_reference  = v_sale.reference,
         updated_at      = now()
   where id = p_delivery_id;

  -- ---- la commande suit ce que le client a verse ---------------------------
  perform public.recompute_command_payments(v_del.command_id);

  return v_sale.id;
end;
$fn$;


-- ============================================================================
-- 08. create_command() — TVA de la commande
-- ----------------------------------------------------------------------------
--  Reprend la derniere version (adresse, chauffeur, matricule, n° de bon, date
--  de creation editable, ancienne commande) et ajoute l'option TVA. Le
--  declencheur de la section 04 calcule tva_amount / total_ttc / rest_amount.
--  Aucun consume_stock() ici : la matiere ne part qu'a la livraison.
-- ============================================================================

create or replace function public.create_command(p_payload jsonb)
returns public.commands
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd      public.commands;
  v_ref      text;
  v_item     jsonb;
  v_total    numeric := 0;
  v_advance  numeric := coalesce((p_payload ->> 'advance_paid')::numeric, 0);
  v_seq      int;
  v_created  timestamptz := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());
  v_bon      text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
  v_addr     text := nullif(btrim(coalesce(p_payload ->> 'client_address', '')), '');
  v_driver   text := nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '');
  v_plate    text := nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '');
  v_client   uuid := nullif(p_payload ->> 'client_id', '')::uuid;
  v_hist     boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_tva_on   boolean := coalesce((p_payload ->> 'tva_enabled')::boolean, false);
  v_tva_rate numeric := coalesce((p_payload ->> 'tva_rate')::numeric, 19);
  v_year     text := to_char(v_created, 'YYYY');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.commands;
  v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.commands where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_item ->> 'total_price')::numeric,
                 coalesce((v_item ->> 'quantity')::numeric, 0) * coalesce((v_item ->> 'unit_price')::numeric, 0));
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  if not v_tva_on then v_tva_rate := 0; end if;

  if v_addr is null and v_client is not null then
    select nullif(btrim(address), '') into v_addr from public.clients where id = v_client;
  end if;

  insert into public.commands (reference, client_id, client_name, client_phone, client_address,
                               driver_name, driver_plate, receive_date,
                               receive_hour, receive_minute, total_amount, advance_paid,
                               extra_paid, paid_amount, rest_amount, status, notes, bon_number,
                               is_historical, tva_enabled, tva_rate,
                               created_at, updated_at, created_by)
  values (v_ref,
          v_client,
          coalesce(p_payload ->> 'client_name', 'Client'),
          p_payload ->> 'client_phone',
          v_addr, v_driver, v_plate,
          nullif(p_payload ->> 'receive_date', '')::date,
          p_payload ->> 'receive_hour',
          p_payload ->> 'receive_minute',
          v_total, v_advance, 0, v_advance, 0,
          'pending', p_payload ->> 'notes', v_bon,
          v_hist, v_tva_on, v_tva_rate,
          v_created, v_created, public.current_username())
  returning * into v_cmd;

  if v_addr is not null and v_client is not null then
    update public.clients
       set address = v_addr, updated_at = now()
     where id = v_client and coalesce(nullif(btrim(address), ''), '') is distinct from v_addr;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    insert into public.command_items (command_id, product_id, fiche_technic_id, product_name,
                                      quantity, unit_price, total_price, sell_by_unit, sell_unit)
    values (v_cmd.id,
            nullif(v_item ->> 'product_id', '')::uuid,
            nullif(v_item ->> 'fiche_technic_id', '')::uuid,
            coalesce(v_item ->> 'product_name', 'Produit'),
            coalesce((v_item ->> 'quantity')::numeric, 0),
            coalesce((v_item ->> 'unit_price')::numeric, 0),
            coalesce((v_item ->> 'total_price')::numeric, 0),
            coalesce((v_item ->> 'sell_by_unit')::boolean, false),
            v_item ->> 'sell_unit');
  end loop;

  -- L'acompte d'une ANCIENNE commande a ete encaisse dans le passe, hors du
  -- logiciel : il ne doit surtout pas gonfler la caisse d'aujourd'hui.
  if v_advance > 0 and not v_hist then
    insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
    values ('deposit', v_advance, v_created::date,
            'Acompte commande ' || v_ref, 'Commande', 'commands', v_cmd.id)
    on conflict (ref_table, ref_id) do nothing;
  end if;

  select * into v_cmd from public.commands where id = v_cmd.id;
  return v_cmd;
end;
$fn$;


-- ============================================================================
-- 09. pay_command() — le reglement se calcule sur le TTC
-- ============================================================================

create or replace function public.pay_command(
  p_command_id uuid, p_amount numeric, p_date date default current_date
) returns public.commands
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd public.commands;
  v_amt numeric := greatest(0, coalesce(p_amount, 0));
begin
  select * into v_cmd from public.commands where id = p_command_id;
  if v_cmd.id is null then
    raise exception 'Commande introuvable (%)', p_command_id;
  end if;

  v_amt := least(v_amt, greatest(0, coalesce(v_cmd.total_ttc, v_cmd.total_amount)
                                  - coalesce(v_cmd.paid_amount, 0)));
  if v_amt <= 0 then return v_cmd; end if;

  update public.commands
     set extra_paid = coalesce(extra_paid, 0) + v_amt,
         updated_at = now()
   where id = p_command_id;

  perform public.recompute_command_payments(p_command_id);

  -- l'argent d'une ancienne commande a circule hors du logiciel
  if not coalesce(v_cmd.is_historical, false) then
    insert into public.caisse_transactions (type, amount, date, description, category_name)
    values ('deposit', v_amt, coalesce(p_date, current_date),
            'Règlement commande ' || v_cmd.reference, 'Commande');
  end if;

  select * into v_cmd from public.commands where id = p_command_id;
  return v_cmd;
end;
$fn$;


-- ============================================================================
-- 10. create_command_delivery() — LA LIVRAISON EST UNE VENTE
-- ----------------------------------------------------------------------------
--  Reprend la version « ancienne livraison / lieu / chauffeur » et ajoute :
--    · l'option TVA du bon (par defaut celle de la commande),
--    · l'encaissement du jour et l'imputation de l'acompte disponible,
--    · la creation de la facture de vente correspondante.
-- ============================================================================

create or replace function public.create_command_delivery(p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del      public.command_deliveries;
  v_cmd      public.commands;
  v_item     jsonb;
  v_ref      text;
  v_seq      int;
  v_driver   text := nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '');
  v_plate    text := nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '');
  v_loc      text := nullif(btrim(coalesce(p_payload ->> 'location', '')), '');
  v_tva_on   boolean;
  v_tva_rate numeric;
  v_cash     numeric := greatest(0, coalesce((p_payload ->> 'cash_paid')::numeric, 0));
  v_adv      numeric := greatest(0, coalesce((p_payload ->> 'advance_applied')::numeric, 0));
begin
  if not public.has_perm('clients', 'edit') and not public.has_perm('clients', 'create') then
    raise exception 'Vous n''avez pas la permission de livrer une commande';
  end if;

  select * into v_cmd from public.commands where id = (p_payload ->> 'command_id')::uuid;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  -- par defaut : le chauffeur prevu, l'adresse et la TVA de la commande
  v_driver := coalesce(v_driver, nullif(btrim(coalesce(v_cmd.driver_name, '')), ''));
  v_plate  := coalesce(v_plate,  nullif(btrim(coalesce(v_cmd.driver_plate, '')), ''));
  v_loc    := coalesce(v_loc,    nullif(btrim(coalesce(v_cmd.client_address, '')), ''));

  v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_cmd.tva_enabled, false));
  v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric,
                         nullif(coalesce(v_cmd.tva_rate, 0), 0), 19);
  if not v_tva_on then v_tva_rate := 0; end if;

  -- l'acompte n'est jamais impute deux fois
  v_adv := least(v_adv, public.command_advance_available(v_cmd.id, null));

  select count(*) + 1 into v_seq from public.command_deliveries where command_id = v_cmd.id;
  v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  while exists (select 1 from public.command_deliveries where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  end loop;

  insert into public.command_deliveries (command_id, reference, date, delivered_at, notes,
                                         driver_name, driver_plate, location, is_historical,
                                         tva_enabled, tva_rate, advance_applied, cash_paid)
  values (v_cmd.id, v_ref,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now())::date,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now()),
          coalesce(p_payload ->> 'notes', ''),
          v_driver, v_plate, v_loc, coalesce(v_cmd.is_historical, false),
          v_tva_on, v_tva_rate, v_adv, v_cash)
  returning * into v_del;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
      insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
      values (v_del.id,
              nullif(v_item ->> 'command_item_id', '')::uuid,
              coalesce(v_item ->> 'product_name', 'Produit'),
              coalesce((v_item ->> 'quantity')::numeric, 0),
              v_item ->> 'sell_unit');
    end if;
  end loop;

  -- ---- LA LIVRAISON RETIRE LES MATIERES DU STOCK — sauf ancienne livraison --
  if not coalesce(v_cmd.is_historical, false) then
    perform public.apply_command_delivery_stock(v_del.id);
  end if;

  -- ---- ... ET DEVIENT UNE FACTURE DE VENTE ---------------------------------
  perform public.apply_delivery_sale(v_del.id);

  perform public.recompute_command_delivery(v_cmd.id);
  perform public.log_activity('clients', 'deliver', 'command_deliveries', v_del.id, p_payload);

  select * into v_del from public.command_deliveries where id = v_del.id;
  return v_del;
end;
$fn$;


-- ============================================================================
-- 11. update_command_delivery() — la vente liee suit la modification
-- ============================================================================

create or replace function public.update_command_delivery(p_id uuid, p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del      public.command_deliveries;
  v_item     jsonb;
  v_tva_on   boolean;
  v_tva_rate numeric;
  v_adv      numeric;
  v_cash     numeric;
begin
  select * into v_del from public.command_deliveries where id = p_id;
  if v_del.id is null then raise exception 'Livraison introuvable'; end if;

  v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_del.tva_enabled, false));
  v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric,
                         nullif(coalesce(v_del.tva_rate, 0), 0), 19);
  if not v_tva_on then v_tva_rate := 0; end if;

  v_cash := greatest(0, coalesce((p_payload ->> 'cash_paid')::numeric, coalesce(v_del.cash_paid, 0)));
  v_adv  := greatest(0, coalesce((p_payload ->> 'advance_applied')::numeric, coalesce(v_del.advance_applied, 0)));
  v_adv  := least(v_adv, public.command_advance_available(v_del.command_id, p_id));

  update public.command_deliveries
     set delivered_at    = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at),
         date            = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at)::date,
         notes           = coalesce(p_payload ->> 'notes', notes),
         location        = case when p_payload ? 'location'
                                then nullif(btrim(coalesce(p_payload ->> 'location', '')), '')
                                else location end,
         driver_name     = case when p_payload ? 'driver_name'
                                then nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '')
                                else driver_name end,
         driver_plate    = case when p_payload ? 'driver_plate'
                                then nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '')
                                else driver_plate end,
         tva_enabled     = v_tva_on,
         tva_rate        = v_tva_rate,
         advance_applied = v_adv,
         cash_paid       = v_cash,
         updated_at      = now()
   where id = p_id
  returning * into v_del;

  if p_payload ? 'items' then
    delete from public.command_delivery_items where delivery_id = p_id;
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
      if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
        insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
        values (p_id,
                nullif(v_item ->> 'command_item_id', '')::uuid,
                coalesce(v_item ->> 'product_name', 'Produit'),
                coalesce((v_item ->> 'quantity')::numeric, 0),
                v_item ->> 'sell_unit');
      end if;
    end loop;
  end if;

  -- ---- stock remis puis rededuit — sauf ancienne livraison ------------------
  if not coalesce(v_del.is_historical, false) then
    perform public.apply_command_delivery_stock(p_id);
  end if;

  -- ---- la facture de vente est reconstruite a l'identique -------------------
  perform public.apply_delivery_sale(p_id);

  perform public.recompute_command_delivery(v_del.command_id);
  perform public.log_activity('clients', 'deliver_update', 'command_deliveries', v_del.id, p_payload);

  select * into v_del from public.command_deliveries where id = p_id;
  return v_del;
end;
$fn$;


-- ============================================================================
-- 12. delete_command_delivery() — la vente liee part avec le bon
-- ----------------------------------------------------------------------------
--  `sales.delivery_id` est en ON DELETE CASCADE : supprimer le bon supprime la
--  facture, ses lignes, ses reglements et — via trg_sale_payments_caisse_del —
--  les ecritures de caisse correspondantes.
-- ============================================================================

create or replace function public.delete_command_delivery(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd uuid;
  v_ref text;
begin
  select command_id, reference into v_cmd, v_ref
    from public.command_deliveries where id = p_id;

  delete from public.client_debts
   where description = 'Reste livraison ' || coalesce(v_ref, '')
     and coalesce(total_paid, 0) = 0;

  -- le declencheur `command_deliveries_restore_stock` remet les matieres
  delete from public.command_deliveries where id = p_id;

  if v_cmd is not null then
    perform public.recompute_command_payments(v_cmd);
    perform public.recompute_command_delivery(v_cmd);
  end if;
end;
$fn$;


-- ============================================================================
-- 13. update_sale() / pay_sale_debt() — pilotent le bon de livraison
-- ----------------------------------------------------------------------------
--  Une facture issue d'une livraison se modifie et se regle depuis /ventes
--  comme n'importe quelle vente : les deux fonctions redirigent alors l'ecriture
--  vers le bon de livraison, qui reste la source de verite (valeur livree,
--  acompte impute, encaissement) et reconstruit la facture.
-- ============================================================================

create or replace function public.update_sale(p_id uuid, p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale     public.sales;
  v_total    numeric;
  v_red      numeric;
  v_base     numeric;
  v_tva_on   boolean;
  v_tva_rate numeric;
  v_tva      numeric;
  v_final    numeric;
  v_paid     numeric;
  v_rest     numeric;
  v_date     date;
  v_status   public.sale_status;
begin
  select * into v_sale from public.sales where id = p_id;
  if v_sale.id is null then
    raise exception 'Vente introuvable (%)', p_id;
  end if;

  v_date := coalesce(nullif(p_payload ->> 'date', '')::date, v_sale.date);

  -- ---- facture issue d'une livraison : le bon reste la source de verite ----
  if v_sale.delivery_id is not null then
    v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_sale.tva_enabled, false));
    v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric, nullif(coalesce(v_sale.tva_rate, 0), 0), 19);
    if not v_tva_on then v_tva_rate := 0; end if;
    v_paid := greatest(0, coalesce((p_payload ->> 'paid_amount')::numeric, v_sale.paid_amount));

    -- le montant paye saisi remplace tous les reglements libres
    delete from public.sale_payments
     where sale_id = p_id and coalesce(origin, '') not in ('delivery_advance', 'delivery_cash');

    update public.command_deliveries d
       set delivered_at = (v_date::timestamp + coalesce(d.delivered_at::time, '12:00'::time)),
           date         = v_date,
           notes        = coalesce(p_payload ->> 'note', d.notes),
           tva_enabled  = v_tva_on,
           tva_rate     = v_tva_rate,
           cash_paid    = greatest(0, v_paid - coalesce(d.advance_applied, 0)),
           updated_at   = now()
     where d.id = v_sale.delivery_id;

    perform public.apply_delivery_sale(v_sale.delivery_id);
    perform public.log_activity('sales', 'update', 'sales', p_id, p_payload);
    select * into v_sale from public.sales where id = p_id;
    return v_sale;
  end if;

  -- ---- vente ordinaire : comportement historique ---------------------------
  v_red   := greatest(0, coalesce((p_payload ->> 'reduction')::numeric, v_sale.reduction));
  v_total := coalesce(
    (select sum(quantity * selling_price) from public.sale_lines where sale_id = p_id),
    v_sale.total_amount);
  v_red   := least(v_red, v_total);
  v_base  := greatest(0, v_total - v_red);

  v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_sale.tva_enabled, false));
  v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric, coalesce(v_sale.tva_rate, 0));
  if not v_tva_on then v_tva_rate := 0; end if;
  v_tva   := case when v_tva_on then round(v_base * v_tva_rate / 100, 2) else 0 end;
  v_final := v_base + v_tva;

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
         tva_enabled  = v_tva_on,
         tva_rate     = v_tva_rate,
         tva_amount   = v_tva,
         final_amount = v_final,
         paid_amount  = v_paid,
         rest_amount  = v_rest,
         status       = v_status,
         note         = coalesce(p_payload ->> 'note', note),
         updated_at   = now()
   where id = p_id
  returning * into v_sale;

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


create or replace function public.pay_sale_debt(
  p_sale_id uuid, p_amount numeric, p_date date default current_date,
  p_description text default 'Règlement dette'
) returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare v_sale public.sales;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'Vente introuvable (%)', p_sale_id; end if;

  -- le reglement garde sa propre date en caisse (origin NULL)
  insert into public.sale_payments (sale_id, date, amount, description)
  values (p_sale_id, coalesce(p_date, current_date), p_amount, p_description);

  if v_sale.delivery_id is not null then
    -- la facture est reconstruite a partir du bon : elle integre ce reglement
    perform public.apply_delivery_sale(v_sale.delivery_id);
  else
    update public.sales
       set paid_amount = least(final_amount, paid_amount + p_amount),
           rest_amount = greatest(0, final_amount - least(final_amount, paid_amount + p_amount)),
           status      = case when greatest(0, final_amount - least(final_amount, paid_amount + p_amount)) = 0
                              then 'paid'::public.sale_status else 'debt'::public.sale_status end,
           updated_at  = now()
     where id = p_sale_id;
  end if;

  perform public.log_activity('sales', 'pay', 'sales', p_sale_id, jsonb_build_object('amount', p_amount));
  select * into v_sale from public.sales where id = p_sale_id;
  return v_sale;
end;
$fn$;


-- ============================================================================
-- 14. SUPPRIMER LA VENTE D'UNE LIVRAISON SUPPRIME LE BON DE LIVRAISON
-- ----------------------------------------------------------------------------
--  La livraison ET sa facture sont une seule et meme operation : les deux
--  boutons « supprimer » doivent produire le meme resultat (matieres remises
--  en stock, commande revenue en « non livree », caisse nettoyee).
--  `pg_trigger_depth() = 1` distingue la suppression demandee par l'operateur
--  de la cascade declenchee par la suppression du bon lui-meme.
-- ============================================================================

create or replace function public.trg_sale_delete_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.delivery_id is not null and pg_trigger_depth() = 1 then
    delete from public.command_deliveries where id = old.delivery_id;
    if old.command_id is not null then
      perform public.recompute_command_payments(old.command_id);
      perform public.recompute_command_delivery(old.command_id);
    end if;
  end if;
  return old;
end;
$fn$;

drop trigger if exists trg_sales_delete_delivery on public.sales;
create trigger trg_sales_delete_delivery
  after delete on public.sales
  for each row execute function public.trg_sale_delete_delivery();


-- ============================================================================
-- 15. REPRISE DES LIVRAISONS DEJA ENREGISTREES
-- ----------------------------------------------------------------------------
--  Chaque bon de livraison existant recoit sa facture de vente : la valeur
--  livree est facturee, l'acompte encore disponible sur la commande y est
--  impute (sans ecriture de caisse : il y est deja entre) et le solde devient
--  une dette client. Les bons deja rattaches a une vente sont ignores.
-- ============================================================================

do $$
declare
  r      record;
  v_ht   numeric;
  v_left numeric;
begin
  for r in
    select d.id, d.command_id
      from public.command_deliveries d
     where not exists (select 1 from public.sales s where s.delivery_id = d.id)
     order by d.delivered_at
  loop
    select coalesce(sum(di.quantity * coalesce(px.unit_price, 0)), 0)
      into v_ht
      from public.command_delivery_items di
      left join lateral (
        select ci.unit_price
          from public.command_items ci
         where ci.command_id = r.command_id
           and (ci.id = di.command_item_id
                or (di.command_item_id is null and ci.product_name = di.product_name))
         order by (ci.id = di.command_item_id) desc
         limit 1
      ) px on true
     where di.delivery_id = r.id;

    v_left := public.command_advance_available(r.command_id, r.id);

    update public.command_deliveries
       set advance_applied = least(coalesce(v_left, 0), coalesce(v_ht, 0)),
           cash_paid       = 0
     where id = r.id;

    perform public.apply_delivery_sale(r.id);
  end loop;
end $$;


-- ============================================================================
-- 16. VUES DE CONTROLE + DROITS
-- ============================================================================

drop view if exists public.v_livraisons_ventes;
create view public.v_livraisons_ventes as
select d.reference                        as bon_livraison,
       c.reference                        as commande,
       c.client_name,
       d.delivered_at,
       d.location,
       d.total_ht,
       d.tva_enabled,
       d.tva_rate,
       d.tva_amount,
       d.total_ttc,
       d.advance_applied,
       d.cash_paid,
       d.paid_amount,
       d.rest_amount,
       s.reference                        as facture_vente,
       s.status                           as statut_vente
  from public.command_deliveries d
  join public.commands c on c.id = d.command_id
  left join public.sales s on s.delivery_id = d.id
 order by d.delivered_at desc;

grant select on public.v_livraisons_ventes to authenticated, service_role;

grant execute on function public.create_command(jsonb)                        to authenticated, service_role;
grant execute on function public.pay_command(uuid, numeric, date)             to authenticated, service_role;
grant execute on function public.create_command_delivery(jsonb)               to authenticated, service_role;
grant execute on function public.update_command_delivery(uuid, jsonb)         to authenticated, service_role;
grant execute on function public.delete_command_delivery(uuid)                to authenticated, service_role;
grant execute on function public.apply_delivery_sale(uuid)                    to authenticated, service_role;
grant execute on function public.recompute_command_payments(uuid)             to authenticated, service_role;
grant execute on function public.command_advance_available(uuid, uuid)        to authenticated, service_role;
grant execute on function public.update_sale(uuid, jsonb)                     to authenticated, service_role;
grant execute on function public.pay_sale_debt(uuid, numeric, date, text)     to authenticated, service_role;

commit;

-- ============================================================================
--  FIN
--
--  VERIFICATIONS RAPIDES
--    -- chaque bon de livraison a bien sa facture de vente :
--    select * from public.v_livraisons_ventes limit 20;
--
--    -- les ventes issues d'une livraison apparaissent dans /ventes :
--    select reference, date, final_amount, paid_amount, rest_amount, status,
--           delivery_id, command_id, tva_enabled, tva_rate, tva_amount
--      from public.sales where delivery_id is not null
--     order by date desc limit 20;
--
--    -- la caisse ne compte JAMAIS deux fois le meme argent :
--    select p.description, p.amount, p.skip_caisse, p.origin,
--           (select count(*) from public.caisse_transactions t
--             where t.ref_table = 'sale_payments' and t.ref_id = p.id) as ecritures
--      from public.sale_payments p order by p.created_at desc limit 20;
--
--    -- lignes de commande pointant une fiche technique supprimee : la vente
--    -- generee les facture par leur libelle, sans rattachement de recette
--    select ci.id, ci.product_name, ci.fiche_technic_id
--      from public.command_items ci
--     where ci.fiche_technic_id is not null
--       and not exists (select 1 from public.fiche_technics ft where ft.id = ci.fiche_technic_id);
--
--    -- TVA et reglements des commandes :
--    select reference, total_amount, tva_enabled, tva_rate, tva_amount,
--           total_ttc, advance_paid, extra_paid, paid_amount, rest_amount
--      from public.commands order by created_at desc limit 20;
-- ============================================================================

;


-- ===== altech_production_update_achat_modification_complete.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  MISE À JOUR — MODIFICATION COMPLÈTE D'UNE FACTURE D'ACHAT
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS :
--    1. altech_production_supabase.sql
--    2. altech_production_update_2026.sql
--    3. altech_production_update_achat_bon_matricule.sql
--    4. altech_production_update_pos_production_rapports.sql
--    5. altech_production_update_anciens_achats_ventes_tva.sql
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  POURQUOI
--   Le bouton « Modifier » d'une facture d'achat n'autorisait que l'en-tête
--   (date, n° de bon, matricule, montant payé). L'utilisateur doit pouvoir
--   rouvrir la facture EXACTEMENT comme à sa création et corriger TOUT :
--   fournisseur, date, bon de livraison, matricule, lignes de marchandises
--   (produit, quantité, prix, seuil d'alerte, unité, péremption) et règlement.
--
--   Toutes les tables liées suivent la correction :
--     · products            — le stock des anciennes lignes est REPRIS puis les
--                             nouvelles quantités sont réinjectées ;
--     · stock_movements     — une écriture d'annulation puis les nouvelles ;
--     · purchase_lines      — remplacées à l'identique de la saisie ;
--     · purchase_payments   — reconstruits sur le nouveau montant payé ;
--     · caisse_transactions — le décaissement suit le nouveau règlement ;
--     · purchases           — total, payé et reste recalculés.
-- ============================================================================

alter table public.purchases
  add column if not exists is_historical boolean not null default false;


-- ============================================================================
-- 01. RPC update_purchase() — modification COMPLÈTE d'une facture d'achat
-- ----------------------------------------------------------------------------
--  p_payload :
--    { supplier_id, date, bon_number, driver_plate, is_historical, note,
--      paid_amount, products: [ { product_id, product_name, quantity,
--      purchase_price, min_alert_quantity, unit_enabled, unit,
--      expiration_enabled, expiration_date } ] }
--
--  · Les clés absentes gardent leur valeur actuelle : l'ancien écran
--    « en-tête seul » continue donc de fonctionner sans changement.
--  · `products` absent  -> les lignes et le stock ne sont pas touchés.
--  · `products` présent -> le stock de l'ancienne facture est annulé puis
--    réappliqué avec les nouvelles lignes (sauf « ancien achat », qui ne
--    mouvemente jamais le stock).
-- ============================================================================

create or replace function public.update_purchase(p_id uuid, p_payload jsonb)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pur       public.purchases;
  v_old_hist  boolean;
  v_new_hist  boolean;
  v_date      date;
  v_total     numeric;
  v_paid      numeric;
  v_line      jsonb;
  v_old       record;
  v_left      numeric;
  v_replace   boolean;
begin
  select * into v_pur from public.purchases where id = p_id;
  if v_pur.id is null then
    raise exception 'Facture d achat introuvable (%)', p_id;
  end if;

  v_old_hist := coalesce(v_pur.is_historical, false);
  v_new_hist := coalesce((p_payload ->> 'is_historical')::boolean, v_old_hist);
  v_date     := coalesce(nullif(p_payload ->> 'date', '')::date, v_pur.date);
  v_replace  := jsonb_typeof(p_payload -> 'products') = 'array';

  -- ------------------------------------------------------------------ 1/5
  -- Reprise du stock alimenté par l'ancienne version de la facture.
  -- Un « ancien achat » n'a jamais rien ajouté : il n'y a rien à reprendre.
  if v_replace and not v_old_hist then
    for v_old in
      select id, product_id, quantity
        from public.purchase_lines
       where purchase_id = p_id and product_id is not null
    loop
      update public.products
         set current_quantity   = current_quantity   - v_old.quantity,
             principal_quantity = principal_quantity - v_old.quantity,
             updated_at         = now()
       where id = v_old.product_id
      returning current_quantity into v_left;

      if v_left is not null then
        insert into public.stock_movements
          (product_id, quantity, reason, ref_table, ref_id, balance_after)
        values (v_old.product_id, -v_old.quantity, 'purchase_edit',
                'purchase_lines', v_old.id, v_left);
      end if;
    end loop;
  end if;

  if v_replace then
    delete from public.purchase_lines where purchase_id = p_id;
  end if;

  -- ------------------------------------------------------------------ 2/5
  -- En-tête mis à jour AVANT les nouvelles lignes : le déclencheur de stock
  -- lit `is_historical` sur la facture pour savoir s'il doit alimenter.
  update public.purchases
     set supplier_id   = coalesce(nullif(p_payload ->> 'supplier_id', '')::uuid, supplier_id),
         date          = v_date,
         bon_number    = nullif(btrim(coalesce(p_payload ->> 'bon_number', coalesce(bon_number, ''))), ''),
         driver_plate  = nullif(upper(btrim(coalesce(p_payload ->> 'driver_plate', coalesce(driver_plate, '')))), ''),
         is_historical = v_new_hist,
         note          = coalesce(p_payload ->> 'note', note),
         updated_at    = now()
   where id = p_id;

  -- ------------------------------------------------------------------ 3/5
  -- Nouvelles lignes : trg_purchase_line_stock réalimente products et
  -- stock_movements (sauf ancien achat).
  if v_replace then
    for v_line in select * from jsonb_array_elements(p_payload -> 'products') loop
      insert into public.purchase_lines (
        purchase_id, product_id, product_name, quantity, purchase_price,
        min_alert_quantity, unit_enabled, unit, expiration_enabled, expiration_date)
      values (
        p_id,
        nullif(v_line ->> 'product_id', '')::uuid,
        coalesce(v_line ->> 'product_name', 'Produit'),
        coalesce((v_line ->> 'quantity')::numeric, 0),
        coalesce((v_line ->> 'purchase_price')::numeric, 0),
        nullif(v_line ->> 'min_alert_quantity', '')::numeric,
        coalesce((v_line ->> 'unit_enabled')::boolean, false),
        v_line ->> 'unit',
        coalesce((v_line ->> 'expiration_enabled')::boolean, false),
        nullif(v_line ->> 'expiration_date', '')::date
      );
    end loop;
  end if;

  -- ------------------------------------------------------------------ 4/5
  -- Total recalculé sur les lignes réellement enregistrées.
  v_total := coalesce(
    (select sum(quantity * purchase_price) from public.purchase_lines where purchase_id = p_id), 0);
  v_paid  := least(
    greatest(0, coalesce((p_payload ->> 'paid_amount')::numeric, v_pur.paid_amount)),
    v_total);

  -- ------------------------------------------------------------------ 5/5
  -- Règlement reconstruit : la suppression retire le décaissement de caisse
  -- (trg_purchase_payments_caisse_del), l'insertion en recrée un — sauf pour
  -- un ancien achat, réglé hors du logiciel.
  delete from public.purchase_payments where purchase_id = p_id;
  if v_paid > 0 then
    insert into public.purchase_payments (purchase_id, date, amount, description)
    values (p_id, v_date, v_paid,
            case when v_new_hist then 'Reglement ancien achat (modifie)'
                 else 'Reglement achat (modifie)' end);
  end if;

  update public.purchases
     set total_amount = v_total,
         paid_amount  = v_paid,
         rest_amount  = greatest(0, v_total - v_paid),
         updated_at   = now()
   where id = p_id
  returning * into v_pur;

  perform public.log_activity('purchase', 'update', 'purchases', p_id, p_payload);
  return v_pur;
end;
$fn$;

grant execute on function public.update_purchase(uuid, jsonb) to authenticated, service_role;


-- ============================================================================
-- 02. CONTRÔLE — reprises de stock générées par la modification d'un achat
-- ============================================================================

create or replace view public.v_purchase_stock_corrections as
select m.created_at,
       m.product_id,
       p.name as product_name,
       m.quantity,
       m.balance_after
  from public.stock_movements m
  left join public.products p on p.id = m.product_id
 where m.reason = 'purchase_edit'
 order by m.created_at desc;

grant select on public.v_purchase_stock_corrections to authenticated, service_role;

;


-- ===== altech_production_update_achat_modification_stock.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  CORRECTIF — « Modifier » une facture d'achat n'enregistrait pas les
--  modifications, et le stock ne suivait pas.
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS :
--    1. altech_production_supabase.sql
--    2. altech_production_update_2026.sql
--    3. altech_production_update_achat_bon_matricule.sql
--    4. altech_production_update_pos_production_rapports.sql
--    5. altech_production_update_anciens_achats_ventes_tva.sql
--    6. altech_production_update_achat_modification_complete.sql
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  LE BUG
--   La version précédente de update_purchase() corrigeait le stock en DEUX
--   temps : elle retirait d'abord la TOTALITÉ des anciennes quantités, puis
--   réinjectait les nouvelles.
--
--   Or la table products porte la contrainte
--       constraint products_qty_positive check (current_quantity >= 0)
--
--   Dès que la marchandise achetée avait déjà été vendue, consommée en
--   production, envoyée au comptoir ou détruite, le stock actuel était
--   inférieur à la quantité facturée : le retrait intermédiaire le rendait
--   NÉGATIF, la contrainte sautait et TOUTE la transaction était annulée.
--   Résultat côté écran : « Modifier » ne gardait AUCUNE modification —
--   ni le fournisseur, ni la date, ni les lignes, ni le règlement.
--
--   Exemple : 100 sacs achetés, 90 déjà vendus (stock = 10). L'utilisateur
--   corrige la quantité de la facture 100 -> 120.
--     · avant : 10 - 100 = -90  -> CHECK violée -> rien n'est enregistré ;
--     · après : écart = +20     -> 10 + 20 = 30 -> enregistré.
--
--  LE CORRECTIF
--   Le stock est réconcilié PAR ÉCART (nouvelle quantité − ancienne quantité),
--   produit par produit, en une seule écriture. Aucun creux intermédiaire,
--   donc plus aucune violation de contrainte. Les tables liées suivent :
--     · products            — quantités réconciliées par écart, plus la fiche
--                             produit (prix d'achat, seuil d'alerte, unité,
--                             péremption) alignée sur les lignes corrigées ;
--     · stock_movements     — une écriture 'purchase_edit' par produit touché ;
--     · purchase_lines      — remplacées à l'identique de la saisie ;
--     · purchase_payments   — reconstruits UNIQUEMENT si le montant payé
--                             change (l'historique des versements et les
--                             écritures de caisse sont sinon préservés) ;
--     · caisse_transactions — le décaissement suit le nouveau règlement ;
--     · purchases           — fournisseur, date, bon, matricule, ancien achat,
--                             total, payé et reste.
-- ============================================================================

begin;

-- Colonnes utilisées par la fonction — garde-fous si un script antérieur
-- n'a pas été exécuté.
alter table public.purchases
  add column if not exists bon_number    text,
  add column if not exists driver_plate  text,
  add column if not exists is_historical boolean not null default false;


-- ============================================================================
-- 01. trg_purchase_line_to_stock() — silencieux pendant une réconciliation
-- ----------------------------------------------------------------------------
--  update_purchase() calcule lui-même l'écart de stock : quand il réécrit les
--  lignes, le déclencheur ne doit PAS réalimenter les produits, sinon les
--  quantités seraient comptées deux fois. Le drapeau est posé avec
--  set_config(..., true) : il est local à la transaction et disparaît tout
--  seul, même en cas d'erreur.
-- ============================================================================

create or replace function public.trg_purchase_line_to_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_left numeric;
  v_hist boolean;
begin
  if new.product_id is null then
    return new;
  end if;

  -- Réécriture des lignes par update_purchase() : le stock est déjà réconcilié.
  if coalesce(current_setting('altech.skip_purchase_stock', true), '') = '1' then
    return new;
  end if;

  -- « Ancien achat » : la marchandise a été reçue et consommée dans le passé,
  -- le stock d'aujourd'hui ne doit surtout pas être gonflé.
  select coalesce(is_historical, false) into v_hist
    from public.purchases where id = new.purchase_id;
  if coalesce(v_hist, false) then
    return new;
  end if;

  update public.products
     set current_quantity   = current_quantity + new.quantity,
         principal_quantity = principal_quantity + new.quantity,
         min_alert_quantity = coalesce(new.min_alert_quantity, min_alert_quantity),
         purchase_price     = case when new.purchase_price > 0 then new.purchase_price else purchase_price end,
         expiration_date    = coalesce(new.expiration_date, expiration_date),
         expiration_enabled = case when new.expiration_date is not null then true else expiration_enabled end,
         unit_enabled       = case when new.unit_enabled then true else unit_enabled end,
         unit               = case when new.unit_enabled then coalesce(new.unit, unit) else unit end,
         updated_at         = now()
   where id = new.product_id
  returning current_quantity into v_left;

  insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
  values (new.product_id, new.quantity, 'purchase', 'purchase_lines', new.id, v_left);

  return new;
end;
$fn$;

drop trigger if exists trg_purchase_line_stock on public.purchase_lines;
create trigger trg_purchase_line_stock
  after insert on public.purchase_lines
  for each row execute function public.trg_purchase_line_to_stock();


-- ============================================================================
-- 02. RPC update_purchase() — modification complète, stock réconcilié par écart
-- ----------------------------------------------------------------------------
--  p_payload :
--    { supplier_id, date, bon_number, driver_plate, is_historical, note,
--      paid_amount, products: [ { product_id, product_name, quantity,
--      purchase_price, min_alert_quantity, unit_enabled, unit,
--      expiration_enabled, expiration_date } ] }
--
--  · Les clés absentes gardent leur valeur actuelle.
--  · `products` absent  -> lignes et stock intacts (modification d'en-tête).
--  · `products` présent -> lignes remplacées et stock réconcilié par écart.
--  · « Ancien achat » : ne mouvemente jamais le stock. Basculer une facture
--    normale en ancien achat retire donc ses quantités, et l'inverse les
--    ajoute — l'écart gère les deux sens automatiquement.
-- ============================================================================

create or replace function public.update_purchase(p_id uuid, p_payload jsonb)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pur      public.purchases;
  v_old_hist boolean;
  v_new_hist boolean;
  v_date     date;
  v_total    numeric;
  v_paid     numeric;
  v_paid_now numeric;
  v_replace  boolean;
  v_line     jsonb;
  v_delta    record;
  v_left     numeric;
begin
  select * into v_pur from public.purchases where id = p_id;
  if v_pur.id is null then
    raise exception 'Facture d achat introuvable (%)', p_id;
  end if;

  v_old_hist := coalesce(v_pur.is_historical, false);
  v_new_hist := coalesce((p_payload ->> 'is_historical')::boolean, v_old_hist);
  v_date     := coalesce(nullif(p_payload ->> 'date', '')::date, v_pur.date);
  v_replace  := jsonb_typeof(p_payload -> 'products') = 'array';

  -- ------------------------------------------------------------------ 1/6
  -- En-tête. Mis à jour d'abord : le reste de la fonction (et le déclencheur
  -- de stock) lit `is_historical` sur la facture.
  update public.purchases
     set supplier_id   = coalesce(nullif(p_payload ->> 'supplier_id', '')::uuid, supplier_id),
         date          = v_date,
         bon_number    = nullif(btrim(coalesce(p_payload ->> 'bon_number', coalesce(bon_number, ''))), ''),
         driver_plate  = nullif(upper(btrim(coalesce(p_payload ->> 'driver_plate', coalesce(driver_plate, '')))), ''),
         is_historical = v_new_hist,
         note          = coalesce(p_payload ->> 'note', note),
         updated_at    = now()
   where id = p_id;

  if v_replace then
    -- ---------------------------------------------------------------- 2/6
    -- Stock réconcilié PAR ÉCART, produit par produit, en une seule écriture.
    --   écart = quantité nouvelle version − quantité ancienne version
    -- Un produit retiré de la facture donne un écart négatif, un produit
    -- ajouté un écart positif. Un « ancien achat » compte pour zéro des deux
    -- côtés puisqu'il n'alimente jamais le stock.
    for v_delta in
      with old_q as (
        select product_id, sum(quantity) as qty
          from public.purchase_lines
         where purchase_id = p_id and product_id is not null
         group by product_id
      ),
      new_q as (
        select (l ->> 'product_id')::uuid as product_id,
               sum(coalesce((l ->> 'quantity')::numeric, 0)) as qty
          from jsonb_array_elements(p_payload -> 'products') as l
         where nullif(l ->> 'product_id', '') is not null
         group by 1
      )
      select coalesce(n.product_id, o.product_id) as product_id,
             (case when v_new_hist then 0 else coalesce(n.qty, 0) end)
           - (case when v_old_hist then 0 else coalesce(o.qty, 0) end) as delta
        from old_q o
        full outer join new_q n on n.product_id = o.product_id
    loop
      continue when coalesce(v_delta.delta, 0) = 0;

      -- greatest(0, ...) : la marchandise a pu être vendue entre-temps.
      -- Le stock ne descend jamais sous zéro (contrainte products_qty_positive)
      -- et la correction reste tracée dans stock_movements.
      update public.products
         set current_quantity   = greatest(0, current_quantity   + v_delta.delta),
             principal_quantity = greatest(0, principal_quantity + v_delta.delta),
             updated_at         = now()
       where id = v_delta.product_id
      returning current_quantity into v_left;

      if v_left is not null then
        insert into public.stock_movements
          (product_id, quantity, reason, ref_table, ref_id, balance_after)
        values (v_delta.product_id, v_delta.delta, 'purchase_edit',
                'purchases', p_id, v_left);
      end if;
    end loop;

    -- ---------------------------------------------------------------- 3/6
    -- Lignes remplacées, déclencheur de stock muet (écart déjà appliqué).
    perform set_config('altech.skip_purchase_stock', '1', true);

    delete from public.purchase_lines where purchase_id = p_id;

    for v_line in select * from jsonb_array_elements(p_payload -> 'products') loop
      insert into public.purchase_lines (
        purchase_id, product_id, product_name, quantity, purchase_price,
        min_alert_quantity, unit_enabled, unit, expiration_enabled, expiration_date)
      values (
        p_id,
        nullif(v_line ->> 'product_id', '')::uuid,
        coalesce(v_line ->> 'product_name', 'Produit'),
        coalesce((v_line ->> 'quantity')::numeric, 0),
        coalesce((v_line ->> 'purchase_price')::numeric, 0),
        nullif(v_line ->> 'min_alert_quantity', '')::numeric,
        coalesce((v_line ->> 'unit_enabled')::boolean, false),
        v_line ->> 'unit',
        coalesce((v_line ->> 'expiration_enabled')::boolean, false),
        nullif(v_line ->> 'expiration_date', '')::date
      );
    end loop;

    perform set_config('altech.skip_purchase_stock', '0', true);

    -- ---------------------------------------------------------------- 4/6
    -- Fiche produit (/stock) alignée sur la facture corrigée, exactement comme
    -- à la création : prix d'achat, seuil d'alerte, unité et péremption.
    -- Un ancien achat ne touche pas à la fiche du jour.
    if not v_new_hist then
      for v_line in select * from jsonb_array_elements(p_payload -> 'products') loop
        continue when nullif(v_line ->> 'product_id', '') is null;

        update public.products
           set min_alert_quantity = coalesce(nullif(v_line ->> 'min_alert_quantity', '')::numeric,
                                             min_alert_quantity),
               purchase_price     = case when coalesce((v_line ->> 'purchase_price')::numeric, 0) > 0
                                         then (v_line ->> 'purchase_price')::numeric
                                         else purchase_price end,
               expiration_date    = coalesce(nullif(v_line ->> 'expiration_date', '')::date, expiration_date),
               expiration_enabled = case when nullif(v_line ->> 'expiration_date', '') is not null
                                         then true else expiration_enabled end,
               unit_enabled       = case when coalesce((v_line ->> 'unit_enabled')::boolean, false)
                                         then true else unit_enabled end,
               unit               = case when coalesce((v_line ->> 'unit_enabled')::boolean, false)
                                         then coalesce(v_line ->> 'unit', unit) else unit end,
               updated_at         = now()
         where id = (v_line ->> 'product_id')::uuid;
      end loop;
    end if;
  end if;

  -- ------------------------------------------------------------------ 5/6
  -- Total recalculé sur les lignes réellement enregistrées.
  select sum(quantity * purchase_price) into v_total
    from public.purchase_lines where purchase_id = p_id;
  if v_total is null then
    v_total := case when v_replace then 0 else v_pur.total_amount end;
  end if;

  v_paid := least(
    greatest(0, coalesce((p_payload ->> 'paid_amount')::numeric, v_pur.paid_amount)),
    v_total);

  -- ------------------------------------------------------------------ 6/6
  -- Règlement reconstruit UNIQUEMENT s'il a changé : sinon les versements
  -- successifs saisis avec le bouton « Payer » et leurs écritures de caisse
  -- seraient écrasés par un versement unique. La suppression retire le
  -- décaissement (trg_purchase_payments_caisse_del), l'insertion en recrée un
  -- — sauf pour un ancien achat, réglé hors du logiciel.
  select coalesce(sum(amount), 0) into v_paid_now
    from public.purchase_payments where purchase_id = p_id;

  if round(v_paid, 2) <> round(v_paid_now, 2) then
    delete from public.purchase_payments where purchase_id = p_id;
    if v_paid > 0 then
      insert into public.purchase_payments (purchase_id, date, amount, description)
      values (p_id, v_date, v_paid,
              case when v_new_hist then 'Reglement ancien achat (modifie)'
                   else 'Reglement achat (modifie)' end);
    end if;
  end if;

  update public.purchases
     set total_amount = v_total,
         paid_amount  = v_paid,
         rest_amount  = greatest(0, v_total - v_paid),
         updated_at   = now()
   where id = p_id
  returning * into v_pur;

  perform public.log_activity('purchase', 'update', 'purchases', p_id, p_payload);
  return v_pur;
end;
$fn$;

grant execute on function public.update_purchase(uuid, jsonb) to authenticated, service_role;


-- ============================================================================
-- 03. CONTRÔLE — écarts de stock générés par la modification d'un achat
-- ============================================================================

-- Les colonnes changent de nom (quantity -> ecart) : « create or replace »
-- refuserait, la vue est donc reconstruite.
drop view if exists public.v_purchase_stock_corrections;

create view public.v_purchase_stock_corrections as
select m.created_at,
       m.product_id,
       p.name          as product_name,
       m.quantity      as ecart,
       m.balance_after as stock_apres,
       m.ref_id        as purchase_id,
       pu.reference    as purchase_reference
  from public.stock_movements m
  left join public.products  p  on p.id  = m.product_id
  left join public.purchases pu on pu.id = m.ref_id
 where m.reason = 'purchase_edit'
 order by m.created_at desc;

grant select on public.v_purchase_stock_corrections to authenticated, service_role;

commit;

;


-- ===== altech_production_update_historique_commandes_rapports.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR « HISTORIQUE, COMMANDES ET RAPPORTS »
-- ----------------------------------------------------------------------------
--  A EXECUTER EN UNE SEULE FOIS dans l'editeur SQL de Supabase.
--  Le script est IDEMPOTENT : on peut le relancer sans risque.
--
--  PREREQUIS — ces scripts doivent deja avoir ete executes :
--    · altech_production_supabase.sql                       (schema de base)
--    · altech_production_update_2026.sql
--    · altech_production_update_commandes_stock_versements.sql
--    · altech_production_update_anciennes_dettes_avances.sql
--    · altech_production_update_livraison_stock_historique.sql
--    · altech_production_update_livraison_vente_tva.sql      (apply_delivery_sale)
--    · altech_production_update_versements_modes_reglement.sql
--
--  CE QU'IL APPORTE
--  ----------------
--   01. command_items.position       — plusieurs lignes du MEME produit sur une
--                                      commande (quantites et prix differents)
--   02. command_items.cancelled_quantity — le client renonce au reste
--   03. command_adjustments (+ lignes) — annulations et augmentations archivees
--   04. recompute_command_amounts()  — total HT / TVA / TTC / reste du a partir
--                                      des lignes, annulations comprises
--   05. update_command()             — MODIFICATION COMPLETE d'une commande
--                                      (en-tete, TVA, acompte ET lignes)
--   06. cancel_command_remainder()   — annuler le reste non livre
--   07. increase_command()           — augmenter les quantites commandees
--   08. delete_command_adjustment()  — revenir en arriere
--   09. create_command()             — prend en compte `position`
--   10. settle_command_deliveries()  — L'ARGENT DEJA VERSE SUR UNE COMMANDE EST
--                                      IMPUTE SUR SES BONS DE LIVRAISON : les
--                                      factures cessent d'apparaitre en DETTE
--                                      dans /ventes, la caisse et les rapports
--   11. pay_command()                — solde aussitot les livraisons du client
--   12. NETTOYAGE DES VERSEMENTS FANTOMES  (dettes « Reste livraison » orphelines)
--   13. Vues de controle, droits et temps reel
--   14. REPRISE DES DONNEES EXISTANTES
-- ============================================================================

begin;

-- ============================================================================
-- 01. PLUSIEURS LIGNES DU MEME PRODUIT SUR UNE COMMANDE
-- ----------------------------------------------------------------------------
--  Un client prend 30 m3 a un prix negocie puis 20 m3 au tarif normal : ce sont
--  DEUX lignes du meme produit. `position` fige l'ordre de saisie et permet de
--  les distinguer partout (ecran, bon de commande, livraisons, rapports).
-- ============================================================================

alter table public.command_items
  add column if not exists position int not null default 0;

comment on column public.command_items.position is
  'Rang de la ligne dans la commande. Permet de porter PLUSIEURS fois le meme produit avec des quantites et des prix differents.';

-- Les commandes deja saisies recoivent un rang stable (ordre de creation).
with ranked as (
  select id, row_number() over (partition by command_id order by created_at, id) - 1 as rnk
    from public.command_items
)
update public.command_items ci
   set position = r.rnk
  from ranked r
 where r.id = ci.id and coalesce(ci.position, 0) = 0;

create index if not exists command_items_position_idx
  on public.command_items (command_id, position);


-- ============================================================================
-- 02. LE CLIENT RENONCE AU RESTE  (quantite annulee)
-- ----------------------------------------------------------------------------
--  Commande de 100 unites, livree a 70, le client s'arrete la : les 30 unites
--  restantes sont ANNULEES. `quantity` garde la trace de ce qui avait ete
--  commande ; `cancelled_quantity` dit ce a quoi le client a renonce.
--
--      quantite reellement attendue = quantity - cancelled_quantity
--
--  Le total de la commande, sa TVA, son TTC et son reste du sont recalcules sur
--  cette quantite : la dette de 30 unites disparait de la fiche du client, de
--  la caisse et des rapports.
-- ============================================================================

alter table public.command_items
  add column if not exists cancelled_quantity numeric(14,3) not null default 0;

comment on column public.command_items.cancelled_quantity is
  'Quantite a laquelle le client a renonce sur cette ligne. La quantite attendue vaut quantity - cancelled_quantity.';


-- ============================================================================
-- 03. ARCHIVE DES ANNULATIONS ET DES AUGMENTATIONS
-- ============================================================================

create table if not exists public.command_adjustments (
  id                uuid primary key default gen_random_uuid(),
  command_id        uuid not null references public.commands(id) on delete cascade,
  command_reference text,
  client_id         uuid,
  client_name       text,
  type              text not null check (type in ('cancel', 'increase')),
  date              date not null default current_date,
  reason            text default '',
  total_quantity    numeric(14,3) not null default 0,
  total_amount      numeric(14,2) not null default 0,
  created_by        text default public.current_username(),
  created_at        timestamptz not null default now()
);

create table if not exists public.command_adjustment_lines (
  id              uuid primary key default gen_random_uuid(),
  adjustment_id   uuid not null references public.command_adjustments(id) on delete cascade,
  command_item_id uuid,
  product_name    text not null,
  quantity        numeric(14,3) not null default 0,
  unit_price      numeric(14,2) not null default 0,
  amount          numeric(14,2) not null default 0,
  unit            text
);

create index if not exists command_adjustments_command_idx on public.command_adjustments (command_id, date desc);
create index if not exists command_adjustments_client_idx  on public.command_adjustments (client_id, date desc);
create index if not exists command_adjustment_lines_idx    on public.command_adjustment_lines (adjustment_id);

comment on table public.command_adjustments is
  'Annulation du reste non livre, ou augmentation des quantites, d''une commande deja passee. Repris dans l''historique du client et dans le rapport general.';


-- ============================================================================
-- 04. TOTAUX D'UNE COMMANDE, RECALCULES DEPUIS SES LIGNES
-- ----------------------------------------------------------------------------
--  Le total HORS TAXES d'une commande n'est plus une valeur libre : c'est la
--  somme de ses lignes, annulations deduites. Le declencheur `trg_command_totals`
--  en tire ensuite la TVA, le TTC et le reste du.
-- ============================================================================

create or replace function public.recompute_command_amounts(
  p_command_id uuid,
  p_total      numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_total numeric;
begin
  -- Chaque ligne vaut la quantite ENCORE ATTENDUE x son prix unitaire.
  update public.command_items
     set total_price = round(greatest(0, quantity - coalesce(cancelled_quantity, 0)) * coalesce(unit_price, 0), 2)
   where command_id = p_command_id;

  -- `p_total` permet de conserver le TOTAL AJUSTE A LA MAIN par l'operateur
  -- (champ « Ajuster le total » de l'ecran des commandes). Sans lui, le total
  -- est la somme des lignes.
  if p_total is not null then
    v_total := greatest(0, p_total);
  else
    select coalesce(sum(total_price), 0) into v_total
      from public.command_items where command_id = p_command_id;
  end if;

  update public.commands
     set total_amount = v_total,
         updated_at   = now()
   where id = p_command_id;
end;
$fn$;

/**
 * Corrige le total d'une commande d'un ECART, sans toucher au total ajuste a
 * la main : c'est ce qu'il faut pour une annulation (ecart negatif) ou une
 * augmentation (ecart positif).
 */
create or replace function public.shift_command_total(p_command_id uuid, p_delta numeric)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.command_items
     set total_price = round(greatest(0, quantity - coalesce(cancelled_quantity, 0)) * coalesce(unit_price, 0), 2)
   where command_id = p_command_id;

  update public.commands
     set total_amount = greatest(0, coalesce(total_amount, 0) + coalesce(p_delta, 0)),
         updated_at   = now()
   where id = p_command_id;
end;
$fn$;

/**
 * Etat de livraison d'une commande, ANNULATIONS COMPRISES.
 * Une commande de 100 livree a 70 puis annulee pour 30 est « finalisee ».
 */
create or replace function public.recompute_command_delivery(p_command_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_pending int;
begin
  update public.command_items ci
     set delivered_quantity = coalesce((
       select sum(di.quantity)
         from public.command_delivery_items di
         join public.command_deliveries d on d.id = di.delivery_id
        where di.command_item_id = ci.id and d.command_id = p_command_id), 0)
   where ci.command_id = p_command_id;

  select count(*) into v_pending
    from public.command_items
   where command_id = p_command_id
     and coalesce(delivered_quantity, 0)
         < greatest(0, quantity - coalesce(cancelled_quantity, 0)) - 0.0001;

  update public.commands
     set status = case when v_pending = 0 then 'finalised'::public.command_status
                       else 'pending'::public.command_status end,
         updated_at = now()
   where id = p_command_id and status <> 'cancelled';
end;
$fn$;


-- ============================================================================
-- 05. update_command() — MODIFIER UNE COMMANDE, EN ENTIER
-- ----------------------------------------------------------------------------
--  PROBLEME CORRIGE : l'ecran de modification n'ecrivait que quelques colonnes
--  de l'en-tete. La TVA, l'ACOMPTE, le n° de bon, l'adresse, le chauffeur et
--  surtout les LIGNES repartaient inchanges — « je modifie et rien ne change ».
--
--  Cette fonction ecrit TOUT :
--   · l'en-tete (client, dates, TVA, acompte, n° de bon, notes, adresse) ;
--   · les LIGNES, en conservant ce qui a deja ete livre : une ligne deja
--     servie ne peut pas descendre sous la quantite remise, et une ligne qui
--     porte des livraisons n'est jamais supprimee ;
--   · l'ecriture de caisse de l'acompte, ajustee a la difference ;
--   · les totaux, le reste du et les factures de vente des bons de livraison.
--
--  Elle renvoie { id, lines_replaced } — `lines_replaced = false` signale que
--  des lignes ont ete conservees parce qu'elles etaient deja livrees.
-- ============================================================================

create or replace function public.update_command(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd       public.commands;
  v_item      jsonb;
  v_line_id   uuid;
  v_kept      boolean := true;
  v_seen      uuid[]  := '{}';
  v_pos       int     := 0;
  v_adv_old   numeric;
  v_adv_new   numeric;
  v_delivered numeric;
  r           record;
begin
  if not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier une commande';
  end if;

  select * into v_cmd from public.commands where id = p_id;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  v_adv_old := coalesce(v_cmd.advance_paid, 0);
  v_adv_new := case when p_payload ? 'advance_paid'
                    then greatest(0, coalesce((p_payload ->> 'advance_paid')::numeric, 0))
                    else v_adv_old end;

  -- ---------------------------------------------------------- l'en-tete ----
  update public.commands
     set client_id      = coalesce(nullif(p_payload ->> 'client_id', '')::uuid, client_id),
         client_name    = coalesce(nullif(p_payload ->> 'client_name', ''), client_name),
         client_phone   = case when p_payload ? 'client_phone'
                               then nullif(btrim(coalesce(p_payload ->> 'client_phone', '')), '')
                               else client_phone end,
         client_address = case when p_payload ? 'client_address'
                               then nullif(btrim(coalesce(p_payload ->> 'client_address', '')), '')
                               else client_address end,
         driver_name    = case when p_payload ? 'driver_name'
                               then nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '')
                               else driver_name end,
         driver_plate   = case when p_payload ? 'driver_plate'
                               then nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '')
                               else driver_plate end,
         bon_number     = case when p_payload ? 'bon_number'
                               then nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '')
                               else bon_number end,
         receive_date   = coalesce(nullif(p_payload ->> 'receive_date', '')::date, receive_date),
         receive_hour   = coalesce(nullif(p_payload ->> 'receive_hour', ''), receive_hour),
         receive_minute = coalesce(nullif(p_payload ->> 'receive_minute', ''), receive_minute),
         notes          = case when p_payload ? 'notes'
                               then coalesce(p_payload ->> 'notes', '')
                               else notes end,
         tva_enabled    = case when p_payload ? 'tva_enabled'
                               then coalesce((p_payload ->> 'tva_enabled')::boolean, tva_enabled)
                               else tva_enabled end,
         tva_rate       = case when p_payload ? 'tva_rate'
                               then coalesce((p_payload ->> 'tva_rate')::numeric, tva_rate)
                               else tva_rate end,
         is_historical  = case when p_payload ? 'is_historical'
                               then coalesce((p_payload ->> 'is_historical')::boolean, is_historical)
                               else is_historical end,
         advance_paid   = v_adv_new,
         created_at     = coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, created_at),
         updated_at     = now()
   where id = p_id;

  -- ------------------------------------------------------------ lignes ----
  if p_payload ? 'items' then
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
      v_line_id := nullif(v_item ->> 'id', '')::uuid;

      if v_line_id is not null
         and exists (select 1 from public.command_items where id = v_line_id and command_id = p_id) then
        -- Ligne existante : on ne descend JAMAIS sous ce qui a deja ete remis.
        select coalesce(delivered_quantity, 0) into v_delivered
          from public.command_items where id = v_line_id;

        update public.command_items
           set product_name    = coalesce(v_item ->> 'product_name', product_name),
               product_id      = nullif(v_item ->> 'product_id', '')::uuid,
               fiche_technic_id= nullif(v_item ->> 'fiche_technic_id', '')::uuid,
               quantity        = greatest(coalesce((v_item ->> 'quantity')::numeric, quantity), v_delivered),
               unit_price      = coalesce((v_item ->> 'unit_price')::numeric, unit_price),
               sell_by_unit    = coalesce((v_item ->> 'sell_by_unit')::boolean, sell_by_unit),
               sell_unit       = v_item ->> 'sell_unit',
               position        = coalesce((v_item ->> 'position')::int, v_pos)
         where id = v_line_id;

        if coalesce((v_item ->> 'quantity')::numeric, 0) < v_delivered - 0.0001 then
          v_kept := false;   -- quantite ramenee au minimum livre
        end if;
        v_seen := v_seen || v_line_id;
      else
        -- Nouvelle ligne (y compris un DOUBLON volontaire du meme produit).
        insert into public.command_items (
          command_id, position, product_id, fiche_technic_id, product_name,
          quantity, unit_price, total_price, sell_by_unit, sell_unit
        )
        values (
          p_id,
          coalesce((v_item ->> 'position')::int, v_pos),
          nullif(v_item ->> 'product_id', '')::uuid,
          nullif(v_item ->> 'fiche_technic_id', '')::uuid,
          coalesce(v_item ->> 'product_name', 'Produit'),
          coalesce((v_item ->> 'quantity')::numeric, 0),
          coalesce((v_item ->> 'unit_price')::numeric, 0),
          coalesce((v_item ->> 'total_price')::numeric, 0),
          coalesce((v_item ->> 'sell_by_unit')::boolean, false),
          v_item ->> 'sell_unit'
        )
        returning id into v_line_id;
        v_seen := v_seen || v_line_id;
      end if;

      v_pos := v_pos + 1;
    end loop;

    -- Les lignes retirees de l'ecran disparaissent — SAUF si elles portent
    -- deja une livraison : la marchandise est partie, la ligne doit rester.
    for r in
      select id, coalesce(delivered_quantity, 0) as delivered
        from public.command_items
       where command_id = p_id and not (id = any(v_seen))
    loop
      if r.delivered > 0.0001
         or exists (select 1 from public.command_delivery_items where command_item_id = r.id) then
        v_kept := false;
      else
        delete from public.command_items where id = r.id;
      end if;
    end loop;
  end if;

  -- --------------------------------------------- totaux, caisse, ventes ----
  -- Le total envoye par l'ecran fait foi : il peut avoir ete AJUSTE A LA
  -- MAIN. Sans `total_amount` dans le payload, il est recalcule des lignes.
  perform public.recompute_command_amounts(
    p_id,
    case when p_payload ? 'total_amount'
         then (p_payload ->> 'total_amount')::numeric else null end
  );
  perform public.recompute_command_delivery(p_id);

  select * into v_cmd from public.commands where id = p_id;

  -- L'ACOMPTE A CHANGE : l'ecriture de caisse suit (jamais pour une ancienne
  -- commande, dont l'argent a circule hors du logiciel).
  if v_adv_new is distinct from v_adv_old and not coalesce(v_cmd.is_historical, false) then
    delete from public.caisse_transactions
     where ref_table = 'commands' and ref_id = p_id;
    if v_adv_new > 0 then
      insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
      values ('deposit', v_adv_new, v_cmd.created_at::date,
              'Acompte commande ' || v_cmd.reference, 'Commande', 'commands', p_id)
      on conflict (ref_table, ref_id) do nothing;
    end if;
  end if;

  -- Les bons de livraison sont revalorises au nouveau prix unitaire, puis
  -- leurs factures de vente sont reconstruites.
  for r in select id from public.command_deliveries where command_id = p_id order by delivered_at loop
    perform public.apply_delivery_sale(r.id);
  end loop;

  perform public.settle_command_deliveries(p_id);
  perform public.recompute_command_payments(p_id);
  perform public.log_activity('clients', 'update', 'commands', p_id, p_payload);

  return jsonb_build_object('id', p_id, 'lines_replaced', v_kept);
end;
$fn$;


-- ============================================================================
-- 06. cancel_command_remainder() — ANNULER LE RESTE NON LIVRE
-- ----------------------------------------------------------------------------
--  Le client a commande 100 unites, il s'arrete a 70 et renonce au solde.
--  Chaque ligne choisie voit sa quantite ANNULEE augmenter ; le total de la
--  commande, sa TVA, son TTC et son reste du sont recalcules, la commande
--  passe en « livree » et l'operation est archivee.
-- ============================================================================

create or replace function public.cancel_command_remainder(p_payload jsonb)
returns public.command_adjustments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd   public.commands;
  v_adj   public.command_adjustments;
  v_line  jsonb;
  v_item  public.command_items;
  v_qty   numeric;
  v_left  numeric;
  v_price numeric;
begin
  if not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier une commande';
  end if;

  select * into v_cmd from public.commands where id = (p_payload ->> 'command_id')::uuid;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  insert into public.command_adjustments (
    command_id, command_reference, client_id, client_name, type, date, reason
  )
  values (
    v_cmd.id, v_cmd.reference, v_cmd.client_id, v_cmd.client_name, 'cancel',
    coalesce(nullif(p_payload ->> 'date', '')::date, current_date),
    coalesce(p_payload ->> 'reason', '')
  )
  returning * into v_adj;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb)) loop
    v_qty := greatest(0, coalesce((v_line ->> 'quantity')::numeric, 0));
    continue when v_qty <= 0;

    -- Une variable RECORD garde la valeur de l'iteration precedente quand la
    -- recherche ne ramene rien : on la vide avant chaque ligne, sinon la
    -- ligne suivante serait imputee au produit precedent.
    v_item := null;
    select * into v_item
      from public.command_items
     where command_id = v_cmd.id
       and (id = nullif(v_line ->> 'command_item_id', '')::uuid
            or (nullif(v_line ->> 'command_item_id', '') is null
                and product_name = (v_line ->> 'product_name')))
     order by (id = nullif(v_line ->> 'command_item_id', '')::uuid) desc
     limit 1;
    continue when v_item.id is null;

    -- On n'annule jamais plus que ce qui reste a livrer.
    v_left := greatest(0, v_item.quantity
                          - coalesce(v_item.delivered_quantity, 0)
                          - coalesce(v_item.cancelled_quantity, 0));
    v_qty := least(v_qty, v_left);
    continue when v_qty <= 0;

    v_price := coalesce(v_item.unit_price, 0);

    update public.command_items
       set cancelled_quantity = coalesce(cancelled_quantity, 0) + v_qty
     where id = v_item.id;

    insert into public.command_adjustment_lines (
      adjustment_id, command_item_id, product_name, quantity, unit_price, amount, unit
    )
    values (v_adj.id, v_item.id, v_item.product_name, v_qty, v_price,
            round(v_qty * v_price, 2), v_item.sell_unit);
  end loop;

  update public.command_adjustments a
     set total_quantity = coalesce((select sum(quantity) from public.command_adjustment_lines where adjustment_id = a.id), 0),
         total_amount   = coalesce((select sum(amount)   from public.command_adjustment_lines where adjustment_id = a.id), 0)
   where a.id = v_adj.id;

  select * into v_adj from public.command_adjustments where id = v_adj.id;

  -- Le total de la commande BAISSE de la valeur annulee : le reste du, la TVA
  -- et le TTC suivent, et la dette correspondante disparait de la fiche du
  -- client, de la caisse et des rapports.
  perform public.shift_command_total(v_cmd.id, -coalesce(v_adj.total_amount, 0));
  perform public.recompute_command_delivery(v_cmd.id);
  perform public.settle_command_deliveries(v_cmd.id);
  perform public.recompute_command_payments(v_cmd.id);
  perform public.log_activity('clients', 'cancel_remainder', 'command_adjustments', v_adj.id, p_payload);

  select * into v_adj from public.command_adjustments where id = v_adj.id;
  return v_adj;
end;
$fn$;


-- ============================================================================
-- 07. increase_command() — LE CLIENT EN REDEMANDE
-- ----------------------------------------------------------------------------
--  Plutot que de creer une deuxieme commande, la quantite de chaque ligne
--  choisie augmente. Le total, la TVA, le TTC et le reste du suivent.
-- ============================================================================

create or replace function public.increase_command(p_payload jsonb)
returns public.command_adjustments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd   public.commands;
  v_adj   public.command_adjustments;
  v_line  jsonb;
  v_item  public.command_items;
  v_qty   numeric;
  v_price numeric;
begin
  if not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier une commande';
  end if;

  select * into v_cmd from public.commands where id = (p_payload ->> 'command_id')::uuid;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  insert into public.command_adjustments (
    command_id, command_reference, client_id, client_name, type, date, reason
  )
  values (
    v_cmd.id, v_cmd.reference, v_cmd.client_id, v_cmd.client_name, 'increase',
    coalesce(nullif(p_payload ->> 'date', '')::date, current_date),
    coalesce(p_payload ->> 'reason', '')
  )
  returning * into v_adj;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb)) loop
    v_qty := greatest(0, coalesce((v_line ->> 'quantity')::numeric, 0));
    continue when v_qty <= 0;

    -- Une variable RECORD garde la valeur de l'iteration precedente quand la
    -- recherche ne ramene rien : on la vide avant chaque ligne, sinon la
    -- ligne suivante serait imputee au produit precedent.
    v_item := null;
    select * into v_item
      from public.command_items
     where command_id = v_cmd.id
       and (id = nullif(v_line ->> 'command_item_id', '')::uuid
            or (nullif(v_line ->> 'command_item_id', '') is null
                and product_name = (v_line ->> 'product_name')))
     order by (id = nullif(v_line ->> 'command_item_id', '')::uuid) desc
     limit 1;

    if v_item.id is null then
      -- Produit absent de la commande : on lui cree une ligne.
      v_price := greatest(0, coalesce((v_line ->> 'unit_price')::numeric, 0));
      insert into public.command_items (
        command_id, position, product_name, quantity, unit_price, total_price, sell_unit
      )
      values (
        v_cmd.id,
        coalesce((select max(position) + 1 from public.command_items where command_id = v_cmd.id), 0),
        coalesce(v_line ->> 'product_name', 'Produit'),
        v_qty, v_price, round(v_qty * v_price, 2), v_line ->> 'unit'
      )
      returning * into v_item;
    else
      v_price := coalesce(v_item.unit_price, 0);
      update public.command_items
         set quantity = coalesce(quantity, 0) + v_qty
       where id = v_item.id;
    end if;

    insert into public.command_adjustment_lines (
      adjustment_id, command_item_id, product_name, quantity, unit_price, amount, unit
    )
    values (v_adj.id, v_item.id, v_item.product_name, v_qty, v_price,
            round(v_qty * v_price, 2), v_item.sell_unit);
  end loop;

  update public.command_adjustments a
     set total_quantity = coalesce((select sum(quantity) from public.command_adjustment_lines where adjustment_id = a.id), 0),
         total_amount   = coalesce((select sum(amount)   from public.command_adjustment_lines where adjustment_id = a.id), 0)
   where a.id = v_adj.id;

  select * into v_adj from public.command_adjustments where id = v_adj.id;

  -- Le total de la commande AUGMENTE de la valeur ajoutee.
  perform public.shift_command_total(v_cmd.id, coalesce(v_adj.total_amount, 0));
  perform public.recompute_command_delivery(v_cmd.id);
  perform public.settle_command_deliveries(v_cmd.id);
  perform public.recompute_command_payments(v_cmd.id);
  perform public.log_activity('clients', 'increase', 'command_adjustments', v_adj.id, p_payload);

  select * into v_adj from public.command_adjustments where id = v_adj.id;
  return v_adj;
end;
$fn$;


-- ============================================================================
-- 08. delete_command_adjustment() — REVENIR EN ARRIERE
-- ============================================================================

create or replace function public.delete_command_adjustment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_adj  public.command_adjustments;
  v_line record;
begin
  select * into v_adj from public.command_adjustments where id = p_id;
  if v_adj.id is null then return; end if;

  for v_line in select * from public.command_adjustment_lines where adjustment_id = p_id loop
    if v_adj.type = 'cancel' then
      update public.command_items
         set cancelled_quantity = greatest(0, coalesce(cancelled_quantity, 0) - v_line.quantity)
       where id = v_line.command_item_id;
    else
      update public.command_items
         set quantity = greatest(coalesce(delivered_quantity, 0), coalesce(quantity, 0) - v_line.quantity)
       where id = v_line.command_item_id;
    end if;
  end loop;

  delete from public.command_adjustments where id = p_id;

  -- On rend a la commande ce que l'operation lui avait retire (annulation),
  -- ou on lui retire ce qu'elle lui avait ajoute (augmentation).
  perform public.shift_command_total(
    v_adj.command_id,
    case when v_adj.type = 'cancel' then coalesce(v_adj.total_amount, 0)
         else -coalesce(v_adj.total_amount, 0) end
  );
  perform public.recompute_command_delivery(v_adj.command_id);
  perform public.settle_command_deliveries(v_adj.command_id);
  perform public.recompute_command_payments(v_adj.command_id);
end;
$fn$;


-- ============================================================================
-- 09. create_command() — LA LIGNE GARDE SON RANG
-- ----------------------------------------------------------------------------
--  Reprend la derniere version et ajoute `position`, indispensable pour porter
--  plusieurs fois le meme produit.
-- ============================================================================

create or replace function public.create_command(p_payload jsonb)
returns public.commands
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd     public.commands;
  v_item    jsonb;
  v_ref     text;
  v_seq     int;
  v_year    text;
  v_advance numeric := greatest(0, coalesce((p_payload ->> 'advance_paid')::numeric, 0));
  v_created timestamptz := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());
  v_hist    boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_addr    text := nullif(btrim(coalesce(p_payload ->> 'client_address', '')), '');
  v_client  uuid := nullif(p_payload ->> 'client_id', '')::uuid;
  v_tva_on  boolean := coalesce((p_payload ->> 'tva_enabled')::boolean, false);
  v_tva     numeric := coalesce((p_payload ->> 'tva_rate')::numeric, 0);
  v_pos     int := 0;
begin
  if not public.has_perm('clients', 'create') then
    raise exception 'Vous n''avez pas la permission de creer une commande';
  end if;

  v_year := to_char(v_created, 'YYYY');
  select coalesce(count(*), 0) + 1 into v_seq from public.commands;
  v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.commands where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  insert into public.commands (
    reference, client_id, client_name, client_phone, client_address,
    driver_name, driver_plate, receive_date, receive_hour, receive_minute,
    total_amount, tva_enabled, tva_rate, advance_paid, extra_paid, paid_amount,
    notes, bon_number, is_historical, status, created_by, created_at
  )
  values (
    v_ref, v_client,
    coalesce(p_payload ->> 'client_name', 'Client'),
    nullif(btrim(coalesce(p_payload ->> 'client_phone', '')), ''),
    v_addr,
    nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), ''),
    nullif(p_payload ->> 'receive_date', '')::date,
    coalesce(p_payload ->> 'receive_hour', '00'),
    coalesce(p_payload ->> 'receive_minute', '00'),
    coalesce((p_payload ->> 'total_amount')::numeric, 0),
    v_tva_on, case when v_tva_on then coalesce(nullif(v_tva, 0), 19) else 0 end,
    v_advance, 0, v_advance,
    coalesce(p_payload ->> 'notes', ''),
    nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), ''),
    v_hist, 'pending'::public.command_status,
    public.current_username(), v_created
  )
  returning * into v_cmd;

  -- l'adresse saisie devient l'adresse de reference du client
  if v_client is not null and v_addr is not null then
    update public.clients
       set address = v_addr, updated_at = now()
     where id = v_client and coalesce(nullif(btrim(address), ''), '') is distinct from v_addr;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    insert into public.command_items (
      command_id, position, product_id, fiche_technic_id, product_name,
      quantity, unit_price, total_price, sell_by_unit, sell_unit
    )
    values (
      v_cmd.id,
      coalesce((v_item ->> 'position')::int, v_pos),
      nullif(v_item ->> 'product_id', '')::uuid,
      nullif(v_item ->> 'fiche_technic_id', '')::uuid,
      coalesce(v_item ->> 'product_name', 'Produit'),
      coalesce((v_item ->> 'quantity')::numeric, 0),
      coalesce((v_item ->> 'unit_price')::numeric, 0),
      coalesce((v_item ->> 'total_price')::numeric, 0),
      coalesce((v_item ->> 'sell_by_unit')::boolean, false),
      v_item ->> 'sell_unit'
    );
    v_pos := v_pos + 1;
  end loop;

  -- L'acompte d'une ANCIENNE commande a ete encaisse dans le passe, hors du
  -- logiciel : il ne doit surtout pas gonfler la caisse d'aujourd'hui.
  if v_advance > 0 and not v_hist then
    insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
    values ('deposit', v_advance, v_created::date,
            'Acompte commande ' || v_ref, 'Commande', 'commands', v_cmd.id)
    on conflict (ref_table, ref_id) do nothing;
  end if;

  select * into v_cmd from public.commands where id = v_cmd.id;
  return v_cmd;
end;
$fn$;


-- ============================================================================
-- 10. settle_command_deliveries() — LA VENTE D'UNE COMMANDE PAYEE N'EST PLUS
--     UNE DETTE
-- ----------------------------------------------------------------------------
--  LE BUG CORRIGE ICI
--  ------------------
--  Le client — souvent un CLIENT PASSAGER — regle sa commande d'avance, ou la
--  paie depuis l'ecran « Commandes ». Cet argent restait sur la COMMANDE :
--  le bon de livraison naissait avec « acompte impute = 0 », la facture de
--  vente qu'il engendre naissait donc NON PAYEE.
--
--  Resultat : dans /ventes toutes ces factures s'affichaient en DETTE alors
--  que le client n'avait plus rien a devoir, la caisse et les rapports
--  comptaient une dette imaginaire.
--
--  Cette fonction repartit l'argent ENCORE DISPONIBLE sur la commande
--  (acompte + reglements) entre ses bons de livraison non soldes, du plus
--  ancien au plus recent, puis reconstruit leurs factures. Aucune ecriture de
--  caisse n'est creee : l'argent y est deja entre.
-- ============================================================================

create or replace function public.settle_command_deliveries(p_command_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_left numeric;
  r      record;
  v_take numeric;
begin
  if p_command_id is null then return; end if;

  for r in
    select d.id, coalesce(d.total_ttc, 0) as ttc,
           coalesce(d.advance_applied, 0) as adv,
           coalesce(d.cash_paid, 0) as cash
      from public.command_deliveries d
     where d.command_id = p_command_id
     order by d.delivered_at, d.created_at
  loop
    -- argent encore disponible sur la commande, ce bon exclu
    v_left := public.command_advance_available(p_command_id, r.id);
    exit when v_left <= 0;

    v_take := least(v_left, greatest(0, r.ttc - r.cash));
    if v_take <> r.adv then
      update public.command_deliveries
         set advance_applied = v_take, updated_at = now()
       where id = r.id;
      perform public.apply_delivery_sale(r.id);
    end if;
  end loop;

  perform public.recompute_command_payments(p_command_id);
end;
$fn$;

comment on function public.settle_command_deliveries(uuid) is
  'Impute l''argent deja verse sur une commande (acompte + reglements) sur ses bons de livraison non soldes, pour que les factures de /ventes ne restent pas affichees en dette.';


-- ============================================================================
-- 11. create_command_delivery() / pay_command() — SOLDER AUSSITOT
-- ----------------------------------------------------------------------------
--  · A la creation d'un bon, si l'ecran n'a pas precise l'acompte a imputer,
--    on impute d'office tout ce qui est disponible.
--  · Apres un reglement saisi sur la commande, l'argent descend aussitot sur
--    les bons non soldes : la facture passe a « payee » dans /ventes.
-- ============================================================================

create or replace function public.create_command_delivery(p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del      public.command_deliveries;
  v_cmd      public.commands;
  v_item     jsonb;
  v_ref      text;
  v_seq      int;
  v_driver   text := nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '');
  v_plate    text := nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '');
  v_loc      text := nullif(btrim(coalesce(p_payload ->> 'location', '')), '');
  v_tva_on   boolean;
  v_tva_rate numeric;
  v_cash     numeric := greatest(0, coalesce((p_payload ->> 'cash_paid')::numeric, 0));
  v_adv      numeric;
begin
  if not public.has_perm('clients', 'edit') and not public.has_perm('clients', 'create') then
    raise exception 'Vous n''avez pas la permission de livrer une commande';
  end if;

  select * into v_cmd from public.commands where id = (p_payload ->> 'command_id')::uuid;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  v_driver := coalesce(v_driver, nullif(btrim(coalesce(v_cmd.driver_name, '')), ''));
  v_plate  := coalesce(v_plate,  nullif(btrim(coalesce(v_cmd.driver_plate, '')), ''));
  v_loc    := coalesce(v_loc,    nullif(btrim(coalesce(v_cmd.client_address, '')), ''));

  v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_cmd.tva_enabled, false));
  v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric,
                         nullif(coalesce(v_cmd.tva_rate, 0), 0), 19);
  if not v_tva_on then v_tva_rate := 0; end if;

  -- Acompte a imputer : celui demande par l'ecran, sinon TOUT ce qui reste
  -- disponible sur la commande (c'est la correction du bug « facture payee
  -- affichee en dette »).
  if p_payload ? 'advance_applied' and (p_payload ->> 'advance_applied') is not null then
    v_adv := greatest(0, coalesce((p_payload ->> 'advance_applied')::numeric, 0));
  else
    v_adv := public.command_advance_available(v_cmd.id, null);
  end if;
  v_adv := least(v_adv, public.command_advance_available(v_cmd.id, null));

  select count(*) + 1 into v_seq from public.command_deliveries where command_id = v_cmd.id;
  v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  while exists (select 1 from public.command_deliveries where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  end loop;

  insert into public.command_deliveries (command_id, reference, date, delivered_at, notes,
                                         driver_name, driver_plate, location, is_historical,
                                         tva_enabled, tva_rate, advance_applied, cash_paid)
  values (v_cmd.id, v_ref,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now())::date,
          coalesce((p_payload ->> 'delivered_at')::timestamptz, now()),
          coalesce(p_payload ->> 'notes', ''),
          v_driver, v_plate, v_loc, coalesce(v_cmd.is_historical, false),
          v_tva_on, v_tva_rate, v_adv, v_cash)
  returning * into v_del;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
      insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
      values (v_del.id,
              nullif(v_item ->> 'command_item_id', '')::uuid,
              coalesce(v_item ->> 'product_name', 'Produit'),
              coalesce((v_item ->> 'quantity')::numeric, 0),
              v_item ->> 'sell_unit');
    end if;
  end loop;

  if not coalesce(v_cmd.is_historical, false) then
    perform public.apply_command_delivery_stock(v_del.id);
  end if;

  perform public.apply_delivery_sale(v_del.id);
  perform public.recompute_command_delivery(v_cmd.id);
  perform public.settle_command_deliveries(v_cmd.id);
  perform public.log_activity('clients', 'deliver', 'command_deliveries', v_del.id, p_payload);

  select * into v_del from public.command_deliveries where id = v_del.id;
  return v_del;
end;
$fn$;


create or replace function public.pay_command(
  p_command_id uuid, p_amount numeric, p_date date default current_date
) returns public.commands
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd public.commands;
  v_amt numeric := greatest(0, coalesce(p_amount, 0));
begin
  select * into v_cmd from public.commands where id = p_command_id;
  if v_cmd.id is null then
    raise exception 'Commande introuvable (%)', p_command_id;
  end if;

  v_amt := least(v_amt, greatest(0, coalesce(v_cmd.total_ttc, v_cmd.total_amount)
                                  - coalesce(v_cmd.paid_amount, 0)));
  if v_amt <= 0 then return v_cmd; end if;

  update public.commands
     set extra_paid = coalesce(extra_paid, 0) + v_amt,
         updated_at = now()
   where id = p_command_id;

  perform public.recompute_command_payments(p_command_id);

  -- l'argent d'une ancienne commande a circule hors du logiciel
  if not coalesce(v_cmd.is_historical, false) then
    insert into public.caisse_transactions (type, amount, date, description, category_name)
    values ('deposit', v_amt, coalesce(p_date, current_date),
            'Règlement commande ' || v_cmd.reference, 'Commande');
  end if;

  -- LE REGLEMENT DESCEND AUSSITOT SUR LES BONS DE LIVRAISON : les factures
  -- de /ventes passent a « payee » au lieu de rester affichees en dette.
  perform public.settle_command_deliveries(p_command_id);

  select * into v_cmd from public.commands where id = p_command_id;
  return v_cmd;
end;
$fn$;


-- ============================================================================
-- 12. LES VERSEMENTS FANTOMES
-- ----------------------------------------------------------------------------
--  LE BUG CORRIGE ICI
--  ------------------
--  « Je supprime un versement du client, puis j'imprime le compte rendu : le
--    versement supprime y est toujours compte, mais je ne le retrouve nulle
--    part dans son historique. »
--
--  Deux causes, corrigees ensemble :
--
--   1. LES DETTES ORPHELINES. Chaque bon de livraison non solde creait une
--      dette « Reste livraison BL-… ». Quand le bon (ou sa facture, ou la
--      commande) disparaissait, la dette restait — avec ses versements, qui
--      continuaient d'alimenter le compte rendu. On les supprime, et un
--      declencheur empeche desormais qu'elles se reforment.
--
--   2. L'ECRITURE DE CAISSE d'un versement supprime. `delete_client_payment`
--      et `delete_client_debt_versement` effacent maintenant TOUJOURS
--      l'ecriture de caisse correspondante.
--
--  Cote application, l'historique du client, le compte rendu affiche et le
--  compte rendu imprime lisent desormais LA MEME liste de versements : ce qui
--  est visible est ce qui est compte.
-- ============================================================================

-- 12.1  Les dettes de livraison orphelines partent, versements compris.
delete from public.client_debt_versements v
 using public.client_debts d
 where v.debt_id = d.id
   and d.description like 'Reste livraison %'
   and not exists (
     select 1 from public.command_deliveries cd
      where 'Reste livraison ' || cd.reference = d.description);

delete from public.caisse_transactions
 where ref_table = 'client_debt_versements'
   and ref_id not in (select id from public.client_debt_versements);

delete from public.client_debts d
 where d.description like 'Reste livraison %'
   and not exists (
     select 1 from public.command_deliveries cd
      where 'Reste livraison ' || cd.reference = d.description);

-- 12.2  Un versement supprime emporte TOUJOURS son ecriture de caisse.
create or replace function public.delete_client_debt_versement(p_versement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_vers public.client_debt_versements;
begin
  select * into v_vers from public.client_debt_versements where id = p_versement_id;
  if v_vers.id is null then return; end if;

  update public.client_debts
     set total_paid  = greatest(0, coalesce(total_paid, 0) - v_vers.amount),
         rest_amount = greatest(0, coalesce(total_debt, 0)
                                   - greatest(0, coalesce(total_paid, 0) - v_vers.amount)),
         updated_at  = now()
   where id = v_vers.debt_id;

  delete from public.caisse_transactions
   where ref_table = 'client_debt_versements' and ref_id = p_versement_id;

  delete from public.client_debt_versements where id = p_versement_id;
end;
$fn$;

-- 12.3  Supprimer une dette enregistree emporte ses versements ET leur caisse.
create or replace function public.trg_client_debt_delete_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  delete from public.caisse_transactions
   where ref_table = 'client_debt_versements'
     and ref_id in (select id from public.client_debt_versements where debt_id = old.id);
  delete from public.client_debt_versements where debt_id = old.id;
  return old;
end;
$fn$;

drop trigger if exists trg_client_debts_cleanup on public.client_debts;
create trigger trg_client_debts_cleanup
  before delete on public.client_debts
  for each row execute function public.trg_client_debt_delete_cleanup();

-- 12.4  Supprimer un bon de livraison emporte sa dette « Reste livraison … ».
create or replace function public.trg_delivery_delete_debt()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  delete from public.client_debts
   where description = 'Reste livraison ' || coalesce(old.reference, '');
  return old;
end;
$fn$;

drop trigger if exists trg_command_deliveries_debt on public.command_deliveries;
create trigger trg_command_deliveries_debt
  before delete on public.command_deliveries
  for each row execute function public.trg_delivery_delete_debt();


-- ============================================================================
-- 13. DROITS, RLS ET TEMPS REEL
-- ============================================================================

alter table public.command_adjustments       enable row level security;
alter table public.command_adjustment_lines  enable row level security;

drop policy if exists command_adjustments_sel on public.command_adjustments;
drop policy if exists command_adjustments_ins on public.command_adjustments;
drop policy if exists command_adjustments_upd on public.command_adjustments;
drop policy if exists command_adjustments_del on public.command_adjustments;

create policy command_adjustments_sel on public.command_adjustments
  for select to authenticated using (public.has_perm('clients', 'view'));
create policy command_adjustments_ins on public.command_adjustments
  for insert to authenticated with check (public.has_perm('clients', 'create'));
create policy command_adjustments_upd on public.command_adjustments
  for update to authenticated using (public.has_perm('clients', 'edit'))
  with check (public.has_perm('clients', 'edit'));
create policy command_adjustments_del on public.command_adjustments
  for delete to authenticated using (public.has_perm('clients', 'delete'));

drop policy if exists command_adjustment_lines_sel on public.command_adjustment_lines;
drop policy if exists command_adjustment_lines_ins on public.command_adjustment_lines;
drop policy if exists command_adjustment_lines_upd on public.command_adjustment_lines;
drop policy if exists command_adjustment_lines_del on public.command_adjustment_lines;

create policy command_adjustment_lines_sel on public.command_adjustment_lines
  for select to authenticated using (public.has_perm('clients', 'view'));
create policy command_adjustment_lines_ins on public.command_adjustment_lines
  for insert to authenticated with check (public.has_perm('clients', 'create'));
create policy command_adjustment_lines_upd on public.command_adjustment_lines
  for update to authenticated using (public.has_perm('clients', 'edit'))
  with check (public.has_perm('clients', 'edit'));
create policy command_adjustment_lines_del on public.command_adjustment_lines
  for delete to authenticated using (public.has_perm('clients', 'delete'));

grant select, insert, update, delete on public.command_adjustments      to authenticated;
grant select, insert, update, delete on public.command_adjustment_lines to authenticated;

grant execute on function public.update_command(uuid, jsonb)            to authenticated, service_role;
grant execute on function public.cancel_command_remainder(jsonb)        to authenticated, service_role;
grant execute on function public.increase_command(jsonb)                to authenticated, service_role;
grant execute on function public.delete_command_adjustment(uuid)        to authenticated, service_role;
grant execute on function public.recompute_command_amounts(uuid, numeric) to authenticated, service_role;
grant execute on function public.shift_command_total(uuid, numeric)     to authenticated, service_role;
grant execute on function public.recompute_command_delivery(uuid)       to authenticated, service_role;
grant execute on function public.settle_command_deliveries(uuid)        to authenticated, service_role;
grant execute on function public.create_command(jsonb)                  to authenticated, service_role;
grant execute on function public.create_command_delivery(jsonb)         to authenticated, service_role;
grant execute on function public.pay_command(uuid, numeric, date)       to authenticated, service_role;
grant execute on function public.delete_client_debt_versement(uuid)     to authenticated, service_role;

do $$
begin
  begin
    alter publication supabase_realtime add table public.command_adjustments;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.command_adjustment_lines;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;


-- ============================================================================
-- 14. REPRISE DES DONNEES EXISTANTES
-- ----------------------------------------------------------------------------
--  Toutes les commandes deja enregistrees sont repassees en revue :
--   · leurs totaux sont recalcules depuis leurs lignes ;
--   · l'argent deja verse est impute sur leurs bons de livraison — c'est CE
--     PASSAGE qui fait disparaitre les fausses dettes de /ventes ;
--   · leurs factures de vente sont reconstruites en consequence.
-- ============================================================================

do $$
declare r record;
begin
  for r in select id from public.commands order by created_at loop
    -- `shift_command_total(..., 0)` rafraichit les lignes SANS toucher au
    -- total, qui a pu etre ajuste a la main par l'operateur.
    perform public.shift_command_total(r.id, 0);
    perform public.recompute_command_delivery(r.id);
    perform public.settle_command_deliveries(r.id);
    perform public.recompute_command_payments(r.id);
  end loop;
end $$;


-- ============================================================================
-- 15. VUES DE CONTROLE
-- ============================================================================

drop view if exists public.v_command_adjustments;
create view public.v_command_adjustments as
select a.id,
       a.date,
       a.type,
       a.command_reference,
       a.client_name,
       a.total_quantity,
       a.total_amount,
       a.reason,
       a.created_by,
       a.created_at
  from public.command_adjustments a
 order by a.date desc, a.created_at desc;

grant select on public.v_command_adjustments to authenticated, service_role;

/** Controle du bug « facture payee affichee en dette ». Cette vue doit rester
 *  VIDE : elle liste les ventes issues d'un bon de livraison qui affichent une
 *  dette alors que leur commande a deja encaisse de quoi la couvrir. */
drop view if exists public.v_ventes_dette_suspecte;
create view public.v_ventes_dette_suspecte as
select s.reference        as facture,
       c.reference        as commande,
       c.client_name,
       s.final_amount,
       s.paid_amount,
       s.rest_amount,
       public.command_advance_available(c.id, null) as argent_disponible_commande
  from public.sales s
  join public.commands c on c.id = s.command_id
 where s.delivery_id is not null
   and s.rest_amount > 0
   and public.command_advance_available(c.id, null) > 0;

grant select on public.v_ventes_dette_suspecte to authenticated, service_role;

commit;

-- ============================================================================
--  FIN — MISE A JOUR « HISTORIQUE, COMMANDES ET RAPPORTS »
-- ============================================================================

;


-- ===== altech_production_update_acomptes_comptes_rendus.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « ACOMPTES CLIENTS / FOURNISSEURS, COMPTES RENDUS ET CALCULS JUSTES »
-- ----------------------------------------------------------------------------
--  A EXECUTER EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est IDEMPOTENT : il peut etre relance sans risque.
--
--  PREREQUIS — toutes les mises a jour precedentes, et en dernier :
--    · altech_production_update_historique_commandes_rapports.sql
--
--  LES BUGS CORRIGES
--  -----------------
--  1. LE VERSEMENT EN TROP DISPARAISSAIT.
--     Un client doit 1 000 DA et verse 1 500 DA : pay_client() soldait la vente
--     puis versait les 500 DA restants sur le « reste » PERIME d'une commande
--     (ce reste compte deux fois la marchandise deja facturee par ses bons de
--     livraison). Aucune avance n'etait creee, et au premier recalcul de la
--     commande ou du bon, les 1 500 DA disparaissaient ENTIEREMENT de la fiche
--     du client — alors qu'ils etaient bien en caisse.
--     -> Le versement s'impute desormais : anciennes dettes, ventes (bons de
--        livraison compris), puis le RELIQUAT DEVIENT UN ACOMPTE du client
--        (clients.credit_amount). Idem pour les fournisseurs.
--
--  2. LES IMPUTATIONS ETAIENT EFFACEES.
--     La part d'un versement imputee sur la facture d'un bon de livraison etait
--     ecrasee par apply_delivery_sale(). Elle est maintenant memorisee dans
--     `sales.allocated_amount` (et `purchases.allocated_amount`) : aucun
--     recalcul ne peut plus la perdre.
--
--  3. LA CAISSE COMPTAIT DEUX FOIS.
--     Modifier une vente ou une facture d'achat deja reglee par un versement
--     recreait un reglement « en especes » du montant total : l'argent du
--     versement entrait (ou sortait) une deuxieme fois en caisse.
--
--  4. SUPPRIMER UN VERSEMENT POUVAIT « DEPAYER » UNE VENTE REGLEE EN CAISSE.
--     L'annulation d'imputation retirait l'argent de n'importe quelle vente ;
--     elle ne reprend plus que ce qui venait vraiment du compte du client.
--
--  5. SUPPRIMER UNE VENTE / UN ACHAT REGLE PAR VERSEMENT PERDAIT L'ARGENT.
--     Ce qui avait ete impute revient maintenant sur le compte du tiers et est
--     re-impute sur ses autres dettes (le reliquat reste en acompte).
--
--  6. LA MONNAIE RENDUE A LA CAISSE ETAIT COMPTEE COMME ENCAISSEE.
--     Un client qui donne 1 500 DA pour un ticket de 1 000 DA recoit 500 DA de
--     monnaie : la vente etait pourtant enregistree « payee 1 500 DA » et la
--     caisse gonflee de 500 DA. Les ventes concernees sont corrigees.
--
--  CE QUE LE SCRIPT AJOUTE
--  -----------------------
--    01. sales.allocated_amount, purchases.allocated_amount,
--        commands.credit_applied
--    02. command_payments — les reglements d'une commande, dates (compte rendu)
--    03. command_advance_available() / recompute_command_payments()
--    04. apply_delivery_sale() — conserve les imputations
--    05. allocate_ / deallocate_client_payment()
--    06. allocate_ / deallocate_supplier_payment()
--    07. ACOMPTE UTILISE A LA CREATION : apply_credit_to_sale(),
--        apply_credit_to_command(), apply_credit_to_purchase()
--    08. rebalance_party_credit() — impute l'acompte sur les dettes restantes
--    09. update_sale() / pay_sale_debt() / update_purchase() / pay_command()
--    10. Suppressions : l'argent impute revient sur le compte du tiers
--    11. Changement de client d'une commande : l'acompte suit le bon client
--    12. Vue v_party_balances (dette, acompte, solde net)
--    13. REPRISE DES DONNEES — tous les comptes clients / fournisseurs sont
--        reconstruits a partir de l'argent REELLEMENT recu / verse
--    14. Droits, RLS et temps reel
-- ============================================================================

begin;

-- ============================================================================
-- 01. COLONNES
-- ============================================================================

alter table public.sales
  add column if not exists allocated_amount numeric(14,2) not null default 0;
alter table public.purchases
  add column if not exists allocated_amount numeric(14,2) not null default 0;
alter table public.commands
  add column if not exists credit_applied numeric(14,2) not null default 0;

comment on column public.sales.allocated_amount is
  'Part du montant paye qui vient du COMPTE du client (versements, acompte) et non d''un encaissement porte par la facture. Elle ne genere aucune ecriture de caisse (le versement a deja la sienne).';
comment on column public.purchases.allocated_amount is
  'Part du montant regle qui vient du COMPTE du fournisseur (versements, trop-verse) — aucune ecriture de caisse propre.';
comment on column public.commands.credit_applied is
  'Acompte du client (avance) utilise comme acompte de la commande — deja en caisse, aucune nouvelle ecriture.';


-- ============================================================================
-- 02. REGLEMENTS D'UNE COMMANDE (bouton « Payer » de l'ecran Commandes)
-- ----------------------------------------------------------------------------
--  `commands.extra_paid` n'etait qu'un cumul sans date : impossible de le
--  placer sur la bonne periode d'un compte rendu. Chaque reglement est
--  desormais une ligne datee, reliee a son ecriture de caisse.
-- ============================================================================

create table if not exists public.command_payments (
  id          uuid primary key default gen_random_uuid(),
  command_id  uuid not null references public.commands(id) on delete cascade,
  amount      numeric(14,2) not null default 0,
  date        date not null default current_date,
  notes       text default '',
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now()
);

create index if not exists command_payments_command_idx
  on public.command_payments (command_id, date);

comment on table public.command_payments is
  'Reglements encaisses sur une commande depuis l''ecran Commandes (cumul : commands.extra_paid).';

create or replace function public.trg_command_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref  text;
  v_hist boolean;
begin
  select reference, coalesce(is_historical, false)
    into v_ref, v_hist
    from public.commands where id = new.command_id;

  -- l'argent d'une ANCIENNE commande a circule hors du logiciel
  if coalesce(v_hist, false) then
    return new;
  end if;

  insert into public.caisse_transactions
    (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('deposit', new.amount, new.date,
          'Règlement commande ' || coalesce(v_ref, ''), 'Commande',
          'command_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do update
     set amount = excluded.amount, date = excluded.date, updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists trg_command_payment_caisse on public.command_payments;
create trigger trg_command_payment_caisse
  after insert or update of amount, date on public.command_payments
  for each row execute function public.trg_command_payment_to_caisse();

drop trigger if exists trg_command_payments_caisse_del on public.command_payments;
create trigger trg_command_payments_caisse_del
  before delete on public.command_payments
  for each row execute function public.trg_delete_linked_caisse();

-- Reprise : les reglements deja saisis sont retrouves dans la caisse
-- (« Règlement commande CMD-… », sans reference) et relies a leur ligne.
do $$
declare
  c   record;
  t   record;
  v_id    uuid;
  v_found numeric;
begin
  if exists (select 1 from public.command_payments) then
    return;   -- reprise deja faite
  end if;

  alter table public.command_payments disable trigger trg_command_payment_caisse;

  for c in select id, reference, extra_paid, created_at from public.commands where coalesce(extra_paid, 0) > 0 loop
    v_found := 0;
    for t in
      select id, amount, date
        from public.caisse_transactions
       where ref_table is null
         and category_name = 'Commande'
         and description = 'Règlement commande ' || c.reference
       order by date, created_at
    loop
      exit when v_found >= c.extra_paid - 0.004;
      insert into public.command_payments (command_id, amount, date, notes)
      values (c.id, least(t.amount, c.extra_paid - v_found), t.date, 'Reprise')
      returning id into v_id;
      update public.caisse_transactions
         set ref_table = 'command_payments', ref_id = v_id, updated_at = now()
       where id = t.id;
      v_found := v_found + least(t.amount, c.extra_paid - v_found);
    end loop;

    if c.extra_paid - v_found > 0.004 then
      insert into public.command_payments (command_id, amount, date, notes)
      values (c.id, c.extra_paid - v_found, c.created_at::date, 'Reprise (date inconnue)');
    end if;
  end loop;

  alter table public.command_payments enable trigger trg_command_payment_caisse;
end $$;


-- ============================================================================
-- 03. ARGENT D'UNE COMMANDE
-- ----------------------------------------------------------------------------
--  argent de la commande = acompte + reglements + acompte client utilise
--  disponible            = argent de la commande - ce qui est deja impute
--                          sur ses bons de livraison
-- ============================================================================

create or replace function public.command_advance_available(
  p_command_id uuid, p_exclude_delivery uuid default null
) returns numeric
language sql
stable
security definer
set search_path = public
as $fn$
  select greatest(0,
           coalesce((select coalesce(c.advance_paid, 0) + coalesce(c.extra_paid, 0)
                          + coalesce(c.credit_applied, 0)
                       from public.commands c where c.id = p_command_id), 0)
         - coalesce((select sum(d.advance_applied) from public.command_deliveries d
                      where d.command_id = p_command_id
                        and (p_exclude_delivery is null or d.id <> p_exclude_delivery)), 0));
$fn$;

create or replace function public.recompute_command_payments(p_command_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.commands c
     set paid_amount = coalesce(c.advance_paid, 0)
                     + coalesce(c.extra_paid, 0)
                     + coalesce(c.credit_applied, 0)
                     + coalesce((
                         select sum(greatest(0, coalesce(s.paid_amount, d.paid_amount, 0)
                                              - coalesce(d.advance_applied, 0)))
                           from public.command_deliveries d
                           left join public.sales s on s.delivery_id = d.id
                          where d.command_id = c.id), 0),
         updated_at  = now()
   where c.id = p_command_id;
end;
$fn$;


-- ============================================================================
-- 04. apply_delivery_sale() — LE BON DE LIVRAISON DEVIENT UNE FACTURE,
--     SANS PLUS JAMAIS EFFACER CE QUE LE CLIENT A VERSE
-- ----------------------------------------------------------------------------
--  paye = acompte de commande impute + encaissement a la remise
--       + reglements de dette saisis ensuite + part venue du compte du client
--  Si la facture diminue (quantites corrigees), la part venue du compte du
--  client qui ne trouve plus a s'imputer retourne en ACOMPTE.
-- ============================================================================

create or replace function public.apply_delivery_sale(p_delivery_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del    public.command_deliveries;
  v_cmd    public.commands;
  v_sale   public.sales;
  v_ht     numeric := 0;
  v_tva    numeric := 0;
  v_ttc    numeric := 0;
  v_adv    numeric;
  v_cash   numeric;
  v_extra  numeric := 0;
  v_alloc  numeric := 0;
  v_raw    numeric := 0;
  v_freed  numeric := 0;
  v_paid   numeric;
  v_rest   numeric;
  v_ref    text;
  v_seq    int;
  v_status public.sale_status;
  v_hist   boolean;
  v_year   text;
begin
  select * into v_del from public.command_deliveries where id = p_delivery_id;
  if v_del.id is null then return null; end if;
  select * into v_cmd from public.commands where id = v_del.command_id;
  if v_cmd.id is null then return null; end if;

  v_hist := coalesce(v_del.is_historical, coalesce(v_cmd.is_historical, false));

  -- ---- valeur HORS TAXES de ce qui est remis sur ce bon --------------------
  select coalesce(sum(di.quantity * coalesce(px.unit_price, 0)), 0)
    into v_ht
    from public.command_delivery_items di
    left join lateral (
      select ci.unit_price
        from public.command_items ci
       where ci.command_id = v_del.command_id
         and (ci.id = di.command_item_id
              or (di.command_item_id is null and ci.product_name = di.product_name))
       order by (ci.id = di.command_item_id) desc
       limit 1
    ) px on true
   where di.delivery_id = p_delivery_id;

  v_tva := case when coalesce(v_del.tva_enabled, false)
                then round(v_ht * coalesce(v_del.tva_rate, 0) / 100, 2) else 0 end;
  v_ttc := v_ht + v_tva;

  -- ---- la facture de vente -------------------------------------------------
  select * into v_sale from public.sales where delivery_id = p_delivery_id;

  if v_sale.id is null then
    v_year := to_char(coalesce(v_del.delivered_at, now()), 'YYYY');
    select coalesce(count(*), 0) + 1 into v_seq from public.sales;
    v_ref := 'VNT-' || v_year || '-' || lpad(v_seq::text, 3, '0');
    while exists (select 1 from public.sales where reference = v_ref) loop
      v_seq := v_seq + 1;
      v_ref := 'VNT-' || v_year || '-' || lpad(v_seq::text, 3, '0');
    end loop;

    insert into public.sales (reference, client_id, date, total_amount, reduction, final_amount,
                              paid_amount, rest_amount, status, note, bon_number, is_historical,
                              tva_enabled, tva_rate, tva_amount, delivery_id, command_id,
                              created_by, created_at)
    values (v_ref, v_cmd.client_id, coalesce(v_del.delivered_at, now())::date,
            v_ht, 0, v_ttc, 0, v_ttc, 'debt'::public.sale_status,
            nullif(btrim(coalesce(v_del.notes, '')), ''),
            v_cmd.bon_number, v_hist,
            coalesce(v_del.tva_enabled, false), coalesce(v_del.tva_rate, 0), v_tva,
            p_delivery_id, v_cmd.id,
            coalesce(v_del.created_by, public.current_username()),
            coalesce(v_del.delivered_at, now()))
    returning * into v_sale;
  end if;

  -- ---- la commande a change de client : l'argent venu du compte de
  --      l'ancien client lui revient ----------------------------------------
  v_raw := greatest(0, coalesce(v_sale.allocated_amount, 0));
  if v_raw > 0 and v_sale.client_id is distinct from v_cmd.client_id then
    if v_sale.client_id is not null then
      update public.clients
         set credit_amount = coalesce(credit_amount, 0) + v_raw, updated_at = now()
       where id = v_sale.client_id;
    end if;
    v_raw := 0;
  end if;

  -- ---- ce que le client regle sur cette livraison --------------------------
  select coalesce(sum(amount), 0) into v_extra
    from public.sale_payments
   where sale_id = v_sale.id and coalesce(origin, '') not in ('delivery_advance', 'delivery_cash');

  v_adv   := least(greatest(0, coalesce(v_del.advance_applied, 0)), v_ttc);
  v_cash  := least(greatest(0, coalesce(v_del.cash_paid, 0)), greatest(0, v_ttc - v_adv));
  v_extra := least(greatest(0, v_extra), greatest(0, v_ttc - v_adv - v_cash));
  v_alloc := least(v_raw, greatest(0, v_ttc - v_adv - v_cash - v_extra));
  v_freed := greatest(0, v_raw - v_alloc);
  v_paid  := v_adv + v_cash + v_extra + v_alloc;
  v_rest  := greatest(0, v_ttc - v_paid);
  v_status := case when v_rest <= 0 then 'paid'::public.sale_status
                   else 'debt'::public.sale_status end;

  update public.sales
     set client_id        = v_cmd.client_id,
         date             = coalesce(v_del.delivered_at, now())::date,
         total_amount     = v_ht,
         reduction        = 0,
         final_amount     = v_ttc,
         paid_amount      = v_paid,
         rest_amount      = v_rest,
         status           = v_status,
         allocated_amount = v_alloc,
         note             = nullif(btrim(coalesce(v_del.notes, '')), ''),
         bon_number       = v_cmd.bon_number,
         is_historical    = v_hist,
         tva_enabled      = coalesce(v_del.tva_enabled, false),
         tva_rate         = coalesce(v_del.tva_rate, 0),
         tva_amount       = v_tva,
         command_id       = v_cmd.id,
         updated_at       = now()
   where id = v_sale.id
  returning * into v_sale;

  -- l'argent du client qui ne trouve plus a s'imputer redevient un ACOMPTE
  if v_freed > 0.004 and v_cmd.client_id is not null then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + v_freed, updated_at = now()
     where id = v_cmd.client_id;
  end if;

  -- ---- lignes de la facture = produits remis -------------------------------
  delete from public.sale_lines where sale_id = v_sale.id;
  insert into public.sale_lines (sale_id, product_id, comptoir_id, fiche_technic_id,
                                 product_name, quantity, selling_price, base_price,
                                 sell_by_unit, unit)
  select v_sale.id, null, null,
         (select ft.id from public.fiche_technics ft where ft.id = px.fiche_technic_id),
         di.product_name, di.quantity, coalesce(px.unit_price, 0), coalesce(px.unit_price, 0),
         coalesce(px.sell_by_unit, false), coalesce(di.sell_unit, px.sell_unit)
    from public.command_delivery_items di
    left join lateral (
      select ci.unit_price, ci.fiche_technic_id, ci.sell_by_unit, ci.sell_unit
        from public.command_items ci
       where ci.command_id = v_del.command_id
         and (ci.id = di.command_item_id
              or (di.command_item_id is null and ci.product_name = di.product_name))
       order by (ci.id = di.command_item_id) desc
       limit 1
    ) px on true
   where di.delivery_id = p_delivery_id;

  -- ---- les deux reglements du bon (acompte impute + encaissement) ----------
  delete from public.sale_payments
   where sale_id = v_sale.id and coalesce(origin, '') in ('delivery_advance', 'delivery_cash');
  if v_adv > 0 then
    insert into public.sale_payments (sale_id, date, amount, description, skip_caisse, origin)
    values (v_sale.id, v_sale.date, v_adv,
            'Acompte commande ' || v_cmd.reference || ' impute sur ' || v_del.reference,
            true, 'delivery_advance');
  end if;
  if v_cash > 0 then
    insert into public.sale_payments (sale_id, date, amount, description, skip_caisse, origin)
    values (v_sale.id, v_sale.date, v_cash,
            'Encaissement livraison ' || v_del.reference, false, 'delivery_cash');
  end if;

  -- ---- la dette client suivie (ecran historique « dettes clients ») -------
  delete from public.client_debts
   where description = 'Reste livraison ' || v_del.reference
     and coalesce(total_paid, 0) = 0;
  if v_rest > 0 and v_cmd.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_cmd.client_id, c.name, c.phone, v_rest, v_rest, v_sale.date,
           'Reste livraison ' || v_del.reference, public.current_username()
      from public.clients c where c.id = v_cmd.client_id;
  end if;

  -- ---- le bon de livraison memorise sa situation ---------------------------
  update public.command_deliveries
     set total_ht        = v_ht,
         tva_amount      = v_tva,
         total_ttc       = v_ttc,
         advance_applied = v_adv,
         cash_paid       = v_cash,
         paid_amount     = v_paid,
         rest_amount     = v_rest,
         sale_id         = v_sale.id,
         sale_reference  = v_sale.reference,
         updated_at      = now()
   where id = p_delivery_id;

  perform public.recompute_command_payments(v_del.command_id);

  return v_sale.id;
end;
$fn$;


-- ============================================================================
-- 05. IMPUTATION D'UN VERSEMENT CLIENT
-- ----------------------------------------------------------------------------
--  ORDRE : dette hors document (acompte negatif) -> anciennes dettes ->
--          ventes (factures de caisse ET de bons de livraison, la plus
--          ancienne d'abord) -> le RELIQUAT DEVIENT UN ACOMPTE.
--  Les commandes NE SONT PLUS des dettes : leur acompte vit sur la commande
--  et s'impute sur ses bons de livraison.
-- ============================================================================

create or replace function public.allocate_client_payment(p_client_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_left   numeric := coalesce(p_amount, 0);
  v_take   numeric;
  v_new    numeric;
  v_credit numeric;
  r        record;
begin
  if p_client_id is null or v_left <= 0 then return; end if;

  -- 0) une dette hors document (acompte negatif) est soldee en premier ;
  --    un acompte deja present est imputé AVEC ce versement : le client ne
  --    garde jamais en meme temps une dette et un acompte inutilise.
  select coalesce(credit_amount, 0) into v_credit from public.clients where id = p_client_id;
  if coalesce(v_credit, 0) < 0 then
    v_take := least(v_left, -v_credit);
    update public.clients
       set credit_amount = credit_amount + v_take, updated_at = now()
     where id = p_client_id;
    v_left := v_left - v_take;
  elsif coalesce(v_credit, 0) > 0 then
    update public.clients set credit_amount = 0, updated_at = now() where id = p_client_id;
    v_left := v_left + v_credit;
  end if;

  -- 1) ANCIENNES DETTES — la plus ancienne d'abord
  for r in
    select id, rest_amount from public.party_old_debts
     where party_type = 'client' and party_id = p_client_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.party_old_debts
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  -- 2) VENTES non soldees (caisse et bons de livraison)
  for r in
    select id, rest_amount, delivery_id from public.sales
     where client_id = p_client_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    if r.delivery_id is not null then
      update public.sales
         set allocated_amount = coalesce(allocated_amount, 0) + v_take, updated_at = now()
       where id = r.id;
      perform public.apply_delivery_sale(r.delivery_id);
    else
      v_new := greatest(0, r.rest_amount - v_take);
      update public.sales
         set allocated_amount = coalesce(allocated_amount, 0) + v_take,
             paid_amount      = paid_amount + v_take,
             rest_amount      = v_new,
             status           = case when v_new <= 0 then 'paid'::public.sale_status
                                     else 'debt'::public.sale_status end,
             updated_at       = now()
       where id = r.id;
    end if;
    v_left := v_left - v_take;
  end loop;

  -- 3) LE RELIQUAT DEVIENT UN ACOMPTE DU CLIENT
  if v_left > 0 then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + v_left, updated_at = now()
     where id = p_client_id;
  end if;
end;
$fn$;

comment on function public.allocate_client_payment(uuid, numeric) is
  'Impute un versement client : anciennes dettes, puis ventes (caisse et bons de livraison) ; le reliquat devient un ACOMPTE (clients.credit_amount).';

create or replace function public.deallocate_client_payment(p_client_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_left   numeric := coalesce(p_amount, 0);
  v_take   numeric;
  v_credit numeric;
  v_paid   numeric;
  r        record;
begin
  if p_client_id is null or v_left <= 0 then return; end if;

  -- Ordre INVERSE : acompte -> ventes (plus recentes d'abord) -> anciennes dettes.
  -- Seul l'argent venu du compte du client est repris : un encaissement de
  -- caisse porte par la facture n'est jamais touche.
  select coalesce(credit_amount, 0) into v_credit from public.clients where id = p_client_id;
  if coalesce(v_credit, 0) > 0 then
    v_take := least(v_left, v_credit);
    update public.clients
       set credit_amount = credit_amount - v_take, updated_at = now()
     where id = p_client_id;
    v_left := v_left - v_take;
  end if;

  for r in
    select id, allocated_amount, delivery_id, final_amount, paid_amount from public.sales
     where client_id = p_client_id and allocated_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.allocated_amount);
    if r.delivery_id is not null then
      update public.sales
         set allocated_amount = greatest(0, allocated_amount - v_take), updated_at = now()
       where id = r.id;
      perform public.apply_delivery_sale(r.delivery_id);
    else
      v_paid := greatest(0, r.paid_amount - v_take);
      update public.sales
         set allocated_amount = greatest(0, allocated_amount - v_take),
             paid_amount      = v_paid,
             rest_amount      = greatest(0, final_amount - v_paid),
             status           = case when final_amount - v_paid <= 0 then 'paid'::public.sale_status
                                     else 'debt'::public.sale_status end,
             updated_at       = now()
       where id = r.id;
    end if;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, paid_amount, amount from public.party_old_debts
     where party_type = 'client' and party_id = p_client_id and paid_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.party_old_debts
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = greatest(0, amount - greatest(0, paid_amount - v_take)),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  -- Ce qui n'a pu etre repris (acompte deja utilise sur une commande ou deja
  -- rendu) reste DU par le client : l'acompte devient negatif.
  if v_left > 0.004 then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) - v_left, updated_at = now()
     where id = p_client_id;
  end if;
end;
$fn$;

comment on function public.deallocate_client_payment(uuid, numeric) is
  'Annule l''imputation d''un versement client (ordre inverse) sans jamais toucher aux encaissements portes par les factures.';


-- ============================================================================
-- 06. IMPUTATION D'UN VERSEMENT FOURNISSEUR
-- ============================================================================

create or replace function public.allocate_supplier_payment(p_supplier_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_left   numeric := coalesce(p_amount, 0);
  v_take   numeric;
  v_credit numeric;
  r        record;
begin
  if p_supplier_id is null or v_left <= 0 then return; end if;

  select coalesce(credit_amount, 0) into v_credit from public.suppliers where id = p_supplier_id;
  if coalesce(v_credit, 0) < 0 then
    v_take := least(v_left, -v_credit);
    update public.suppliers
       set credit_amount = credit_amount + v_take, updated_at = now()
     where id = p_supplier_id;
    v_left := v_left - v_take;
  elsif coalesce(v_credit, 0) > 0 then
    update public.suppliers set credit_amount = 0, updated_at = now() where id = p_supplier_id;
    v_left := v_left + v_credit;
  end if;

  for r in
    select id, rest_amount from public.party_old_debts
     where party_type = 'supplier' and party_id = p_supplier_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.party_old_debts
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, rest_amount from public.purchases
     where supplier_id = p_supplier_id and rest_amount > 0
     order by date asc, created_at asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.rest_amount);
    update public.purchases
       set allocated_amount = coalesce(allocated_amount, 0) + v_take,
           paid_amount      = paid_amount + v_take,
           rest_amount      = greatest(0, rest_amount - v_take),
           updated_at       = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    update public.suppliers
       set credit_amount = coalesce(credit_amount, 0) + v_left, updated_at = now()
     where id = p_supplier_id;
  end if;
end;
$fn$;

comment on function public.allocate_supplier_payment(uuid, numeric) is
  'Impute un versement fournisseur : anciennes dettes puis factures d''achat ; le reliquat devient un TROP-VERSE (suppliers.credit_amount), utilisable sur les prochains achats.';

create or replace function public.deallocate_supplier_payment(p_supplier_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_left   numeric := coalesce(p_amount, 0);
  v_take   numeric;
  v_credit numeric;
  v_paid   numeric;
  r        record;
begin
  if p_supplier_id is null or v_left <= 0 then return; end if;

  select coalesce(credit_amount, 0) into v_credit from public.suppliers where id = p_supplier_id;
  if coalesce(v_credit, 0) > 0 then
    v_take := least(v_left, v_credit);
    update public.suppliers
       set credit_amount = credit_amount - v_take, updated_at = now()
     where id = p_supplier_id;
    v_left := v_left - v_take;
  end if;

  for r in
    select id, allocated_amount, total_amount, paid_amount from public.purchases
     where supplier_id = p_supplier_id and allocated_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.allocated_amount);
    v_paid := greatest(0, r.paid_amount - v_take);
    update public.purchases
       set allocated_amount = greatest(0, allocated_amount - v_take),
           paid_amount      = v_paid,
           rest_amount      = greatest(0, total_amount - v_paid),
           updated_at       = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, paid_amount, amount from public.party_old_debts
     where party_type = 'supplier' and party_id = p_supplier_id and paid_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.party_old_debts
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = greatest(0, amount - greatest(0, paid_amount - v_take)),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  if v_left > 0.004 then
    update public.suppliers
       set credit_amount = coalesce(credit_amount, 0) - v_left, updated_at = now()
     where id = p_supplier_id;
  end if;
end;
$fn$;


-- ============================================================================
-- 07. L'ACOMPTE UTILISE A LA CREATION D'UN DOCUMENT
-- ----------------------------------------------------------------------------
--  L'ecran de creation (vente de caisse, bon de livraison, commande, achat)
--  affiche l'acompte disponible du tiers ; s'il est utilise, il est impute
--  ICI, sans aucune ecriture de caisse (l'argent y est deja entre avec le
--  versement qui a cree l'acompte). Chaque fonction renvoie le montant
--  reellement impute.
-- ============================================================================

create or replace function public.apply_credit_to_sale(p_sale_id uuid, p_amount numeric default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale   public.sales;
  v_credit numeric;
  v_take   numeric;
  v_new    numeric;
begin
  if not (public.has_perm('clients', 'pay') or public.has_perm('clients', 'create')
          or public.has_perm('clients', 'edit') or public.has_perm('pos', 'create')
          or public.has_perm('sales', 'create') or public.has_perm('sales', 'pay')) then
    raise exception 'Vous n''avez pas la permission d''utiliser l''acompte du client';
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null or v_sale.client_id is null then return 0; end if;

  select coalesce(credit_amount, 0) into v_credit from public.clients where id = v_sale.client_id;
  v_take := least(greatest(0, coalesce(p_amount, v_credit)), greatest(0, v_credit),
                  greatest(0, v_sale.rest_amount));
  if v_take <= 0.004 then return 0; end if;

  update public.clients
     set credit_amount = credit_amount - v_take, updated_at = now()
   where id = v_sale.client_id;

  if v_sale.delivery_id is not null then
    update public.sales
       set allocated_amount = coalesce(allocated_amount, 0) + v_take, updated_at = now()
     where id = v_sale.id;
    perform public.apply_delivery_sale(v_sale.delivery_id);
  else
    v_new := greatest(0, v_sale.rest_amount - v_take);
    update public.sales
       set allocated_amount = coalesce(allocated_amount, 0) + v_take,
           paid_amount      = paid_amount + v_take,
           rest_amount      = v_new,
           status           = case when v_new <= 0 then 'paid'::public.sale_status
                                   else 'debt'::public.sale_status end,
           updated_at       = now()
     where id = v_sale.id;
  end if;

  perform public.log_activity('clients', 'credit_use', 'sales', v_sale.id,
    jsonb_build_object('amount', v_take));
  return v_take;
end;
$fn$;

create or replace function public.apply_credit_to_command(p_command_id uuid, p_amount numeric default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd    public.commands;
  v_credit numeric;
  v_take   numeric;
begin
  if not (public.has_perm('clients', 'pay') or public.has_perm('clients', 'create')
          or public.has_perm('clients', 'edit') or public.has_perm('pos', 'create')) then
    raise exception 'Vous n''avez pas la permission d''utiliser l''acompte du client';
  end if;

  select * into v_cmd from public.commands where id = p_command_id;
  if v_cmd.id is null or v_cmd.client_id is null then return 0; end if;

  select coalesce(credit_amount, 0) into v_credit from public.clients where id = v_cmd.client_id;
  v_take := least(greatest(0, coalesce(p_amount, v_credit)), greatest(0, v_credit),
                  greatest(0, coalesce(nullif(v_cmd.total_ttc, 0), v_cmd.total_amount) - v_cmd.paid_amount));
  if v_take <= 0.004 then return 0; end if;

  update public.clients
     set credit_amount = credit_amount - v_take, updated_at = now()
   where id = v_cmd.client_id;

  update public.commands
     set credit_applied = coalesce(credit_applied, 0) + v_take, updated_at = now()
   where id = p_command_id;

  -- l'argent descend aussitot sur les bons deja livres et non soldes
  perform public.recompute_command_payments(p_command_id);
  perform public.settle_command_deliveries(p_command_id);

  perform public.log_activity('clients', 'credit_use', 'commands', p_command_id,
    jsonb_build_object('amount', v_take));
  return v_take;
end;
$fn$;

create or replace function public.apply_credit_to_purchase(p_purchase_id uuid, p_amount numeric default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pur    public.purchases;
  v_credit numeric;
  v_take   numeric;
begin
  if not (public.has_perm('suppliers', 'pay') or public.has_perm('purchase', 'create')
          or public.has_perm('purchase', 'edit') or public.has_perm('purchase', 'pay')) then
    raise exception 'Vous n''avez pas la permission d''utiliser le trop-verse du fournisseur';
  end if;

  select * into v_pur from public.purchases where id = p_purchase_id;
  if v_pur.id is null or v_pur.supplier_id is null then return 0; end if;

  select coalesce(credit_amount, 0) into v_credit from public.suppliers where id = v_pur.supplier_id;
  v_take := least(greatest(0, coalesce(p_amount, v_credit)), greatest(0, v_credit),
                  greatest(0, v_pur.rest_amount));
  if v_take <= 0.004 then return 0; end if;

  update public.suppliers
     set credit_amount = credit_amount - v_take, updated_at = now()
   where id = v_pur.supplier_id;

  update public.purchases
     set allocated_amount = coalesce(allocated_amount, 0) + v_take,
         paid_amount      = paid_amount + v_take,
         rest_amount      = greatest(0, rest_amount - v_take),
         updated_at       = now()
   where id = p_purchase_id;

  perform public.log_activity('suppliers', 'credit_use', 'purchases', p_purchase_id,
    jsonb_build_object('amount', v_take));
  return v_take;
end;
$fn$;


-- ============================================================================
-- 08. IMPUTER L'ACOMPTE SUR LES DETTES RESTANTES
-- ----------------------------------------------------------------------------
--  Un tiers ne doit pas avoir en meme temps une dette ET un acompte : l'acompte
--  est impute sur ses dettes (la plus ancienne d'abord), le reliquat reste en
--  acompte. Appelee apres une suppression et par le bouton de l'ecran.
-- ============================================================================

create or replace function public.rebalance_party_credit(p_party_type text, p_party_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_credit numeric;
begin
  if p_party_id is null then return 0; end if;

  if lower(coalesce(p_party_type, 'client')) = 'supplier' then
    select coalesce(credit_amount, 0) into v_credit from public.suppliers where id = p_party_id;
    if coalesce(v_credit, 0) > 0.004 then
      update public.suppliers set credit_amount = 0, updated_at = now() where id = p_party_id;
      perform public.allocate_supplier_payment(p_party_id, v_credit);
    end if;
    select coalesce(credit_amount, 0) into v_credit from public.suppliers where id = p_party_id;
  else
    select coalesce(credit_amount, 0) into v_credit from public.clients where id = p_party_id;
    if coalesce(v_credit, 0) > 0.004 then
      update public.clients set credit_amount = 0, updated_at = now() where id = p_party_id;
      perform public.allocate_client_payment(p_party_id, v_credit);
    end if;
    select coalesce(credit_amount, 0) into v_credit from public.clients where id = p_party_id;
  end if;

  return coalesce(v_credit, 0);
end;
$fn$;

comment on function public.rebalance_party_credit(text, uuid) is
  'Impute l''acompte d''un client (ou le trop-verse d''un fournisseur) sur ses dettes restantes ; renvoie l''acompte qui reste.';


-- ============================================================================
-- 09. MODIFICATIONS ET REGLEMENTS — plus jamais d'argent compte deux fois
-- ============================================================================

-- 09.1 update_sale : la part venue du compte du client n'est jamais recreee
--      comme un encaissement de caisse ; les reglements ne sont reconstruits
--      que si le montant encaisse a reellement change (sinon leurs dates en
--      caisse seraient perdues).
create or replace function public.update_sale(p_id uuid, p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale     public.sales;
  v_del      public.command_deliveries;
  v_total    numeric;
  v_red      numeric;
  v_base     numeric;
  v_tva_on   boolean;
  v_tva_rate numeric;
  v_tva      numeric;
  v_final    numeric;
  v_paid     numeric;
  v_rest     numeric;
  v_date     date;
  v_status   public.sale_status;
  v_alloc    numeric;
  v_new_alloc numeric;
  v_freed    numeric := 0;
  v_direct   numeric;
  v_rows     numeric;
begin
  select * into v_sale from public.sales where id = p_id;
  if v_sale.id is null then
    raise exception 'Vente introuvable (%)', p_id;
  end if;

  v_date  := coalesce(nullif(p_payload ->> 'date', '')::date, v_sale.date);
  v_alloc := greatest(0, coalesce(v_sale.allocated_amount, 0));

  -- ---- facture issue d'une livraison : le bon reste la source de verite ----
  if v_sale.delivery_id is not null then
    select * into v_del from public.command_deliveries where id = v_sale.delivery_id;

    v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_sale.tva_enabled, false));
    v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric, nullif(coalesce(v_sale.tva_rate, 0), 0), 19);
    if not v_tva_on then v_tva_rate := 0; end if;
    v_paid := greatest(0, coalesce((p_payload ->> 'paid_amount')::numeric, v_sale.paid_amount));

    -- le montant saisi couvre : acompte de commande + part venue du compte du
    -- client + encaissement du jour. Il remplace les reglements libres.
    v_new_alloc := least(v_alloc, greatest(0, v_paid - coalesce(v_del.advance_applied, 0)));
    v_freed     := v_alloc - v_new_alloc;

    delete from public.sale_payments
     where sale_id = p_id and coalesce(origin, '') not in ('delivery_advance', 'delivery_cash');

    update public.command_deliveries d
       set delivered_at = (v_date::timestamp + coalesce(d.delivered_at::time, '12:00'::time)),
           date         = v_date,
           notes        = coalesce(p_payload ->> 'note', d.notes),
           tva_enabled  = v_tva_on,
           tva_rate     = v_tva_rate,
           cash_paid    = greatest(0, v_paid - coalesce(d.advance_applied, 0) - v_new_alloc),
           updated_at   = now()
     where d.id = v_sale.delivery_id;

    update public.sales set allocated_amount = v_new_alloc, updated_at = now() where id = p_id;

    perform public.apply_delivery_sale(v_sale.delivery_id);

    if v_freed > 0.004 and v_sale.client_id is not null then
      update public.clients
         set credit_amount = coalesce(credit_amount, 0) + v_freed, updated_at = now()
       where id = v_sale.client_id;
    end if;

    perform public.log_activity('sales', 'update', 'sales', p_id, p_payload);
    select * into v_sale from public.sales where id = p_id;
    return v_sale;
  end if;

  -- ---- vente ordinaire -------------------------------------------------------
  v_red   := greatest(0, coalesce((p_payload ->> 'reduction')::numeric, v_sale.reduction));
  v_total := coalesce(
    (select sum(quantity * selling_price) from public.sale_lines where sale_id = p_id),
    v_sale.total_amount);
  v_red   := least(v_red, v_total);
  v_base  := greatest(0, v_total - v_red);

  v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_sale.tva_enabled, false));
  v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric, coalesce(v_sale.tva_rate, 0));
  if not v_tva_on then v_tva_rate := 0; end if;
  v_tva   := case when v_tva_on then round(v_base * v_tva_rate / 100, 2) else 0 end;
  v_final := v_base + v_tva;

  v_paid  := least(greatest(0, coalesce((p_payload ->> 'paid_amount')::numeric, v_sale.paid_amount)), v_final);
  v_rest  := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  -- la part venue du compte du client est conservee (plafonnee au paye) ;
  -- seul le reste est un encaissement porte par la facture
  v_new_alloc := least(v_alloc, v_paid);
  v_freed     := v_alloc - v_new_alloc;
  v_direct    := v_paid - v_new_alloc;

  select coalesce(sum(amount), 0) into v_rows from public.sale_payments where sale_id = p_id;
  if round(v_rows, 2) <> round(v_direct, 2) then
    -- le trigger de suppression retire aussi les ecritures de caisse liees
    delete from public.sale_payments where sale_id = p_id;
    if v_direct > 0 then
      insert into public.sale_payments (sale_id, date, amount, description)
      values (p_id, v_date, v_direct, 'Paiement vente (modifie)');
    end if;
  end if;

  update public.sales
     set date             = v_date,
         total_amount     = v_total,
         reduction        = v_red,
         tva_enabled      = v_tva_on,
         tva_rate         = v_tva_rate,
         tva_amount       = v_tva,
         final_amount     = v_final,
         paid_amount      = v_paid,
         rest_amount      = v_rest,
         status           = v_status,
         allocated_amount = v_new_alloc,
         note             = coalesce(p_payload ->> 'note', note),
         updated_at       = now()
   where id = p_id
  returning * into v_sale;

  if v_freed > 0.004 and v_sale.client_id is not null then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + v_freed, updated_at = now()
     where id = v_sale.client_id;
  end if;

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

-- 09.2 pay_sale_debt : on n'encaisse jamais plus que le reste du ; un
--      montant superieur est verse sur le compte du client (dettes puis
--      acompte) au lieu de disparaitre.
create or replace function public.pay_sale_debt(
  p_sale_id uuid, p_amount numeric, p_date date default current_date,
  p_description text default 'Règlement dette'
) returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale   public.sales;
  v_take   numeric;
  v_excess numeric;
  v_name   text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'Vente introuvable (%)', p_sale_id; end if;

  v_take   := least(p_amount, greatest(0, v_sale.rest_amount));
  v_excess := p_amount - v_take;

  if v_take > 0 then
    -- le reglement garde sa propre date en caisse (origin NULL)
    insert into public.sale_payments (sale_id, date, amount, description)
    values (p_sale_id, coalesce(p_date, current_date), v_take, p_description);

    if v_sale.delivery_id is not null then
      perform public.apply_delivery_sale(v_sale.delivery_id);
    else
      update public.sales
         set paid_amount = least(final_amount, paid_amount + v_take),
             rest_amount = greatest(0, final_amount - least(final_amount, paid_amount + v_take)),
             status      = case when greatest(0, final_amount - least(final_amount, paid_amount + v_take)) = 0
                                then 'paid'::public.sale_status else 'debt'::public.sale_status end,
             updated_at  = now()
       where id = p_sale_id;
    end if;
  end if;

  if v_excess > 0.004 then
    if v_sale.client_id is null then
      raise exception 'Le montant depasse le reste du (%)', v_sale.rest_amount;
    end if;
    select name into v_name from public.clients where id = v_sale.client_id;
    insert into public.client_payments (client_id, client_name, amount, date, paid_at, notes, method)
    values (v_sale.client_id, v_name, v_excess, coalesce(p_date, current_date),
            coalesce(p_date, current_date)::timestamptz,
            'Excedent du reglement de la facture ' || v_sale.reference, 'especes');
    perform public.allocate_client_payment(v_sale.client_id, v_excess);
  end if;

  perform public.log_activity('sales', 'pay', 'sales', p_sale_id, jsonb_build_object('amount', p_amount));
  select * into v_sale from public.sales where id = p_sale_id;
  return v_sale;
end;
$fn$;

-- 09.3 update_purchase : meme principe que update_sale (copie de la version
--      « modification complete + stock » avec la part venue du compte du
--      fournisseur conservee).
create or replace function public.update_purchase(p_id uuid, p_payload jsonb)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pur      public.purchases;
  v_old_hist boolean;
  v_new_hist boolean;
  v_date     date;
  v_total    numeric;
  v_paid     numeric;
  v_paid_now numeric;
  v_replace  boolean;
  v_line     jsonb;
  v_delta    record;
  v_left     numeric;
  v_old_supplier uuid;
  v_alloc    numeric;
  v_new_alloc numeric;
  v_freed    numeric := 0;
  v_direct   numeric;
begin
  select * into v_pur from public.purchases where id = p_id;
  if v_pur.id is null then
    raise exception 'Facture d achat introuvable (%)', p_id;
  end if;

  v_old_supplier := v_pur.supplier_id;
  v_alloc    := greatest(0, coalesce(v_pur.allocated_amount, 0));
  v_old_hist := coalesce(v_pur.is_historical, false);
  v_new_hist := coalesce((p_payload ->> 'is_historical')::boolean, v_old_hist);
  v_date     := coalesce(nullif(p_payload ->> 'date', '')::date, v_pur.date);
  v_replace  := jsonb_typeof(p_payload -> 'products') = 'array';

  -- 1/6 En-tete
  update public.purchases
     set supplier_id   = coalesce(nullif(p_payload ->> 'supplier_id', '')::uuid, supplier_id),
         date          = v_date,
         bon_number    = nullif(btrim(coalesce(p_payload ->> 'bon_number', coalesce(bon_number, ''))), ''),
         driver_plate  = nullif(upper(btrim(coalesce(p_payload ->> 'driver_plate', coalesce(driver_plate, '')))), ''),
         is_historical = v_new_hist,
         note          = coalesce(p_payload ->> 'note', note),
         updated_at    = now()
   where id = p_id
  returning * into v_pur;

  -- la facture a change de fournisseur : l'argent venu du compte de l'ancien
  -- fournisseur lui revient integralement
  if v_pur.supplier_id is distinct from v_old_supplier and v_alloc > 0 then
    if v_old_supplier is not null then
      update public.suppliers
         set credit_amount = coalesce(credit_amount, 0) + v_alloc, updated_at = now()
       where id = v_old_supplier;
    end if;
    update public.purchases
       set allocated_amount = 0, paid_amount = greatest(0, paid_amount - v_alloc), updated_at = now()
     where id = p_id;
    v_alloc := 0;
    select * into v_pur from public.purchases where id = p_id;
  end if;

  if v_replace then
    -- 2/6 Stock reconcilie PAR ECART
    for v_delta in
      with old_q as (
        select product_id, sum(quantity) as qty
          from public.purchase_lines
         where purchase_id = p_id and product_id is not null
         group by product_id
      ),
      new_q as (
        select (l ->> 'product_id')::uuid as product_id,
               sum(coalesce((l ->> 'quantity')::numeric, 0)) as qty
          from jsonb_array_elements(p_payload -> 'products') as l
         where nullif(l ->> 'product_id', '') is not null
         group by 1
      )
      select coalesce(n.product_id, o.product_id) as product_id,
             (case when v_new_hist then 0 else coalesce(n.qty, 0) end)
           - (case when v_old_hist then 0 else coalesce(o.qty, 0) end) as delta
        from old_q o
        full outer join new_q n on n.product_id = o.product_id
    loop
      continue when coalesce(v_delta.delta, 0) = 0;

      update public.products
         set current_quantity   = greatest(0, current_quantity   + v_delta.delta),
             principal_quantity = greatest(0, principal_quantity + v_delta.delta),
             updated_at         = now()
       where id = v_delta.product_id
      returning current_quantity into v_left;

      if v_left is not null then
        insert into public.stock_movements
          (product_id, quantity, reason, ref_table, ref_id, balance_after)
        values (v_delta.product_id, v_delta.delta, 'purchase_edit',
                'purchases', p_id, v_left);
      end if;
    end loop;

    -- 3/6 Lignes remplacees, declencheur de stock muet
    perform set_config('altech.skip_purchase_stock', '1', true);

    delete from public.purchase_lines where purchase_id = p_id;

    for v_line in select * from jsonb_array_elements(p_payload -> 'products') loop
      insert into public.purchase_lines (
        purchase_id, product_id, product_name, quantity, purchase_price,
        min_alert_quantity, unit_enabled, unit, expiration_enabled, expiration_date)
      values (
        p_id,
        nullif(v_line ->> 'product_id', '')::uuid,
        coalesce(v_line ->> 'product_name', 'Produit'),
        coalesce((v_line ->> 'quantity')::numeric, 0),
        coalesce((v_line ->> 'purchase_price')::numeric, 0),
        nullif(v_line ->> 'min_alert_quantity', '')::numeric,
        coalesce((v_line ->> 'unit_enabled')::boolean, false),
        v_line ->> 'unit',
        coalesce((v_line ->> 'expiration_enabled')::boolean, false),
        nullif(v_line ->> 'expiration_date', '')::date
      );
    end loop;

    perform set_config('altech.skip_purchase_stock', '0', true);

    -- 4/6 Fiche produit alignee sur la facture corrigee
    if not v_new_hist then
      for v_line in select * from jsonb_array_elements(p_payload -> 'products') loop
        continue when nullif(v_line ->> 'product_id', '') is null;

        update public.products
           set min_alert_quantity = coalesce(nullif(v_line ->> 'min_alert_quantity', '')::numeric,
                                             min_alert_quantity),
               purchase_price     = case when coalesce((v_line ->> 'purchase_price')::numeric, 0) > 0
                                         then (v_line ->> 'purchase_price')::numeric
                                         else purchase_price end,
               expiration_date    = coalesce(nullif(v_line ->> 'expiration_date', '')::date, expiration_date),
               expiration_enabled = case when nullif(v_line ->> 'expiration_date', '') is not null
                                         then true else expiration_enabled end,
               unit_enabled       = case when coalesce((v_line ->> 'unit_enabled')::boolean, false)
                                         then true else unit_enabled end,
               unit               = case when coalesce((v_line ->> 'unit_enabled')::boolean, false)
                                         then coalesce(v_line ->> 'unit', unit) else unit end,
               updated_at         = now()
         where id = (v_line ->> 'product_id')::uuid;
      end loop;
    end if;
  end if;

  -- 5/6 Total recalcule sur les lignes reellement enregistrees
  select sum(quantity * purchase_price) into v_total
    from public.purchase_lines where purchase_id = p_id;
  if v_total is null then
    v_total := case when v_replace then 0 else v_pur.total_amount end;
  end if;

  v_paid := least(
    greatest(0, coalesce((p_payload ->> 'paid_amount')::numeric, v_pur.paid_amount)),
    v_total);

  -- 6/6 La part venue du compte du fournisseur est conservee ; seul le reste
  --     est un reglement porte par la facture (avec sa sortie de caisse).
  v_new_alloc := least(v_alloc, v_paid);
  v_freed     := v_alloc - v_new_alloc;
  v_direct    := v_paid - v_new_alloc;

  select coalesce(sum(amount), 0) into v_paid_now
    from public.purchase_payments where purchase_id = p_id;

  if round(v_direct, 2) <> round(v_paid_now, 2) then
    delete from public.purchase_payments where purchase_id = p_id;
    if v_direct > 0 then
      insert into public.purchase_payments (purchase_id, date, amount, description)
      values (p_id, v_date, v_direct,
              case when v_new_hist then 'Reglement ancien achat (modifie)'
                   else 'Reglement achat (modifie)' end);
    end if;
  end if;

  update public.purchases
     set total_amount     = v_total,
         paid_amount      = v_paid,
         rest_amount      = greatest(0, v_total - v_paid),
         allocated_amount = v_new_alloc,
         updated_at       = now()
   where id = p_id
  returning * into v_pur;

  if v_freed > 0.004 and v_pur.supplier_id is not null then
    update public.suppliers
       set credit_amount = coalesce(credit_amount, 0) + v_freed, updated_at = now()
     where id = v_pur.supplier_id;
  end if;

  perform public.log_activity('purchase', 'update', 'purchases', p_id, p_payload);
  return v_pur;
end;
$fn$;

-- 09.4 pay_command : chaque reglement est une ligne datee (command_payments)
--      qui porte sa propre ecriture de caisse.
create or replace function public.pay_command(
  p_command_id uuid, p_amount numeric, p_date date default current_date
) returns public.commands
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd public.commands;
  v_amt numeric := greatest(0, coalesce(p_amount, 0));
begin
  select * into v_cmd from public.commands where id = p_command_id;
  if v_cmd.id is null then
    raise exception 'Commande introuvable (%)', p_command_id;
  end if;

  v_amt := least(v_amt, greatest(0, coalesce(nullif(v_cmd.total_ttc, 0), v_cmd.total_amount)
                                  - coalesce(v_cmd.paid_amount, 0)));
  if v_amt <= 0 then return v_cmd; end if;

  insert into public.command_payments (command_id, amount, date)
  values (p_command_id, v_amt, coalesce(p_date, current_date));

  update public.commands
     set extra_paid = coalesce(extra_paid, 0) + v_amt,
         updated_at = now()
   where id = p_command_id;

  perform public.recompute_command_payments(p_command_id);
  -- le reglement descend aussitot sur les bons de livraison non soldes
  perform public.settle_command_deliveries(p_command_id);

  select * into v_cmd from public.commands where id = p_command_id;
  return v_cmd;
end;
$fn$;


-- ============================================================================
-- 10. SUPPRESSIONS — L'ARGENT IMPUTE REVIENT SUR LE COMPTE DU TIERS
-- ============================================================================

create or replace function public.trg_sales_return_allocations()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare r record;
begin
  for r in
    select client_id, sum(coalesce(allocated_amount, 0)) as alloc
      from old_rows
     where client_id is not null
     group by client_id
    having sum(coalesce(allocated_amount, 0)) > 0.004
  loop
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + r.alloc, updated_at = now()
     where id = r.client_id;
    perform public.rebalance_party_credit('client', r.client_id);
  end loop;
  return null;
end;
$fn$;

drop trigger if exists trg_sales_return_allocations on public.sales;
create trigger trg_sales_return_allocations
  after delete on public.sales
  referencing old table as old_rows
  for each statement execute function public.trg_sales_return_allocations();

create or replace function public.trg_purchases_return_allocations()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare r record;
begin
  for r in
    select supplier_id, sum(coalesce(allocated_amount, 0)) as alloc
      from old_rows
     where supplier_id is not null
     group by supplier_id
    having sum(coalesce(allocated_amount, 0)) > 0.004
  loop
    update public.suppliers
       set credit_amount = coalesce(credit_amount, 0) + r.alloc, updated_at = now()
     where id = r.supplier_id;
    perform public.rebalance_party_credit('supplier', r.supplier_id);
  end loop;
  return null;
end;
$fn$;

drop trigger if exists trg_purchases_return_allocations on public.purchases;
create trigger trg_purchases_return_allocations
  after delete on public.purchases
  referencing old table as old_rows
  for each statement execute function public.trg_purchases_return_allocations();

-- Supprimer une commande, c'est comme si elle n'avait jamais existe (ses bons
-- de livraison et leurs encaissements partent deja avec elle) :
--   · l'acompte CLIENT utilise dessus lui revient ;
--   · l'ecriture de caisse de son acompte en especes est retiree, comme celles
--     de ses reglements (command_payments, en cascade).
create or replace function public.trg_command_return_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(old.credit_applied, 0) > 0.004 and old.client_id is not null then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + old.credit_applied, updated_at = now()
     where id = old.client_id;
  end if;
  delete from public.caisse_transactions where ref_table = 'commands' and ref_id = old.id;
  return old;
end;
$fn$;

drop trigger if exists trg_commands_return_credit on public.commands;
create trigger trg_commands_return_credit
  before delete on public.commands
  for each row execute function public.trg_command_return_credit();

create or replace function public.trg_commands_after_delete_rebalance()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare r record;
begin
  for r in
    select distinct client_id from old_rows
     where client_id is not null and coalesce(credit_applied, 0) > 0.004
  loop
    perform public.rebalance_party_credit('client', r.client_id);
  end loop;
  return null;
end;
$fn$;

drop trigger if exists trg_commands_after_delete_rebalance on public.commands;
create trigger trg_commands_after_delete_rebalance
  after delete on public.commands
  referencing old table as old_rows
  for each statement execute function public.trg_commands_after_delete_rebalance();

-- Un reglement de commande supprime diminue le cumul de la commande.
create or replace function public.trg_command_payment_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if pg_trigger_depth() > 1 then
    return old;   -- suppression en cascade de la commande elle-meme
  end if;
  update public.commands
     set extra_paid = greatest(0, coalesce(extra_paid, 0) - old.amount), updated_at = now()
   where id = old.command_id;
  perform public.recompute_command_payments(old.command_id);
  return old;
end;
$fn$;

drop trigger if exists trg_command_payments_sync on public.command_payments;
create trigger trg_command_payments_sync
  after delete on public.command_payments
  for each row execute function public.trg_command_payment_deleted();


-- ============================================================================
-- 11. UNE COMMANDE CHANGE DE CLIENT : L'ACOMPTE SUIT LE BON CLIENT
-- ============================================================================

create or replace function public.trg_command_client_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.client_id is distinct from old.client_id and coalesce(old.credit_applied, 0) > 0.004 then
    if old.client_id is not null then
      update public.clients
         set credit_amount = coalesce(credit_amount, 0) + old.credit_applied, updated_at = now()
       where id = old.client_id;
    end if;
    new.credit_applied := 0;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_commands_client_change on public.commands;
create trigger trg_commands_client_change
  before update of client_id on public.commands
  for each row execute function public.trg_command_client_change();


-- ============================================================================
-- 12. SITUATION NETTE DE CHAQUE TIERS
-- ----------------------------------------------------------------------------
--  dette   = reste des ventes (caisse + bons de livraison) + anciennes dettes
--  acompte = avance libre + argent des commandes pas encore impute
--  solde   = dette - acompte   (negatif : l'entreprise doit au tiers)
-- ============================================================================

drop view if exists public.v_party_balances;
create view public.v_party_balances as
select 'client'::text                                         as party_type,
       c.id                                                   as party_id,
       c.name                                                 as party_name,
       coalesce(s.billed, 0) + coalesce(o.billed, 0)          as total_du,
       coalesce(s.rest, 0) + coalesce(o.rest, 0)              as reste_du,
       coalesce(c.credit_amount, 0)                           as avance,
       coalesce(k.available, 0)                               as acompte_commandes,
       coalesce(s.rest, 0) + coalesce(o.rest, 0)
         - coalesce(c.credit_amount, 0) - coalesce(k.available, 0) as solde_net
  from public.clients c
  left join (select client_id, sum(final_amount) as billed, sum(rest_amount) as rest
               from public.sales group by client_id) s on s.client_id = c.id
  left join (select party_id, sum(amount) as billed, sum(rest_amount) as rest
               from public.party_old_debts where party_type = 'client'
              group by party_id) o on o.party_id = c.id
  left join (select client_id, sum(public.command_advance_available(id, null)) as available
               from public.commands group by client_id) k on k.client_id = c.id
union all
select 'supplier'::text,
       s.id,
       s.name,
       coalesce(p.billed, 0) + coalesce(o.billed, 0),
       coalesce(p.rest, 0) + coalesce(o.rest, 0),
       coalesce(s.credit_amount, 0),
       0::numeric,
       coalesce(p.rest, 0) + coalesce(o.rest, 0) - coalesce(s.credit_amount, 0)
  from public.suppliers s
  left join (select supplier_id, sum(total_amount) as billed, sum(rest_amount) as rest
               from public.purchases group by supplier_id) p on p.supplier_id = s.id
  left join (select party_id, sum(amount) as billed, sum(rest_amount) as rest
               from public.party_old_debts where party_type = 'supplier'
              group by party_id) o on o.party_id = s.id;

comment on view public.v_party_balances is
  'Situation nette de chaque tiers : dette (ventes/achats + anciennes dettes), acompte (avance libre + argent des commandes non impute) et solde net.';

do $$
begin
  execute 'alter view public.v_party_balances set (security_invoker = true)';
exception when others then null;
end $$;

-- Controle : AVANT cette mise a jour, modifier une facture deja reglee par un
-- versement recreait un reglement « (modifie) » du montant total, ecrit une
-- deuxieme fois en caisse. Cette vue liste ces reglements pour verification
-- manuelle (les nouveaux « (modifie) » ne contiennent plus jamais l'argent
-- d'un versement).
drop view if exists public.v_controle_reglements_modifies;
create view public.v_controle_reglements_modifies as
select 'vente'::text                  as document,
       s.reference,
       s.date,
       c.name                         as tiers,
       sp.amount                      as reglement_modifie,
       s.final_amount                 as total_document,
       coalesce(c.credit_amount, 0)   as acompte_actuel
  from public.sales s
  join public.sale_payments sp on sp.sale_id = s.id and sp.description = 'Paiement vente (modifie)'
  left join public.clients c on c.id = s.client_id
 where exists (select 1 from public.client_payments p where p.client_id = s.client_id)
union all
select 'achat'::text,
       p.reference,
       p.date,
       su.name,
       pp.amount,
       p.total_amount,
       coalesce(su.credit_amount, 0)
  from public.purchases p
  join public.purchase_payments pp on pp.purchase_id = p.id and pp.description like 'Reglement %(modifie)'
  left join public.suppliers su on su.id = p.supplier_id
 where exists (select 1 from public.supplier_payments x where x.supplier_id = p.supplier_id);

do $$
begin
  execute 'alter view public.v_controle_reglements_modifies set (security_invoker = true)';
exception when others then null;
end $$;


-- ============================================================================
-- 13. REPRISE DES DONNEES
-- ----------------------------------------------------------------------------
--  Tous les comptes sont reconstruits a partir de l'argent REELLEMENT recu :
--
--   a) la monnaie rendue a la caisse n'est plus comptee comme encaissee ;
--   b) chaque facture repart de ce qui a ete encaisse SUR ELLE (caisse, bon
--      de livraison, reglement de dette) ;
--   c) l'argent des commandes est impute sur leurs bons de livraison ;
--   d) le total des versements du tiers (moins les excedents rendus) est
--      re-impute : anciennes dettes, factures, et le reliquat devient son
--      ACOMPTE — y compris l'argent que l'ancien calcul avait perdu.
--
--  Relancer le script refait exactement le meme calcul : il ne fausse rien.
-- ============================================================================

-- ---- a) monnaie rendue ------------------------------------------------------
do $$
declare
  r        record;
  p        record;
  v_excess numeric;
  v_cut    numeric;
begin
  for r in
    select s.id, s.final_amount, coalesce(sum(sp.amount), 0) as rows_sum
      from public.sales s
      join public.sale_payments sp on sp.sale_id = s.id
     where s.delivery_id is null
     group by s.id, s.final_amount
    having coalesce(sum(sp.amount), 0) > s.final_amount + 0.004
  loop
    v_excess := r.rows_sum - r.final_amount;
    for p in
      select id, amount from public.sale_payments
       where sale_id = r.id
       order by date desc, created_at desc
    loop
      exit when v_excess <= 0.004;
      v_cut := least(v_excess, p.amount);
      if v_cut >= p.amount - 0.004 then
        delete from public.sale_payments where id = p.id;
      else
        update public.sale_payments set amount = amount - v_cut where id = p.id;
        update public.caisse_transactions
           set amount = amount - v_cut, updated_at = now()
         where ref_table = 'sale_payments' and ref_id = p.id;
      end if;
      v_excess := v_excess - v_cut;
    end loop;
  end loop;
end $$;

-- ---- b) + c) + d) CLIENTS -----------------------------------------------------
do $$
declare
  r      record;
  v_pool numeric;
begin
  -- factures de caisse : payees de ce qui a ete encaisse sur elles
  update public.sales s
     set allocated_amount = 0,
         paid_amount = least(s.final_amount, coalesce(x.rows_sum, 0)),
         rest_amount = greatest(0, s.final_amount - least(s.final_amount, coalesce(x.rows_sum, 0))),
         status      = case when s.final_amount - least(s.final_amount, coalesce(x.rows_sum, 0)) <= 0.004
                            then 'paid'::public.sale_status else 'debt'::public.sale_status end,
         updated_at  = now()
    from (select s2.id,
                 (select coalesce(sum(sp.amount), 0) from public.sale_payments sp where sp.sale_id = s2.id) as rows_sum
            from public.sales s2 where s2.delivery_id is null) x
   where x.id = s.id;

  -- factures des bons de livraison : reconstruites depuis le bon
  update public.sales set allocated_amount = 0 where delivery_id is not null and allocated_amount <> 0;
  for r in select id from public.command_deliveries order by delivered_at, created_at loop
    perform public.apply_delivery_sale(r.id);
  end loop;

  -- l'argent des commandes descend sur leurs bons de livraison
  for r in select id from public.commands order by created_at loop
    perform public.settle_command_deliveries(r.id);
    perform public.recompute_command_payments(r.id);
  end loop;

  -- anciennes dettes et acomptes repartent de zero...
  update public.party_old_debts
     set paid_amount = 0, rest_amount = amount, updated_at = now()
   where party_type = 'client' and (paid_amount <> 0 or rest_amount <> amount);
  update public.clients set credit_amount = 0 where credit_amount <> 0;

  -- ... puis tout l'argent verse par chaque client est re-impute (moins
  -- l'acompte deja deplace sur ses commandes, qui y reste)
  for r in
    select c.id,
           coalesce((select sum(amount) from public.client_payments p where p.client_id = c.id), 0)
         + coalesce((select sum(amount) from public.client_debt_versements v where v.client_id = c.id), 0)
         - coalesce((select sum(amount) from public.party_credit_refunds f
                      where f.party_type = 'client' and f.party_id = c.id), 0)
         - coalesce((select sum(k.credit_applied) from public.commands k where k.client_id = c.id), 0) as pool
      from public.clients c
  loop
    v_pool := round(coalesce(r.pool, 0), 2);
    if v_pool > 0 then
      perform public.allocate_client_payment(r.id, v_pool);
    elsif v_pool < 0 then
      update public.clients set credit_amount = v_pool where id = r.id;
    end if;
  end loop;
end $$;

-- ---- b) + d) FOURNISSEURS ---------------------------------------------------
do $$
declare
  r      record;
  v_pool numeric;
begin
  -- factures d'achat : reglees de ce qui a ete paye sur elles ; ce qui a ete
  -- paye EN PLUS du total rejoint le compte du fournisseur
  create temporary table tmp_purchase_excess on commit drop as
  select p.supplier_id,
         greatest(0, coalesce((select sum(pp.amount) from public.purchase_payments pp where pp.purchase_id = p.id), 0)
                     - p.total_amount) as excess
    from public.purchases p;

  update public.purchases p
     set allocated_amount = 0,
         paid_amount = least(p.total_amount, coalesce(x.rows_sum, 0)),
         rest_amount = greatest(0, p.total_amount - least(p.total_amount, coalesce(x.rows_sum, 0))),
         updated_at  = now()
    from (select p2.id,
                 (select coalesce(sum(pp.amount), 0) from public.purchase_payments pp where pp.purchase_id = p2.id) as rows_sum
            from public.purchases p2) x
   where x.id = p.id;

  update public.party_old_debts
     set paid_amount = 0, rest_amount = amount, updated_at = now()
   where party_type = 'supplier' and (paid_amount <> 0 or rest_amount <> amount);
  update public.suppliers set credit_amount = 0 where credit_amount <> 0;

  for r in
    select s.id,
           coalesce((select sum(amount) from public.supplier_payments p where p.supplier_id = s.id), 0)
         + coalesce((select sum(excess) from tmp_purchase_excess e where e.supplier_id = s.id), 0)
         - coalesce((select sum(amount) from public.party_credit_refunds f
                      where f.party_type = 'supplier' and f.party_id = s.id), 0) as pool
      from public.suppliers s
  loop
    v_pool := round(coalesce(r.pool, 0), 2);
    if v_pool > 0 then
      perform public.allocate_supplier_payment(r.id, v_pool);
    elsif v_pool < 0 then
      update public.suppliers set credit_amount = v_pool where id = r.id;
    end if;
  end loop;
end $$;


-- ============================================================================
-- 14. DROITS, RLS ET TEMPS REEL
-- ============================================================================

alter table public.command_payments enable row level security;

drop policy if exists command_payments_sel on public.command_payments;
drop policy if exists command_payments_ins on public.command_payments;
drop policy if exists command_payments_upd on public.command_payments;
drop policy if exists command_payments_del on public.command_payments;

create policy command_payments_sel on public.command_payments
  for select to authenticated using (public.has_perm('clients', 'view'));
create policy command_payments_ins on public.command_payments
  for insert to authenticated with check (public.has_perm('clients', 'pay') or public.has_perm('clients', 'edit'));
create policy command_payments_upd on public.command_payments
  for update to authenticated using (public.has_perm('clients', 'edit'))
  with check (public.has_perm('clients', 'edit'));
create policy command_payments_del on public.command_payments
  for delete to authenticated using (public.has_perm('clients', 'delete'));

grant select, insert, update, delete on public.command_payments to authenticated;
grant select on public.v_party_balances to authenticated, service_role;
grant select on public.v_controle_reglements_modifies to authenticated, service_role;

grant execute on function public.command_advance_available(uuid, uuid)   to authenticated, service_role;
grant execute on function public.recompute_command_payments(uuid)         to authenticated, service_role;
grant execute on function public.apply_delivery_sale(uuid)                to authenticated, service_role;
grant execute on function public.allocate_client_payment(uuid, numeric)   to authenticated, service_role;
grant execute on function public.deallocate_client_payment(uuid, numeric) to authenticated, service_role;
grant execute on function public.allocate_supplier_payment(uuid, numeric) to authenticated, service_role;
grant execute on function public.deallocate_supplier_payment(uuid, numeric) to authenticated, service_role;
grant execute on function public.apply_credit_to_sale(uuid, numeric)      to authenticated, service_role;
grant execute on function public.apply_credit_to_command(uuid, numeric)   to authenticated, service_role;
grant execute on function public.apply_credit_to_purchase(uuid, numeric)  to authenticated, service_role;
grant execute on function public.rebalance_party_credit(text, uuid)       to authenticated, service_role;
grant execute on function public.update_sale(uuid, jsonb)                 to authenticated, service_role;
grant execute on function public.pay_sale_debt(uuid, numeric, date, text) to authenticated, service_role;
grant execute on function public.update_purchase(uuid, jsonb)             to authenticated, service_role;
grant execute on function public.pay_command(uuid, numeric, date)         to authenticated, service_role;

do $$
begin
  begin
    alter publication supabase_realtime add table public.command_payments;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;

commit;

-- ============================================================================
--  FIN — VERIFICATIONS RAPIDES
--
--    -- situation de chaque tiers (solde_net negatif = acompte en sa faveur)
--    select * from public.v_party_balances where solde_net <> 0 order by solde_net;
--
--    -- clients qui ont un acompte
--    select name, credit_amount from public.clients where credit_amount <> 0 order by credit_amount desc;
--
--    -- factures payees en partie par le compte du client (versements / acompte)
--    select reference, final_amount, paid_amount, allocated_amount, rest_amount
--      from public.sales where allocated_amount > 0 order by date desc limit 50;
--
--    -- aucune vente ne doit avoir un paye superieur a son total
--    select reference, final_amount, paid_amount from public.sales where paid_amount > final_amount + 0.01;
-- ============================================================================

;


-- ===== altech_production_update_noms_produits_titres.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « NOM DES PRODUITS TOUJOURS A JOUR + TITRES PERSONNALISES DES IMPRESSIONS »
-- ----------------------------------------------------------------------------
--  A EXECUTER EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est IDEMPOTENT : il peut etre relance sans risque.
--
--  PREREQUIS — toutes les mises a jour precedentes, et en dernier :
--    · altech_production_update_acomptes_comptes_rendus.sql
--
--  LE BUG CORRIGE
--  --------------
--  Le nom d'un produit (fiche technique ou produit de stock) est RECOPIE dans
--  chaque ligne de commande, de livraison, de vente, d'achat, de production...
--  Renommer « BETON 380KG/M3 adjuvant » en « BETON 380KG/M3 » ne changeait
--  donc que la fiche : le compte rendu, le bon de livraison, l'historique et le
--  rapport general continuaient d'imprimer l'ANCIEN nom — et chaque nouvelle
--  livraison d'une commande deja passee le recopiait encore.
--
--   1. Un declencheur sur `fiche_technics` et un sur `products` repercutent
--      desormais tout changement de nom dans TOUTES les tables liees.
--   2. Un rattrapage aligne une fois pour toutes les lignes existantes sur le
--      nom actuel de leur fiche / produit.
--   3. Le recalcul des totaux d'un achat ne se declenche plus quand seul le
--      nom d'une ligne change (il ne reagit qu'aux quantites et aux prix).
--
--  NOUVEAUTE
--  ---------
--   4. Table `document_titles` : les titres personnalises choisis a
--      l'impression (compte rendu, bon de livraison, rapport general...),
--      partages par tous les postes.
-- ============================================================================


-- ============================================================================
-- 01. LES TOTAUX D'UN ACHAT NE BOUGENT PLUS QUAND SEUL UN NOM CHANGE
-- ============================================================================

drop trigger if exists trg_purchase_lines_totals on public.purchase_lines;
create trigger trg_purchase_lines_totals
  after insert or delete or update of purchase_id, quantity, purchase_price on public.purchase_lines
  for each row execute function public.trg_recalc_purchase_totals();


-- ============================================================================
-- 02. RENOMMER UNE FICHE TECHNIQUE
-- ----------------------------------------------------------------------------
--  Une ligne appartient a la fiche quand son `fiche_technic_id` la designe ;
--  les anciennes ventes du point de vente portaient l'identifiant de la fiche
--  dans `product_id` : elles sont reconnues aussi.
-- ============================================================================

create or replace function public.propagate_fiche_name(
  p_fiche_id uuid, p_old_name text, p_new_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_fiche_id is null or coalesce(trim(p_new_name), '') = '' then
    return;
  end if;

  -- lignes de commande
  update public.command_items
     set product_name = p_new_name
   where (fiche_technic_id = p_fiche_id or (fiche_technic_id is null and product_id = p_fiche_id))
     and product_name is distinct from p_new_name;

  -- lignes des bons de livraison et des annulations / augmentations
  update public.command_delivery_items di
     set product_name = p_new_name
    from public.command_items ci
   where ci.id = di.command_item_id
     and (ci.fiche_technic_id = p_fiche_id or (ci.fiche_technic_id is null and ci.product_id = p_fiche_id))
     and di.product_name is distinct from p_new_name;

  update public.command_adjustment_lines al
     set product_name = p_new_name
    from public.command_items ci
   where ci.id = al.command_item_id
     and (ci.fiche_technic_id = p_fiche_id or (ci.fiche_technic_id is null and ci.product_id = p_fiche_id))
     and al.product_name is distinct from p_new_name;

  -- lignes de vente (point de vente et factures des bons de livraison)
  update public.sale_lines
     set product_name = p_new_name
   where (fiche_technic_id = p_fiche_id or (fiche_technic_id is null and product_id = p_fiche_id))
     and product_name is distinct from p_new_name;

  -- la fiche utilisee comme ingredient d'une autre fiche / d'une production
  update public.fiche_technic_lines
     set product_name = p_new_name
   where product_id = p_fiche_id
     and source_type::text = 'fiche'
     and product_name is distinct from p_new_name;

  update public.production_used_products
     set product_name = p_new_name
   where product_id = p_fiche_id
     and source_type::text = 'fiche'
     and product_name is distinct from p_new_name;

  -- productions lancees depuis la fiche, puis leur article comptoir et ses
  -- destructions — seulement celles qui portaient encore l'ancien nom
  update public.comptoir_items c
     set product_name = p_new_name
    from public.productions pr
   where pr.id = c.production_id
     and pr.fiche_technic_id = p_fiche_id
     and c.product_name = p_old_name;

  update public.destructions d
     set product_name = p_new_name
    from public.comptoir_items c, public.productions pr
   where c.id = d.comptoir_id
     and pr.id = c.production_id
     and pr.fiche_technic_id = p_fiche_id
     and d.product_name = p_old_name;

  update public.productions
     set name = p_new_name
   where fiche_technic_id = p_fiche_id
     and name = p_old_name;
end;
$fn$;

create or replace function public.trg_fiche_technic_renamed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.name is distinct from old.name then
    perform public.propagate_fiche_name(new.id, old.name, new.name);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_fiche_technics_rename on public.fiche_technics;
create trigger trg_fiche_technics_rename
  after update of name on public.fiche_technics
  for each row execute function public.trg_fiche_technic_renamed();


-- ============================================================================
-- 03. RENOMMER UN PRODUIT DE STOCK
-- ============================================================================

create or replace function public.propagate_product_name(
  p_product_id uuid, p_new_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_product_id is null or coalesce(trim(p_new_name), '') = '' then
    return;
  end if;

  update public.purchase_lines
     set product_name = p_new_name
   where product_id = p_product_id
     and product_name is distinct from p_new_name;

  update public.sale_lines
     set product_name = p_new_name
   where product_id = p_product_id
     and fiche_technic_id is null
     and product_name is distinct from p_new_name;

  update public.command_items
     set product_name = p_new_name
   where product_id = p_product_id
     and fiche_technic_id is null
     and product_name is distinct from p_new_name;

  update public.command_delivery_items di
     set product_name = p_new_name
    from public.command_items ci
   where ci.id = di.command_item_id
     and ci.product_id = p_product_id
     and ci.fiche_technic_id is null
     and di.product_name is distinct from p_new_name;

  update public.command_adjustment_lines al
     set product_name = p_new_name
    from public.command_items ci
   where ci.id = al.command_item_id
     and ci.product_id = p_product_id
     and ci.fiche_technic_id is null
     and al.product_name is distinct from p_new_name;

  update public.command_delivery_consumptions
     set product_name = p_new_name
   where product_id = p_product_id
     and product_name is distinct from p_new_name;

  update public.fiche_technic_lines
     set product_name = p_new_name
   where product_id = p_product_id
     and source_type::text = 'stock'
     and product_name is distinct from p_new_name;

  update public.production_used_products
     set product_name = p_new_name
   where product_id = p_product_id
     and source_type::text = 'stock'
     and product_name is distinct from p_new_name;
end;
$fn$;

create or replace function public.trg_product_renamed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.name is distinct from old.name then
    perform public.propagate_product_name(new.id, new.name);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_products_rename on public.products;
create trigger trg_products_rename
  after update of name on public.products
  for each row execute function public.trg_product_renamed();


-- ============================================================================
-- 04. RATTRAPAGE — toutes les lignes existantes prennent le nom actuel
-- ============================================================================

-- 4.1 fiches techniques
update public.command_items ci
   set product_name = ft.name
  from public.fiche_technics ft
 where ft.id = coalesce(ci.fiche_technic_id, ci.product_id)
   and ci.product_name is distinct from ft.name;

update public.sale_lines sl
   set product_name = ft.name
  from public.fiche_technics ft
 where ft.id = coalesce(sl.fiche_technic_id, sl.product_id)
   and sl.product_name is distinct from ft.name;

update public.fiche_technic_lines l
   set product_name = ft.name
  from public.fiche_technics ft
 where ft.id = l.product_id
   and l.source_type::text = 'fiche'
   and l.product_name is distinct from ft.name;

update public.production_used_products u
   set product_name = ft.name
  from public.fiche_technics ft
 where ft.id = u.product_id
   and u.source_type::text = 'fiche'
   and u.product_name is distinct from ft.name;

-- 4.2 produits de stock
update public.purchase_lines pl
   set product_name = p.name
  from public.products p
 where p.id = pl.product_id
   and pl.product_name is distinct from p.name;

update public.sale_lines sl
   set product_name = p.name
  from public.products p
 where p.id = sl.product_id
   and sl.fiche_technic_id is null
   and sl.product_name is distinct from p.name;

update public.command_items ci
   set product_name = p.name
  from public.products p
 where p.id = ci.product_id
   and ci.fiche_technic_id is null
   and ci.product_name is distinct from p.name;

update public.command_delivery_consumptions c
   set product_name = p.name
  from public.products p
 where p.id = c.product_id
   and c.product_name is distinct from p.name;

update public.fiche_technic_lines l
   set product_name = p.name
  from public.products p
 where p.id = l.product_id
   and l.source_type::text = 'stock'
   and l.product_name is distinct from p.name;

update public.production_used_products u
   set product_name = p.name
  from public.products p
 where p.id = u.product_id
   and u.source_type::text = 'stock'
   and u.product_name is distinct from p.name;

-- 4.3 livraisons et annulations : le nom de leur ligne de commande
update public.command_delivery_items di
   set product_name = ci.product_name
  from public.command_items ci
 where ci.id = di.command_item_id
   and di.product_name is distinct from ci.product_name;

update public.command_adjustment_lines al
   set product_name = ci.product_name
  from public.command_items ci
 where ci.id = al.command_item_id
   and al.product_name is distinct from ci.product_name;


-- ============================================================================
-- 05. TITRES PERSONNALISES DES IMPRESSIONS
-- ----------------------------------------------------------------------------
--  `scope` regroupe les titres par famille de document :
--    statement (compte rendu), delivery (bon de livraison), report (rapport
--    general), list (listes / historiques). Un titre peut servir partout.
-- ============================================================================

create table if not exists public.document_titles (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  scope      text not null default 'statement',
  created_by text default public.current_username(),
  created_at timestamptz not null default now()
);

create unique index if not exists document_titles_scope_title_key
  on public.document_titles (scope, upper(title));

alter table public.document_titles enable row level security;

drop policy if exists document_titles_sel on public.document_titles;
drop policy if exists document_titles_ins on public.document_titles;
drop policy if exists document_titles_upd on public.document_titles;
drop policy if exists document_titles_del on public.document_titles;

create policy document_titles_sel on public.document_titles
  for select to authenticated using (true);
create policy document_titles_ins on public.document_titles
  for insert to authenticated with check (true);
create policy document_titles_upd on public.document_titles
  for update to authenticated using (true) with check (true);
create policy document_titles_del on public.document_titles
  for delete to authenticated using (true);

grant select, insert, update, delete on public.document_titles to authenticated;

comment on table public.document_titles is
  'Titres personnalises proposes a l''impression (compte rendu, bon de livraison, rapport general, listes).';

notify pgrst, 'reload schema';

;


-- ===== altech_production_update_releve_modifications.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « RELEVE : VOIR ET MODIFIER CHAQUE LIGNE DU COMPTE RENDU »
-- ----------------------------------------------------------------------------
--  A EXECUTER EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est IDEMPOTENT : il peut etre relance sans risque.
--
--  PREREQUIS — toutes les mises a jour precedentes, et en dernier :
--    · altech_production_update_noms_produits_titres.sql
--
--  Chaque ligne du releve (compte rendu client / fournisseur, bon de livraison
--  de periode, rapport general) peut maintenant etre modifiee depuis le releve
--  lui-meme. Les ventes, bons de livraison, achats, anciennes dettes et
--  versements avaient deja leur fonction de modification ; il manquait :
--
--   1. update_sale_lines()       — les LIGNES d'une vente de caisse
--                                  (designation, quantite, prix unitaire),
--                                  avec correction du stock / du comptoir,
--                                  puis recalcul complet de la facture.
--   2. update_command_payment()  — un reglement de commande (montant, date).
--   3. update_party_refund()     — un excedent rendu / recupere.
--
--  Tous les totaux derives (reste, dette du tiers, acompte, caisse) sont
--  recalcules par les fonctions existantes appelees en fin de traitement.
-- ============================================================================


-- ============================================================================
-- 01. LIGNES D'UNE VENTE DE CAISSE
-- ----------------------------------------------------------------------------
--  p_lines   : [{ "id": uuid, "product_name": text, "quantity": num,
--                 "selling_price": num }]   — quantite 0 = ligne supprimee
--  p_header  : meme contenu que update_sale() (date, reduction, paid_amount,
--              tva_enabled, tva_rate, note)
--
--  L'ecart de quantite d'une vente NORMALE (pas « ancienne ») est repercute :
--    · article du comptoir -> comptoir_items.quantity
--    · produit du stock    -> stock (sortie ou retour, trace dans stock_movements)
--    · fiche technique     -> matieres premieres de sa recette
--  Une facture issue d'un bon de livraison se modifie par son BON : refusee ici.
-- ============================================================================

create or replace function public.update_sale_lines(
  p_sale_id uuid, p_lines jsonb, p_header jsonb default '{}'::jsonb
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale  public.sales;
  v_item  jsonb;
  v_line  public.sale_lines;
  v_qty   numeric;
  v_price numeric;
  v_name  text;
  v_delta numeric;
  v_req   record;
  v_left  numeric;
  v_kept  int;
begin
  if not public.has_perm('clients', 'edit') and not public.has_perm('sales', 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier une vente';
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null then
    raise exception 'Vente introuvable (%)', p_sale_id;
  end if;
  if v_sale.delivery_id is not null then
    raise exception 'Cette facture vient d''un bon de livraison : modifiez le bon lui-meme.';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into v_line
      from public.sale_lines
     where id = nullif(v_item ->> 'id', '')::uuid and sale_id = p_sale_id;
    if v_line.id is null then
      continue;
    end if;

    v_qty   := greatest(0, coalesce((v_item ->> 'quantity')::numeric, v_line.quantity));
    v_price := greatest(0, coalesce((v_item ->> 'selling_price')::numeric, v_line.selling_price));
    v_name  := coalesce(nullif(btrim(v_item ->> 'product_name'), ''), v_line.product_name);
    v_delta := v_qty - v_line.quantity;

    -- ---- le stock suit l'ecart de quantite (jamais pour une ancienne vente)
    if abs(v_delta) > 0.0005 and not coalesce(v_sale.is_historical, false) then
      if v_line.comptoir_id is not null then
        update public.comptoir_items
           set quantity = greatest(0, quantity - v_delta), updated_at = now()
         where id = v_line.comptoir_id;

      elsif v_line.fiche_technic_id is not null then
        for v_req in
          select r.product_id, r.product_name, sum(r.quantity) as quantity
            from public.fiche_stock_requirements(v_line.fiche_technic_id, abs(v_delta)) r
           group by r.product_id, r.product_name
        loop
          if v_delta > 0 then
            perform public.consume_stock(v_req.product_id, v_req.quantity, 'sale_edit',
                                         'sales', p_sale_id, v_req.product_name);
          else
            update public.products
               set current_quantity = current_quantity + v_req.quantity, updated_at = now()
             where id = public.resolve_stock_product(v_req.product_id, v_req.product_name)
            returning current_quantity into v_left;
            if v_left is not null then
              insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
              values (public.resolve_stock_product(v_req.product_id, v_req.product_name),
                      v_req.quantity, 'sale_edit', 'sales', p_sale_id, v_left);
            end if;
          end if;
        end loop;

      elsif v_line.product_id is not null
            and exists (select 1 from public.products where id = v_line.product_id) then
        if v_delta > 0 then
          perform public.consume_stock(v_line.product_id, v_delta, 'sale_edit',
                                       'sales', p_sale_id, v_line.product_name);
        else
          update public.products
             set current_quantity = current_quantity - v_delta, updated_at = now()
           where id = v_line.product_id
          returning current_quantity into v_left;
          insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
          values (v_line.product_id, -v_delta, 'sale_edit', 'sales', p_sale_id, v_left);
        end if;
      end if;
    end if;

    if v_qty <= 0 then
      delete from public.sale_lines where id = v_line.id;
    else
      update public.sale_lines
         set quantity      = v_qty,
             selling_price = v_price,
             product_name  = v_name
       where id = v_line.id;
    end if;
  end loop;

  select count(*) into v_kept from public.sale_lines where sale_id = p_sale_id;
  if v_kept = 0 then
    raise exception 'Une vente doit garder au moins une ligne — supprimez plutot la vente.';
  end if;

  -- total, TVA, paye, reste, dette client et caisse : update_sale() recalcule tout
  select * into v_sale from public.update_sale(p_sale_id, coalesce(p_header, '{}'::jsonb));

  perform public.log_activity('sales', 'update', 'sale_lines', p_sale_id, p_lines);
  return v_sale;
end;
$fn$;


-- ============================================================================
-- 02. REGLEMENT D'UNE COMMANDE
-- ----------------------------------------------------------------------------
--  Le cumul `commands.extra_paid` suit l'ecart ; la caisse suit via le
--  declencheur trg_command_payment_caisse ; le paye / reste de la commande
--  est recalcule par recompute_command_payments().
-- ============================================================================

create or replace function public.update_command_payment(
  p_id uuid, p_amount numeric, p_date date default null, p_notes text default null
)
returns public.command_payments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old public.command_payments;
  v_new public.command_payments;
begin
  if not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier un reglement';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  select * into v_old from public.command_payments where id = p_id;
  if v_old.id is null then
    raise exception 'Reglement introuvable (%)', p_id;
  end if;

  update public.command_payments
     set amount = p_amount,
         date   = coalesce(p_date, date),
         notes  = coalesce(p_notes, notes)
   where id = p_id
  returning * into v_new;

  update public.commands
     set extra_paid = greatest(0, coalesce(extra_paid, 0) + (p_amount - v_old.amount)),
         updated_at = now()
   where id = v_old.command_id;

  perform public.recompute_command_payments(v_old.command_id);
  perform public.log_activity('clients', 'update', 'command_payments', p_id,
    jsonb_build_object('amount', p_amount, 'old_amount', v_old.amount, 'date', v_new.date));
  return v_new;
end;
$fn$;


-- ============================================================================
-- 03. EXCEDENT RENDU AU CLIENT / RECUPERE DU FOURNISSEUR
-- ----------------------------------------------------------------------------
--  L'acompte du tiers est corrige de l'ecart (il ne peut pas devenir
--  negatif) ; la caisse suit via le declencheur trg_party_refund_caisse.
-- ============================================================================

create or replace function public.update_party_refund(
  p_id              uuid,
  p_amount          numeric,
  p_refunded_at     timestamptz default null,
  p_notes           text default null,
  p_method          text default null,
  p_cheque_number   text default null,
  p_virement_number text default null,
  p_bank_name       text default null
)
returns public.party_credit_refunds
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old    public.party_credit_refunds;
  v_row    public.party_credit_refunds;
  v_module text;
  v_credit numeric := 0;
  v_method text;
begin
  select * into v_old from public.party_credit_refunds where id = p_id;
  if v_old.id is null then
    raise exception 'Remboursement introuvable (%)', p_id;
  end if;

  v_module := case when v_old.party_type = 'supplier' then 'suppliers' else 'clients' end;
  if not public.has_perm(v_module, 'edit') and not public.has_perm(v_module, 'pay') then
    raise exception 'Vous n''avez pas la permission de modifier ce remboursement';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  v_method := lower(coalesce(nullif(btrim(p_method), ''), v_old.method, 'especes'));
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de reglement inconnu : %', p_method;
  end if;

  if v_old.party_type = 'client' then
    select coalesce(credit_amount, 0) into v_credit from public.clients where id = v_old.party_id;
  else
    select coalesce(credit_amount, 0) into v_credit from public.suppliers where id = v_old.party_id;
  end if;

  -- l'ancien montant revient d'abord au tiers, puis le nouveau en sort
  if p_amount > v_credit + v_old.amount + 0.005 then
    raise exception 'Excedent disponible insuffisant : % DA',
      to_char(v_credit + v_old.amount, 'FM999999999.00');
  end if;

  if v_old.party_type = 'client' then
    update public.clients
       set credit_amount = greatest(0, coalesce(credit_amount, 0) + v_old.amount - p_amount), updated_at = now()
     where id = v_old.party_id;
  else
    update public.suppliers
       set credit_amount = greatest(0, coalesce(credit_amount, 0) + v_old.amount - p_amount), updated_at = now()
     where id = v_old.party_id;
  end if;

  update public.party_credit_refunds
     set amount          = p_amount,
         refunded_at     = coalesce(p_refunded_at, refunded_at),
         date            = coalesce(p_refunded_at, refunded_at)::date,
         notes           = coalesce(p_notes, notes),
         method          = v_method,
         cheque_number   = case when v_method = 'cheque'   then nullif(btrim(coalesce(p_cheque_number, cheque_number)), '') end,
         virement_number = case when v_method = 'virement' then nullif(btrim(coalesce(p_virement_number, virement_number)), '') end,
         bank_name       = case when v_method <> 'especes' then nullif(btrim(coalesce(p_bank_name, bank_name)), '') end,
         updated_at      = now()
   where id = p_id
  returning * into v_row;

  perform public.log_activity(v_module, 'update', 'party_credit_refunds', p_id,
    jsonb_build_object('amount', p_amount, 'old_amount', v_old.amount));
  return v_row;
end;
$fn$;


-- ============================================================================
-- 04. DROITS
-- ============================================================================

grant execute on function public.update_sale_lines(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.update_command_payment(uuid, numeric, date, text) to authenticated, service_role;
grant execute on function public.update_party_refund(uuid, numeric, timestamptz, text, text, text, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

;


-- ===== altech_production_update_argent_compte_deux_fois.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « LE MEME ARGENT COMPTE DEUX FOIS : COMMANDES + VERSEMENTS »
-- ----------------------------------------------------------------------------
--  A EXECUTER EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est IDEMPOTENT : il peut etre relance sans risque.
--
--  PREREQUIS — toutes les mises a jour precedentes, et en dernier :
--    · altech_production_update_releve_modifications.sql
--
--  LE BUG
--  ------
--  Exemple reel (client HERRAZI) :
--     ventes (20 bons de livraison)        8 150 350,00 DA
--     versements directs                   7 310 000,00 DA
--     => dette reelle                        840 350,00 DA
--  Or la carte affichait « Total paye 14 060 000 » et un ACOMPTE de
--  5 909 650 DA en faveur du client.
--
--  Cause : l'ANCIEN pay_client() imputait le versement sur les ventes puis sur
--  les COMMANDES (commands.paid_amount). La mise a jour « livraison = vente »
--  a transforme ce paye en « reglements de commande » (commands.extra_paid),
--  puis la mise a jour « acomptes » en a fait des lignes command_payments
--  « Reprise (date inconnue) » — SANS ecriture de caisse, puisque cet argent
--  etait deja entre en caisse avec le VERSEMENT.
--  Enfin la reprise des acomptes a re-impute la TOTALITE des versements :
--     5 750 000 + 1 000 000 (deja poses sur les commandes)  -> comptes 2 fois
--  Ces 6 750 000 DA payaient les 16 premiers bons ; les versements, re-imputes,
--  ne trouvaient plus de dette et devenaient un faux acompte (5 909 650 DA).
--  La carte, le compte rendu et le bon de livraison imprime suivaient.
--
--  LA CORRECTION
--  -------------
--   01. Sauvegarde des lignes retirees (repair_phantom_command_payments) —
--       rien n'est perdu, tout peut etre controle.
--   02. Retrait des reglements de commande FANTOMES :
--         · « Reprise (date inconnue) » d'une commande normale : un vrai
--           reglement de commande a TOUJOURS son ecriture de caisse — sans
--           elle, c'est de l'argent venu d'un versement (ou d'un bon) ;
--         · « Reprise (date inconnue) » d'une ANCIENNE commande (qui n'ecrit
--           jamais en caisse) : retiree dans la limite des versements du client
--           non deja retrouves sur ses commandes normales.
--   03. Chaque client concerne est reconstruit exactement comme la reprise
--       des acomptes : bons de livraison, argent des commandes, puis TOUS ses
--       versements re-imputes (anciennes dettes, factures, reliquat = acompte).
--   04. cancel_credit_imputation() — bouton « Supprimer » de l'onglet
--       « Acompte & imputations » : l'argent impute revient en ACOMPTE.
--   05. resettle_command_deliveries() — re-repartit l'argent d'une commande
--       sur tous ses bons (utilisee par 03 et 04).
-- ============================================================================

begin;

-- ============================================================================
-- 05. (defini en premier : utilise plus bas)
--     RE-REPARTIR L'ARGENT D'UNE COMMANDE SUR TOUS SES BONS
-- ----------------------------------------------------------------------------
--  settle_command_deliveries() ne REDUIT jamais l'imputation d'un bon : si
--  l'argent de la commande diminue, les derniers bons gardaient un acompte qui
--  n'existe plus. Ici tout repart de zero puis est reimpute du plus ancien au
--  plus recent.
-- ============================================================================

create or replace function public.resettle_command_deliveries(p_command_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
begin
  if p_command_id is null then return; end if;

  update public.command_deliveries
     set advance_applied = 0, updated_at = now()
   where command_id = p_command_id and coalesce(advance_applied, 0) <> 0;

  for r in
    select id from public.command_deliveries
     where command_id = p_command_id
     order by delivered_at, created_at
  loop
    perform public.apply_delivery_sale(r.id);
  end loop;

  perform public.settle_command_deliveries(p_command_id);
  perform public.recompute_command_payments(p_command_id);
end;
$fn$;

comment on function public.resettle_command_deliveries(uuid) is
  'Remet a zero l''acompte impute sur chaque bon d''une commande puis le re-repartit (plus ancien d''abord) selon l''argent REEL de la commande.';


-- ============================================================================
-- 01. SAUVEGARDE DES LIGNES RETIREES
-- ============================================================================

create table if not exists public.repair_phantom_command_payments (
  id            uuid primary key,
  command_id    uuid,
  command_ref   text,
  client_id     uuid,
  is_historical boolean,
  amount        numeric(14,2),
  date          date,
  notes         text,
  created_at    timestamptz,
  repaired_at   timestamptz not null default now()
);

comment on table public.repair_phantom_command_payments is
  'Reglements de commande retires par la mise a jour « argent compte deux fois » : argent deja compte par un versement du client.';

alter table public.repair_phantom_command_payments enable row level security;
drop policy if exists repair_phantom_read on public.repair_phantom_command_payments;
create policy repair_phantom_read on public.repair_phantom_command_payments
  for select to authenticated using (true);


-- ============================================================================
-- 02. + 03. RETRAIT DES REGLEMENTS FANTOMES ET RECONSTRUCTION DES CLIENTS
-- ============================================================================

do $$
declare
  r         record;
  c         record;
  v_budget  numeric;
  v_take    numeric;
  v_pool    numeric;
  v_clients uuid[] := '{}';
begin
  -- ---- 02.a commandes NORMALES : toute « Reprise (date inconnue) » ----------
  --      (aucune ecriture de caisse derriere) est de l'argent deja compte
  for r in
    select cp.id, cp.command_id, k.reference, k.client_id, cp.amount, cp.date, cp.notes, cp.created_at
      from public.command_payments cp
      join public.commands k on k.id = cp.command_id
     where cp.notes like 'Reprise (date inconnue)%'
       and not coalesce(k.is_historical, false)
       and not exists (select 1 from public.caisse_transactions t
                        where t.ref_table = 'command_payments' and t.ref_id = cp.id)
  loop
    insert into public.repair_phantom_command_payments
      (id, command_id, command_ref, client_id, is_historical, amount, date, notes, created_at)
    values (r.id, r.command_id, r.reference, r.client_id, false, r.amount, r.date, r.notes, r.created_at)
    on conflict (id) do nothing;
    delete from public.command_payments where id = r.id;   -- le declencheur baisse extra_paid
    if r.client_id is not null then v_clients := array_append(v_clients, r.client_id); end if;
  end loop;

  -- ---- 02.b ANCIENNES commandes : dans la limite des versements du client ---
  for c in
    select distinct k.client_id
      from public.command_payments cp
      join public.commands k on k.id = cp.command_id
     where cp.notes like 'Reprise (date inconnue)%'
       and coalesce(k.is_historical, false)
       and k.client_id is not null
  loop
    v_budget :=
        coalesce((select sum(amount) from public.client_payments p where p.client_id = c.client_id), 0)
      + coalesce((select sum(amount) from public.client_debt_versements v where v.client_id = c.client_id), 0)
      - coalesce((select sum(amount) from public.repair_phantom_command_payments x
                   where x.client_id = c.client_id), 0);

    for r in
      select cp.id, cp.command_id, k.reference, cp.amount, cp.date, cp.notes, cp.created_at
        from public.command_payments cp
        join public.commands k on k.id = cp.command_id
       where cp.notes like 'Reprise (date inconnue)%'
         and coalesce(k.is_historical, false)
         and k.client_id = c.client_id
       order by k.created_at, cp.created_at
    loop
      exit when v_budget <= 0.004;
      v_take := least(v_budget, r.amount);
      insert into public.repair_phantom_command_payments
        (id, command_id, command_ref, client_id, is_historical, amount, date, notes, created_at)
      values (r.id, r.command_id, r.reference, c.client_id, true, v_take, r.date, r.notes, r.created_at)
      on conflict (id) do nothing;
      if v_take >= r.amount - 0.004 then
        delete from public.command_payments where id = r.id;
      else
        update public.command_payments set amount = amount - v_take where id = r.id;
        update public.commands
           set extra_paid = greatest(0, coalesce(extra_paid, 0) - v_take), updated_at = now()
         where id = r.command_id;
      end if;
      v_budget := v_budget - v_take;
      v_clients := array_append(v_clients, c.client_id);
    end loop;
  end loop;

  -- ---- 02.c le cumul extra_paid = somme des reglements dates ------------------
  update public.commands k
     set extra_paid = coalesce((select sum(cp.amount) from public.command_payments cp
                                 where cp.command_id = k.id), 0),
         updated_at = now()
   where k.client_id = any(v_clients)
     and coalesce(k.extra_paid, 0) <> coalesce((select sum(cp.amount) from public.command_payments cp
                                                 where cp.command_id = k.id), 0);

  -- ---- 03. reconstruction de chaque client concerne ---------------------------
  for c in select distinct unnest(v_clients) as client_id loop
    -- factures de caisse : payees de ce qui a ete encaisse sur elles
    update public.sales s
       set allocated_amount = 0,
           paid_amount = least(s.final_amount, x.rows_sum),
           rest_amount = greatest(0, s.final_amount - least(s.final_amount, x.rows_sum)),
           status      = case when s.final_amount - least(s.final_amount, x.rows_sum) <= 0.004
                              then 'paid'::public.sale_status else 'debt'::public.sale_status end,
           updated_at  = now()
      from (select s2.id,
                   coalesce((select sum(sp.amount) from public.sale_payments sp where sp.sale_id = s2.id), 0) as rows_sum
              from public.sales s2
             where s2.client_id = c.client_id and s2.delivery_id is null) x
     where x.id = s.id;

    -- factures des bons de livraison : l'argent du compte repart de zero
    update public.sales set allocated_amount = 0, updated_at = now()
     where client_id = c.client_id and delivery_id is not null and coalesce(allocated_amount, 0) <> 0;

    -- l'argent REEL de chaque commande redescend sur ses bons
    for r in select id from public.commands where client_id = c.client_id order by created_at loop
      perform public.resettle_command_deliveries(r.id);
    end loop;

    -- anciennes dettes et acompte repartent de zero...
    update public.party_old_debts
       set paid_amount = 0, rest_amount = amount, updated_at = now()
     where party_type = 'client' and party_id = c.client_id
       and (paid_amount <> 0 or rest_amount <> amount);
    update public.clients set credit_amount = 0, updated_at = now() where id = c.client_id;

    -- ... puis TOUS les versements du client sont re-imputes une seule fois
    v_pool := round(
        coalesce((select sum(amount) from public.client_payments p where p.client_id = c.client_id), 0)
      + coalesce((select sum(amount) from public.client_debt_versements v where v.client_id = c.client_id), 0)
      - coalesce((select sum(amount) from public.party_credit_refunds f
                   where f.party_type = 'client' and f.party_id = c.client_id), 0)
      - coalesce((select sum(k.credit_applied) from public.commands k where k.client_id = c.client_id), 0)
    , 2);
    if v_pool > 0 then
      perform public.allocate_client_payment(c.client_id, v_pool);
    elsif v_pool < 0 then
      update public.clients set credit_amount = v_pool where id = c.client_id;
    end if;
  end loop;

  select count(distinct x) into v_pool from unnest(v_clients) x;
  raise notice 'Clients corriges : %', v_pool;
end $$;


-- ============================================================================
-- 04. SUPPRIMER UNE IMPUTATION DE L'ACOMPTE
-- ----------------------------------------------------------------------------
--  Onglet « Acompte & imputations » de l'historique client, bouton Supprimer.
--  p_kind = 'sale'    : la part d'une vente / d'un bon payee par le compte du
--                       client (sales.allocated_amount) ;
--           'command' : l'acompte du client utilise comme acompte d'une
--                       commande (commands.credit_applied).
--  L'argent n'est PAS perdu : il revient dans l'ACOMPTE du client, et le
--  document retrouve son reste du. Aucune ecriture de caisse (l'argent y est
--  entre avec le versement). Renvoie le montant rendu a l'acompte.
-- ============================================================================

create or replace function public.cancel_credit_imputation(p_kind text, p_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale   public.sales;
  v_cmd    public.commands;
  v_amt    numeric := 0;
  v_client uuid;
  v_paid   numeric;
begin
  if not (public.has_perm('clients', 'delete') or public.has_perm('clients', 'edit')) then
    raise exception 'Vous n''avez pas la permission de supprimer une imputation';
  end if;

  if lower(coalesce(p_kind, '')) = 'command' then
    select * into v_cmd from public.commands where id = p_id;
    if v_cmd.id is null then raise exception 'Commande introuvable'; end if;
    v_amt := greatest(0, coalesce(v_cmd.credit_applied, 0));
    v_client := v_cmd.client_id;
    if v_amt <= 0.004 then return 0; end if;

    update public.commands set credit_applied = 0, updated_at = now() where id = p_id;
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + v_amt, updated_at = now()
     where id = v_client;
    -- les bons ne peuvent plus compter sur cet argent
    perform public.resettle_command_deliveries(p_id);

  else
    select * into v_sale from public.sales where id = p_id;
    if v_sale.id is null then raise exception 'Facture introuvable'; end if;
    v_amt := greatest(0, coalesce(v_sale.allocated_amount, 0));
    v_client := v_sale.client_id;
    if v_amt <= 0.004 then return 0; end if;

    if v_sale.delivery_id is not null then
      update public.sales set allocated_amount = 0, updated_at = now() where id = p_id;
      perform public.apply_delivery_sale(v_sale.delivery_id);
    else
      v_paid := greatest(0, v_sale.paid_amount - v_amt);
      update public.sales
         set allocated_amount = 0,
             paid_amount      = v_paid,
             rest_amount      = greatest(0, final_amount - v_paid),
             status           = case when final_amount - v_paid <= 0 then 'paid'::public.sale_status
                                     else 'debt'::public.sale_status end,
             updated_at       = now()
       where id = p_id;
    end if;

    if v_client is not null then
      update public.clients
         set credit_amount = coalesce(credit_amount, 0) + v_amt, updated_at = now()
       where id = v_client;
    end if;
  end if;

  perform public.log_activity('clients', 'credit_cancel',
    case when lower(coalesce(p_kind, '')) = 'command' then 'commands' else 'sales' end,
    p_id, jsonb_build_object('amount', v_amt));
  return v_amt;
end;
$fn$;

comment on function public.cancel_credit_imputation(text, uuid) is
  'Annule l''imputation de l''acompte client sur une vente / un bon (sale) ou une commande (command) : le montant revient dans l''acompte du client.';


-- ============================================================================
-- DROITS
-- ============================================================================

grant execute on function public.resettle_command_deliveries(uuid) to authenticated, service_role;
grant execute on function public.cancel_credit_imputation(text, uuid) to authenticated, service_role;
grant select on public.repair_phantom_command_payments to authenticated, service_role;

commit;

notify pgrst, 'reload schema';


-- ============================================================================
-- CONTROLE (facultatif) — a lancer apres le script
-- ============================================================================
--  Ce qui a ete retire, par client :
--    select c.name, x.command_ref, x.is_historical, x.amount, x.date
--      from public.repair_phantom_command_payments x
--      left join public.clients c on c.id = x.client_id
--     order by c.name, x.date;
--
--  Situation de chaque client : factures, argent recu, solde
--    select c.name,
--           (select coalesce(sum(final_amount), 0) from public.sales s where s.client_id = c.id) as ventes,
--           (select coalesce(sum(amount), 0) from public.client_payments p where p.client_id = c.id) as versements,
--           (select coalesce(sum(rest_amount), 0) from public.sales s where s.client_id = c.id) as reste_factures,
--           c.credit_amount as acompte
--      from public.clients c
--     order by c.name;

;


-- ===== altech_production_update_modification_commandes_compte_rendu.sql =====
-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « MODIFIER UNE COMMANDE / UN BON / UN VERSEMENT : TOUT SUIT »
--  « COMPTE RENDU : TOUT SE MODIFIE, TOUT SE RECALCULE »
-- ----------------------------------------------------------------------------
--  A EXECUTER EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est IDEMPOTENT : il peut etre relance sans risque.
--
--  PREREQUIS — toutes les mises a jour precedentes, et en dernier :
--    · altech_production_update_argent_compte_deux_fois.sql
--
--  LES BUGS CORRIGES
--  -----------------
--  1. « JE MODIFIE LE PRIX D'UNE COMMANDE, LA CARTE GARDE L'ANCIEN PRIX ».
--     L'ecran renvoyait l'ANCIEN total dans « Ajuster le total ». La base
--     revalorisait bien les bons de livraison au nouveau prix, mais la
--     commande gardait son ancien total : carte, reste du et « restant a
--     livrer » faux.
--     Exemple reel (client 00DJAMAL) : CMD-2026-132, 7 x 8 500 -> 7 x 8 499.
--       bon + facture  59 493,00 DA (nouveau prix)
--       commande       59 500,00 DA (ancien total)  -> « 7,00 DA restant a livrer »
--     -> update_command() ignore desormais un total renvoye tel quel quand il
--        n'avait jamais ete ajuste a la main : il suit les lignes.
--
--  2. BAISSER L'ACOMPTE OU UN REGLEMENT D'UNE COMMANDE LAISSAIT DE L'ARGENT
--     FANTOME SUR SES BONS : l'acompte deja impute n'etait jamais reduit.
--     -> l'argent de la commande est re-reparti des qu'il ne couvre plus ce
--        qui est impute (modification de commande, de reglement, de bon,
--        suppression d'un reglement ou d'un bon).
--
--  3. UN BON DE LIVRAISON DATE DANS LE FUTUR (faute de frappe sur l'annee).
--     Exemple reel : BL-CMD-2025-093-01 du 16/12/2026 au lieu du 16/12/2025 —
--     la facture VNT-2026-192 sortait du compte rendu de decembre 2025.
--
--  4. « LIVRAISON PREVUE » ANTERIEURE A LA CREATION DE LA COMMANDE
--     (ex. CMD-2026-389 creee le 20/09/2026, prevue le 20/08/2026).
--
--  CE QUE LE SCRIPT AJOUTE
--  -----------------------
--    01. repair_command_edits — journal de tout ce que la reprise corrige
--    02. command_lines_total() / fix_command_over_imputation()
--    03. update_command()            — le total suit les lignes
--    04. update_command_delivery()   — l'argent de la commande reste juste
--    05. delete_command_delivery()   — l'argent libere paie les autres bons
--    06. update_command_payment() et suppression d'un reglement
--    07. rebuild_client_account()    — bouton « Recalculer le compte »
--    08. v_client_account_check      — controle de coherence de chaque client
--    09. REPRISE DES DONNEES (dont 00DJAMAL et HAMZA CHANTIER OUDJAR)
--    10. Droits
-- ============================================================================

begin;

-- ============================================================================
-- 01. JOURNAL DES CORRECTIONS
-- ============================================================================

create table if not exists public.repair_command_edits (
  id          bigserial primary key,
  kind        text not null,             -- total / delivery_date / receive_date / money / account
  ref_table   text,
  ref_id      uuid,
  reference   text,
  client_id   uuid,
  old_value   text,
  new_value   text,
  repaired_at timestamptz not null default now()
);

comment on table public.repair_command_edits is
  'Corrections appliquees par la mise a jour « modification commandes / compte rendu » : rien n''est perdu, tout peut etre controle.';

alter table public.repair_command_edits enable row level security;
drop policy if exists repair_command_edits_read on public.repair_command_edits;
create policy repair_command_edits_read on public.repair_command_edits
  for select to authenticated using (true);


-- ============================================================================
-- 02. OUTILS
-- ============================================================================

/** Total HORS TAXES d'une commande tel que ses lignes le donnent. */
create or replace function public.command_lines_total(p_command_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(sum(round(greatest(0, quantity - coalesce(cancelled_quantity, 0))
                            * coalesce(unit_price, 0), 2)), 0)
    from public.command_items
   where command_id = p_command_id;
$fn$;

/**
 * L'argent d'une commande (acompte + reglements + acompte client) ne doit
 * jamais etre inferieur a ce qui est deja impute sur ses bons. Si c'est le cas
 * (acompte ou reglement baisse / supprime), tout est re-reparti.
 * Renvoie true quand une re-repartition a eu lieu.
 */
create or replace function public.fix_command_over_imputation(p_command_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_money numeric;
  v_used  numeric;
begin
  if p_command_id is null then return false; end if;

  select coalesce(advance_paid, 0) + coalesce(extra_paid, 0) + coalesce(credit_applied, 0)
    into v_money
    from public.commands where id = p_command_id;
  if v_money is null then return false; end if;

  select coalesce(sum(advance_applied), 0) into v_used
    from public.command_deliveries where command_id = p_command_id;

  if v_used > v_money + 0.004 then
    perform public.resettle_command_deliveries(p_command_id);
    return true;
  end if;
  return false;
end;
$fn$;


-- ============================================================================
-- 03. update_command() — MODIFIER UNE COMMANDE, LE TOTAL SUIT LES LIGNES
-- ----------------------------------------------------------------------------
--  Identique a la version precedente, plus :
--   · un total renvoye INCHANGE par l'ecran, alors qu'il n'avait jamais ete
--     ajuste a la main, est ignore : il est recalcule des lignes (bug du prix
--     modifie qui ne changeait pas la carte) ;
--   · l'argent de la commande est re-reparti s'il ne couvre plus ses bons ;
--   · le reliquat disponible descend sur les bons non soldes.
-- ============================================================================

create or replace function public.update_command(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd        public.commands;
  v_item       jsonb;
  v_line_id    uuid;
  v_kept       boolean := true;
  v_seen       uuid[]  := '{}';
  v_pos        int     := 0;
  v_adv_old    numeric;
  v_adv_new    numeric;
  v_delivered  numeric;
  v_old_total  numeric;
  v_old_lines  numeric;
  v_total      numeric;
  r            record;
begin
  if not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier une commande';
  end if;

  select * into v_cmd from public.commands where id = p_id;
  if v_cmd.id is null then raise exception 'Commande introuvable'; end if;

  v_old_total := coalesce(v_cmd.total_amount, 0);
  v_old_lines := public.command_lines_total(p_id);

  v_adv_old := coalesce(v_cmd.advance_paid, 0);
  v_adv_new := case when p_payload ? 'advance_paid'
                    then greatest(0, coalesce((p_payload ->> 'advance_paid')::numeric, 0))
                    else v_adv_old end;

  -- ---------------------------------------------------------- l'en-tete ----
  update public.commands
     set client_id      = coalesce(nullif(p_payload ->> 'client_id', '')::uuid, client_id),
         client_name    = coalesce(nullif(p_payload ->> 'client_name', ''), client_name),
         client_phone   = case when p_payload ? 'client_phone'
                               then nullif(btrim(coalesce(p_payload ->> 'client_phone', '')), '')
                               else client_phone end,
         client_address = case when p_payload ? 'client_address'
                               then nullif(btrim(coalesce(p_payload ->> 'client_address', '')), '')
                               else client_address end,
         driver_name    = case when p_payload ? 'driver_name'
                               then nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '')
                               else driver_name end,
         driver_plate   = case when p_payload ? 'driver_plate'
                               then nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '')
                               else driver_plate end,
         bon_number     = case when p_payload ? 'bon_number'
                               then nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '')
                               else bon_number end,
         receive_date   = coalesce(nullif(p_payload ->> 'receive_date', '')::date, receive_date),
         receive_hour   = coalesce(nullif(p_payload ->> 'receive_hour', ''), receive_hour),
         receive_minute = coalesce(nullif(p_payload ->> 'receive_minute', ''), receive_minute),
         notes          = case when p_payload ? 'notes'
                               then coalesce(p_payload ->> 'notes', '')
                               else notes end,
         tva_enabled    = case when p_payload ? 'tva_enabled'
                               then coalesce((p_payload ->> 'tva_enabled')::boolean, tva_enabled)
                               else tva_enabled end,
         tva_rate       = case when p_payload ? 'tva_rate'
                               then coalesce((p_payload ->> 'tva_rate')::numeric, tva_rate)
                               else tva_rate end,
         is_historical  = case when p_payload ? 'is_historical'
                               then coalesce((p_payload ->> 'is_historical')::boolean, is_historical)
                               else is_historical end,
         advance_paid   = v_adv_new,
         created_at     = coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, created_at),
         updated_at     = now()
   where id = p_id;

  -- ------------------------------------------------------------ lignes ----
  if p_payload ? 'items' then
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
      v_line_id := nullif(v_item ->> 'id', '')::uuid;

      if v_line_id is not null
         and exists (select 1 from public.command_items where id = v_line_id and command_id = p_id) then
        -- Ligne existante : on ne descend JAMAIS sous ce qui a deja ete remis.
        select coalesce(delivered_quantity, 0) into v_delivered
          from public.command_items where id = v_line_id;

        update public.command_items
           set product_name    = coalesce(v_item ->> 'product_name', product_name),
               product_id      = nullif(v_item ->> 'product_id', '')::uuid,
               fiche_technic_id= nullif(v_item ->> 'fiche_technic_id', '')::uuid,
               quantity        = greatest(coalesce((v_item ->> 'quantity')::numeric, quantity), v_delivered),
               unit_price      = coalesce((v_item ->> 'unit_price')::numeric, unit_price),
               sell_by_unit    = coalesce((v_item ->> 'sell_by_unit')::boolean, sell_by_unit),
               sell_unit       = v_item ->> 'sell_unit',
               position        = coalesce((v_item ->> 'position')::int, v_pos)
         where id = v_line_id;

        if coalesce((v_item ->> 'quantity')::numeric, 0) < v_delivered - 0.0001 then
          v_kept := false;   -- quantite ramenee au minimum livre
        end if;
        v_seen := v_seen || v_line_id;
      else
        -- Nouvelle ligne (y compris un DOUBLON volontaire du meme produit).
        insert into public.command_items (
          command_id, position, product_id, fiche_technic_id, product_name,
          quantity, unit_price, total_price, sell_by_unit, sell_unit
        )
        values (
          p_id,
          coalesce((v_item ->> 'position')::int, v_pos),
          nullif(v_item ->> 'product_id', '')::uuid,
          nullif(v_item ->> 'fiche_technic_id', '')::uuid,
          coalesce(v_item ->> 'product_name', 'Produit'),
          coalesce((v_item ->> 'quantity')::numeric, 0),
          coalesce((v_item ->> 'unit_price')::numeric, 0),
          coalesce((v_item ->> 'total_price')::numeric, 0),
          coalesce((v_item ->> 'sell_by_unit')::boolean, false),
          v_item ->> 'sell_unit'
        )
        returning id into v_line_id;
        v_seen := v_seen || v_line_id;
      end if;

      v_pos := v_pos + 1;
    end loop;

    -- Les lignes retirees de l'ecran disparaissent — SAUF si elles portent
    -- deja une livraison : la marchandise est partie, la ligne doit rester.
    for r in
      select id, coalesce(delivered_quantity, 0) as delivered
        from public.command_items
       where command_id = p_id and not (id = any(v_seen))
    loop
      if r.delivered > 0.0001
         or exists (select 1 from public.command_delivery_items where command_item_id = r.id) then
        v_kept := false;
      else
        delete from public.command_items where id = r.id;
      end if;
    end loop;
  end if;

  -- --------------------------------------------- totaux, caisse, ventes ----
  -- Le total envoye fait foi QUAND L'OPERATEUR L'A AJUSTE. S'il revient
  -- identique a l'ancien total alors que celui-ci n'avait jamais ete ajuste
  -- (= somme des anciennes lignes), c'est l'ecran qui l'a recopie : il suit
  -- les lignes. C'etait le bug « le prix change mais pas la carte ».
  v_total := case when p_payload ? 'total_amount'
                  then nullif(p_payload ->> 'total_amount', '')::numeric else null end;
  if v_total is not null
     and abs(v_total - v_old_total) < 0.005
     and abs(v_old_total - v_old_lines) < 0.005 then
    v_total := null;
  end if;

  perform public.recompute_command_amounts(p_id, v_total);
  perform public.recompute_command_delivery(p_id);

  select * into v_cmd from public.commands where id = p_id;

  -- L'ACOMPTE A CHANGE : l'ecriture de caisse suit (jamais pour une ancienne
  -- commande, dont l'argent a circule hors du logiciel).
  if v_adv_new is distinct from v_adv_old and not coalesce(v_cmd.is_historical, false) then
    delete from public.caisse_transactions
     where ref_table = 'commands' and ref_id = p_id;
    if v_adv_new > 0 then
      insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
      values ('deposit', v_adv_new, v_cmd.created_at::date,
              'Acompte commande ' || v_cmd.reference, 'Commande', 'commands', p_id)
      on conflict (ref_table, ref_id) do nothing;
    end if;
  end if;

  -- Les bons de livraison sont revalorises au nouveau prix unitaire, puis
  -- leurs factures de vente sont reconstruites.
  for r in select id from public.command_deliveries where command_id = p_id order by delivered_at loop
    perform public.apply_delivery_sale(r.id);
  end loop;

  -- l'acompte a baisse : les bons ne gardent pas un argent qui n'existe plus
  perform public.fix_command_over_imputation(p_id);
  perform public.settle_command_deliveries(p_id);
  perform public.recompute_command_payments(p_id);
  perform public.log_activity('clients', 'update', 'commands', p_id, p_payload);

  return jsonb_build_object('id', p_id, 'lines_replaced', v_kept);
end;
$fn$;


-- ============================================================================
-- 04. update_command_delivery() — L'ARGENT DE LA COMMANDE RESTE JUSTE
-- ============================================================================

create or replace function public.update_command_delivery(p_id uuid, p_payload jsonb)
returns public.command_deliveries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_del      public.command_deliveries;
  v_item     jsonb;
  v_tva_on   boolean;
  v_tva_rate numeric;
  v_adv      numeric;
  v_cash     numeric;
begin
  select * into v_del from public.command_deliveries where id = p_id;
  if v_del.id is null then raise exception 'Livraison introuvable'; end if;

  v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_del.tva_enabled, false));
  v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric,
                         nullif(coalesce(v_del.tva_rate, 0), 0), 19);
  if not v_tva_on then v_tva_rate := 0; end if;

  v_cash := greatest(0, coalesce((p_payload ->> 'cash_paid')::numeric, coalesce(v_del.cash_paid, 0)));
  v_adv  := greatest(0, coalesce((p_payload ->> 'advance_applied')::numeric, coalesce(v_del.advance_applied, 0)));
  v_adv  := least(v_adv, public.command_advance_available(v_del.command_id, p_id));

  update public.command_deliveries
     set delivered_at    = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at),
         date            = coalesce((p_payload ->> 'delivered_at')::timestamptz, delivered_at)::date,
         notes           = coalesce(p_payload ->> 'notes', notes),
         location        = case when p_payload ? 'location'
                                then nullif(btrim(coalesce(p_payload ->> 'location', '')), '')
                                else location end,
         driver_name     = case when p_payload ? 'driver_name'
                                then nullif(btrim(coalesce(p_payload ->> 'driver_name', '')), '')
                                else driver_name end,
         driver_plate    = case when p_payload ? 'driver_plate'
                                then nullif(btrim(coalesce(p_payload ->> 'driver_plate', '')), '')
                                else driver_plate end,
         tva_enabled     = v_tva_on,
         tva_rate        = v_tva_rate,
         advance_applied = v_adv,
         cash_paid       = v_cash,
         updated_at      = now()
   where id = p_id
  returning * into v_del;

  if p_payload ? 'items' then
    delete from public.command_delivery_items where delivery_id = p_id;
    for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
      if coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
        insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
        values (p_id,
                nullif(v_item ->> 'command_item_id', '')::uuid,
                coalesce(v_item ->> 'product_name', 'Produit'),
                coalesce((v_item ->> 'quantity')::numeric, 0),
                v_item ->> 'sell_unit');
      end if;
    end loop;
  end if;

  -- ---- stock remis puis rededuit — sauf ancienne livraison ------------------
  if not coalesce(v_del.is_historical, false) then
    perform public.apply_command_delivery_stock(p_id);
  end if;

  -- ---- la facture de vente est reconstruite a l'identique -------------------
  perform public.apply_delivery_sale(p_id);

  perform public.recompute_command_delivery(v_del.command_id);
  -- ---- l'argent de la commande ne depasse jamais ce qui est impute ----------
  perform public.fix_command_over_imputation(v_del.command_id);
  perform public.recompute_command_payments(v_del.command_id);
  perform public.log_activity('clients', 'deliver_update', 'command_deliveries', v_del.id, p_payload);

  select * into v_del from public.command_deliveries where id = p_id;
  return v_del;
end;
$fn$;


-- ============================================================================
-- 05. delete_command_delivery() — L'ARGENT LIBERE PAIE LES AUTRES BONS
-- ============================================================================

create or replace function public.delete_command_delivery(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cmd uuid;
  v_ref text;
begin
  select command_id, reference into v_cmd, v_ref
    from public.command_deliveries where id = p_id;

  delete from public.client_debts
   where description = 'Reste livraison ' || coalesce(v_ref, '')
     and coalesce(total_paid, 0) = 0;

  -- le declencheur `command_deliveries_restore_stock` remet les matieres
  delete from public.command_deliveries where id = p_id;

  if v_cmd is not null then
    perform public.recompute_command_delivery(v_cmd);
    -- l'acompte qui payait ce bon descend sur les autres bons non soldes
    perform public.settle_command_deliveries(v_cmd);
    perform public.recompute_command_payments(v_cmd);
  end if;
end;
$fn$;


-- ============================================================================
-- 06. REGLEMENT D'UNE COMMANDE MODIFIE OU SUPPRIME
-- ============================================================================

create or replace function public.update_command_payment(
  p_id uuid, p_amount numeric, p_date date default null, p_notes text default null
)
returns public.command_payments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old public.command_payments;
  v_new public.command_payments;
begin
  if not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier un reglement';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  select * into v_old from public.command_payments where id = p_id;
  if v_old.id is null then
    raise exception 'Reglement introuvable (%)', p_id;
  end if;

  update public.command_payments
     set amount = p_amount,
         date   = coalesce(p_date, date),
         notes  = coalesce(p_notes, notes)
   where id = p_id
  returning * into v_new;

  update public.commands
     set extra_paid = greatest(0, coalesce(extra_paid, 0) + (p_amount - v_old.amount)),
         updated_at = now()
   where id = v_old.command_id;

  -- reglement en baisse : les bons ne gardent pas un argent disparu ;
  -- en hausse : le supplement descend sur les bons non soldes
  perform public.fix_command_over_imputation(v_old.command_id);
  perform public.settle_command_deliveries(v_old.command_id);
  perform public.recompute_command_payments(v_old.command_id);
  perform public.log_activity('clients', 'update', 'command_payments', p_id,
    jsonb_build_object('amount', p_amount, 'old_amount', v_old.amount, 'date', v_new.date));
  return v_new;
end;
$fn$;

create or replace function public.trg_command_payment_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if pg_trigger_depth() > 1 then
    return old;   -- suppression en cascade de la commande elle-meme
  end if;
  update public.commands
     set extra_paid = greatest(0, coalesce(extra_paid, 0) - old.amount), updated_at = now()
   where id = old.command_id;
  perform public.fix_command_over_imputation(old.command_id);
  perform public.recompute_command_payments(old.command_id);
  return old;
end;
$fn$;


-- ============================================================================
-- 07. rebuild_client_account() — « RECALCULER LE COMPTE »
-- ----------------------------------------------------------------------------
--  Reconstruit le compte d'UN client a partir de ses documents et de l'argent
--  REELLEMENT recu :
--   a) chaque commande : quantites livrees, bons revalorises au prix de la
--      commande, argent de la commande re-reparti sur ses bons ;
--   b) chaque vente de caisse : paye = encaissements + part venue du compte ;
--   c) si l'argent du client ne tombe plus juste
--        versements + versements de dettes − excedents rendus − acompte
--        utilise sur ses commandes
--      ≠ imputations sur ventes + anciennes dettes reglees + acompte
--      alors TOUS ses versements sont re-imputes (anciennes dettes, factures
--      de la plus ancienne a la plus recente, reliquat = acompte).
--  Renvoie la situation du client avant / apres.
-- ============================================================================

create or replace function public.client_money_gap(p_client_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $fn$
  select round(
      coalesce((select sum(amount) from public.client_payments p where p.client_id = p_client_id), 0)
    + coalesce((select sum(amount) from public.client_debt_versements v where v.client_id = p_client_id), 0)
    - coalesce((select sum(amount) from public.party_credit_refunds f
                 where f.party_type = 'client' and f.party_id = p_client_id), 0)
    - coalesce((select sum(k.credit_applied) from public.commands k where k.client_id = p_client_id), 0)
    - coalesce((select sum(s.allocated_amount) from public.sales s where s.client_id = p_client_id), 0)
    - coalesce((select sum(o.paid_amount) from public.party_old_debts o
                 where o.party_type = 'client' and o.party_id = p_client_id), 0)
    - coalesce((select c.credit_amount from public.clients c where c.id = p_client_id), 0)
  , 2);
$fn$;

comment on function public.client_money_gap(uuid) is
  'Argent du client non retrouve (ou compte en trop) dans ses imputations : 0 quand le compte tombe juste.';

create or replace function public.client_account_snapshot(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'ventes',      coalesce((select sum(final_amount) from public.sales where client_id = p_client_id), 0),
    'paye',        coalesce((select sum(paid_amount)  from public.sales where client_id = p_client_id), 0),
    'reste',       coalesce((select sum(rest_amount)  from public.sales where client_id = p_client_id), 0),
    'anciennes',   coalesce((select sum(rest_amount)  from public.party_old_debts
                               where party_type = 'client' and party_id = p_client_id), 0),
    'versements',  coalesce((select sum(amount) from public.client_payments where client_id = p_client_id), 0),
    'acompte',     coalesce((select credit_amount from public.clients where id = p_client_id), 0),
    'ecart',       public.client_money_gap(p_client_id)
  );
$fn$;

create or replace function public.rebuild_client_account_core(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r        record;
  v_before jsonb;
  v_pool   numeric;
  v_rows   numeric;
  v_ok     numeric;
  v_freed  numeric := 0;
  v_full   boolean := false;
begin
  if p_client_id is null then return null; end if;
  v_before := public.client_account_snapshot(p_client_id);

  -- ---- a) commandes et bons de livraison ------------------------------------
  for r in select id from public.commands where client_id = p_client_id order by created_at loop
    perform public.recompute_command_delivery(r.id);
    perform public.resettle_command_deliveries(r.id);   -- revalorise chaque bon
  end loop;

  -- ---- b) ventes de caisse : paye = encaissements + part du compte ----------
  for r in
    select s.id, s.final_amount, s.paid_amount, coalesce(s.allocated_amount, 0) as alloc,
           coalesce((select sum(sp.amount) from public.sale_payments sp where sp.sale_id = s.id), 0) as rows_sum
      from public.sales s
     where s.client_id = p_client_id and s.delivery_id is null
  loop
    v_rows := least(r.rows_sum, r.final_amount);
    v_ok   := least(r.alloc, greatest(0, r.final_amount - v_rows));
    v_freed := v_freed + (r.alloc - v_ok);
    if abs(r.paid_amount - (v_rows + v_ok)) > 0.004 or abs(r.alloc - v_ok) > 0.004 then
      update public.sales
         set allocated_amount = v_ok,
             paid_amount      = v_rows + v_ok,
             rest_amount      = greatest(0, final_amount - v_rows - v_ok),
             status           = case when final_amount - v_rows - v_ok <= 0.004
                                     then 'paid'::public.sale_status else 'debt'::public.sale_status end,
             updated_at       = now()
       where id = r.id;
    end if;
  end loop;
  if v_freed > 0.004 then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + v_freed, updated_at = now()
     where id = p_client_id;
  end if;

  -- ---- c) l'argent du client tombe-t-il juste ? ------------------------------
  if abs(public.client_money_gap(p_client_id)) > 0.01 then
    v_full := true;
    -- factures de caisse : payees de ce qui a ete encaisse sur elles
    update public.sales s
       set allocated_amount = 0,
           paid_amount = least(s.final_amount, x.rows_sum),
           rest_amount = greatest(0, s.final_amount - least(s.final_amount, x.rows_sum)),
           status      = case when s.final_amount - least(s.final_amount, x.rows_sum) <= 0.004
                              then 'paid'::public.sale_status else 'debt'::public.sale_status end,
           updated_at  = now()
      from (select s2.id,
                   coalesce((select sum(sp.amount) from public.sale_payments sp where sp.sale_id = s2.id), 0) as rows_sum
              from public.sales s2
             where s2.client_id = p_client_id and s2.delivery_id is null) x
     where x.id = s.id;

    -- factures des bons : l'argent du compte repart de zero
    update public.sales set allocated_amount = 0, updated_at = now()
     where client_id = p_client_id and delivery_id is not null and coalesce(allocated_amount, 0) <> 0;
    for r in select id from public.commands where client_id = p_client_id order by created_at loop
      perform public.resettle_command_deliveries(r.id);
    end loop;

    update public.party_old_debts
       set paid_amount = 0, rest_amount = amount, updated_at = now()
     where party_type = 'client' and party_id = p_client_id
       and (paid_amount <> 0 or rest_amount <> amount);
    update public.clients set credit_amount = 0, updated_at = now() where id = p_client_id;

    v_pool := round(
        coalesce((select sum(amount) from public.client_payments p where p.client_id = p_client_id), 0)
      + coalesce((select sum(amount) from public.client_debt_versements v where v.client_id = p_client_id), 0)
      - coalesce((select sum(amount) from public.party_credit_refunds f
                   where f.party_type = 'client' and f.party_id = p_client_id), 0)
      - coalesce((select sum(k.credit_applied) from public.commands k where k.client_id = p_client_id), 0)
    , 2);
    if v_pool > 0 then
      perform public.allocate_client_payment(p_client_id, v_pool);
    elsif v_pool < 0 then
      update public.clients set credit_amount = v_pool, updated_at = now() where id = p_client_id;
    end if;
  end if;

  return jsonb_build_object(
    'client_id', p_client_id,
    'reimpute', v_full,
    'avant', v_before,
    'apres', public.client_account_snapshot(p_client_id)
  );
end;
$fn$;

comment on function public.rebuild_client_account_core(uuid) is
  'Reconstruit le compte d''un client (commandes, bons, ventes, imputations) sans controle de droits — reserve aux scripts.';

create or replace function public.rebuild_client_account(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_res jsonb;
begin
  if not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission de recalculer un compte client';
  end if;
  v_res := public.rebuild_client_account_core(p_client_id);
  perform public.log_activity('clients', 'rebuild', 'clients', p_client_id, v_res);
  return v_res;
end;
$fn$;

comment on function public.rebuild_client_account(uuid) is
  'Bouton « Recalculer le compte » : reconstruit le compte du client depuis ses documents et l''argent reellement recu.';


-- ============================================================================
-- 08. CONTROLE DE COHERENCE DE CHAQUE CLIENT
-- ----------------------------------------------------------------------------
--  select * from public.v_client_account_check where anomalies > 0;
-- ============================================================================

create or replace view public.v_client_account_check
with (security_invoker = true) as
select c.id as client_id,
       c.name,
       coalesce(s.ventes, 0)            as ventes,
       coalesce(s.paye, 0)              as paye,
       coalesce(s.reste, 0)             as reste,
       coalesce(c.credit_amount, 0)     as acompte,
       public.client_money_gap(c.id)    as ecart_argent,
       coalesce(k.total_decale, 0)      as commandes_total_decale,
       coalesce(k.sur_impute, 0)        as commandes_sur_imputees,
       coalesce(d.bl_futurs, 0)         as bons_dates_futur,
       coalesce(d.bl_decales, 0)        as bons_facture_decalee,
       (case when abs(public.client_money_gap(c.id)) > 0.01 then 1 else 0 end)
       + coalesce(k.total_decale, 0) + coalesce(k.sur_impute, 0)
       + coalesce(d.bl_futurs, 0) + coalesce(d.bl_decales, 0) as anomalies
  from public.clients c
  left join lateral (
    select sum(final_amount) as ventes, sum(paid_amount) as paye, sum(rest_amount) as reste
      from public.sales where client_id = c.id
  ) s on true
  left join lateral (
    select count(*) filter (
             where x.status = 'finalised'
               and exists (select 1 from public.command_deliveries dd where dd.command_id = x.id)
               and abs(coalesce(x.total_amount, 0) - public.command_lines_total(x.id)) > 0.004
           ) as total_decale,
           count(*) filter (
             where coalesce((select sum(dd.advance_applied) from public.command_deliveries dd
                              where dd.command_id = x.id), 0)
                   > coalesce(x.advance_paid, 0) + coalesce(x.extra_paid, 0) + coalesce(x.credit_applied, 0) + 0.004
           ) as sur_impute
      from public.commands x where x.client_id = c.id
  ) k on true
  left join lateral (
    select count(*) filter (where dd.delivered_at > now() + interval '1 day') as bl_futurs,
           count(*) filter (where sa.id is not null and abs(sa.final_amount - coalesce(dd.total_ttc, 0)) > 0.004) as bl_decales
      from public.command_deliveries dd
      join public.commands x on x.id = dd.command_id
      left join public.sales sa on sa.delivery_id = dd.id
     where x.client_id = c.id
  ) d on true;

comment on view public.v_client_account_check is
  'Controle de chaque compte client : ecart d''argent, commandes au total decale, acomptes sur-imputes, bons dates dans le futur, factures de bon decalees.';


-- ============================================================================
-- 09. REPRISE DES DONNEES
-- ============================================================================

do $$
declare
  r         record;
  v_new     timestamptz;
  v_clients uuid[] := '{}';
  v_res     jsonb;
  v_n       int;
begin
  -- ---- 09.a bons de livraison dates dans le FUTUR ----------------------------
  --      faute de frappe sur l'annee : on recule d'un an quand la date tombe
  --      alors apres la creation de la commande, sinon on prend la livraison
  --      prevue (ou la date de creation) en gardant l'heure saisie.
  for r in
    select d.id, d.reference, d.delivered_at, d.command_id, k.client_id,
           k.created_at as cmd_created, k.receive_date
      from public.command_deliveries d
      join public.commands k on k.id = d.command_id
     where d.delivered_at > now() + interval '1 day'
  loop
    v_new := r.delivered_at - interval '1 year';
    if v_new > now() or v_new::date < r.cmd_created::date - 1 then
      v_new := (case when r.receive_date is not null and r.receive_date <= current_date
                     then r.receive_date else r.cmd_created::date end)
               + (r.delivered_at - date_trunc('day', r.delivered_at));
    end if;

    insert into public.repair_command_edits (kind, ref_table, ref_id, reference, client_id, old_value, new_value)
    values ('delivery_date', 'command_deliveries', r.id, r.reference, r.client_id,
            r.delivered_at::text, v_new::text);

    update public.command_deliveries
       set delivered_at = v_new, date = v_new::date, updated_at = now()
     where id = r.id;
    perform public.apply_delivery_sale(r.id);   -- la facture prend la bonne date
    if r.client_id is not null then v_clients := array_append(v_clients, r.client_id); end if;
  end loop;

  -- ---- 09.b livraison prevue AVANT la creation de la commande ---------------
  for r in
    select id, reference, client_id, receive_date, created_at
      from public.commands
     where receive_date is not null and receive_date < created_at::date
  loop
    insert into public.repair_command_edits (kind, ref_table, ref_id, reference, client_id, old_value, new_value)
    values ('receive_date', 'commands', r.id, r.reference, r.client_id,
            r.receive_date::text, r.created_at::date::text);
    update public.commands set receive_date = r.created_at::date, updated_at = now() where id = r.id;
  end loop;

  -- ---- 09.c commandes LIVREES dont le total ne suit plus les lignes ---------
  --      (bug du prix modifie) : leurs bons sont factures au prix des lignes,
  --      la commande reprend donc le total de ses lignes.
  for r in
    select k.id, k.reference, k.client_id, k.total_amount, public.command_lines_total(k.id) as lines_total
      from public.commands k
     where k.status = 'finalised'
       and exists (select 1 from public.command_deliveries d where d.command_id = k.id)
       and abs(coalesce(k.total_amount, 0) - public.command_lines_total(k.id)) > 0.004
  loop
    insert into public.repair_command_edits (kind, ref_table, ref_id, reference, client_id, old_value, new_value)
    values ('total', 'commands', r.id, r.reference, r.client_id,
            r.total_amount::text, r.lines_total::text);
    perform public.recompute_command_amounts(r.id, null);
    perform public.recompute_command_payments(r.id);
    if r.client_id is not null then v_clients := array_append(v_clients, r.client_id); end if;
  end loop;

  -- ---- 09.d commandes dont les bons portent plus d'argent qu'elles n'en ont --
  for r in
    select k.id, k.reference, k.client_id
      from public.commands k
     where coalesce((select sum(d.advance_applied) from public.command_deliveries d where d.command_id = k.id), 0)
           > coalesce(k.advance_paid, 0) + coalesce(k.extra_paid, 0) + coalesce(k.credit_applied, 0) + 0.004
  loop
    insert into public.repair_command_edits (kind, ref_table, ref_id, reference, client_id, old_value, new_value)
    values ('money', 'commands', r.id, r.reference, r.client_id, 'acompte sur-impute', 're-reparti');
    perform public.resettle_command_deliveries(r.id);
    if r.client_id is not null then v_clients := array_append(v_clients, r.client_id); end if;
  end loop;

  -- ---- 09.e clients a reconstruire -------------------------------------------
  --      · ceux cites dans la demande : 00DJAMAL et HAMZA CHANTIER OUDJAR ;
  --      · ceux touches ci-dessus ;
  --      · ceux dont l'argent ne tombe pas juste ou dont une facture de bon
  --        ne correspond plus a son bon.
  select array_agg(id) into v_clients
    from (
      select unnest(v_clients) as id
      union
      select id from public.clients
       where upper(regexp_replace(name, '\s+', ' ', 'g')) like '%DJAMAL%'
          or (upper(name) like '%HAMZA%' and upper(name) like '%OUDJAR%')
      union
      select c.id from public.clients c where abs(public.client_money_gap(c.id)) > 0.01
      union
      select k.client_id
        from public.command_deliveries d
        join public.commands k on k.id = d.command_id
        join public.sales s on s.delivery_id = d.id
       where abs(s.final_amount - coalesce(d.total_ttc, 0)) > 0.004
    ) x
   where id is not null;

  v_n := 0;
  for r in select distinct unnest(coalesce(v_clients, '{}'::uuid[])) as client_id loop
    v_res := public.rebuild_client_account_core(r.client_id);
    insert into public.repair_command_edits (kind, ref_table, ref_id, client_id, old_value, new_value)
    values ('account', 'clients', r.client_id, r.client_id,
            (v_res -> 'avant')::text, (v_res -> 'apres')::text);
    v_n := v_n + 1;
  end loop;

  raise notice 'Comptes clients reconstruits : %', v_n;
end $$;


-- ============================================================================
-- 10. DROITS
-- ============================================================================

grant execute on function public.command_lines_total(uuid)          to authenticated, service_role;
grant execute on function public.fix_command_over_imputation(uuid)  to authenticated, service_role;
grant execute on function public.client_money_gap(uuid)             to authenticated, service_role;
grant execute on function public.client_account_snapshot(uuid)      to authenticated, service_role;
grant execute on function public.rebuild_client_account(uuid)       to authenticated, service_role;
revoke all on function public.rebuild_client_account_core(uuid) from public, anon, authenticated;
grant execute on function public.rebuild_client_account_core(uuid)  to service_role;
grant execute on function public.update_command(uuid, jsonb)          to authenticated, service_role;
grant execute on function public.update_command_delivery(uuid, jsonb) to authenticated, service_role;
grant execute on function public.delete_command_delivery(uuid)        to authenticated, service_role;
grant execute on function public.update_command_payment(uuid, numeric, date, text) to authenticated, service_role;
grant select on public.repair_command_edits   to authenticated, service_role;
grant select on public.v_client_account_check to authenticated, service_role;

commit;

notify pgrst, 'reload schema';


-- ============================================================================
-- CONTROLE (facultatif) — a lancer apres le script
-- ============================================================================
--  Ce que la reprise a corrige :
--    select e.kind, c.name, e.reference, e.old_value, e.new_value, e.repaired_at
--      from public.repair_command_edits e
--      left join public.clients c on c.id = e.client_id
--     order by e.repaired_at, e.kind;
--
--  Situation des deux clients signales :
--    select c.name, public.client_account_snapshot(c.id)
--      from public.clients c
--     where c.name ilike '%djamal%' or (c.name ilike '%hamza%' and c.name ilike '%oudjar%');
--
--  Clients qui presentent encore une anomalie (doit etre vide) :
--    select * from public.v_client_account_check where anomalies > 0;
--
--  Historique complet d'un client (remplacer le nom) :
--    select 'vente' as t, s.reference, s.date, s.final_amount, s.paid_amount, s.rest_amount, s.allocated_amount
--      from public.sales s join public.clients c on c.id = s.client_id
--     where c.name ilike '%hamza%oudjar%'
--    union all
--    select 'versement', coalesce(p.notes, ''), p.date, p.amount, null, null, null
--      from public.client_payments p join public.clients c on c.id = p.client_id
--     where c.name ilike '%hamza%oudjar%'
--     order by 3;

;


-- ===== altech_production_update_corbeille.sql =====
-- =============================================================================
--  ALTECH PRODUCTION — MISE A JOUR : CORBEILLE (restauration des suppressions)
-- -----------------------------------------------------------------------------
--  Toute ligne supprimée (bouton « Supprimer » de n'importe quelle interface,
--  suppression faite par une fonction RPC, suppression en cascade) est copiée
--  dans public.recycle_bin avant de disparaître. L'écran
--  Paramètres › Corbeille liste ces suppressions et permet de les restaurer.
--
--  A exécuter UNE fois dans Supabase › SQL Editor (ré-exécutable sans risque).
-- =============================================================================

-- 1) Table de la corbeille ------------------------------------------------------
create table if not exists public.recycle_bin (
  id           bigserial primary key,
  tx_id        bigint      not null default txid_current(),
  table_name   text        not null,
  row_id       text,
  data         jsonb       not null,
  deleted_at   timestamptz not null default now(),
  deleted_by   uuid        default auth.uid(),
  user_marked  boolean     not null default false,   -- suppression demandée par un bouton
  reinserted   boolean     not null default false    -- la même transaction a ré-inséré dans la table (= modification)
);
create index if not exists recycle_bin_tx_idx on public.recycle_bin (tx_id);
create index if not exists recycle_bin_date_idx on public.recycle_bin (deleted_at desc);

alter table public.recycle_bin enable row level security;
drop policy if exists recycle_bin_sel on public.recycle_bin;
create policy recycle_bin_sel on public.recycle_bin for select to authenticated using (true);

-- 2) Déclencheurs ---------------------------------------------------------------
create or replace function public.recycle_capture()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.recycle_bin (table_name, row_id, data, user_marked)
  values (
    tg_table_name,
    to_jsonb(old) ->> 'id',
    to_jsonb(old),
    coalesce(current_setting('app.recycle_user', true), '') = 'on'
  );
  perform set_config('app.recycle_tx', 'on', true);
  return old;
end $$;

-- Une insertion dans la même table pendant la même transaction = une
-- modification (supprimer puis recréer les lignes) : elle n'est pas affichée.
create or replace function public.recycle_mark_reinsert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.recycle_tx', true), '') = 'on' then
    update public.recycle_bin
       set reinserted = true
     where tx_id = txid_current() and table_name = tg_table_name and not reinserted;
  end if;
  return null;
end $$;

do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('recycle_bin', 'profiles', 'store_settings', 'caisse_settings', 'activity_log')
       and c.relname not like 'repair\_%'
  loop
    execute format('drop trigger if exists zz_recycle_capture on public.%I', r.relname);
    execute format('create trigger zz_recycle_capture before delete on public.%I
                    for each row execute function public.recycle_capture()', r.relname);
    execute format('drop trigger if exists zz_recycle_reinsert on public.%I', r.relname);
    execute format('create trigger zz_recycle_reinsert after insert on public.%I
                    for each statement execute function public.recycle_mark_reinsert()', r.relname);
  end loop;
end $$;

-- 3) Suppression depuis un bouton (marque la suppression comme « utilisateur ») --
-- security invoker : les droits (RLS) de l'utilisateur s'appliquent toujours.
create or replace function public.recycle_delete(p_table text, p_id text)
returns void language plpgsql security invoker set search_path = public as $$
declare v_count int;
begin
  perform set_config('app.recycle_user', 'on', true);
  execute format('delete from public.%I where id::text = $1', p_table) using p_id;
  get diagnostics v_count = row_count;
  perform set_config('app.recycle_user', '', true);
end $$;
grant execute on function public.recycle_delete(text, text) to authenticated;

-- 4) Liste des suppressions affichées dans Paramètres › Corbeille ----------------
create or replace function public.recycle_bin_list()
returns table (
  id bigint, tx_id bigint, table_name text, row_id text, data jsonb,
  deleted_at timestamptz, deleted_by_name text
) language plpgsql security definer set search_path = public as $$
declare
  v_detail text[] := array[
    'command_items','sale_lines','purchase_lines','purchase_order_items','fiche_technic_lines',
    'command_delivery_items','command_delivery_consumptions','command_adjustment_lines',
    'production_used_products','stock_movements','caisse_transactions'];
begin
  -- ménage : les traces internes (modifications) de plus de 7 jours
  delete from public.recycle_bin b
   where b.deleted_at < now() - interval '7 days'
     and not exists (
       select 1 from public.recycle_bin x
        where x.tx_id = b.tx_id
          and (x.user_marked or (not x.reinserted and not (x.table_name = any (v_detail)))));

  return query
    select b.id, b.tx_id, b.table_name, b.row_id, b.data, b.deleted_at,
           coalesce(nullif(p.full_name, ''), p.username, p.email, '')::text
      from public.recycle_bin b
      left join public.profiles p on p.id = b.deleted_by
     where exists (
       select 1 from public.recycle_bin x
        where x.tx_id = b.tx_id
          and (x.user_marked or (not x.reinserted and not (x.table_name = any (v_detail)))))
     order by b.deleted_at desc, b.id;
end $$;
grant execute on function public.recycle_bin_list() to authenticated;

-- 5) Restauration d'une suppression (toutes les lignes de la même opération) ----
create or replace function public.recycle_restore(p_tx_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_cols text;
  v_pending bigint[];
  v_done int := 0;
  v_progress boolean := true;
  v_last_error text;
begin
  if not (public.is_admin() or public.has_perm('settings', 'edit')) then
    raise exception 'Accès refusé';
  end if;

  select array_agg(b.id order by b.id) into v_pending from public.recycle_bin b where b.tx_id = p_tx_id;
  if v_pending is null then raise exception 'Élément introuvable dans la corbeille'; end if;

  -- plusieurs passes : les lignes parentes doivent exister avant leurs lignes filles
  while v_progress and array_length(v_pending, 1) > 0 loop
    v_progress := false;
    for r in select b.* from public.recycle_bin b where b.id = any (v_pending) order by b.id loop
      select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position) into v_cols
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = r.table_name
         and c.is_generated = 'NEVER' and coalesce(c.identity_generation, '') <> 'ALWAYS'
         and r.data ? c.column_name;
      begin
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                       r.table_name, v_cols, v_cols, r.table_name) using r.data;
        v_done := v_done + 1;
        v_pending := array_remove(v_pending, r.id);
        v_progress := true;
      exception
        when unique_violation then          -- la ligne existe déjà : rien à restaurer
          v_pending := array_remove(v_pending, r.id);
          v_progress := true;
        when others then
          v_last_error := sqlerrm;          -- réessayée à la passe suivante
      end;
    end loop;
  end loop;

  if array_length(v_pending, 1) > 0 then
    raise exception 'Restauration impossible : %', coalesce(v_last_error, 'dépendance manquante');
  end if;

  delete from public.recycle_bin where tx_id = p_tx_id;
  return v_done;
end $$;
grant execute on function public.recycle_restore(bigint) to authenticated;

notify pgrst, 'reload schema';

;


-- ===== altech_production_update_sauvegarde_complete.sql =====
-- =============================================================================
-- Altech Production — Sauvegarde complète / Vérification / Restauration
-- =============================================================================
-- Paramètres › Base de données :
--   « Télécharger la sauvegarde »  -> public.backup_export()
--   « Vérifier une sauvegarde »    -> public.backup_verify(jsonb)
--   « Restaurer »                  -> public.backup_restore(jsonb)
--
-- La sauvegarde contient TOUTES les tables du schéma public (clients,
-- fournisseurs, stock, achats, ventes, commandes, productions, employés,
-- caisse, dépenses, paramètres, corbeille, journal…) ligne par ligne, ainsi
-- que les comptes de connexion (auth.users + auth.identities, mots de passe
-- chiffrés compris) : après restauration on se connecte avec les mêmes
-- identifiants qu'avant.
--
-- Migration vers un nouveau projet Supabase :
--   1. ancien projet : exécuter ce fichier, puis Paramètres › Télécharger
--   2. nouveau projet : exécuter altech_production_supabase.sql puis tous les
--      altech_production_update_*.sql (dont celui-ci)
--   3. créer un compte administrateur temporaire, se connecter,
--      Paramètres › Restaurer › choisir le fichier
--   4. se reconnecter avec les identifiants d'origine, puis
--      Paramètres › Vérifier une sauvegarde -> tout doit être « identique »
--
-- Idempotent : peut être ré-exécuté sans risque.
-- =============================================================================

-- Tables sauvegardées : toutes les tables ordinaires du schéma public.
create or replace function public._backup_tables()
returns setof text
language sql stable
set search_path = public, pg_catalog
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  order by c.relname;
$$;

-- Colonnes insérables (les colonnes générées sont recalculées par Postgres).
create or replace function public._backup_columns(p_schema text, p_table text)
returns text[]
language sql stable
set search_path = public, pg_catalog
as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = p_schema and c.relname = p_table
    and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
$$;

-- Empreinte d'une table : nombre de lignes + md5 des lignes triées.
-- Les lignes sont comparées sous leur forme typée (record::text), ce qui
-- neutralise les différences de format JSON (1.5 / 1.50, ordre des clés…).
create or replace function public._backup_live_fingerprint(p_schema text, p_table text)
returns jsonb
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  v_count bigint;
  v_md5   text;
begin
  execute format(
    'select count(*), md5(coalesce(string_agg(t::text, E''\n'' order by t::text), '''')) from %I.%I t',
    p_schema, p_table) into v_count, v_md5;
  return jsonb_build_object('rows', v_count, 'md5', v_md5);
end;
$$;

create or replace function public._backup_file_fingerprint(p_schema text, p_table text, p_rows jsonb)
returns jsonb
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  v_count bigint;
  v_md5   text;
begin
  execute format(
    'select count(*), md5(coalesce(string_agg(t::text, E''\n'' order by t::text), ''''))
       from jsonb_populate_recordset(null::%I.%I, $1) t',
    p_schema, p_table) using coalesce(p_rows, '[]'::jsonb) into v_count, v_md5;
  return jsonb_build_object('rows', v_count, 'md5', v_md5);
end;
$$;

-- -----------------------------------------------------------------------------
-- Export
-- -----------------------------------------------------------------------------
create or replace function public.backup_export()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table  text;
  v_rows   jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_users  jsonb;
  v_ids    jsonb;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur';
  end if;

  for v_table in select public._backup_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', v_table)
      into v_rows;
    v_tables := v_tables || jsonb_build_object(v_table, v_rows);
    v_counts := v_counts || jsonb_build_object(v_table, jsonb_array_length(v_rows));
  end loop;

  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_users from auth.users u;
  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_ids from auth.identities i;

  return jsonb_build_object(
    'format',     'altech-production-backup',
    'version',    2,
    'created_at', now(),
    'tables',     v_tables,
    'counts',     v_counts,
    'auth',       jsonb_build_object('users', v_users, 'identities', v_ids)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Vérification : compare le fichier à la base actuelle, table par table.
-- -----------------------------------------------------------------------------
create or replace function public.backup_verify(p_backup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table  text;
  v_file   jsonb;
  v_live   jsonb;
  v_result jsonb := '[]'::jsonb;
  v_ok     boolean := true;
  v_same   boolean;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur';
  end if;
  if p_backup->>'format' is distinct from 'altech-production-backup' then
    raise exception 'Ce fichier n''est pas une sauvegarde Altech Production';
  end if;

  -- tables de la base et/ou du fichier
  for v_table in
    select name from (
      select public._backup_tables() as name
      union
      select jsonb_object_keys(p_backup->'tables')
    ) s order by name
  loop
    if not exists (select 1 from public._backup_tables() t where t = v_table) then
      v_result := v_result || jsonb_build_object('table', v_table, 'status', 'absente de la base',
        'file_rows', jsonb_array_length(p_backup->'tables'->v_table), 'db_rows', null);
      v_ok := false;
      continue;
    end if;

    v_live := public._backup_live_fingerprint('public', v_table);
    if not (p_backup->'tables' ? v_table) then
      v_result := v_result || jsonb_build_object('table', v_table, 'status', 'absente du fichier',
        'file_rows', null, 'db_rows', v_live->'rows');
      if (v_live->>'rows')::bigint > 0 then v_ok := false; end if;
      continue;
    end if;

    v_file := public._backup_file_fingerprint('public', v_table, p_backup->'tables'->v_table);
    v_same := v_file = v_live;
    if not v_same then v_ok := false; end if;
    v_result := v_result || jsonb_build_object('table', v_table,
      'status', case when v_same then 'identique' else 'différente' end,
      'file_rows', v_file->'rows', 'db_rows', v_live->'rows');
  end loop;

  -- comptes de connexion
  v_live := public._backup_live_fingerprint('auth', 'users');
  v_file := public._backup_file_fingerprint('auth', 'users', p_backup->'auth'->'users');
  v_same := v_file = v_live;
  if not v_same then v_ok := false; end if;
  v_result := v_result || jsonb_build_object('table', 'comptes (auth.users)',
    'status', case when v_same then 'identique' else 'différente' end,
    'file_rows', v_file->'rows', 'db_rows', v_live->'rows');

  return jsonb_build_object('ok', v_ok, 'created_at', p_backup->'created_at', 'tables', v_result);
end;
$$;

-- -----------------------------------------------------------------------------
-- Restauration : remplace toutes les données par celles du fichier.
-- Tout se fait dans une seule transaction : en cas d'erreur rien n'est modifié.
-- Les déclencheurs (mouvements de stock, soldes, journal…) sont désactivés
-- pendant l'import pour que les données soient reprises telles quelles,
-- sans double comptage.
-- -----------------------------------------------------------------------------
create or replace function public._backup_insert(p_schema text, p_table text, p_rows jsonb)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_cols text;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then return; end if;
  -- uniquement les colonnes présentes à la fois dans la table et dans le fichier
  select string_agg(quote_ident(c), ', ') into v_cols
  from unnest(public._backup_columns(p_schema, p_table)) c
  where exists (select 1 from jsonb_array_elements(p_rows) r where r ? c);
  if v_cols is null then return; end if;
  execute format(
    'insert into %I.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::%I.%I, $1)',
    p_schema, p_table, v_cols, v_cols, p_schema, p_table) using p_rows;
end;
$$;

create or replace function public.backup_restore(p_backup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table    text;
  v_list     text;
  v_seq      record;
  v_restored jsonb := '{}'::jsonb;
  v_replica  boolean := true;
  v_has_auth boolean := coalesce((p_backup->'auth') ? 'users', false);
  v_profiles jsonb;
  v_fk       record;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur';
  end if;
  if p_backup->>'format' is distinct from 'altech-production-backup' then
    raise exception 'Ce fichier n''est pas une sauvegarde Altech Production';
  end if;

  begin
    set local session_replication_role = replica;
  exception when others then
    v_replica := false;
  end;

  select string_agg(format('public.%I', t), ', ') into v_list from public._backup_tables() t;
  if not v_replica then
    for v_table in select public._backup_tables() loop
      execute format('alter table public.%I disable trigger user', v_table);
    end loop;
  end if;

  -- Sauvegarde sans comptes (faite depuis le navigateur) : on garde les comptes
  -- de ce projet, donc leurs profils, pour rester connecté après l'import.
  if not v_has_auth then
    select coalesce(jsonb_agg(to_jsonb(p) - 'worker_id'), '[]'::jsonb) into v_profiles from public.profiles p;
  end if;

  -- 1. comptes de connexion
  if v_has_auth then
    execute 'truncate table ' || v_list || ' cascade';
    delete from auth.identities;
    delete from auth.users;
    perform public._backup_insert('auth', 'users', p_backup->'auth'->'users');
    perform public._backup_insert('auth', 'identities', p_backup->'auth'->'identities');
  end if;

  -- 2. données de l'application
  execute 'truncate table ' || v_list || ' cascade';
  if v_replica then
    for v_table in select public._backup_tables() loop
      if p_backup->'tables' ? v_table and (v_has_auth or v_table <> 'profiles') then
        perform public._backup_insert('public', v_table, p_backup->'tables'->v_table);
        v_restored := v_restored || jsonb_build_object(v_table, jsonb_array_length(p_backup->'tables'->v_table));
      end if;
    end loop;
  else
    -- sans mode replica : clés étrangères vérifiées, on insère dans l'ordre des dépendances
    declare
      v_done    text[] := '{}';
      v_pending text[];
      v_progress boolean;
    begin
      select array_agg(t) into v_pending from public._backup_tables() t;
      loop
        v_progress := false;
        foreach v_table in array v_pending loop
          if not exists (
            select 1 from pg_constraint k
            join pg_class c on c.oid = k.conrelid
            join pg_class r on r.oid = k.confrelid
            join pg_namespace rn on rn.oid = r.relnamespace
            where k.contype = 'f' and c.relname = v_table
              and c.relnamespace = 'public'::regnamespace
              and rn.nspname = 'public' and r.relname <> v_table
              and not (r.relname = any(v_done))
          ) then
            if p_backup->'tables' ? v_table and (v_has_auth or v_table <> 'profiles') then
              perform public._backup_insert('public', v_table, p_backup->'tables'->v_table);
              v_restored := v_restored || jsonb_build_object(v_table, jsonb_array_length(p_backup->'tables'->v_table));
            end if;
            v_done := v_done || v_table;
            v_pending := array_remove(v_pending, v_table);
            v_progress := true;
          end if;
        end loop;
        exit when coalesce(array_length(v_pending, 1), 0) = 0;
        if not v_progress then
          raise exception 'Dépendances circulaires entre tables : %', v_pending;
        end if;
      end loop;
    end;
    for v_table in select public._backup_tables() loop
      execute format('alter table public.%I enable trigger user', v_table);
    end loop;
  end if;

  -- 2b. sauvegarde sans comptes : profils de ce projet remis en place, et
  -- références vers des comptes de l'ancien projet effacées (null).
  if not v_has_auth then
    perform public._backup_insert('public', 'profiles', v_profiles);
    for v_fk in
      select c.relname as tbl, a.attname as col
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
        and c.relnamespace = 'public'::regnamespace and array_length(k.conkey, 1) = 1
    loop
      execute format('update public.%I set %I = null where %I is not null and not exists (select 1 from auth.users u where u.id = %I.%I)',
        v_fk.tbl, v_fk.col, v_fk.col, v_fk.tbl, v_fk.col);
    end loop;
  end if;

  -- 3. compteurs (bigserial / identity) repositionnés après les lignes importées
  for v_seq in
    select n.nspname as sch, c.relname as tbl, a.attname as col,
           pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) as seq
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  loop
    if v_seq.seq is not null then
      execute format('select setval(%L, coalesce((select max(%I) from %I.%I), 0) + 1, false)',
        v_seq.seq, v_seq.col, v_seq.sch, v_seq.tbl);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'tables', v_restored,
    'users', jsonb_array_length(coalesce(p_backup->'auth'->'users', '[]'::jsonb)));
end;
$$;

revoke all on function public.backup_export()        from public, anon;
revoke all on function public.backup_verify(jsonb)   from public, anon;
revoke all on function public.backup_restore(jsonb)  from public, anon;
grant execute on function public.backup_export()       to authenticated;
grant execute on function public.backup_verify(jsonb)  to authenticated;
grant execute on function public.backup_restore(jsonb) to authenticated;

revoke all on function public._backup_tables()                          from public, anon, authenticated;
revoke all on function public._backup_columns(text, text)               from public, anon, authenticated;
revoke all on function public._backup_live_fingerprint(text, text)      from public, anon, authenticated;
revoke all on function public._backup_file_fingerprint(text, text, jsonb) from public, anon, authenticated;
revoke all on function public._backup_insert(text, text, jsonb)         from public, anon, authenticated;

;
