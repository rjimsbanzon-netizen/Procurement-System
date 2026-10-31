# ProcureFlow — Admin Recovery & Complete Procurement History Reset

This patch addresses the **PR-1007 Pending approval / missing cloud PR** issue and invoices marked **Matched** while their Purchase Orders are missing. It also ensures that an Admin's reset clears old approval workflow and invoice records instead of leaving them orphaned in D1.

## Files (merge into existing project paths)

- `cloudflare/src/financeRoutes.ts` — changed; adds authenticated Admin-only restoration and atomic reset endpoints, stale-write protections. Based on the later Supplier-only invoice submission / assigned-Finance verification version, not the older ZIP.
- `src/components/RestoreMissingRecord.tsx` — new; read original PR / PO from the current browser's cached copy or a JSON backup and submit only that single record for server verification.
- `src/pages/ApprovalsPage.tsx` — changed; Admin-only restore control for a missing PR with an existing D1 workflow.
- `src/pages/InvoiceMatchingPage.tsx` — changed; flags previously matched invoices as **Match invalid — review** if the PO/delivery no longer exists; shows Admin-only PO recovery. Keeps supplier-only submission and assigned-Finance approval restrictions.
- `src/services/storage.ts` — changed; Admin reset uses the new atomic Worker endpoint rather than PUT /enterprise-state; clears browser notification-read cache after successful reset.
- `src/events/mainEvents.ts` — changed; Admin reset confirmation explicitly describes all histories being cleared. Includes the later supplier bid terms changes.

**Do not replace `cloudflare/src/index.ts`.** No new D1 migration is required if finance migration `0006` and notification migration `0005` have already been applied.

## Installation

Back up your working files and copy these six paths into the project. Since you have made incremental patches, compare any newer local edits before replacing a file.

Deploy the Worker first:

```powershell
cd D:\GitHub\Procurement-System\cloudflare
npx wrangler deploy
```

Then build and publish the frontend:

```powershell
cd D:\GitHub\Procurement-System
npm run build
```

Publish the resulting frontend using your existing GitHub Pages workflow.

## Restore PR-1007 (without creating a duplicate)

1. Sign in as **Admin** and open **Approval Workflow**.
2. Find **PR-1007** and select **Admin: restore missing PR from backup**.
3. First try **Check this browser's cached copy**. If that fails, load a `.json` copy of your **original** ProcureFlow workspace from an earlier device or export.
4. Preview the original record's title, department, amount and status. Select **Validate & restore** and confirm.
5. The Worker checks the existing D1 approval request, its submitted amount and department, the original status, required specifications, and duplication. If it matches, the missing PR is inserted and audited, with its pending approval step unchanged.
6. Refresh the Approval Workflow. The Procurement Head can resume from the existing step after review.

**A screenshot or an approval row does not contain the full original requisition**. The system will not invent its item title, quantity, technical specifications, or other details. If a trustworthy original JSON record is not available, you will need a separate administrative data-recovery procedure based on supporting evidence or an existing backup. An old browser may still have the original `eprocurement_db` in Local Storage; don't clear that device until you've checked it.

To export a browser's cached workspace while signed in on that device, paste this in that browser's Developer Tools Console (it saves a local JSON file):

```javascript
const saved = localStorage.getItem('eprocurement_db');
if (!saved) throw new Error('No cached workspace on this browser.');
const url = URL.createObjectURL(new Blob([saved], { type: 'application/json' }));
const link = document.createElement('a');
link.href = url;
link.download = 'procureflow-local-backup.json';
link.click();
URL.revokeObjectURL(url);
```

This backup may contain sensitive procurement or account information. Keep it private; do not post it publicly. The recovery UI sends only the selected PR or PO object, not the entire file.

## Restore missing PO-5001 / PO-5005

1. As Admin, open **Invoice & PO Matching** and find an invoice with **Purchase Order is missing**.
2. Select **Admin: restore missing PO from backup** under the affected invoice.
3. Choose an original workspace JSON backup containing that PO. The Worker verifies the PR relationship, quantity, signed / issued status, supplier, invoice amount, and that an existing invoice / delivery / payment references the lost PO.
4. If validation passes, the original PO is restored and audit-logged. Restore any other missing goods-receipt records separately from an authoritative backup; the invoice remains **Match invalid** until all required conditions pass.

A `Matched` row with a missing PO is **not** considered payment-ready. The patch corrects the displayed status; it does not silently change the previously recorded Finance decision.

## Admin-only reset, including historical PR approvals

When Admin clicks **Reset System Database** and types `RESET`, the Worker transaction now clears:

- All procurement workspace arrays: requisitions, stock needs, bids, orders, deliveries, payments, amendments, suppliers, ratings, previous activity/audit history
- `pr_approval_steps` and `pr_approval_requests` (old pending, rejected, approved PR workflows)
- `supplier_invoices` (invoice match history referencing the cleared POs)
- `notification_reads` (read receipts for previous activity)

One new **Procurement Records Reset** audit entry remains as evidence of the action.

It intentionally **retains registered user accounts, login sessions, approved staff assignments, department budgets/Finance rules, and uploaded files**. Document attachments already uploaded for old PRs/POs are not deleted by this change. If you want them deleted too, that should be a separate controlled procedure due to retention and evidentiary requirements.

The reset is protected by D1 authenticated Admin role and executes as a single Worker D1 batch. It is not equivalent to simply clearing the frontend `localStorage` or `enterprise_state` JSON.

After an Admin reset, **other signed-in devices should sign out and sign back in before saving**. The Worker rejects stale snapshots missing the new reset marker so older browsers don't silently reintroduce previous records.

## Back up BEFORE a future reset

For a current snapshot of your production D1 database, you can export SQL:

```powershell
cd D:\GitHub\Procurement-System\cloudflare
npx wrangler d1 export procurecorp-db --remote --output=./procurecorp-before-reset.sql
```

This backs up the **current** database state, not records already overwritten in the past. D1 Time Travel may have an earlier restore point within your plan's retention period, but **do not run a whole-database time-travel restore on production** to recover one requisition: that overwrites the *entire* database (users, sessions, approvals, invoices and recent changes). Restore only using a reviewed backup/recovery process.

## Testing performed

- TypeScript frontend check with installed React types (the uploaded source contains an unrelated `main.tsx` unused import, so test mode disables `noUnusedLocals`).
- Cloudflare finance route strict TypeScript check.
- Focused mock D1 tests: PR backup restoration, duplicate/incorrect-data rejection, Admin authorization, orphan PO backup restoration, atomic-reset table clearing, and post-reset stale-save rejection.
- No actual Cloudflare production data was accessed or changed. Please test a non-production copy before using Reset on real records.
