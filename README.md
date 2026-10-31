# ProcureFlow registration: HTML username pattern + Cloudflare PBKDF2

This is a **two-line, non-destructive** repair for two distinct errors:

1. Chrome's HTML `pattern` uses JavaScript `/v` regex syntax, so `[A-Za-z0-9._-]{3,32}` is invalid. Correct pattern: `(?:[A-Za-z0-9._]|-){3,32}`.
2. Cloudflare Workers in the user's earlier runtime logs rejected PBKDF2 iteration counts above 100,000, while one Worker revision requested 210,000. The script lowers the **constant for newly generated password hashes** to 100,000 only when currently above that limit.

## Install

1. Copy `scripts/fix-registration-errors.mjs` into `D:\GitHub\Procurement-System\scripts\` (create folder if needed).
2. Open PowerShell at `D:\GitHub\Procurement-System`.
3. Execute:

   ```powershell
   node scripts/fix-registration-errors.mjs
   ```

   The script checks both files before changing anything. It backs up each modified file next to the original with `.bak-*` suffix. If it cannot find the expected code, it quits instead of overwriting working routes.

4. If `cloudflare/src/index.ts` was modified, deploy your existing Worker:

   ```powershell
   cd cloudflare
   npx wrangler deploy
   cd ..
   ```

5. Build your frontend and publish it with your current GitHub Pages deployment workflow:

   ```powershell
   npm run build
   ```

   A Worker deployment does **not** deploy the frontend HTML change. You must publish the updated frontend separately.

6. Try registering again. If it still returns HTTP 500, stream the **new** exception and inspect it:

   ```powershell
   cd cloudflare
   npx wrangler tail procurecorp-api --format pretty
   ```

## Manual edits (if preferred)

**src/views/auth.ts**: Replace exactly:

```text
pattern="[A-Za-z0-9._-]{3,32}"
```

with:

```text
pattern="(?:[A-Za-z0-9._]|-){3,32}"
```

**cloudflare/src/index.ts**: Replace the `PASSWORD_ITERATIONS` value of `210_000` with `100_000` (if still above 100,000).

## Scope and safety

- No D1 database schema modifications.
- No deletions, user account changes, or stored password hash rewrites.
- No replacement of authentication routes, finance, notifications, or documents.
- Existing password hashes with iteration counts **above 100,000** will still be unsupported by this Cloudflare runtime, so those particular accounts would require a separate secure password-reset flow. Do not lower the iteration count encoded inside their stored hashes; that will break authentication.
- HTTP 500 might have a different cause after this change; the Worker tail is authoritative.
