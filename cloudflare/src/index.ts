/**
 * ProcureCorp API — Cloudflare Worker backed by D1.
 * Modified for private Workers KV document attachments.
 */
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { handleDocumentRoutes } from './documentRoutes';
import { handleNotificationRoutes } from './notificationRoutes';
import { handleFinanceRoutes, validateFinanceSnapshotWrite } from './financeRoutes';
import { handleSourcingRoutes, validateSourcingSnapshotWrite } from './sourcingRoutes';

export interface Env {
  DB: D1Database;
  DOCUMENTS: KVNamespace;
  ALLOWED_ORIGIN?: string;
  BOOTSTRAP_SECRET?: string;
}

type Role = 'admin' | 'employee' | 'guest';
type AccountStatus = 'pending' | 'approved' | 'rejected';
type User = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: Role;
  app_role: string;
  status: AccountStatus;
  department: string;
  company_name: string;
  access_revoked: number;
};

const ACCESS_CONTROL_ROLES = [
  'Admin', 'Procurement Head', 'Procurement Officer', 'Employee', 'Supplier'
] as const;
const ACCESS_CONTROL_ACTIONS = new Set([
  'create_pr', 'approve_pr', 'manage_suppliers', 'manage_bidding',
  'record_delivery', 'manage_delivery_issues', 'approve_amendment',
  'process_payment', 'confirm_payment', 'rate_supplier', 'manage_users',
  'manage_permissions', 'view_all_po', 'view_assigned_po',
  'view_supplier_portal', 'submit_bids',
]);

const PASSWORD_ITERATIONS = 100_000;
const SESSION_DURATION_SECONDS = 12 * 60 * 60;

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGIN?.split(',').map(origin => origin.trim()).filter(Boolean) ?? ['*'];
}

function corsHeaders(env: Env, origin: string | null): HeadersInit {
  const allowed = allowedOrigins(env);
  const selected = origin && allowed.includes(origin) ? origin
    : allowed.includes('*') ? '*' : allowed[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': selected,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'employee' || value === 'guest';
}

function isStatus(value: unknown): value is 'pending' | 'approved' | 'rejected' | 'completed' {
  return value === 'pending' || value === 'approved' || value === 'rejected' || value === 'completed';
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

async function digest(value: string): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const result = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS },
    key,
    256
  );
  return `pbkdf2$${PASSWORD_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(result))}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [scheme, iterationsText, saltHex, expectedHex] = storedHash.split('$');
  if (scheme !== 'pbkdf2') {
    return constantTimeEqual(await digest(password), storedHash);
  }

  const iterations = Number(iterationsText);
  const salt = hexToBytes(saltHex ?? '');
  const expected = hexToBytes(expectedHex ?? '');
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 1_000_000 ||
    !salt ||
    !expected
  ) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const actual = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      key,
      expected.length * 8
    )
  );
  return constantTimeEqual(bytesToHex(actual), bytesToHex(expected));
}

function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function authenticate(request: Request, env: Env): Promise<User | null> {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT users.id, users.username, users.name, users.email, users.role,
            users.app_role, users.status, users.department, users.company_name, users.access_revoked
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?
       AND users.status = 'approved' AND users.access_revoked = 0`
  )
    .bind(await digest(token), Math.floor(Date.now() / 1000))
    .first<User>();
  return row ?? null;
}

function isAdmin(user: User): boolean {
  return user.role === 'admin';
}

function validAccount(input: {
  username?: unknown;
  password?: unknown;
  name?: unknown;
  email?: unknown;
  role?: unknown;
}): input is { username: string; password: string; name: string; email: string; role?: unknown } {
  return (
    typeof input.username === 'string' &&
    /^[a-z0-9._-]{3,32}$/i.test(input.username.trim()) &&
    typeof input.password === 'string' &&
    input.password.length >= 8 &&
    input.password.length <= 256 &&
    typeof input.name === 'string' &&
    input.name.trim().length > 0 &&
    input.name.trim().length <= 120 &&
    typeof input.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
  );
}

