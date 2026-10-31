# ProcureFlow — Supplier Invoice Submission / Finance Verification

Based on the uploaded `Procurement-System(2).zip`. Only three existing source files are changed.

## Changed files

- `src/pages/InvoiceMatchingPage.tsx`
- `src/components/Sidebar.tsx`
- `cloudflare/src/financeRoutes.ts`

## Role responsibilities

| Role | Invoice responsibilities |
| --- | --- |
| Supplier | Upload an invoice document linked to an issued PO belonging to their company; submit an invoice and view its status. **Cannot verify.** |
| Procurement Officer | Record and inspect deliveries through the existing Delivery Monitoring module; view supplier invoices and review discrepancies. Cannot submit/verify invoices. |
| Procurement Head | Review invoices and POs; resolve procurement issues using the existing workflow. Cannot submit/verify invoices. |
| Assigned Finance Officer | Download and review supplier invoices, inspect matched PO/delivery data, and confirm the three-way match. Cannot submit invoices. |
| Admin | View invoices, manage assignments, and oversee the process. **Not a verifier by default**. To allow the Admin to verify, assign that account as Finance Officer in Department Budgets. |

The API enforces these restrictions: hiding a button alone cannot bypass them. A supplier must own the PO, the PO must be issued/accepted, and the linked invoice attachment must have been uploaded using that same supplier account.

## UI changes

- The Supplier screen shows an invoice-submission form and a read-only register with verification status.
- Staff and Admin see an invoice review workspace and register, **not** a submission form.
- Authorized Finance sees an additional **Confirm match** action, gated by automatic checks.
- Invoice actions are grouped side-by-side: **Review checks**, **Invoice file**, **Confirm match** (when authorized), wrapping on smaller screens.
- Submission controls appear in a responsive **Clear fields / Submit to Finance** row.
- Sidebar modules are reordered by procurement sequence: requisition → approval → bidding → PO → delivery → invoice → payment. Other permissions are unchanged.

## Integration

1. Back up your current project, especially if you have made changes since exporting `Procurement-System(2).zip`.
2. Copy the three changed files into the matching folders, or merge them if those files have newer local edits.
3. From the `cloudflare` folder deploy **only after ensuring the working `src/index.ts` still imports and calls `handleFinanceRoutes`**, as it did before:

   ```powershell
   cd D:\GitHub\Procurement-System\cloudflare
   npx wrangler deploy
   ```

4. From the repository root, rebuild and publish your frontend using your existing GitHub Pages procedure:

   ```powershell
   cd D:\GitHub\Procurement-System
   npm run build
   ```

**No D1 migrations or database resets are needed.** The existing `index.ts`, registration, notifications, documents, approvals, payment gate, and Admin-only database reset are not replaced by this patch.

## Test after deployment

- As a supplier: open an accepted/issued PO for your company, attach an invoice, and submit. Confirm the register shows Awaiting Finance.
- As another supplier: make sure the first supplier's invoice is not accessible.
- As Admin/Procurement Head: inspect invoices, but make sure no supplier-invoice submission action is available.
- As the *assigned Finance Officer*: select **Review checks**, open the invoice file, inspect the three-way results, and select **Confirm match** when all checks are clear.
- Refresh on two devices with the same account to verify D1-backed invoice statuses update.
- Try an unsigned PO, wrong-company PO, or mismatched invoice amount: it must not be verified.

## Verification performed

- Frontend TypeScript project compilation passed (`tsc -p tsconfig.json`).
- Worker TypeScript strict validation passed against the Worker, finance, document, and notification routes.
- Focused route tests passed for supplier-only submission, ownership, attachment uploader, Finance-only confirmation, and Admin oversight.
- A complete Linux Vite bundle could not be produced from the uploaded ZIP's Windows `node_modules` because its optional Linux Rollup binary was missing. Run `npm run build` on your Windows machine.
- Live Cloudflare deployment has not been performed.
