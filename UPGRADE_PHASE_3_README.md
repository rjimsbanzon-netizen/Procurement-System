# ProcureFlow — Phase 3: D1 record index and least-privilege workspace reads

Source: `Procurement-System(20261103-142830).zip` + Phase 1 + Phase 2 + Delivery Issues Dashboard Fix (assembled in the working copy). This package contains ONLY Phase 3's added or modified files; it is NOT a full project and must be applied to your existing Phase 2 repository.

## What Phase 3 changes

1. **Non-destructive record-index migration** `cloudflare/migrations/0021_workspace_record_index.sql` creates `workspace_record_index`. It backfills the 10 business record collections from the existing `enterprise_state` snapshot. SQLite triggers maintain the index transactionally when any existing Finance, Sourcing, Admin reset or other route updates the canonical snapshot. Indexes allow subsequent work to move toward per-record querying, by collection / department / supplier.
2. **Read restrictions on `GET /enterprise-state`**: Admin still sees the original snapshot; verified suppliers retain the supplier-only view added in Phase 2; regular staff see department-related PRs, PO/delivery records and limited payment status instead of company-wide financial data. Existing procurement and operations cross-department workflows remain supported; approved Finance appointees may see Finance records after the Worker checks the appointment in D1. Non-admin users no longer receive raw `auditLogs` or unrecognized internal snapshot fields.
3. **Admin-only integrity endpoint**: `GET /admin/workspace-record-integrity` compares every indexed record with the canonical snapshot and returns `ok`, per-collection counts and a truncated list of mismatches (not complete record payloads). It returns HTTP 409 if there is index drift or 503 if the migration is missing. Only authenticated Admin can access it.
4. **Concurrency compatibility**: D1 reports trigger row changes in its `meta.changes`, so the existing snapshot optimistic-write checks are switched to `UPDATE ... RETURNING id` and check for one RETURNED row. This avoids false 409 errors after the migration. Linked approval, sourcing, invoice, payment and supplier security validators remain intact.
5. **Regression checks**: tests include backfill, specialized-path updates, stale-write rejection, reset cleanup, department-limited data, supplier isolation (previous Phase 2 tests), full access for Admin, and detection of index drift. Existing Phase 1, Phase 2 and Delivery Issue tests are preserved.

**What this does NOT do:** It does not yet remove the canonical snapshot, cut every module over to the index, or fully normalize business records into separate relational tables. Existing specialized Finance, Sourcing and Operations D1 tables stay as they are. The indexed table adds storage/write overhead, so monitor D1 performance. A full production/security audit and an end-to-end authenticated test against a disposable D1 Worker are still needed.

## Files changed / added

- `cloudflare/src/index.ts` (read access / integrity route / returning-based CAS)
- `cloudflare/src/workspaceChanges.ts` (department-scoped read projection)
- `cloudflare/src/workspaceRecordIndex.ts` **NEW** (integrity checker)
- `cloudflare/src/financeRoutes.ts` (returning-based CAS)
- `cloudflare/src/sourcingRoutes.ts` (returning-based CAS)
- `cloudflare/migrations/0021_workspace_record_index.sql` **NEW**
- `cloudflare/rollback/phase3_workspace_index_rollback.sql` **NEW**, emergency use only
- `tests/phase3ReadModel.test.mjs` **NEW**
- `UPGRADE_PHASE_3_README.md` **NEW**

No frontend components, logos, existing database records, access matrix data, or passwords are distributed in this patch.

## Required installation order — critical

**Do not apply migration 0021 while the old Phase 2 Worker is still running.** The index triggers increase the number of rows changed by a statement; the old worker's `meta.changes === 1` checks can incorrectly treat completed writes as failed.

1. Back up your repository and export your current production D1 database using an account with appropriate access. Keep that backup PRIVATE:

   ```powershell
   cd cloudflare
   npx wrangler d1 export procurecorp-db --remote --output=../procureflow_pre_phase3.sql
   ```

   Do not commit the exported SQL; it may contain sensitive supplier and financial data. Add it to `.gitignore` or store it outside the repository.

