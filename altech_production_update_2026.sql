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
