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
