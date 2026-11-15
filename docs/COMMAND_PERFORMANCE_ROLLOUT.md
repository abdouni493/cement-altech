# Commandes et bons de livraison : validation et déploiement

Baseline inspected: `d8ae668`. Changes are local and reviewable; no production
data, hosted database, Vercel deployment, or environment configuration was changed.

## Deployment order

1. In staging first, take a verified backup and retain installed function
   definitions. Run `diagnostics/document_numbering.sql` read-only. Check actual
   installed definitions, duplicate BL references, nonstandard legacy references,
   suffix maxima and indexes. A duplicate BL reference intentionally stops 04;
   resolve its business identity explicitly, never automatically renumber it.
2. Quiesce writes during migration (including old tabs, imports, scheduled jobs,
   POS and restores). Apply **complete files, in order**:
   - `sql_nouveau_projet/04_atomic_reference_allocator.sql`
   - `sql_nouveau_projet/05_atomic_command_operations.sql`
   - `sql_nouveau_projet/06_command_summaries.sql`
   - `sql_nouveau_projet/07_purchase_summaries.sql`
3. Each file is transactional and upgrade-safe/reapplicable against the supported
   installed definitions. 04 deliberately fails on unfamiliar numbering code
   rather than overwrite unrelated installed business fixes. Inspect and adapt
   its reviewed replacement blocks for a divergent installation. Allow the
   PostgREST schema cache to reload; migrations send notifications.
4. Run the local fixture suite below; repeat the operator checks in staging with
   both an administrator and restricted worker. Capture the hosted waterfall
   using the supplied browser benchmark before accepting latency targets.
5. Deploy the frontend to Vercel **after SQL**. Existing Supabase public URL/key
   configuration is unchanged. New order/delivery writes require the v2 RPCs;
   they fail visibly if SQL is missing and never fall back to partial writes.
   The repository push uses `[skip vercel]` in the commit message to request
   skipping automatic Vercel deployment. Verify that behavior in the project's
   Git integration; no deployment is initiated by the validation scripts.
6. Refresh all operator tabs. Keep the database migrations if the frontend must
   be reverted. Do not restore historical SQL after 04 without reapplying 04–07.

Fresh installation: execute `01_schema_de_base.sql`, all seven
`02_mises_a_jour_partie_01_sur_07.sql` through `...07_sur_07.sql`, then
`03_finalisation.sql`, then **04 → 05 → 06 → 07**, all under `sql_nouveau_projet/`.
The older equivalent aggregate path (base + toutes_mises_a_jour + finalisation)
must also end with these four new files. No application data migration, default
account, or renumbering is needed.

## Effective definitions and numbering

The latest effective definitions come from part 05 (`create_command`,
`create_command_delivery`), part 06 (`apply_delivery_sale`), part 03
(`create_sale`, delegated to by `create_sale_with_productions`), part 02
(`create_purchase`), and part 01 (`create_purchase_order`). Earlier same-name
definitions are superseded. Migration 04 patches these six installed numbering
blocks while preserving their business bodies, security attributes and grants.
05 retains the delivery accounting body under a private `_accounting_v1` name
and puts serialized validation in front of it. Reapplying 04 finds that alias.

`document_reference_counters` stores a high-water value per complete prefix.
Allocation is a single primary-key UPSERT; `lpad` uses the larger of the minimum
width and actual suffix length. CMD/VNT/ACH/BC retain each writer's existing
year/date choice; BL retains its full parent-order reference scope. Manual
`bon_number` is untouched. Gaps and deleted numbers are not reused. Issued
references remain byte-for-byte unchanged. Nonstandard references remain
verbatim and are explicitly excluded from numeric initialization (see diagnostic).

POS and BL-linked invoices coordinate in the same VNT namespace. Observation
triggers advance counters for explicit imports, recycle restore and direct
legacy inserts. Existing exact-reference uniqueness remains authoritative;
uncoordinated old browser-generated references may get a duplicate-key error
and require retry. New SQL writers allocate atomically. Imports disabling
triggers must call the private `sync_document_reference_counters()` as an
authorized migration operator before commit. Bulk restore handles this itself.
Normal saves never scan history to initialize counters.

