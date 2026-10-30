
React + TypeScript procurement app with role-based access, Cloudflare D1 cloud storage, and an offline SQLite store.

## Storage modes

| Mode | When | Where data lives |
|------|------|------------------|
| **Cloud** | Online and `VITE_API_URL` is set | Cloudflare D1 |
| **Local** | Offline, or no API URL is configured | Browser SQLite (sql.js) in IndexedDB |

Cloud API errors are shown rather than silently saving to a different local database. Local data can be exported as a `.sqlite` file from the navbar while using local mode. Cloud and local data are separate stores; there is no automatic synchronization.

## Local demo accounts

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |

The admin account is created only in the local offline database. Cloud accounts are provisioned separately; the first cloud administrator is created once during setup.

## Frontend setup

```powershell
npm install
npm run dev
```

## Cloudflare D1 and Worker setup

### 1. Use the provisioned D1 database

```powershell
cd cloudflare
npx wrangler whoami
```

The APAC database `procurecorp-db` is bound in `cloudflare/wrangler.toml` and its schema is applied. The deployed Worker is `https://procurecorp-api.rjimsbanzon.workers.dev`; it allows the GitHub Pages site and local Vite development origins.

For an existing D1 database, apply account verification fields from the `cloudflare` directory with `npx wrangler d1 execute procurecorp-db --remote --file=./migrations/0001_user_registration.sql`.

Apply the account access-revocation field with `npx wrangler d1 execute procurecorp-db --remote --file=./migrations/0002_user_access_revocation.sql`. Admins can revoke or restore access and permanently delete non-admin accounts from **User Verification**. Revocation invalidates existing sessions; account deletion removes the user's credentials and sessions.

### 2. Create the first cloud administrator

Set a one-time bootstrap secret from the `cloudflare` directory:
```powershell
npx wrangler secret put BOOTSTRAP_SECRET
```

Then run this PowerShell script locally. It prompts for the secret and administrator password; never put either value in source control or chat:

```powershell
$secret = Read-Host "Bootstrap secret"
$securePassword = Read-Host "New administrator password" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $body = @{
    setupSecret = $secret
    username = "admin"
    password = $password
    name = "Procurement Administrator"
    email = "admin@example.com"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "https://procurecorp-api.rjimsbanzon.workers.dev/auth/bootstrap" `
    -Method Post -ContentType "application/json" -Body $body
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  Remove-Variable password -ErrorAction SilentlyContinue
}
```

The bootstrap endpoint works only while the D1 `users` table is empty. Cloud credentials are stored separately from Enterprise business records.

### 3. Run or build the frontend

The Worker URL is set in `.env.development` and `.env.production`. Run `npm run dev` for local development or `npm run build` for GitHub Pages at `/Procurement-System/`.

The Worker issues expiring bearer sessions and stores only token hashes in D1. Cloud passwords are salted and hashed with PBKDF2 at 100,000 iterations, the maximum supported by Cloudflare Workers Web Crypto. Protect the bootstrap secret; never commit secrets.

On the cloud sign-in page, choose **Register Account** to request an Employee or Supplier account. New accounts remain pending until an administrator approves or rejects them in **User Verification**; pending and rejected accounts cannot sign in.

## API surface (Worker)

- `GET /health`
- `POST /auth/login` `{ username, password }` (returns user and bearer token)
- `POST /auth/bootstrap` `{ setupSecret, username, password, name, email }` (one-time)
- `POST /auth/register` `{ username, password, name, email, role }` (admin only)
- `POST /auth/logout` (authenticated)
- `GET /users` (admin only)
- `GET|POST /suppliers` (staff read, admin write)
- `DELETE /suppliers/:id` (admin only)
- `GET|POST /orders` (staff only; employees can create pending requests, admins can update)

## Project structure

```text
src/
  components/       Login, Dashboard, Orders, Suppliers, Users, About, Navbar
  context/          AuthContext
  db/
    schema.sql      D1 schema
    dataService.ts  Cloud/local storage selection
    cloudApi.ts     Worker API client
    localStore.ts   sql.js + IndexedDB offline store
cloudflare/
  wrangler.toml     Worker and D1 binding
  src/index.ts      Authenticated Worker API
```

Offline sql.js is loaded from a CDN; first offline use needs network access once to cache its WASM (or self-host the sql.js files under `public/`). Cloud and offline data are not synchronized automatically; use local database export/import for local backups.

## Combined enterprise interface (new)

The homepage now opens **Enterprise Workspace**, which preserves the supplied standalone HTML interface and its workflows. The **Original Project Modules** tab keeps the React application unchanged (apart from the workspace switcher): authentication, users, suppliers, purchase orders, original dashboard and existing Cloudflare/SQLite data service.

These are **two separate application datasets**, not one automatically merged record model. With `VITE_API_URL` configured, the Enterprise Workspace signs in through the Cloudflare Worker and stores business records in D1; browser storage is only a local cache. Without the API URL, it uses the original browser-local account and data store. Cloud mode does not accept local demo credentials.

### Enterprise procurement lifecycle

1. An employee creates a Purchase Request; the Procurement Head or Admin approves it and publishes its linked procurement need.
2. Suppliers apply with bids. The Procurement Head or Admin selects a supplier, schedules an online or face-to-face discussion, and records the agreed price, quantity, specifications, and terms.
3. Issuing the resulting Purchase Order moves it to **Awaiting Supplier Signature**. The assigned supplier must accept and sign it before staff can log a delivery.
4. Procurement staff inspect deliveries. Payment is enabled only when the full ordered quantity has been received and every delivery is marked **Completed - Verified**.
5. For a delivery issue, the Procurement Head or Admin issues an amendment; the supplier submits an explanation, management reviews it, and staff reinspect before payment.
6. Supplier evaluation becomes available after a transaction is paid and verified.

The supplier PO-signing action records the signed-in supplier account and timestamp; it is an in-app acceptance record, not a cryptographic or legally certified digital signature.

### Enterprise D1 storage

After signing in as the Cloudflare Admin, Enterprise business-record changes are saved to an Admin-only D1 snapshot and restored on the next sign-in. The snapshot contains stock needs, bids, meetings, requisitions, orders, deliveries, amendments, payments, suppliers, ratings, audit logs, and access-control records. Resetting the Enterprise database clears business records and audit history but keeps the Admin account.

### Local development

From the project root: `npm ci`, then `npm run dev`. Browse the displayed local URL. For cloud features, also configure `.env` and run the Worker separately as documented above.
