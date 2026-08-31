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
