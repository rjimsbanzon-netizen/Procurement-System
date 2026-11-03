/** Optimistic, record-specific save baseline for the current authenticated session.
 * No browser storage is used: returning to a tab after logout cannot reuse a prior baseline.
 */
export const BUSINESS_COLLECTIONS = [
  'stockNeeds', 'bids', 'proposalMeetings', 'requisitions', 'orders',
  'deliveries', 'amendments', 'payments', 'suppliers', 'ratings',
] as const;
type Row = Record<string, any>;
type State = Record<string, Row[]>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
let baseline: State | null = null;
let sessionToken: string | null = null;
export function setWorkspaceBaseline(data: Record<string, unknown> | null, token: string | null) {
  sessionToken = token;
  baseline = data && token ? clone(Object.fromEntries(BUSINESS_COLLECTIONS.map(key =>
    [key, Array.isArray(data[key]) ? data[key] : []]))) as State : null;
}
export function clearWorkspaceBaseline() { baseline = null; sessionToken = null; }
export function getWorkspaceChanges(next: Record<string, unknown>, token: string) {
  if (!baseline || !sessionToken || sessionToken !== token)
    throw new Error('Workspace revision is missing. Reload or sign in again before saving.');
  const operations: {collection:string;id:string;before:Row|null;after:Row|null}[] = [];
  for (const key of BUSINESS_COLLECTIONS) {
    const first = new Map<string, Row>();
    for (const row of baseline[key] || []) {
      if (!row || typeof row.id !== 'string' || first.has(row.id))
        throw new Error(`Duplicate or invalid saved ${key} record IDs.`);
      first.set(row.id, row);
    }
    const second = new Map<string, Row>();
    const rows = next[key];
    if (!Array.isArray(rows)) throw new Error(`Missing ${key} records.`);
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || second.has(row.id))
        throw new Error(`Duplicate or invalid updated ${key} record IDs.`);
      second.set(row.id, row);
    }
    for (const id of new Set([...first.keys(), ...second.keys()])) {
      const before = first.get(id) || null, after = second.get(id) || null;
      if (!same(before, after)) operations.push({collection:key,id,before:clone(before),after:clone(after)});
    }
  }
  return operations;
}
/** Only advance the optimistic baseline after the Worker confirms the save. */
export function confirmWorkspaceChanges(changes: {collection:string;id:string;after:Row|null}[], token: string) {
  if (!baseline || sessionToken !== token) throw new Error('Session changed during cloud save.');
  for (const {collection,id,after} of changes) {
    const rows = baseline[collection] || [];
    const index = rows.findIndex(row => row.id === id);
    if (after === null) { if (index >= 0) rows.splice(index, 1); }
    else if (index >= 0) rows[index] = clone(after);
    else rows.push(clone(after));
  }
}
