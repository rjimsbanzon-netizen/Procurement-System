/** Phase 4: bounded, read-only access to the Phase 3 indexed record mirror.
 * Read permissions are computed from the canonical workspace's existing
 * allowlisted projection. The index can never grant additional read access.
 */
import {
  WORKSPACE_COLLECTIONS, projectWorkspace,
  type Actor, type Workspace, type WorkspaceReadScope, type WorkspaceCollection,
} from './workspaceChanges.ts';

type Row = Record<string, unknown>;
export type RecordPageConfig = { collection: WorkspaceCollection; offset: number; limit: number };
export type IndexedPageRow = { record_id: string; payload: string };
const asRow = (item: unknown): item is Row => Boolean(item && typeof item === 'object' && !Array.isArray(item));

/** Input validation is deliberately strict and independent of the SQL layer. */
export function parseRecordPageConfig(url: URL): RecordPageConfig | { error: string } {
  const known = ['collection', 'offset', 'limit'];
  if ([...url.searchParams.keys()].some(key => !known.includes(key)))
    return { error: 'Unknown record-list parameter.' };
  if (known.some(key => url.searchParams.getAll(key).length > 1))
    return { error: 'Duplicate record-list parameters are not allowed.' };
  const collection = url.searchParams.get('collection');
  if (!collection || !WORKSPACE_COLLECTIONS.includes(collection as WorkspaceCollection))
    return { error: 'Select a valid procurement collection.' };
  const parseIntParam = (key: string, fallback: number, max: number) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    if (!/^(0|[1-9][0-9]*)$/.test(raw)) return -1;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed <= max ? parsed : -1;
  };
  const offset = parseIntParam('offset', 0, 100_000);
  const limit = parseIntParam('limit', 25, 100);
  if (offset < 0 || limit < 1) return { error: 'offset must be 0–100000 and limit must be 1–100.' };
  return { collection: collection as WorkspaceCollection, offset, limit };
}

/** The same policy as GET /enterprise-state; never trust client filters. */
export function visibleRecordPage(
  canonical: Workspace, actor: Actor, scope: WorkspaceReadScope, config: RecordPageConfig,
): { records: Row[]; total: number; nextOffset: number | null } {
  const visible = projectWorkspace(canonical, actor, scope);
  const records = visible[config.collection];
  if (!Array.isArray(records) || records.some(row => !asRow(row) || typeof row.id !== 'string'))
    throw new Error('Invalid projected workspace records.');
  const sorted = [...records].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
  const page = sorted.slice(config.offset, config.offset + config.limit);
  return {
    records: page,
    total: sorted.length,
    nextOffset: config.offset + page.length < sorted.length ? config.offset + page.length : null,
  };
}

/** A collection may be paged safely only when its indexed row count matches the
 * canonical snapshot. This catches incomplete migrations and orphan index rows
 * even when the requested page happens to be empty.
 */
export function validateIndexedCount(
  canonical: Workspace, collection: WorkspaceCollection, indexedTotal: number,
): string | null {
  const records = canonical[collection] ?? [];
  if (!Array.isArray(records) || records.some(row => !asRow(row) || typeof row.id !== 'string' || !row.id))
    return 'Canonical collection is invalid.';
  if (!Number.isSafeInteger(indexedTotal) || records.length !== indexedTotal)
    return 'The indexed workspace is out of sync. Contact Admin.';
  return null;
}

/** Index agreement is checked BEFORE returning any projected page. When drift
 * exists, fail instead of showing a silently incomplete or outdated list.
 */
export function validateIndexedPage(
  canonical: Workspace, collection: WorkspaceCollection, records: Row[], indexRows: IndexedPageRow[],
): string | null {
  const indexed = new Map(indexRows.map(row => [row.record_id, row.payload]));
  const originals = canonical[collection];
  if (!Array.isArray(originals)) return 'Canonical collection is invalid.';
  const canonicalById = new Map<string, Row>();
  for (const row of originals) if (asRow(row) && typeof row.id === 'string') canonicalById.set(row.id, row);
  for (const record of records) {
    const id = String(record.id);
    const payload = indexed.get(id);
    const original = canonicalById.get(id);
    if (!payload || !original) return 'The indexed workspace is missing a record. Contact Admin.';
    try {
      if (JSON.stringify(JSON.parse(payload)) !== JSON.stringify(original))
        return 'The indexed workspace has an outdated record. Contact Admin.';
    } catch { return 'The indexed workspace contains invalid JSON. Contact Admin.'; }
  }
  return null;
}