## Confirmed writes, retry and print semantics

`create_command_v2(uuid,jsonb)` combines order, lines, optional client address
update, cash advance and requested customer-credit allocation. Delivery v2
combines price overrides, delivery/stock, advance, cash, linked invoice and
requested credit. A stable operation ID and canonical payload are retained
across retries. Server receipts are scoped to the actor, operation kind and
payload; conflicting reuse is rejected. A replay returns the original committed
result, even after a lost response. Do not generate a fresh ID just because a
network request timed out. Confirmed database rejection allows correcting the
form; ambiguous transport errors require verifying the pending attempt first.

The receipt contains the command and ordered lines/payments, new BL and lines,
linked invoice, authoritative money fields/customer credit, and older BLs and
invoices modified in that transaction. Stores merge these by ID. There is no
post-create readback or full-history fallback in the normal command path.
Old in-flight command/client/sale reads cannot overwrite those confirmed merges.
Credit messages and balance use server-applied amounts, not requested estimates.
The print/title prompt opens from confirmed data; existing title, end text,
column labels, French/Arabic, fiscal identifiers, driver and location options
remain available. Duplicate product lines match by line ID rather than name.

Selected order details/reprint are read by parent ID. Command and purchase
lists fetch bounded pages with stable date/ID ordering; their SQL totals cover
all filtered results, not just the page. After a command save the merged row is
immediate and totals are marked for explicit refresh rather than silently
starting a history query. History reports retain explicit all-history reads.
Startup/focus loads only current-route dependencies and defers cross-screen
invalidations; account switching clears prior account data and pending reads.

## Measured findings (highest impact first)

All SQL benchmarks use disposable local PostgreSQL 15, an admin auth fixture and
identical rolled-back input per sample, with no hosted network latency. Raw
samples, counts, roles and conditions are retained in `tests/*benchmark-results.json`.

1. **Numbering livelock:** five of five baseline runs in each boundary fixture
   hit a 500 ms statement timeout; none completed. After 04, five of five
   completed: CMD999→1000 median/p95 **4.000/4.283 ms**; a first BL whose sale
   crosses VNT999→1000 **20.520/50.156 ms**; BL99→100 **20.430/31.026 ms**.
   Timeout times are censored lower bounds, not successful 500 ms operations.
   These delivery fixtures use historical mode to isolate numbering.
2. **Read waterfall:** normal create/delivery now return a committed receipt
   instead of loading all orders, BLs and adjustments plus competing stock,
   sales, client-ledger and caisse histories. Browser evidence and exact command
   are described below; do not infer hosted latency from local SQL timings.
   In the deterministic Chromium HTTP simulation (40 ms/request, 1 MB/s,
   15 runs/scenario), creation changed **2→1 requests**, keeping zero unfiltered
   reads; delivery changed **16→1 requests**, removing **15 unfiltered reads**
   including background requests. For 800 orders/80 selected-order BLs,
   store-call-to-next-frame delivery median/p95 changed **448.1/501.0 →
   47.7/95.6 ms**. Small-history delivery changed **113.0/114.6 → 62.4/67.1 ms**.
   This isolates request shape and transfer cost, not live database or hosted
   network latency. Raw request waterfalls and samples are retained in
   `tests/browser-benchmark-results.json`.
3. **Repeated settlement:** the old oldest-first loop recomputed available
   advance across all same-order BLs on each iteration. The replacement computes
   availability once, visits candidates, and updates only changed allocations.
   Existing monetary recomputation and quantity validation are retained.
   Isolated 500-funded-BL fixture: median/p95 **56.645/69.149 → 0.774/1.918 ms**
   over 15 local SQL runs, without linked invoices (intentionally isolates the
   helper). Actual query plans in `tests/command-cost-plans.txt` show remaining
   quantity joins still scan same-order detail: 10.391 → 11.209 ms in this
   single diagnostic capture, while the indexed changed-document candidate
   query changes 0.152 → 0.013 ms. Those plan captures are illustrative, not
   statistically significant speedup claims.

