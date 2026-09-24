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