2. Test Phase 3 against a disposable local or staging database first. Confirm that any earlier migrations required for your test database are installed. Run:

   ```powershell
   cd ..
   npm ci
   npm test
   npm run build
   cd cloudflare
   npm ci
   npx tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --types @cloudflare/workers-types src/index.ts
   ```

3. Set a short maintenance window for multiuser writes. **Deploy the new Worker code FIRST** (the new code functions before migration 0021, except the new Admin integrity endpoint):

   ```powershell
   npx wrangler deploy
   ```

4. **Then** apply migration 0021 to the remote D1 database. It creates a new derived index and triggers; it does not erase the canonical procurement data:

   ```powershell
   npx wrangler d1 execute procurecorp-db --remote --file=./migrations/0021_workspace_record_index.sql
   ```

   Run it only once for this deployment. Monitor D1 errors. If the migration fails, do NOT delete or reset your business records. Use the rollback guide below and investigate.

5. Check the Admin integrity endpoint from a signed-in Admin session. In browser DevTools Console on the ProcureFlow page, run:

   ```js
   fetch('https://procurecorp-api.rjimsbanzon.workers.dev/admin/workspace-record-integrity', {
     headers: { Authorization: `Bearer ${localStorage.getItem('procurement_enterprise_token')}` }
   }).then(async r => ({status:r.status, result:await r.json()})).then(console.log)
   ```

   Expected result: `status: 200` with `result.ok: true` and matching counts for all 10 collections. **Never share the actual access token.** If the result is 409, do not proceed to business transactions; review mismatches. If 503, the schema migration has not been applied successfully.

6. Commit and push your repository changes, then refresh all open browsers/PWAs so all clients run Phase 2-compatible code. GitHub Pages builds in GitHub Actions. There are no Phase 3 frontend component changes, but the server's read projection changes the records that regular employees can see.

7. Test in a **disposable/staging environment**: Admin, Employee from two departments, Department Head, Operations/Procurement, Finance Officer/Head, and Supplier. Check these workflows without real funds: PR create/update, multi-step approve/reject, published bidding, supplier bid, PO issue/sign, delivery discrepancy, invoice matching, authorized payment, Admin reset, and two simultaneous edits to the same record (the later stale edit must receive 409). Confirm D1 index integrity after every group of changes. Do not run Admin reset on production just to test this.

## Emergency rollback (do not remove the canonical business data)

If the triggers cause errors or high D1 cost, stop new writes. Back up the current D1 database; do not restore an older snapshot over newer legitimate procurement transactions. **Drop triggers/index FIRST**:

```powershell
cd cloudflare
npx wrangler d1 execute procurecorp-db --remote --file=./rollback/phase3_workspace_index_rollback.sql
```

Only then restore the prior Worker code from Git, if necessary. The rollback script drops **only the derived `workspace_record_index` and its triggers**, not `enterprise_state`, orders, invoices, approvals or user accounts. Do not run `finance/admin/reset-workspace` to roll back.

## Local verification performed for this patch

- Node 22: **42/42 tests passed**, including seven new Phase 3 tests.
- Frontend TypeScript: passed.
- Worker TypeScript: passed.
- In-memory SQLite: full migration SQL parsed/executed, backfill and trigger synchronization passed, stale CAS returned no rows, Admin reset cleared indexed rows, index checker caught tampering.
- Full Vite build NOT locally verified: uploaded Windows dependency tree lacks `@rollup/rollup-linux-x64-gnu` in this Linux environment. Run `npm ci` on a supported OS then `npm run build`; CI should install appropriate Rollup binaries.
- No live Worker, remote D1, real financial transaction, or end-to-end authenticated browser test was performed. Do not claim production certification without these checks.
