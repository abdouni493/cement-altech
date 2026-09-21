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
