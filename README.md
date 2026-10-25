# ProcureCorp – Procurement System

React + TypeScript procurement app with **role-based access**, **Cloudflare D1** cloud storage, and **offline SQLite** fallback.

## Storage modes

| Mode | When | Where data lives |
|------|------|------------------|
| **Cloud** | Online + `VITE_API_URL` set + Worker healthy | Cloudflare D1 |
| **Local** | Offline, or no API URL, or Worker unreachable | Browser SQLite (sql.js) in IndexedDB |

Local DB can be **exported as a `.sqlite` file** (navbar → Export DB when in local mode).

## Demo accounts

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Employee | `employee` | `emp123` |
| Guest | `guest` | `guest123` |

Admins can create new accounts under **Users**.

## Frontend setup

```bash
npm install
npm run dev
```

Optional cloud binding:

```bash
cp .env.example .env
# edit VITE_API_URL to your Worker URL
```

## Cloudflare D1 binding (ready-to-bind)

### 1. Create D1 database

```bash
cd cloudflare
npm install
npx wrangler login
npx wrangler d1 create procurecorp-db
```

Copy the `database_id` into `cloudflare/wrangler.toml`.

### 2. Apply schema

```bash
npx wrangler d1 execute procurecorp-db --file=../src/db/schema.sql
# or local:
npx wrangler d1 execute procurecorp-db --local --file=../src/db/schema.sql
```

### 3. Seed demo passwords (first deploy)

The schema inserts users with placeholder hashes. Prefer seeding via Worker register API, or run SQL with real SHA-256 hashes of `admin123` / `emp123` / `guest123`.  
Offline mode seeds hashes automatically on first local open.

### 4. Deploy Worker

```bash
npx wrangler deploy
```

Set frontend:

```env
VITE_API_URL=https://procurecorp-api.<your-subdomain>.workers.dev
```

### 5. (Optional) Cloudflare Pages

Deploy the Vite `dist/` to Pages. Set the same `VITE_API_URL` in Pages environment variables (build-time).

## Project structure

```
src/
  components/     Login, Dashboard, Orders, Suppliers, Users, About, Navbar
  context/        AuthContext (async login/register)
  db/
    schema.sql    Shared D1 + local schema
    dataService.ts  Online/offline facade
    cloudApi.ts     Fetch client for Worker
    localStore.ts   sql.js + IndexedDB
    hash.ts         SHA-256 (demo)
cloudflare/
  wrangler.toml   D1 binding
  src/index.ts    Worker API
```

## API surface (Worker)

- `GET  /health`
- `POST /auth/login` `{ username, password }`
- `POST /auth/register` `{ username, password, name, email, role }`
- `GET  /users`
- `GET|POST /suppliers`
- `DELETE /suppliers/:id`
- `GET|POST /orders`

## Notes

- Password hashing is SHA-256 for demo simplicity. Production should use a proper KDF (e.g. Argon2/bcrypt) inside the Worker or Cloudflare Access / Zero Trust.
- Offline sql.js is loaded from CDN; first offline load needs network once to cache the WASM (or self-host the sql.js files under `public/`).
- No automatic cloud↔local sync yet: choose one primary store, or export/import `.sqlite` for backups.
