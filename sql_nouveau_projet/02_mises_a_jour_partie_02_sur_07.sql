-- PARTIE 2/7 des mises a jour. Executer apres la partie 1.
-- Contient : altech_production_update_commandes_stock_versements.sql, altech_production_update_anciens_achats_ventes_tva.sql, altech_production_update_versements_modes_reglement.sql

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


