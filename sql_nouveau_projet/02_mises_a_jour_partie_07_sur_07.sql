-- PARTIE 7/7 des mises a jour. Executer apres la partie 6.
-- Contient : altech_production_update_argent_compte_deux_fois.sql, altech_production_update_modification_commandes_compte_rendu.sql, altech_production_update_corbeille.sql, altech_production_update_sauvegarde_complete.sql

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
