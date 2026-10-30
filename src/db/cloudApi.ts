
import type {
  User,
  PurchaseOrder,
  Supplier,
  CreateUserInput,
  WorkflowCollection,
  WorkflowRecord,
} from '../types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const SESSION_KEY = 'procurement_cloud_token';
const WORKFLOW_COLLECTION_KEYS: Record<WorkflowCollection, string> = {
  requisitions: 'requisitions',
  stockNeeds: 'stockNeeds',
  bids: 'bids',
  meetings: 'proposalMeetings',
  deliveries: 'deliveries',
  amendments: 'amendments',
  payments: 'payments',
  ratings: 'ratings',
  auditLogs: 'auditLogs',
  accessControl: 'accessControl',
};

function emptyEnterpriseState(): Record<string, WorkflowRecord[]> {
  const collections = [
    ...new Set([
      ...Object.values(WORKFLOW_COLLECTION_KEYS),
      'orders',
      'suppliers',
    ]),
  ];
  return Object.fromEntries(
    collections.map((collection) => [collection, []])
  );
}

export function isCloudConfigured(): boolean {
  return Boolean(API_BASE);
}

function getSessionToken(): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(SESSION_KEY);
}

export function clearCloudSession(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(SESSION_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new Error('Cloud API not configured (set VITE_API_URL)');

  const token = getSessionToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) clearCloudSession();
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
    const data = await request<{ user: User | null; token?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (data.user && data.token) {
      localStorage.setItem(SESSION_KEY, data.token);
    } else {
      clearCloudSession();
      if (data.user) throw new Error('Cloud API did not return a session token');
    }
    return data.user;
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

  async getEnterpriseState(): Promise<Record<string, unknown> | null> {
    const response = await request<{ data: Record<string, unknown> | null }>('/enterprise-state');
    return response.data;
  },

  async putEnterpriseState(data: Record<string, unknown>): Promise<void> {
    await request('/enterprise-state', { method: 'PUT', body: JSON.stringify({ data }) });
  },

  async listWorkflowRecords(collection: WorkflowCollection): Promise<WorkflowRecord[]> {
    const data = {
      ...emptyEnterpriseState(),
      ...((await cloudApi.getEnterpriseState()) ?? {}),
    };
    const records = data[WORKFLOW_COLLECTION_KEYS[collection]];
    if (!Array.isArray(records)) return [];
    return records as WorkflowRecord[];
  },

  async upsertWorkflowRecord(
    collection: WorkflowCollection,
    record: WorkflowRecord
  ): Promise<WorkflowRecord> {
    const data = {
      ...emptyEnterpriseState(),
      ...((await cloudApi.getEnterpriseState()) ?? {}),
    };
    const key = WORKFLOW_COLLECTION_KEYS[collection];
    const existing = data[key];
    if (!Array.isArray(existing)) {
      throw new Error(`Cloud workflow collection "${collection}" is invalid.`);
    }
    data[key] = [
      ...existing.filter(
        (item): item is WorkflowRecord =>
          typeof item === 'object' &&
          item !== null &&
          !Array.isArray(item) &&
          (item as WorkflowRecord).id !== record.id
      ),
      record,
    ];
    await this.putEnterpriseState(data);
    return record;
  },

  async logout(): Promise<void> {
    if (!getSessionToken()) return;
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      clearCloudSession();
    }
  },
};
