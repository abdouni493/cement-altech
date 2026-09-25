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