Server-only small/large ordinary-operation comparisons are in
`tests/benchmark-results.json` (15 samples per case). A v2 receipt/idempotency
transaction adds overhead on small histories; it is not a universal SQL speedup.
For the ordinary 800-history/80-BL fixture, delivery median is **4.231→3.271 ms**;
small delivery is **1.583→2.512 ms**. These are server-only values.
Whole-order quantity/payment/advance aggregates still scale with the selected
order's lines and BL count. Price changes and advance reallocation legitimately
revisit older affected documents. Filtered list aggregate queries scale with
matching history. The change does not claim constant-time delivery for an order
with arbitrarily many prior BLs, or constant-time all-history reports.

## Reproduce and inspect

```sh
npm ci
npm run test
npm run test:database
npm run lint
npm run build
npm run benchmark:numbering
npm run benchmark:database
npm run benchmark:restore
npm run benchmark:settlement
npm run benchmark:browser
node scripts/explain-command-cost.mjs
```

Node 24 and Docker are used here. Database tests/benchmarks create disposable
containers with no exposed port; they accept no production connection string.
`tests/sql/bootstrap.sql` is a local auth contract fixture, **never** a migration
for hosted Supabase. It is not a complete emulation of the hosted auth service.
The DB suite applies the entire supported fresh-install path, replays new
migrations, asserts balances/links/stock, and runs independent concurrent
cashier connections. See fixture assertions for exact covered scenarios.

For the actual UI and print regression, start Vite in one terminal with
`BROWSER=none npm run dev -- --host 127.0.0.1 --strictPort`, then run
`npm run test:browser` in another. Chromium must be installed; override its path
with `CHROMIUM_PATH` (default `/usr/bin/chromium`). Playwright is a locked dev
dependency. The test intercepts every Supabase request, so writes stay in
fixtures. It operates the create/deliver controls, double-clicks save, opens the
title and print iframe, checks driver/location and duplicate line quantities,
reprints and checks Arabic/RTL; it also tests durable lost-response replay and
stale reads at store level. Actual click timing samples for this unthrottled
fixture run are in `tests/browser-ui-results.json`; one run is functional
evidence, not a meaningful median/p95. `benchmark:browser` starts its own local
Vite servers and extracts baseline `d8ae668` into a temporary directory, reusing
installed dependencies. It measures store calls plus a rendered frame rather
than pretending to measure a baseline click/print-dialog workflow.

Read-only diagnostics against a staging fixture:

```sh
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f diagnostics/document_numbering.sql
psql "$STAGING_DATABASE_URL" -v command_id=YOUR_FIXTURE_UUID -f diagnostics/command_cost.sql
```

Inspect plans for the selected command's quantity join, advance/payment sums and
changed-document receipt candidates. Existing finalisation supplies FK indexes;
04 supplies counter PK/BL uniqueness, 05 the line/delivery and changed-document
indexes, 06/07 stable list indexes. Recheck actual indexes and plans on staging;
no production write benchmark or production EXPLAIN of write RPCs is authorized.

For real Vercel/Supabase acceptance use the **same staging fixture snapshot**
before/after; record row counts, BLs per selected order, role, browser, region,
network throttling/RTT, warmup count and 15+ measured runs. Export Network HAR
(redact authorization headers and business data). `window.__commandTimings`
records click-to-RPC-return (`rpcMs`), RPC-return-to-confirmation
(`confirmationMs`) and click-to-print-prompt-ready (`printReadyMs`). It measures
prompt readiness, not completion of the browser/OS print dialog. Count all
unfiltered history requests including background traffic until print-ready and
for a grace period afterwards. Expected for a normal command/delivery save: one
v2 RPC and **zero** unfiltered history reads. Catalog and selected-ID reads are
separate. Hosted network end-to-end p95 remains unmeasured in this workspace.

## Backup restore is independent

