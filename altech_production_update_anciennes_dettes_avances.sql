-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « ANCIENNES DETTES des clients / fournisseurs
--    + AVANCE (excedent) quand un client verse PLUS que sa dette,
--    avec le bouton qui lui rend son excedent. »
-- ----------------------------------------------------------------------------
--  A executer EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est idempotent : il peut etre relance sans risque.
--
--  PROBLEMES CORRIGES
--  ------------------
--  1. TROP-PERCU INVISIBLE.
--     Quand un client devait 10 000 DA et versait 15 000 DA, `pay_client()`
--     imputait 10 000 DA sur ses ventes / commandes et PERDAIT les 5 000 DA
--     restants : la carte du client affichait « dette 0 » et l'excedent
--     n'apparaissait nulle part. Desormais l'excedent est conserve dans
--     `clients.credit_amount` (une AVANCE du client sur l'entreprise), affiche
--     en positif sur sa carte et sur son compte rendu, et un bouton permet de
--     le lui RENDRE (sortie de caisse tracee).
--
--  2. AUCUNE FACON DE SAISIR UNE ARDOISE ANTERIEURE.
--     Impossible d'enregistrer « ce client me devait deja 80 000 DA avant le
--     logiciel ». La nouvelle table `party_old_debts` porte ces ANCIENNES
--     DETTES pour un client OU un fournisseur (montant, description, date).
--     Elles entrent dans le calcul de la dette, se soldent par les versements
--     habituels et apparaissent dans l'historique, le compte rendu, la caisse
--     et les rapports.
--
--  REGLES METIER APPLIQUEES
--  ------------------------
--   · Un versement client s'impute dans cet ordre :
--        1) ANCIENNES DETTES (la plus ancienne d'abord)
--        2) VENTES non soldees
--        3) COMMANDES non soldees
--        4) le reliquat devient une AVANCE (`clients.credit_amount`)
--     La suppression / modification d'un versement reprend exactement dans
--     l'ordre inverse (avance, commandes, ventes, anciennes dettes) : la dette
--     du tiers reste donc toujours juste.
--
--   · Une ANCIENNE DETTE ne genere AUCUNE ecriture de caisse : aucun argent
--     n'a bouge, c'est une ardoise reprise du passe. C'est son REGLEMENT
--     (bouton « Versement ») qui alimente la caisse, comme pour une facture.
--
--   · Un REMBOURSEMENT d'excedent, lui, EST un mouvement d'argent :
--        - client    -> SORTIE de caisse (on lui rend son argent)
--        - fournisseur -> ENTREE de caisse (il nous rend le trop-verse)
--
--  CONTENU
--  -------
--    01. clients.credit_amount / suppliers.credit_amount  — l'avance du tiers
--    02. Table `party_old_debts`      — anciennes dettes client / fournisseur
--    03. Table `party_credit_refunds` — remboursement d'un excedent
--    04. Imputation client   : allocate_ / deallocate_client_payment()
--    05. Imputation fournisseur : allocate_ / deallocate_supplier_payment()
--    06. RPC anciennes dettes : add / update / delete_party_old_debt()
--    07. RPC excedent        : refund_party_credit() / delete_party_refund()
--    08. Caisse : declencheurs des remboursements
--    09. Nettoyage a la suppression d'un client / fournisseur
--    10. Vues de controle : v_party_old_debts, v_party_balances
--    11. Reconstruction des avances deja encaissees (retroactif)
--    12. RLS, grants et temps reel
-- ============================================================================

begin;

-- ============================================================================
-- 01. L'AVANCE DU TIERS  (excedent verse, non encore impute ni rendu)
-- ============================================================================

alter table public.clients
  add column if not exists credit_amount numeric(14,2) not null default 0;

alter table public.suppliers
  add column if not exists credit_amount numeric(14,2) not null default 0;

comment on column public.clients.credit_amount is
  'Avance du client : montant verse EN PLUS de sa dette, pas encore impute ni rembourse. Affiche en positif sur sa carte (« il a un credit sur l''entreprise »).';
comment on column public.suppliers.credit_amount is
  'Trop-verse au fournisseur : montant paye EN PLUS de ses factures, recuperable ou imputable sur ses prochaines factures.';

create index if not exists clients_credit_idx   on public.clients   (credit_amount) where credit_amount > 0;
create index if not exists suppliers_credit_idx on public.suppliers (credit_amount) where credit_amount > 0;


