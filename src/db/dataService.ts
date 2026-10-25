/**
 * Unified data service: uses Cloudflare D1 when online + configured,
 * otherwise falls back to local SQLite (sql.js) persisted in IndexedDB.
 */
import type { User, PurchaseOrder, Supplier, CreateUserInput } from '../types';
import { cloudApi, isCloudConfigured } from './cloudApi';
import { localStore, initLocalDb } from './localStore';

export type StorageMode = 'cloud' | 'local';

let currentMode: StorageMode = 'local';

export function getStorageMode(): StorageMode {
  return currentMode;
}

export async function detectStorageMode(): Promise<StorageMode> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    currentMode = 'local';
    await initLocalDb();
    return currentMode;
  }
  if (isCloudConfigured()) {
    const ok = await cloudApi.health();
    if (ok) {
      currentMode = 'cloud';
      return currentMode;
    }
  }
  currentMode = 'local';
  await initLocalDb();
  return currentMode;
}

function useCloud(): boolean {
  return currentMode === 'cloud' && isCloudConfigured();
}

export const dataService = {
  getMode: getStorageMode,
  detectMode: detectStorageMode,

  async login(username: string, password: string): Promise<User | null> {
    await detectStorageMode();
    if (useCloud()) {
      try {
        return await cloudApi.login(username, password);
      } catch {
        // fall through to local
        currentMode = 'local';
        await initLocalDb();
      }
    }
    return localStore.login(username, password);
  },

  async register(input: CreateUserInput): Promise<{ ok: boolean; error?: string; user?: User }> {
    await detectStorageMode();
    if (useCloud()) {
      try {
        return await cloudApi.register(input);
      } catch (e) {
        currentMode = 'local';
        await initLocalDb();
        return localStore.register(input);
      }
    }
    return localStore.register(input);
  },

  async listUsers(): Promise<User[]> {
    await detectStorageMode();
    if (useCloud()) {
      try {
        return await cloudApi.listUsers();
      } catch {
        currentMode = 'local';
        await initLocalDb();
      }
    }
    return localStore.listUsers();
  },

  async listSuppliers(): Promise<Supplier[]> {
    await detectStorageMode();
    if (useCloud()) {
      try {
        return await cloudApi.listSuppliers();
      } catch {
        currentMode = 'local';
        await initLocalDb();
      }
    }
    return localStore.listSuppliers();
  },

  async upsertSupplier(s: Supplier): Promise<Supplier> {
    await detectStorageMode();
    if (useCloud()) {
      try {
        return await cloudApi.upsertSupplier(s);
      } catch {
        currentMode = 'local';
        await initLocalDb();
      }
    }
    return localStore.upsertSupplier(s);
  },

  async deleteSupplier(id: string): Promise<void> {
    await detectStorageMode();
    if (useCloud()) {
      try {
        return await cloudApi.deleteSupplier(id);
      } catch {
        currentMode = 'local';
        await initLocalDb();
      }
    }
    return localStore.deleteSupplier(id);
  },

  async listOrders(): Promise<PurchaseOrder[]> {
    await detectStorageMode();
    if (useCloud()) {
      try {
        return await cloudApi.listOrders();
      } catch {
        currentMode = 'local';
        await initLocalDb();
      }
    }
    return localStore.listOrders();
  },

  async upsertOrder(o: PurchaseOrder): Promise<PurchaseOrder> {
    await detectStorageMode();
    if (useCloud()) {
      try {
        return await cloudApi.upsertOrder(o);
      } catch {
        currentMode = 'local';
        await initLocalDb();
      }
    }
    return localStore.upsertOrder(o);
  },

  exportSqlFile: () => localStore.exportSqlFile(),
  importSqlFile: (file: File) => localStore.importSqlFile(file),
};

// Re-detect when connectivity changes
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void detectStorageMode();
  });
  window.addEventListener('offline', () => {
    currentMode = 'local';
    void initLocalDb();
  });
}
