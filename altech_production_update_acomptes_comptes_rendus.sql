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