-- ============================================================================
-- 02. ANCIENNES DETTES  (ardoise reprise du passe, client OU fournisseur)
-- ----------------------------------------------------------------------------
--  Se comporte exactement comme une facture non soldee : montant, montant
--  deja regle, reste du. Aucune ecriture de caisse a la creation.
-- ============================================================================

create table if not exists public.party_old_debts (
  id          uuid primary key default gen_random_uuid(),
  party_type  text not null check (party_type in ('client', 'supplier')),
  party_id    uuid not null,
  party_name  text,
  amount      numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  rest_amount numeric(14,2) not null default 0,
  date        date not null default current_date,
  description text default '',
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists party_old_debts_party_idx on public.party_old_debts (party_type, party_id, date asc);
create index if not exists party_old_debts_rest_idx  on public.party_old_debts (party_id) where rest_amount > 0;

comment on table public.party_old_debts is
  'Anciennes dettes saisies a posteriori : ce qu''un client devait (ou ce qu''on devait a un fournisseur) AVANT l''utilisation du logiciel. Aucun mouvement de caisse a la creation ; le reglement passe par le bouton « Versement ».';


-- ============================================================================
-- 03. REMBOURSEMENT D'UN EXCEDENT
-- ----------------------------------------------------------------------------
--  Le bouton « Rendre l'excedent » d'une carte client (ou « Recuperer
--  l'excedent » d'une carte fournisseur) ecrit une ligne ici : c'est un vrai
--  mouvement d'argent, il alimente donc la caisse.
-- ============================================================================

create table if not exists public.party_credit_refunds (
  id              uuid primary key default gen_random_uuid(),
  party_type      text not null check (party_type in ('client', 'supplier')),
  party_id        uuid not null,
  party_name      text,
  amount          numeric(14,2) not null default 0,
  date            date not null default current_date,
  refunded_at     timestamptz not null default now(),
  notes           text default '',
  method          text not null default 'especes' check (method in ('especes', 'cheque', 'virement')),
  cheque_number   text,
  virement_number text,
  bank_name       text,
  created_by      text default public.current_username(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists party_credit_refunds_party_idx
  on public.party_credit_refunds (party_type, party_id, refunded_at desc);

comment on table public.party_credit_refunds is
  'Restitution d''un excedent : argent rendu a un client (sortie de caisse) ou recupere aupres d''un fournisseur (entree de caisse).';


-- ============================================================================
-- 04. IMPUTATION D'UN VERSEMENT CLIENT
-- ----------------------------------------------------------------------------
--  ORDRE : anciennes dettes -> ventes -> commandes -> AVANCE.
--  Le reliquat n'est plus perdu : il devient l'avance du client.
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
  if p_client_id is null or v_left <= 0 then return; end if;

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

  -- 2) VENTES non soldees
  for r in
    select id, rest_amount from public.sales
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

  -- 3) COMMANDES non soldees
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

  -- 4) LE RELIQUAT DEVIENT UNE AVANCE DU CLIENT
  if v_left > 0 then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + v_left,
           updated_at    = now()
     where id = p_client_id;
  end if;
end;
$$;

comment on function public.allocate_client_payment(uuid, numeric) is
  'Impute un versement client : anciennes dettes, puis ventes, puis commandes ; le reliquat devient une AVANCE (clients.credit_amount).';

