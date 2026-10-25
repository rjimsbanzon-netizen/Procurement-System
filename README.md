# ProcureCorp - Procurement System

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
| Employee | `employee` | `emp123` |
| Guest | `guest` | `guest123` |

These accounts are created only in the local offline database. Cloud accounts are provisioned separately; the first cloud administrator is created once during setup.

## Frontend setup

```powershell
npm install
npm run dev
```

## Cloudflare D1 and Worker setup

### 1. Create and bind the D1 database

```powershell
cd cloudflare
npm install
npx wrangler login
npx wrangler d1 create procurecorp-db
```

Copy the `database_id` returned by Wrangler into `cloudflare/wrangler.toml` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

### 2. Apply the database schema

From the `cloudflare` directory:

```powershell
npm run db:migrate
```

This creates the accounts, sessions, suppliers, and purchase orders tables in D1.

### 3. Set the bootstrap secret and deploy the Worker

```powershell
npx wrangler secret put BOOTSTRAP_SECRET
npx wrangler deploy
```

Set `BOOTSTRAP_SECRET` to a strong, unique setup value when prompted. Configure `ALLOWED_ORIGIN` in `cloudflare/wrangler.toml` to the exact frontend origin before deploying to production.

### 4. Create the first administrator

The bootstrap endpoint accepts only the configured secret and only works while the users table is empty. From PowerShell, substitute your deployed Worker URL and provide the account values:

```powershell
$secret = Read-Host "Bootstrap secret"
$password = Read-Host "Administrator password"
$body = @{
  setupSecret = $secret
  username = "admin"
  password = $password
  name = "Procurement Administrator"
  email = "admin@example.com"
} | ConvertTo-Json
Invoke-RestMethod -Uri "https://procurecorp-api.YOUR_SUBDOMAIN.workers.dev/auth/bootstrap" `
  -Method Post -ContentType "application/json" -Body $body
```

Use this administrator account to add employee and guest accounts from the app's **Users** page.

### 5. Connect the frontend

Copy `.env.example` to `.env` in the project root and set the Worker URL:

```dotenv
VITE_API_URL=https://procurecorp-api.YOUR_SUBDOMAIN.workers.dev
```

Restart Vite after changing the environment file. For Cloudflare Pages, set `VITE_API_URL` as a build-time environment variable and deploy the Vite `dist/` directory.

The Worker issues expiring bearer sessions and stores only token hashes in D1. Cloud passwords are salted and hashed with PBKDF2. Protect the bootstrap secret and restrict the allowed frontend origin; never commit secrets.

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
