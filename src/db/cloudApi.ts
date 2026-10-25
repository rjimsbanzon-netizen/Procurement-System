/**
 * Cloudflare D1 API client.
 * Point VITE_API_URL at your Worker (e.g. https://procurecorp-api.YOUR.workers.dev)
 * Worker binds D1 via wrangler.toml [[d1_databases]].
 */
import type { User, PurchaseOrder, Supplier, CreateUserInput } from '../types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function isCloudConfigured(): boolean {
  return Boolean(API_BASE);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new Error('Cloud API not configured (set VITE_API_URL)');

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const cloudApi = {
  async health(): Promise<boolean> {
    if (!API_BASE) return false;
    try {
      const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  },

  async login(username: string, password: string): Promise<User | null> {
    try {
      const data = await request<{ user: User | null }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      return data.user;
    } catch {
      return null;
    }
  },

  async register(input: CreateUserInput): Promise<{ ok: boolean; error?: string; user?: User }> {
    try {
      return await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Register failed' };
    }
  },

  async listUsers(): Promise<User[]> {
    return request('/users');
  },

  async listSuppliers(): Promise<Supplier[]> {
    return request('/suppliers');
  },

  async upsertSupplier(s: Supplier): Promise<Supplier> {
    return request('/suppliers', {
      method: 'POST',
      body: JSON.stringify(s),
    });
  },

  async deleteSupplier(id: string): Promise<void> {
    await request(`/suppliers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async listOrders(): Promise<PurchaseOrder[]> {
    return request('/orders');
  },

  async upsertOrder(o: PurchaseOrder): Promise<PurchaseOrder> {
    return request('/orders', {
      method: 'POST',
      body: JSON.stringify(o),
    });
  },
};