/** Returns a helpful registration error without weakening the account checks. */
function accountValidationError(input: {
  username?: unknown;
  password?: unknown;
  name?: unknown;
  email?: unknown;
}): string | null {
  if (typeof input.username !== 'string' || !/^[a-z0-9._-]{3,32}$/i.test(input.username.trim())) {
    return 'Username must contain 3–32 letters, numbers, periods, underscores or hyphens.';
  }
  if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 256) {
    return 'Password must be between 8 and 256 characters.';
  }
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120) {
    return 'Full name is required and must be 120 characters or fewer.';
  }
  if (typeof input.email !== 'string' || input.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return 'Enter a valid email address (254 characters or fewer).';
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigins(env).includes('*') && !allowedOrigins(env).includes(origin)) {
      return json({ error: 'Origin not allowed' }, 403);
    }
    const cors = corsHeaders(env, origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(request.url);

    try {
      if (pathname === '/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT 1').first();
        return json({ ok: true }, 200, cors);
      }

      // Public registration and rejected-account resubmission (admin approval required).
      if (pathname === '/auth/register' && request.method === 'POST') {
        const body = (await request.json()) as {
          username?: unknown; password?: unknown; name?: unknown; email?: unknown;
          accountType?: unknown; department?: unknown; companyName?: unknown;
        };
        const accountError = accountValidationError(body);
        if (accountError) return json({ error: accountError }, 400, cors);
        if (body.accountType !== 'employee' && body.accountType !== 'supplier') {
          return json({ error: 'Choose Employee or Supplier as the account type.' }, 400, cors);
        }
        if (body.department !== undefined && typeof body.department !== 'string') {
          return json({ error: 'Department must be text.' }, 400, cors);
        }
        if (body.companyName !== undefined && typeof body.companyName !== 'string') {
          return json({ error: 'Supplier company name must be text.' }, 400, cors);
        }
        const accountType = body.accountType;
        const appRole = accountType === 'supplier' ? 'Supplier' : 'Employee';
        const role: Role = accountType === 'supplier' ? 'guest' : 'employee';
        const department = accountType === 'employee' ? (body.department as string | undefined)?.trim() ?? '' : '';
        const companyName = accountType === 'supplier' ? (body.companyName as string | undefined)?.trim() ?? '' : '';
        if (department.length > 120) return json({ error: 'Department must be 120 characters or fewer.' }, 400, cors);
        if (accountType === 'supplier' && (!companyName || companyName.length > 160)) {
          return json({ error: 'Supplier company name must be 1–160 characters.' }, 400, cors);
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        try {
          await env.DB.prepare(
            `INSERT INTO users
             (id, username, password_hash, name, email, role, app_role, status, department, company_name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
          ).bind(
            id, (body.username as string).trim().toLowerCase(), await hashPassword(body.password as string),
            (body.name as string).trim(), (body.email as string).trim().toLowerCase(),
            role, appRole, department, companyName, now, now,
          ).run();
        } catch (error) {
          if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
            const existing = await env.DB.prepare(
              `SELECT id, email, password_hash FROM users
               WHERE username = ? AND role != 'admin' AND status = 'rejected' AND access_revoked = 0`
            ).bind((body.username as string).trim().toLowerCase())
              .first<{ id: string; email: string; password_hash: string }>();
            if (!existing || existing.email.toLowerCase() !== (body.email as string).trim().toLowerCase() ||
                !(await verifyPassword(body.password as string, existing.password_hash))) {
              return json({ error: 'Username already exists. Rejected applicants must use their original email and password.' }, 409, cors);
            }
            const updated = await env.DB.prepare(
              `UPDATE users SET name = ?, app_role = ?, role = ?, status = 'pending',
                 department = ?, company_name = ?, updated_at = ?
               WHERE id = ? AND status = 'rejected' AND access_revoked = 0`
            ).bind((body.name as string).trim(), appRole, role, department, companyName, now, existing.id).run();
            if (updated.meta.changes !== 1) return json({ error: 'Unable to resubmit account.' }, 409, cors);
            return json({ ok: true, status: 'pending', reapplied: true }, 200, cors);
          }
          throw error;
        }
        return json({ ok: true, status: 'pending' }, 201, cors);
      }

      if (pathname === '/auth/login' && request.method === 'POST') {
        const body = (await request.json()) as { username?: unknown; password?: unknown };
        if (typeof body.username !== 'string' || typeof body.password !== 'string') {
          return json({ error: 'username and password required' }, 400, cors);
        }
        const row = await env.DB.prepare(
          `SELECT id, username, password_hash, name, email, role,
                  app_role, status, department, company_name, access_revoked
           FROM users WHERE username = ?`
        )
          .bind(body.username.trim().toLowerCase())
          .first<User & { password_hash: string }>();
        if (!row || !(await verifyPassword(body.password, row.password_hash))) {
          return json({ user: null }, 200, cors);
        }
        if (row.status !== 'approved' || row.access_revoked) {
          return json({
            user: null,
            pending: row.status === 'pending',
            rejected: row.status === 'rejected',
            accessRevoked: Boolean(row.access_revoked),
          }, 200, cors);
        }

        const token = newSessionToken();
        const nowSeconds = Math.floor(Date.now() / 1000);
        await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowSeconds).run();
        const expiresAt = nowSeconds + SESSION_DURATION_SECONDS;
        await env.DB.prepare(
          'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
        )
          .bind(await digest(token), row.id, expiresAt)
          .run();

        const { password_hash: _, ...user } = row;
        return json({ user, token }, 200, cors);
      }

      if (pathname === '/auth/bootstrap' && request.method === 'POST') {
        const body = (await request.json()) as {
          setupSecret?: unknown;
          username?: unknown;
          password?: unknown;
          name?: unknown;
          email?: unknown;
        };
        if (!env.BOOTSTRAP_SECRET) {
          return json({ error: 'Administrator bootstrap is not configured' }, 503, cors);
        }
        if (
          typeof body.setupSecret !== 'string' ||
          !constantTimeEqual(body.setupSecret, env.BOOTSTRAP_SECRET)
        ) {
          return json({ error: 'Invalid setup secret' }, 401, cors);
        }
        if (!validAccount(body)) {
          return json({ error: 'Provide a valid username, password (at least 8 characters), name, and email' }, 400, cors);
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const result = await env.DB.prepare(
          `INSERT INTO users
           (id, username, password_hash, name, email, role, app_role, status, department, company_name, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, 'admin', 'Admin', 'approved', '', '', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`
        )
          .bind(
            id,
            body.username.trim().toLowerCase(),
            await hashPassword(body.password),
            body.name.trim(),
            body.email.trim().toLowerCase(),
            now,
            now
          )
          .run();
        if (result.meta.changes === 0) {
          return json({ error: 'Bootstrap is only available before the first account is created' }, 409, cors);
        }
        return json({ ok: true, username: body.username.trim().toLowerCase() }, 201, cors);
      }

      const user = await authenticate(request, env);
      if (!user) return json({ error: 'Authentication required' }, 401, cors);

      // Files are private: authenticate before handling document routes.
      const documentResponse = await handleDocumentRoutes(request, env, user, cors);
      if (documentResponse) return documentResponse;

      // Keep the original login, roles, permissions and document routes intact.
      const notificationResponse = await handleNotificationRoutes(request, env, user, cors);
      if (notificationResponse) return notificationResponse;

      // Additive D1 finance workflows. Keep all existing auth, documents and notification routes.
      const financeResponse = await handleFinanceRoutes(request, env, user, cors);
      if (financeResponse) return financeResponse;

      // Feature 9-11: authenticated supplier messaging, deadlines, accreditation.
      const sourcingResponse = await handleSourcingRoutes(request, env, user, cors);
      if (sourcingResponse) return sourcingResponse;

      if (pathname === '/auth/me' && request.method === 'GET') {
        return json({ user }, 200, cors);
      }

      if (pathname === '/access-control' && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT data FROM access_control_settings WHERE id = 1')
          .first<{ data: string }>();
        if (row) return json({ permissions: JSON.parse(row.data) }, 200, cors);
        const snapshot = await env.DB.prepare('SELECT data FROM enterprise_state WHERE id = 1')
          .first<{ data: string }>();
        const data: unknown = snapshot ? JSON.parse(snapshot.data) : null;
        const legacy = data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>).accessControl : null;
        if (!Array.isArray(legacy)) return json({ permissions: null }, 200, cors);
        const permissions: Record<string, string[]> = {};
        for (const role of ACCESS_CONTROL_ROLES) {
          const entry = legacy.find((x: unknown): x is Record<string, unknown> =>
            !!x && typeof x === 'object' && !Array.isArray(x) && (x as Record<string, unknown>).role === role);
          if (entry && Array.isArray(entry.permissions)) {
            permissions[role] = [...new Set(entry.permissions.filter((x: unknown): x is string =>
              typeof x === 'string' && ACCESS_CONTROL_ACTIONS.has(x)))];
          }
        }
        return json({ permissions }, 200, cors);
      }

      if (pathname === '/access-control' && request.method === 'PUT') {
        if (!isAdmin(user)) return json({ error: 'Administrator access required' }, 403, cors);
        const body = (await request.json()) as { permissions?: unknown };
        if (!body.permissions || typeof body.permissions !== 'object' || Array.isArray(body.permissions)) {
          return json({ error: 'Role permissions are required.' }, 400, cors);
        }
        const input = body.permissions as Record<string, unknown>;
        if (Object.keys(input).length !== ACCESS_CONTROL_ROLES.length ||
            ACCESS_CONTROL_ROLES.some(role =>
              !Array.isArray(input[role]) ||
              (input[role] as unknown[]).some(p => typeof p !== 'string' || !ACCESS_CONTROL_ACTIONS.has(p)))) {
          return json({ error: 'Invalid permission matrix.' }, 400, cors);
        }
        const normalized = Object.fromEntries(ACCESS_CONTROL_ROLES.map(role =>
          [role, [...new Set(input[role] as string[])]]));
        await env.DB.prepare(
          `INSERT INTO access_control_settings (id, data, updated_at)
           VALUES (1, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`
        ).bind(JSON.stringify(normalized)).run();
        return json({ ok: true, permissions: normalized }, 200, cors);
      }

      // Shared enterprise workspace snapshot, as in the original Worker.
      // NOTE: original snapshot API has no per-record authorization on reads or writes.
      if (pathname === '/enterprise-state' && (request.method === 'GET' || request.method === 'PUT')) {
        if (request.method === 'GET') {
          const row = await env.DB.prepare('SELECT data FROM enterprise_state WHERE id = 1').first<{ data: string }>();
          return json({ data: row ? JSON.parse(row.data) : null }, 200, cors);
        }
        const body = (await request.json()) as { data?: unknown };
        if (!body || typeof body.data !== 'object' || !body.data || Array.isArray(body.data)) {
          return json({ error: 'Invalid business dataset' }, 400, cors);
        }
        const allowed = ['stockNeeds','bids','proposalMeetings','requisitions','orders','deliveries','amendments','payments','suppliers','ratings','auditLogs'];
        const input = body.data as Record<string, unknown>;
        if (Object.keys(input).some(k => ![...allowed,'accessControl'].includes(k)) ||
            allowed.some(k => !Array.isArray(input[k])) ||
            (input.accessControl !== undefined && !Array.isArray(input.accessControl))) {
          return json({ error: 'Only enterprise business record arrays are accepted' }, 400, cors);
        }
        // Block direct approval/payment status changes that bypass workflow verification.
        const current = await env.DB.prepare('SELECT data FROM enterprise_state WHERE id=1').first<{ data: string }>();
        const financeError = await validateFinanceSnapshotWrite(
          env, input, current ? JSON.parse(current.data) as Record<string, unknown> : {}, user
        );
        if (financeError) return json({ error: financeError }, 409, cors);
        const sourcingError = validateSourcingSnapshotWrite(input, current ? JSON.parse(current.data) as Record<string, unknown> : {}, user);
        if (sourcingError) return json({ error: sourcingError }, 409, cors);
        const data = JSON.stringify(input);
        if (data.length > 1000000) return json({ error: 'Dataset too large' }, 413, cors);
        await env.DB.prepare("INSERT INTO enterprise_state (id, data, updated_at) VALUES (1, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')").bind(data).run();
        return json({ ok: true }, 200, cors);
      }

      if (pathname === '/users' && request.method === 'GET') {
        if (!isAdmin(user)) return json({ error: 'Administrator access required' }, 403, cors);
        const { results } = await env.DB.prepare(
          `SELECT id, username, name, email, role, app_role, status,
                  department, company_name, access_revoked FROM users ORDER BY username`
        ).all();
        return json(results ?? [], 200, cors);
      }

      const userMatch = pathname.match(/^\/users\/([^/]+)$/);
      if (userMatch && request.method === 'PUT') {
        if (!isAdmin(user)) return json({ error: 'Administrator access required' }, 403, cors);
        const body = (await request.json()) as { status?: unknown; appRole?: unknown; accessRevoked?: unknown };
        const validRoles = ['Employee', 'Procurement Officer', 'Procurement Head', 'Supplier'];
        if ((body.status !== 'pending' && body.status !== 'approved' && body.status !== 'rejected') ||
            (body.accessRevoked !== undefined && typeof body.accessRevoked !== 'boolean') ||
            (body.appRole !== undefined && (typeof body.appRole !== 'string' || !validRoles.includes(body.appRole)))) {
          return json({ error: 'Invalid account status or role' }, 400, cors);
        }
        const id = decodeURIComponent(userMatch[1]);
        const target = await env.DB.prepare('SELECT role FROM users WHERE id = ?')
          .bind(id).first<{ role: Role }>();
        if (!target || target.role === 'admin' || id === user.id) {
          return json({ error: 'Account cannot be modified' }, 404, cors);
        }
        const appRole = body.appRole as string | undefined;
        const role: Role = appRole === 'Supplier' ? 'guest' : 'employee';
        await env.DB.prepare(
          `UPDATE users SET status = ?, app_role = COALESCE(?, app_role),
             role = CASE WHEN ? IS NULL THEN role ELSE ? END,
             access_revoked = COALESCE(?, access_revoked), updated_at = ? WHERE id = ?`
        ).bind(body.status, appRole ?? null, appRole ?? null, role,
          body.accessRevoked === undefined ? null : body.accessRevoked ? 1 : 0,
          new Date().toISOString(), id).run();
        if (body.accessRevoked === true || body.status !== 'approved') {
          await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
        }
        return json({ ok: true, id, status: body.status, appRole, accessRevoked: body.accessRevoked }, 200, cors);
      }
      if (userMatch && request.method === 'DELETE') {
        if (!isAdmin(user)) return json({ error: 'Administrator access required' }, 403, cors);
        const id = decodeURIComponent(userMatch[1]);
        const target = await env.DB.prepare('SELECT role FROM users WHERE id = ?')
          .bind(id).first<{ role: Role }>();
        if (!target || target.role === 'admin' || id === user.id) {
          return json({ error: 'Account cannot be deleted' }, 404, cors);
        }
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
        const result = await env.DB.prepare("DELETE FROM users WHERE id = ? AND role != 'admin'")
          .bind(id).run();
        if (result.meta.changes !== 1) return json({ error: 'Account could not be deleted' }, 409, cors);
        return json({ ok: true, id }, 200, cors);
      }

      if (pathname === '/suppliers' && request.method === 'GET') {
        if (user.role === 'guest') return json({ error: 'Staff access required' }, 403, cors);
        const { results } = await env.DB.prepare(
          'SELECT id, name, contact, category, rating, status FROM suppliers ORDER BY name'
        ).all();
        return json(results ?? [], 200, cors);
      }

      if (pathname === '/suppliers' && request.method === 'POST') {
        if (!isAdmin(user)) return json({ error: 'Administrator access required' }, 403, cors);
        const s = (await request.json()) as {
          id?: unknown;
          name?: unknown;
          contact?: unknown;
          category?: unknown;
          rating?: unknown;
          status?: unknown;
        };
        if (
          typeof s.id !== 'string' ||
          typeof s.name !== 'string' ||
          !s.name.trim() ||
          typeof s.contact !== 'string' ||
          typeof s.category !== 'string' ||
          typeof s.rating !== 'number' ||
          !Number.isFinite(s.rating) ||
          s.rating < 0 ||
          s.rating > 5 ||
          (s.status !== 'active' && s.status !== 'inactive')
        ) {
          return json({ error: 'Invalid supplier details' }, 400, cors);
        }
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO suppliers (id, name, contact, category, rating, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, contact=excluded.contact,
           category=excluded.category, rating=excluded.rating, status=excluded.status,
           updated_at=excluded.updated_at`
        )
          .bind(s.id, s.name.trim(), s.contact.trim(), s.category, s.rating, s.status, now, now)
          .run();
        return json({ ...s, name: s.name.trim(), contact: s.contact.trim() }, 200, cors);
      }

      if (pathname.startsWith('/suppliers/') && request.method === 'DELETE') {
        if (!isAdmin(user)) return json({ error: 'Administrator access required' }, 403, cors);
        const id = decodeURIComponent(pathname.slice('/suppliers/'.length));
        if (!id) return json({ error: 'Supplier ID required' }, 400, cors);
        await env.DB.prepare('DELETE FROM suppliers WHERE id = ?').bind(id).run();
        return json({ ok: true }, 200, cors);
      }

      if (pathname === '/orders' && request.method === 'GET') {
        if (user.role === 'guest') return json({ error: 'Staff access required' }, 403, cors);
        const { results } = await env.DB.prepare(
          `SELECT id, title, description, amount, status, requested_by as requestedBy,
                  requested_at as requestedAt, supplier, category
           FROM purchase_orders ORDER BY requested_at DESC`
        ).all();
        return json(results ?? [], 200, cors);
      }

      if (pathname === '/orders' && request.method === 'POST') {
        if (user.role === 'guest') return json({ error: 'Staff access required' }, 403, cors);
        const o = (await request.json()) as {
          id?: unknown;
          title?: unknown;
          description?: unknown;
          amount?: unknown;
          status?: unknown;
          requestedAt?: unknown;
          supplier?: unknown;
          category?: unknown;
        };
        if (
          typeof o.id !== 'string' ||
          typeof o.title !== 'string' ||
          !o.title.trim() ||
          typeof o.description !== 'string' ||
          typeof o.amount !== 'number' ||
          !Number.isFinite(o.amount) ||
          o.amount < 0 ||
          !isStatus(o.status) ||
          typeof o.requestedAt !== 'string' ||
          typeof o.category !== 'string' ||
          (o.supplier !== undefined && typeof o.supplier !== 'string')
        ) {
          return json({ error: 'Invalid purchase order details' }, 400, cors);
        }
        const existing = await env.DB.prepare('SELECT id FROM purchase_orders WHERE id = ?')
          .bind(o.id)
          .first();
        if (existing && !isAdmin(user)) {
          return json({ error: 'Only administrators can update purchase orders' }, 403, cors);
        }
        if (!existing && !isAdmin(user) && o.status !== 'pending') {
          return json({ error: 'New purchase orders must be pending' }, 403, cors);
        }
        const now = new Date().toISOString();
        const requestedBy = existing && isAdmin(user) ? undefined : user.name;
        if (existing) {
          await env.DB.prepare(
            `UPDATE purchase_orders SET title=?, description=?, amount=?, status=?, requested_at=?,
             supplier=?, category=?, updated_at=? WHERE id=?`
          )
            .bind(
              o.title.trim(),
              o.description,
              o.amount,
              o.status,
              o.requestedAt,
              o.supplier ?? null,
              o.category,
              now,
              o.id
            )
            .run();
        } else {
          await env.DB.prepare(
            `INSERT INTO purchase_orders
             (id, title, description, amount, status, requested_by, requested_at, supplier, category, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              o.id,
              o.title.trim(),
              o.description,
              o.amount,
              o.status,
              o.requestedAt,
              o.supplier ?? null,
              o.category,
              now,
              now
            )
            .run();
        }
        return json({ ...o, title: o.title.trim(), requestedBy: requestedBy ?? user.name }, 200, cors);
      }

      if (pathname === '/auth/logout' && request.method === 'POST') {
        const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
        if (token) {
          await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
            .bind(await digest(token))
            .run();
        }
        return json({ ok: true }, 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: 'Internal server error' }, 500, cors);
    }
  },
};
