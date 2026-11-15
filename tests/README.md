# Performance regression checks

Run from the repository root with Node.js 24 and npm:

```sh
npm ci
npm test
npm run lint
npm run build
npm run test:database
npm run benchmark:database
npm run benchmark:numbering
npm run benchmark:restore
npm run benchmark:settlement
npm run benchmark:browser
node scripts/explain-command-cost.mjs
```

Database commands require a running Docker daemon. They launch a new official
PostgreSQL 15 container, publish no network port, accept no remote database URL,
apply the actual supported migrations in order, and destroy the container on
completion. `tests/sql/bootstrap.sql` is a **local auth-contract fixture**, not a
replacement for Supabase Auth and never a hosted-project migration. The tests use
real PostgreSQL functions, transactions, row locks, tables, constraints, and RLS
permissions. Browser and API tests do not establish that Supabase Auth sign-in or
Vercel networking works.

`test:database` applies base schema, update parts 1–7, finalisation, then migrations
04–07, reapplies 04–07, runs each SQL regression fixture, and races real concurrent
sessions. SQL fixtures roll back. Concurrency tests use a disposable container and
assert invoice links/counts, stock movements and remaining quantities, duplicate
operation receipts, unique references, and shared customer credit balances.

`benchmark:database` compares old functions and the v2 path using the same
fixtures and 15 samples per scenario (`BENCHMARK_RUNS=2..100` overrides). Each save
runs in a rolled-back subtransaction so every sample starts with identical stock,
financial balances, document count and counters. Small fixtures have 10 existing
orders/sales and no BL; large fixtures have 800 existing orders/sales plus a
selected order with 80 BL and linked invoices. Existing invoices are deliberately
below the old 999 limit so the baseline can finish. Results include full samples,
median and p95 in `benchmark-results.json`. These are **server SQL execution
measurements**, excluding Vercel/Supabase round trips and browser rendering.

`benchmark:numbering` separately reproduces the original CMD999, VNT999 and BL99
stalls with a 500 ms statement timeout and runs the same operation after the
allocator migration. Its JSON records completed versus timed-out runs. A timeout
is a lower bound, not a measured successful baseline duration.

`benchmark:restore` is independent of order saves. It measures Node.js JSON parse
and actual database backup restore processing against 10-order and 5,000-order
fixtures. Database samples verify restored counts. Node parse is not browser
parse; HTTP upload and app reload remain unmeasured without staging. The app now
records those phases separately for a safe staging run.

Browser checks and timing instrumentation are described in the deployment guide.
A mocked browser waterfall demonstrates request shape and immediate print data;
it cannot substitute for network/SQL performance on a real Supabase staging
project. Production has never been used for write benchmarks.

With Vite running on port 5173 (`BROWSER=none npm run dev -- --strictPort`), run
`npm run test:browser`. It uses the locked Playwright dev dependency and system
Chromium (`CHROMIUM_PATH` overrides `/usr/bin/chromium`). All Supabase requests
are intercepted. Real operator controls exercise creation, double click guards,
delivery, title selection, print iframe and reprint, plus Arabic/RTL. Store tests
exercise stale reads and durable lost-response recovery. Functional UI samples
are recorded in `browser-ui-results.json`, not represented as hosted timings.

`benchmark:browser` starts baseline/current Vite servers on 5174/5175, extracts
baseline d8ae668 into a temporary directory and reuses installed dependencies.
Its 15-run scenarios intercept transport with 40ms/request +1MB/s responses.
`browser-benchmark-results.json` includes counts, median/p95, samples and a
request waterfall including background traffic and 150ms post-confirmation grace.
Measured start/end is store-call-to-next-frame, not UI click-to-printer. No SQL
runs in that simulation. `command-cost-plans.txt` records actual local SELECT
EXPLAIN ANALYZE/BUFFERS and indexes with 10,500 BLs and 500 on one selected order;
the script reproduces them in a new disposable database.

`benchmark:settlement` isolates the helper with 500 fully funded BLs and remaining
advance, seeded directly so the old numbering loop cannot prevent measurement.
It records 15 SQL samples before/after. This excludes invoice updates because the
seeded BLs have no linked invoices; normal delivery benchmarks include invoices.
