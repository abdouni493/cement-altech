-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  RESET SCRIPT — empties a database that already contains demo data
-- ----------------------------------------------------------------------------
--  ⚠  DESTRUCTIVE — READ BEFORE RUNNING  ⚠
--
--  `altech_production_supabase.sql` creates an EMPTY database, but it never
--  deletes what is already there: a project where an older version of the
--  script was executed still holds the demo accounts (admin / demo / mustapha /
--  omar / youcef) and the demo data (produits, clients, ventes, achats,
--  productions, dépenses…).
--
--  This script removes ALL of it — every business row AND every login account,
--  including the administrators. Run it only on a store that has not started
--  its real activity yet.
--
--  AFTER RUNNING IT
--   1. re-run `altech_production_supabase.sql` (it is idempotent and recreates
--      the functions, triggers, policies and the two configuration rows),
--   2. open the application on /login,
--   3. click "Créer un compte Administrateur" — the button is visible again
--      because the database no longer has any administrator.
--
--  Usage: Supabase Studio > SQL Editor > paste > Run.
-- ============================================================================

begin;

-- ---- every business row ----------------------------------------------------
truncate table
  public.activity_log,
  public.stock_movements,
  public.purchase_payments,
  public.purchase_lines,
  public.purchases,
  public.sale_payments,
  public.sale_lines,
  public.sales,
  public.command_items,
  public.commands,
  public.client_debt_versements,
  public.client_debts,
  public.clients,
  public.suppliers,
  public.production_used_products,
  public.productions,
  public.fiche_technic_lines,
  public.fiche_technics,
  public.destructions,
  public.comptoir_items,
  public.worker_acomptes,
  public.worker_absences,
  public.worker_payments,
  public.workers,
  public.expenses,
  public.caisse_transactions,
  public.caisse_reports,
  public.products,
  public.marques,
  public.categories,
  public.units,
  public.production_categories,
  public.fiche_categories,
  public.expense_categories,
  public.caisse_categories,
  public.roles,
  public.profiles
  restart identity cascade;

-- ---- every login account ---------------------------------------------------
-- profiles are already gone (truncate above); auth.users is the source of truth
delete from auth.identities;
delete from auth.users;

-- ---- configuration back to zero -------------------------------------------
update public.caisse_settings set initial_balance = 0 where id;

commit;

-- ============================================================================
--  The database is now empty: no account, no product, no client, no movement.
--  Create the first administrator from the login page of the application.
-- ============================================================================
