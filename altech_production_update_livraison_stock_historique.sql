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
