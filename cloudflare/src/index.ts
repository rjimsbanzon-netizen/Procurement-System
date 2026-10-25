/**
 * ProcureCorp API — Cloudflare Worker bound to D1
 *
 * Bindings (wrangler.toml):
 *   DB = D1Database
 *
 * Frontend: set VITE_API_URL=https://procurecorp-api.<account>.workers.dev
 */

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
}

type Role = 'admin' | 'employee' | 'guest';

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = env.ALLOWED_ORIGIN ?? '*';
  return {
    'Access-Control-Allow-Origin': allowed === '*' ? '*' : allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Health
      if (path === '/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT 1').first();
        return json({ ok: true }, 200, cors);
      }

      // Auth: login
      if (path === '/auth/login' && request.method === 'POST') {
        const body = (await request.json()) as { username?: string; password?: string };
        if (!body.username || !body.password) {
          return json({ error: 'username and password required' }, 400, cors);
        }
        const row = await env.DB.prepare(
          'SELECT id, username, password_hash, name, email, role FROM users WHERE username = ?'
        )
          .bind(body.username.toLowerCase())
          .first<{
            id: string;
            username: string;
            password_hash: string;
            name: string;
            email: string;
            role: Role;
          }>();

        if (!row) return json({ user: null }, 200, cors);
        const hash = await hashPassword(body.password);
        if (hash !== row.password_hash) return json({ user: null }, 200, cors);

        return json(
          {
            user: {
              id: row.id,
              username: row.username,
              name: row.name,
              email: row.email,
              role: row.role,
            },
          },
          200,
          cors
        );
      }

      // Auth: register
      if (path === '/auth/register' && request.method === 'POST') {
        const body = (await request.json()) as {
          username?: string;
          password?: string;
          name?: string;
          email?: string;
          role?: Role;
        };
        if (!body.username || !body.password || !body.name || !body.email || !body.role) {
          return json({ ok: false, error: 'Missing fields' }, 400, cors);
        }
        const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
          .bind(body.username.toLowerCase())
          .first();
        if (existing) return json({ ok: false, error: 'Username already exists' }, 409, cors);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const password_hash = await hashPassword(body.password);
        await env.DB.prepare(
          `INSERT INTO users (id, username, password_hash, name, email, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            body.username.toLowerCase(),
            password_hash,
            body.name,
            body.email,
            body.role,
            now,
            now
          )
          .run();

        return json(
          {
            ok: true,
            user: {
              id,
              username: body.username.toLowerCase(),
              name: body.name,
              email: body.email,
              role: body.role,
            },
          },
          201,
          cors
        );
      }

      // Users list
      if (path === '/users' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, username, name, email, role FROM users ORDER BY username'
        ).all();
        return json(results ?? [], 200, cors);
      }

      // Suppliers
      if (path === '/suppliers' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, name, contact, category, rating, status FROM suppliers ORDER BY name'
        ).all();
        return json(results ?? [], 200, cors);
      }

      if (path === '/suppliers' && request.method === 'POST') {
        const s = (await request.json()) as {
          id: string;
          name: string;
          contact: string;
          category: string;
          rating: number;
          status: string;
        };
        const now = new Date().toISOString();
        const existing = await env.DB.prepare('SELECT id FROM suppliers WHERE id = ?')
          .bind(s.id)
          .first();
        if (existing) {
          await env.DB.prepare(
            `UPDATE suppliers SET name=?, contact=?, category=?, rating=?, status=?, updated_at=? WHERE id=?`
          )
            .bind(s.name, s.contact, s.category, s.rating, s.status, now, s.id)
            .run();
        } else {
          await env.DB.prepare(
            `INSERT INTO suppliers (id, name, contact, category, rating, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(s.id, s.name, s.contact, s.category, s.rating, s.status, now, now)
            .run();
        }
        return json(s, 200, cors);
      }

      if (path.startsWith('/suppliers/') && request.method === 'DELETE') {
        const id = decodeURIComponent(path.replace('/suppliers/', ''));
        await env.DB.prepare('DELETE FROM suppliers WHERE id = ?').bind(id).run();
        return json({ ok: true }, 200, cors);
      }

      // Orders
      if (path === '/orders' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT id, title, description, amount, status, requested_by as requestedBy,
                  requested_at as requestedAt, supplier, category
           FROM purchase_orders ORDER BY requested_at DESC`
        ).all();
        return json(results ?? [], 200, cors);
      }

      if (path === '/orders' && request.method === 'POST') {
        const o = (await request.json()) as {
          id: string;
          title: string;
          description: string;
          amount: number;
          status: string;
          requestedBy: string;
          requestedAt: string;
          supplier?: string;
          category: string;
        };
        const now = new Date().toISOString();
        const existing = await env.DB.prepare('SELECT id FROM purchase_orders WHERE id = ?')
          .bind(o.id)
          .first();
        if (existing) {
          await env.DB.prepare(
            `UPDATE purchase_orders SET title=?, description=?, amount=?, status=?, requested_by=?,
             requested_at=?, supplier=?, category=?, updated_at=? WHERE id=?`
          )
            .bind(
              o.title,
              o.description,
              o.amount,
              o.status,
              o.requestedBy,
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
              o.title,
              o.description,
              o.amount,
              o.status,
              o.requestedBy,
              o.requestedAt,
              o.supplier ?? null,
              o.category,
              now,
              now
            )
            .run();
        }
        return json(o, 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json(
        { error: err instanceof Error ? err.message : 'Server error' },
        500,
        cors
      );
    }
  },
};