`tests/restore-benchmark-results.json` separates local JSON parse from actual
database restore: 10-order/10.9 KB versus 5000-order/3.47 MB fixtures, 15 parse
samples and five DB samples. Median database times were about **307/415 ms**;
Node JSON parse **0.027/8.471 ms**. These are not browser upload or reload times.
Settings records file bytes/read, JSON parse, HTTP round trip and first rendered
frame after reload as `[restore timing]` metadata only. HTTP timing includes
upload, DB processing and response; use the SQL benchmark for DB-only time.
User confirmation delay and the deliberate reload delay are excluded. Browser
upload, route hydration and hosted restore latency are not measured here.

Backups include new operational tables via the existing table-discovery helper.
Restore merges greatest pre-restore/imported/actual reference counters, so
counter fingerprints may intentionally differ from an older backup while issued
documents match. Restore requires a maintenance window: never replay pending
operator requests across database reset. A receipt whose document disappeared
is rejected. Close old tabs and start clean sessions after restore. Do not prune
idempotency receipts during rollout; deleting them enables duplicate retries.

## Older sessions and recovery

Old RPC signatures still work with fixed numbering; legacy delivery calls gain
transactional quantity/stock validation. Old frontend sessions retain their own
history waterfalls and non-idempotent command fallback, and do not receive the
new retry guarantee. Refresh them before resuming cashier work. Concurrent
reference-generated inserts remain unique; database deadlock/serialization
errors roll back and can be retried with the same v2 operation ID.

If deployment fails, keep 04–07 and revert only the frontend release, then fix
forward. To recover a migration error, its transaction rolls back; inspect the
reported incompatible definition/duplicate before retrying. Never delete issued
documents, decrement counters, purge receipts or restore old fixed-width
numbering to roll back a frontend issue. Business corrections use existing
edit/delete/reversal flows with audit and stock rules. A database backup restore
is disaster recovery under maintenance, not an application-release rollback.

## Operator checklist

1. Créer une commande avec adresse, doublon de produit si nécessaire, TVA,
   versement et acompte client. Vérifier référence, total TTC, crédit réellement
   imputé et reste confirmé; imprimer le bon de commande.
2. Livrer une quantité partielle puis le solde. Vérifier matière disponible,
   avance proposée, espèces, crédit client réel et facture VNT liée. Une
   livraison concurrente du dernier solde doit être refusée sans déduire du stock.
3. Vérifier le titre, colonnes, chauffeur, matricule, lieu et identité fiscale;
   imprimer immédiatement puis réimprimer depuis le détail de la même commande.
   Tester aussi la langue arabe/RTL.
4. Vérifier caisse, dette, avance, mouvements et documents liés; annuler/modifier
   dans une fixture pour contrôler les contre-écritures. Une ancienne commande
   ne doit pas consommer le stock ni créer une entrée de caisse actuelle.
5. Après interruption réseau, utiliser la vérification de la tentative existante;
   ne pas ressaisir une deuxième commande. Actualiser les totaux de liste quand
   l'indicateur le demande et vérifier la fraîcheur sur un deuxième terminal.

## Changed-file map

- SQL: migrations **04–07**; `diagnostics/document_numbering.sql` and
  `diagnostics/command_cost.sql`.
- Commands/BL: `src/pages/Clients/Commands.tsx`, `DeliveryModal.tsx`,
  `src/store/commandStore.ts`, `src/lib/db.ts`, `commandOperation.ts`,
  `commandQueries.ts`, `documents.ts`, and delivery credit typing in `src/types/index.ts`.
- Loading/freshness: `src/App.tsx`, `src/pages/Login.tsx`, `src/lib/sync.ts`,
  `background.ts`, `routeData.ts`, and guarded client/sale/stock/production/comptoir stores.
- Purchases/POS: `src/pages/Purchase/index.tsx`, `src/store/purchaseStore.ts`,
  `src/store/salesStore.ts`, `src/lib/purchaseQueries.ts`, `posQueries.ts`.
- Independent restore telemetry: `src/pages/Settings/index.tsx`,
  `src/lib/restoreTiming.ts`, `src/main.tsx`.
- Validation/reproducibility: `package.json`, lockfile, `eslint.config.js`,
  `tests/` fixtures/results and `scripts/` database/browser/numbering/restore/
  settlement benchmarks and plan capture. Setup and rollout links are in
  `README.md` and `MIGRATION_NOUVEAU_PROJET.md`.
