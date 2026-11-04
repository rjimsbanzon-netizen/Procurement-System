/** Phase 3: verify the record-indexed D1 read model against the still-canonical
 * enterprise_state JSON snapshot. No migration is allowed to rewrite that source.
 */
import type { WorkspaceCollection } from './workspaceChanges';

// Keep this whitelist aligned with WORKSPACE_COLLECTIONS. Type-checking enforces
// valid names; the regression test checks the complete set against the API.
const WORKSPACE_COLLECTIONS: readonly WorkspaceCollection[] = [
  'stockNeeds','bids','proposalMeetings','requisitions','orders',
  'deliveries','amendments','payments','suppliers','ratings',
];

type RecordRow = Record<string, unknown>;
type IndexedRecord = { collection: string; record_id: string; payload: string };
const isRow = (v: unknown): v is RecordRow => Boolean(v && typeof v === 'object' && !Array.isArray(v));

export function verifyWorkspaceRecordIndex(snapshotText: string, indexed: IndexedRecord[]) {
  const snapshot = JSON.parse(snapshotText) as Record<string, unknown>;
  if (!isRow(snapshot)) throw new Error('Invalid canonical workspace');
  const expected = new Map<string, string>();
  const problems: string[] = [];
  const canonicalCounts: Record<string, number> = {};
  const indexedCounts: Record<string, number> = {};
  for (const collection of WORKSPACE_COLLECTIONS) {
    const collectionRows = snapshot[collection] ?? [];
    if (!Array.isArray(collectionRows)) throw new Error(`Invalid canonical collection: ${collection}`);
    canonicalCounts[collection] = collectionRows.length;
    indexedCounts[collection] = 0;
    for (const row of collectionRows) {
      if (!isRow(row) || typeof row.id !== 'string' || !row.id) {
        problems.push(`Invalid canonical row in ${collection}`);
        continue;
      }
      const key = `${collection}:${row.id}`;
      if (expected.has(key)) problems.push(`Duplicate canonical record ${key}`);
      expected.set(key, JSON.stringify(row));
    }
  }
  const seen = new Set<string>();
  for (const record of indexed) {
    const key = `${record.collection}:${record.record_id}`;
    if (!(record.collection in indexedCounts)) {
      problems.push(`Unexpected collection ${record.collection}`);
      continue;
    }
    indexedCounts[record.collection]++;
    if (seen.has(key)) problems.push(`Duplicate index record ${key}`);
    seen.add(key);
    const stored = expected.get(key);
    if (!stored) {
      problems.push(`Index contains absent record ${key}`);
      continue;
    }
    let payload: string;
    try { payload = JSON.stringify(JSON.parse(record.payload)); }
    catch { problems.push(`Invalid index JSON for ${key}`); continue; }
    if (stored !== payload) problems.push(`Outdated index payload for ${key}`);
  }
  for (const key of expected.keys()) if (!seen.has(key)) problems.push(`Index is missing ${key}`);
  return { ok: problems.length === 0, canonicalCounts, indexedCounts,
    mismatchCount: problems.length, mismatches: problems.slice(0, 25) };
}