create or replace function public.deallocate_client_payment(p_client_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left   numeric := coalesce(p_amount, 0);
  v_take   numeric;
  v_credit numeric;
  r        record;
begin
  if p_client_id is null or v_left <= 0 then return; end if;

  -- Ordre INVERSE de l'imputation : avance -> commandes -> ventes -> anciennes dettes
  select coalesce(credit_amount, 0) into v_credit from public.clients where id = p_client_id;
  if coalesce(v_credit, 0) > 0 then
    v_take := least(v_left, v_credit);
    update public.clients
       set credit_amount = greatest(0, coalesce(credit_amount, 0) - v_take),
           updated_at    = now()
     where id = p_client_id;
    v_left := v_left - v_take;
  end if;

  for r in
    select id, paid_amount from public.commands
     where client_id = p_client_id and paid_amount > 0
     order by created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.commands
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = greatest(0, total_amount - greatest(0, paid_amount - v_take)),
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
           rest_amount = greatest(0, final_amount - greatest(0, paid_amount - v_take)),
           status      = case when final_amount - greatest(0, paid_amount - v_take) <= 0
                              then 'paid'::public.sale_status else 'debt'::public.sale_status end,
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, paid_amount from public.party_old_debts
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
end;
$$;

comment on function public.deallocate_client_payment(uuid, numeric) is
  'Annule l''imputation d''un versement client, dans l''ordre inverse : avance, commandes, ventes, anciennes dettes.';


-- ============================================================================
-- 05. IMPUTATION D'UN VERSEMENT FOURNISSEUR
-- ----------------------------------------------------------------------------
--  ORDRE : anciennes dettes -> factures d'achat -> TROP-VERSE.
-- ============================================================================

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
  if p_supplier_id is null or v_left <= 0 then return; end if;

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
       set paid_amount = paid_amount + v_take,
           rest_amount = greatest(0, rest_amount - v_take),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    update public.suppliers
       set credit_amount = coalesce(credit_amount, 0) + v_left,
           updated_at    = now()
     where id = p_supplier_id;
  end if;
end;
$$;

comment on function public.allocate_supplier_payment(uuid, numeric) is
  'Impute un versement fournisseur : anciennes dettes puis factures d''achat ; le reliquat reste en trop-verse (suppliers.credit_amount).';

create or replace function public.deallocate_supplier_payment(p_supplier_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left   numeric := coalesce(p_amount, 0);
  v_take   numeric;
  v_credit numeric;
  r        record;
begin
  if p_supplier_id is null or v_left <= 0 then return; end if;

  select coalesce(credit_amount, 0) into v_credit from public.suppliers where id = p_supplier_id;
  if coalesce(v_credit, 0) > 0 then
    v_take := least(v_left, v_credit);
    update public.suppliers
       set credit_amount = greatest(0, coalesce(credit_amount, 0) - v_take),
           updated_at    = now()
     where id = p_supplier_id;
    v_left := v_left - v_take;
  end if;

  for r in
    select id, paid_amount from public.purchases
     where supplier_id = p_supplier_id and paid_amount > 0
     order by date desc, created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.paid_amount);
    update public.purchases
       set paid_amount = greatest(0, paid_amount - v_take),
           rest_amount = greatest(0, total_amount - greatest(0, paid_amount - v_take)),
           updated_at  = now()
     where id = r.id;
    v_left := v_left - v_take;
  end loop;

  for r in
    select id, paid_amount from public.party_old_debts
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
end;
$$;


-- ============================================================================
-- 06. BOUTON « ANCIENNE DETTE »  (cartes client ET fournisseur)
-- ============================================================================

create or replace function public.add_party_old_debt(
  p_party_type  text,
  p_party_id    uuid,
  p_amount      numeric,
  p_date        date default current_date,
  p_description text default ''
) returns public.party_old_debts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.party_old_debts;
  v_type   text := lower(coalesce(nullif(btrim(p_party_type), ''), 'client'));
  v_module text;
  v_name   text;
  v_credit numeric := 0;
  v_take   numeric;
  v_id     uuid;
begin
  if v_type not in ('client', 'supplier') then
    raise exception 'Type de tiers inconnu : %', p_party_type;
  end if;
  v_module := case when v_type = 'supplier' then 'suppliers' else 'clients' end;

  if not public.has_perm(v_module, 'create') and not public.has_perm(v_module, 'edit') then
    raise exception 'Vous n''avez pas la permission d''enregistrer une ancienne dette';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  if v_type = 'client' then
    select name, coalesce(credit_amount, 0) into v_name, v_credit from public.clients   where id = p_party_id;
  else
    select name, coalesce(credit_amount, 0) into v_name, v_credit from public.suppliers where id = p_party_id;
  end if;
  if v_name is null then raise exception 'Tiers introuvable'; end if;

  insert into public.party_old_debts
    (party_type, party_id, party_name, amount, paid_amount, rest_amount, date, description)
  values
    (v_type, p_party_id, v_name, p_amount, 0, p_amount,
     coalesce(p_date, current_date), coalesce(p_description, ''))
  returning * into v_row;

  v_id := v_row.id;

  -- Si le tiers avait deja une AVANCE, elle solde immediatement cette ardoise
  -- (sinon la carte afficherait en meme temps une dette et un credit).
  if v_credit > 0 then
    v_take := least(v_credit, p_amount);
    if v_type = 'client' then
      update public.clients
         set credit_amount = greatest(0, coalesce(credit_amount, 0) - v_take), updated_at = now()
       where id = p_party_id;
      perform public.allocate_client_payment(p_party_id, v_take);
    else
      update public.suppliers
         set credit_amount = greatest(0, coalesce(credit_amount, 0) - v_take), updated_at = now()
       where id = p_party_id;
      perform public.allocate_supplier_payment(p_party_id, v_take);
    end if;
    select * into v_row from public.party_old_debts where id = v_id;
  end if;

  perform public.log_activity(v_module, 'create', 'party_old_debts', v_row.id,
    jsonb_build_object('amount', p_amount, 'description', p_description));
  return v_row;
end;
$$;

comment on function public.add_party_old_debt(text, uuid, numeric, date, text) is
  'Enregistre une ancienne dette (ardoise d''avant le logiciel) pour un client ou un fournisseur. Aucun mouvement de caisse : seul son reglement en genere un.';

create or replace function public.update_party_old_debt(
  p_id          uuid,
  p_amount      numeric default null,
  p_date        date default null,
  p_description text default null
) returns public.party_old_debts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    public.party_old_debts;
  v_row    public.party_old_debts;
  v_module text;
  v_amount numeric;
  v_paid   numeric;
  v_freed  numeric;
begin
  select * into v_old from public.party_old_debts where id = p_id;
  if v_old.id is null then raise exception 'Ancienne dette introuvable'; end if;

  v_module := case when v_old.party_type = 'supplier' then 'suppliers' else 'clients' end;
  if not public.has_perm(v_module, 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier une ancienne dette';
  end if;

  v_amount := greatest(0, coalesce(p_amount, v_old.amount));
  -- Le montant deja regle ne peut pas depasser le nouveau total : l'excedent
  -- est libere et re-impute (autres dettes, factures, puis avance).
  v_paid  := least(coalesce(v_old.paid_amount, 0), v_amount);
  v_freed := coalesce(v_old.paid_amount, 0) - v_paid;

  update public.party_old_debts
     set amount      = v_amount,
         paid_amount = v_paid,
         rest_amount = greatest(0, v_amount - v_paid),
         date        = coalesce(p_date, date),
         description = coalesce(p_description, description),
         updated_at  = now()
   where id = p_id
  returning * into v_row;

  if v_freed > 0 then
    if v_old.party_type = 'supplier' then
      perform public.allocate_supplier_payment(v_old.party_id, v_freed);
    else
      perform public.allocate_client_payment(v_old.party_id, v_freed);
    end if;
    select * into v_row from public.party_old_debts where id = p_id;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_party_old_debt(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    public.party_old_debts;
  v_module text;
begin
  select * into v_old from public.party_old_debts where id = p_id;
  if v_old.id is null then return; end if;

  v_module := case when v_old.party_type = 'supplier' then 'suppliers' else 'clients' end;
  if not public.has_perm(v_module, 'delete') then
    raise exception 'Vous n''avez pas la permission de supprimer une ancienne dette';
  end if;

  delete from public.party_old_debts where id = p_id;

  -- Ce qui avait ete regle sur cette ardoise est rendu au tiers : on le
  -- re-impute sur ses autres dettes, le reliquat devient une avance.
  if coalesce(v_old.paid_amount, 0) > 0 then
    if v_old.party_type = 'supplier' then
      perform public.allocate_supplier_payment(v_old.party_id, v_old.paid_amount);
    else
      perform public.allocate_client_payment(v_old.party_id, v_old.paid_amount);
    end if;
  end if;
end;
$$;


-- ============================================================================
-- 07. BOUTON « RENDRE L'EXCEDENT »  (visible seulement si avance > 0)
-- ============================================================================

create or replace function public.refund_party_credit(
  p_party_type      text,
  p_party_id        uuid,
  p_amount          numeric,
  p_refunded_at     timestamptz default now(),
  p_notes           text default '',
  p_method          text default 'especes',
  p_cheque_number   text default null,
  p_virement_number text default null,
  p_bank_name       text default null
) returns public.party_credit_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.party_credit_refunds;
  v_type   text := lower(coalesce(nullif(btrim(p_party_type), ''), 'client'));
  v_module text;
  v_method text := lower(coalesce(nullif(btrim(p_method), ''), 'especes'));
  v_name   text;
  v_credit numeric := 0;
begin
  if v_type not in ('client', 'supplier') then
    raise exception 'Type de tiers inconnu : %', p_party_type;
  end if;
  v_module := case when v_type = 'supplier' then 'suppliers' else 'clients' end;

  if not public.has_perm(v_module, 'pay') and not public.has_perm(v_module, 'edit') then
    raise exception 'Vous n''avez pas la permission de rendre un excedent';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de reglement inconnu : %', p_method;
  end if;

  if v_type = 'client' then
    select name, coalesce(credit_amount, 0) into v_name, v_credit from public.clients   where id = p_party_id;
  else
    select name, coalesce(credit_amount, 0) into v_name, v_credit from public.suppliers where id = p_party_id;
  end if;
  if v_name is null then raise exception 'Tiers introuvable'; end if;

  if p_amount > v_credit + 0.005 then
    raise exception 'Excedent disponible insuffisant : % DA', to_char(v_credit, 'FM999999999.00');
  end if;

  if v_type = 'client' then
    update public.clients
       set credit_amount = greatest(0, coalesce(credit_amount, 0) - p_amount), updated_at = now()
     where id = p_party_id;
  else
    update public.suppliers
       set credit_amount = greatest(0, coalesce(credit_amount, 0) - p_amount), updated_at = now()
     where id = p_party_id;
  end if;

  insert into public.party_credit_refunds (
    party_type, party_id, party_name, amount, date, refunded_at, notes,
    method, cheque_number, virement_number, bank_name
  )
  values (
    v_type, p_party_id, v_name, p_amount,
    coalesce(p_refunded_at, now())::date, coalesce(p_refunded_at, now()), coalesce(p_notes, ''),
    v_method,
    case when v_method = 'cheque'   then nullif(btrim(p_cheque_number), '')   end,
    case when v_method = 'virement' then nullif(btrim(p_virement_number), '') end,
    case when v_method <> 'especes' then nullif(btrim(p_bank_name), '')       end
  )
  returning * into v_row;

  perform public.log_activity(v_module, 'pay', 'party_credit_refunds', v_row.id,
    jsonb_build_object('amount', p_amount, 'method', v_method));
  return v_row;
end;
$$;

comment on function public.refund_party_credit(text, uuid, numeric, timestamptz, text, text, text, text, text) is
  'Rend a un client (ou recupere aupres d''un fournisseur) l''excedent verse. Diminue credit_amount et ecrit le mouvement de caisse correspondant.';

create or replace function public.delete_party_refund(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    public.party_credit_refunds;
  v_module text;
begin
  select * into v_old from public.party_credit_refunds where id = p_id;
  if v_old.id is null then return; end if;

  v_module := case when v_old.party_type = 'supplier' then 'suppliers' else 'clients' end;
  if not public.has_perm(v_module, 'delete') then
    raise exception 'Vous n''avez pas la permission de supprimer un remboursement';
  end if;

  -- l'argent n'a finalement pas ete rendu : l'excedent revient au tiers
  if v_old.party_type = 'client' then
    update public.clients
       set credit_amount = coalesce(credit_amount, 0) + v_old.amount, updated_at = now()
     where id = v_old.party_id;
  else
    update public.suppliers
       set credit_amount = coalesce(credit_amount, 0) + v_old.amount, updated_at = now()
     where id = v_old.party_id;
  end if;

  delete from public.party_credit_refunds where id = p_id;
end;
$$;


-- ============================================================================
-- 08. CAISSE — le remboursement d'un excedent est un VRAI mouvement d'argent
-- ----------------------------------------------------------------------------
--  · client     -> SORTIE  (on lui rend son argent)
--  · fournisseur -> ENTREE (il nous rembourse le trop-verse)
--  Une ANCIENNE DETTE, elle, n'ecrit RIEN en caisse : aucun argent n'a bouge.
-- ============================================================================

-- Filet de securite : `payment_method_label()` vient de la mise a jour
-- « versements / modes de reglement ». Si ce script est joue avant elle, on la
-- cree ici pour que le declencheur de caisse ci-dessous fonctionne.
do $guard$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'payment_method_label'
  ) then
    execute $fn$
      create function public.payment_method_label(
        p_method text,
        p_cheque_number text default null,
        p_virement_number text default null,
        p_bank_name text default null
      ) returns text
      language sql
      immutable
      as $body$
        select case coalesce(nullif(btrim(p_method), ''), 'especes')
          when 'cheque' then
            'Cheque bancaire'
            || coalesce(' n° ' || nullif(btrim(p_cheque_number), ''), '')
            || coalesce(' - ' || nullif(btrim(p_bank_name), ''), '')
          when 'virement' then
            'Virement bancaire'
            || coalesce(' n° ' || nullif(btrim(p_virement_number), ''), '')
            || coalesce(' - ' || nullif(btrim(p_bank_name), ''), '')
          else 'Especes'
        end;
      $body$;
    $fn$;
  end if;
end
$guard$;

create or replace function public.trg_party_refund_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caisse_transactions
    (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values (
    case when new.party_type = 'client' then 'withdrawal'::public.caisse_tx_type
         else 'deposit'::public.caisse_tx_type end,
    new.amount, new.date,
    case when new.party_type = 'client'
         then 'Excedent rendu au client: ' else 'Excedent recupere du fournisseur: ' end
      || coalesce(new.party_name, '')
      || ' (' || public.payment_method_label(
           new.method, new.cheque_number, new.virement_number, new.bank_name) || ')',
    case when new.party_type = 'client' then 'Clients' else 'Fournisseurs' end,
    'party_credit_refunds', new.id, new.created_by)
  on conflict (ref_table, ref_id) do update
     set type        = excluded.type,
         amount      = excluded.amount,
         date        = excluded.date,
         description = excluded.description,
         updated_at  = now();
  return new;
end;
$$;

drop trigger if exists trg_party_refund_caisse on public.party_credit_refunds;
create trigger trg_party_refund_caisse
  after insert or update of amount, date, method, cheque_number, virement_number, bank_name
  on public.party_credit_refunds
  for each row execute function public.trg_party_refund_to_caisse();

drop trigger if exists trg_party_refund_caisse_del on public.party_credit_refunds;
create trigger trg_party_refund_caisse_del
  before delete on public.party_credit_refunds
  for each row execute function public.trg_delete_linked_caisse();


-- ============================================================================
-- 09. NETTOYAGE A LA SUPPRESSION D'UN CLIENT / FOURNISSEUR
-- ----------------------------------------------------------------------------
--  `party_old_debts` et `party_credit_refunds` pointent un client OU un
--  fournisseur : impossible d'utiliser une cle etrangere, on nettoie donc
--  par declencheur.
-- ============================================================================

create or replace function public.trg_purge_party_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_type text := case when tg_table_name = 'suppliers' then 'supplier' else 'client' end;
begin
  delete from public.party_old_debts       where party_type = v_type and party_id = old.id;
  delete from public.party_credit_refunds  where party_type = v_type and party_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_clients_purge_ledger on public.clients;
create trigger trg_clients_purge_ledger
  before delete on public.clients
  for each row execute function public.trg_purge_party_ledger();

drop trigger if exists trg_suppliers_purge_ledger on public.suppliers;
create trigger trg_suppliers_purge_ledger
  before delete on public.suppliers
  for each row execute function public.trg_purge_party_ledger();


-- ============================================================================
-- 10. VUES DE CONTROLE
-- ============================================================================

create or replace view public.v_party_old_debts as
select d.id,
       d.party_type,
       d.party_id,
       d.party_name,
       d.amount,
       d.paid_amount,
       d.rest_amount,
       d.date,
       d.description,
       d.created_by,
       d.created_at
  from public.party_old_debts d
 order by d.date desc, d.created_at desc;

comment on view public.v_party_old_debts is
  'Toutes les anciennes dettes (clients et fournisseurs) avec leur reste du.';

create or replace view public.v_party_balances as
select 'client'::text as party_type,
       c.id           as party_id,
       c.name         as party_name,
       coalesce((select sum(s.final_amount) from public.sales s where s.client_id = c.id), 0)
         + coalesce((select sum(k.total_amount) from public.commands k where k.client_id = c.id), 0)
         + coalesce((select sum(o.amount) from public.party_old_debts o
                      where o.party_type = 'client' and o.party_id = c.id), 0)      as total_du,
       coalesce((select sum(s.rest_amount) from public.sales s where s.client_id = c.id), 0)
         + coalesce((select sum(k.rest_amount) from public.commands k where k.client_id = c.id), 0)
         + coalesce((select sum(o.rest_amount) from public.party_old_debts o
                      where o.party_type = 'client' and o.party_id = c.id), 0)      as reste_du,
       coalesce(c.credit_amount, 0)                                                as avance,
       coalesce((select sum(s.rest_amount) from public.sales s where s.client_id = c.id), 0)
         + coalesce((select sum(k.rest_amount) from public.commands k where k.client_id = c.id), 0)
         + coalesce((select sum(o.rest_amount) from public.party_old_debts o
                      where o.party_type = 'client' and o.party_id = c.id), 0)
         - coalesce(c.credit_amount, 0)                                            as solde_net
  from public.clients c
union all
select 'supplier'::text,
       s.id,
       s.name,
       coalesce((select sum(p.total_amount) from public.purchases p where p.supplier_id = s.id), 0)
         + coalesce((select sum(o.amount) from public.party_old_debts o
                      where o.party_type = 'supplier' and o.party_id = s.id), 0),
       coalesce((select sum(p.rest_amount) from public.purchases p where p.supplier_id = s.id), 0)
         + coalesce((select sum(o.rest_amount) from public.party_old_debts o
                      where o.party_type = 'supplier' and o.party_id = s.id), 0),
       coalesce(s.credit_amount, 0),
       coalesce((select sum(p.rest_amount) from public.purchases p where p.supplier_id = s.id), 0)
         + coalesce((select sum(o.rest_amount) from public.party_old_debts o
                      where o.party_type = 'supplier' and o.party_id = s.id), 0)
         - coalesce(s.credit_amount, 0)
  from public.suppliers s;

comment on view public.v_party_balances is
  'Situation nette de chaque tiers : total du, reste du, avance versee et solde net (negatif = le tiers a un credit sur l''entreprise).';

do $$
declare v record;
begin
  for v in select table_name from information_schema.views where table_schema = 'public'
             and table_name in ('v_party_old_debts', 'v_party_balances')
  loop
    begin
      execute format('alter view public.%I set (security_invoker = true)', v.table_name);
    exception when others then null;
    end;
  end loop;
end
$$;


-- ============================================================================
-- 11. RECONSTRUCTION DES AVANCES DEJA ENCAISSEES  (retroactif)
-- ----------------------------------------------------------------------------
--  Avant cette mise a jour, l'excedent d'un versement etait purement perdu.
--  On le reconstitue :
--      avance = total des versements
--             - ce qui a reellement ete impute sur les factures
--             - ce qui a ete impute sur les anciennes dettes
--             - ce qui a deja ete rembourse
--  « ce qui a ete impute » = montant paye sur les documents MOINS les
--  reglements directs (encaissement a la caisse / acompte de commande), qui
--  eux ne viennent pas d'un versement.
--  Le calcul repart toujours des donnees sources : relancer le script ne
--  fausse rien.
-- ============================================================================

with direct_sales as (
  select s.client_id, coalesce(sum(sp.amount), 0) as direct_paid
    from public.sales s
    join public.sale_payments sp on sp.sale_id = s.id
   where s.client_id is not null
   group by s.client_id
),
paid_sales as (
  select client_id, coalesce(sum(paid_amount), 0) as paid
    from public.sales where client_id is not null group by client_id
),
paid_commands as (
  select client_id,
         coalesce(sum(paid_amount), 0)  as paid,
         coalesce(sum(advance_paid), 0) as advance
    from public.commands where client_id is not null group by client_id
),
paid_old as (
  select party_id, coalesce(sum(paid_amount), 0) as paid
    from public.party_old_debts where party_type = 'client' group by party_id
),
versements as (
  select client_id, coalesce(sum(amount), 0) as versed
    from public.client_payments group by client_id
),
rendus as (
  select party_id, coalesce(sum(amount), 0) as refunded
    from public.party_credit_refunds where party_type = 'client' group by party_id
)
update public.clients c
   set credit_amount = round(greatest(0::numeric,
         coalesce(v.versed, 0)
         - greatest(0, coalesce(ps.paid, 0) - coalesce(ds.direct_paid, 0))
         - greatest(0, coalesce(pc.paid, 0) - coalesce(pc.advance, 0))
         - coalesce(po.paid, 0)
         - coalesce(rd.refunded, 0)), 2)
  from public.clients base
  left join versements    v  on v.client_id  = base.id
  left join paid_sales    ps on ps.client_id = base.id
  left join direct_sales  ds on ds.client_id = base.id
  left join paid_commands pc on pc.client_id = base.id
  left join paid_old      po on po.party_id  = base.id
  left join rendus        rd on rd.party_id  = base.id
 where c.id = base.id;

with direct_purchases as (
  select p.supplier_id, coalesce(sum(pp.amount), 0) as direct_paid
    from public.purchases p
    join public.purchase_payments pp on pp.purchase_id = p.id
   group by p.supplier_id
),
paid_purchases as (
  select supplier_id, coalesce(sum(paid_amount), 0) as paid
    from public.purchases group by supplier_id
),
paid_old as (
  select party_id, coalesce(sum(paid_amount), 0) as paid
    from public.party_old_debts where party_type = 'supplier' group by party_id
),
versements as (
  select supplier_id, coalesce(sum(amount), 0) as versed
    from public.supplier_payments group by supplier_id
),
rendus as (
  select party_id, coalesce(sum(amount), 0) as refunded
    from public.party_credit_refunds where party_type = 'supplier' group by party_id
)
update public.suppliers s
   set credit_amount = round(greatest(0::numeric,
         coalesce(v.versed, 0)
         - greatest(0, coalesce(pp.paid, 0) - coalesce(dp.direct_paid, 0))
         - coalesce(po.paid, 0)
         - coalesce(rd.refunded, 0)), 2)
  from public.suppliers base
  left join versements       v  on v.supplier_id  = base.id
  left join paid_purchases   pp on pp.supplier_id = base.id
  left join direct_purchases dp on dp.supplier_id = base.id
  left join paid_old         po on po.party_id    = base.id
  left join rendus           rd on rd.party_id    = base.id
 where s.id = base.id;


-- ============================================================================
-- 12. RLS, GRANTS ET TEMPS REEL
-- ----------------------------------------------------------------------------
--  Le module de securite depend du type de tiers porte par la ligne :
--  « clients » pour un client, « suppliers » pour un fournisseur.
-- ============================================================================

do $$
declare r record;
begin
  for r in select unnest(array['party_old_debts', 'party_credit_refunds']) as tbl
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    execute format('drop policy if exists %I on public.%I', r.tbl || '_sel', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_ins', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_upd', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_del', r.tbl);

    execute format($p$
      create policy %I on public.%I for select to authenticated
      using (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'view'))
    $p$, r.tbl || '_sel', r.tbl);

    execute format($p$
      create policy %I on public.%I for insert to authenticated
      with check (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'create'))
    $p$, r.tbl || '_ins', r.tbl);

    execute format($p$
      create policy %I on public.%I for update to authenticated
      using (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'edit'))
      with check (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'edit'))
    $p$, r.tbl || '_upd', r.tbl);

    execute format($p$
      create policy %I on public.%I for delete to authenticated
      using (public.has_perm(case when party_type = 'supplier' then 'suppliers' else 'clients' end, 'delete'))
    $p$, r.tbl || '_del', r.tbl);
  end loop;
end
$$;

grant select, insert, update, delete on public.party_old_debts      to authenticated, service_role;
grant select, insert, update, delete on public.party_credit_refunds to authenticated, service_role;
grant select on public.v_party_old_debts to authenticated, service_role;
grant select on public.v_party_balances  to authenticated, service_role;

grant execute on function public.allocate_client_payment(uuid, numeric)     to authenticated, service_role;
grant execute on function public.deallocate_client_payment(uuid, numeric)   to authenticated, service_role;
grant execute on function public.allocate_supplier_payment(uuid, numeric)   to authenticated, service_role;
grant execute on function public.deallocate_supplier_payment(uuid, numeric) to authenticated, service_role;
grant execute on function public.add_party_old_debt(text, uuid, numeric, date, text)    to authenticated, service_role;
grant execute on function public.update_party_old_debt(uuid, numeric, date, text)       to authenticated, service_role;
grant execute on function public.delete_party_old_debt(uuid)                            to authenticated, service_role;
grant execute on function public.refund_party_credit(text, uuid, numeric, timestamptz, text, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.delete_party_refund(uuid)                              to authenticated, service_role;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.party_old_debts';
  exception when duplicate_object then null;
            when undefined_object then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.party_credit_refunds';
  exception when duplicate_object then null;
            when undefined_object then null;
  end;
end
$$;

commit;

-- ============================================================================
--  FIN — Anciennes dettes et avances clients / fournisseurs operationnelles.
--
--  VERIFICATIONS RAPIDES :
--    -- situation nette de chaque tiers (solde_net negatif = il a un credit)
--    select * from public.v_party_balances where solde_net <> 0 order by solde_net;
--
--    -- clients qui ont une avance a se faire rendre
--    select name, credit_amount from public.clients where credit_amount > 0;
--
--    -- anciennes dettes saisies
--    select * from public.v_party_old_debts limit 50;
--
--    -- remboursements d'excedent et leur ecriture de caisse
--    select r.party_name, r.amount, r.date, t.type, t.description
--      from public.party_credit_refunds r
--      left join public.caisse_transactions t
--             on t.ref_table = 'party_credit_refunds' and t.ref_id = r.id
--     order by r.refunded_at desc;
-- ============================================================================
