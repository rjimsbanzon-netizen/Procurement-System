# ProcureFlow — Finance Officer department display correction

This patch was prepared from the latest Editable Departments / One Head per Department patch.

## Replace only

`src/pages/StaffAssignmentsPage.tsx`

## Changes

- The Finance Officer selection now displays **Finance & Accounting** as the home department instead of **All departments**.
- Current assignments show **Finance & Accounting** and a secondary clarification that the **review scope is all departments**.
- The Save button reflects the responsibility chosen (Finance Officer, Finance Head, Department Head).
- The database still uses `finance_approvers.department = '*'` for Finance Officer assignments. That value represents **approval scope**, not the employee's home department. It must not be changed without changing the approval authorization logic.
- Existing Finance Officer assignments, restrictions, payment/PR checks, and separation between Finance Head and Finance Officer are unchanged.

## Deploy

1. Back up your current `src/pages/StaffAssignmentsPage.tsx`.
2. Replace it with the file in this ZIP.
3. Run from project root:

   `npm run build`

4. Deploy the frontend to GitHub Pages.

No Cloudflare Worker changes, database migration, or D1 reset are needed.
