/** Restrict legacy full-workspace writes made by suppliers.
 *
 * The long-term solution is record-specific API routes and read projections.
 * Until then, this validator prevents a supplier with a valid login from
 * rewriting other suppliers' POs, bids, invoices, budgets or requisitions.
 */
export type SnapshotUser = {
  id: string;
  name: string;
  email: string;
  company_name: string;
  role: string;
  app_role: string;
};

type RecordValue = Record<string, unknown>;
type Workspace = Record<string, unknown>;
const collections = [
  'stockNeeds', 'bids', 'proposalMeetings', 'requisitions', 'orders',
  'deliveries', 'amendments', 'payments', 'suppliers', 'ratings',
] as const;
const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const validTimestamp = (value: unknown) => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

function changesOnly(before: RecordValue, after: RecordValue, allowed: readonly string[]): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].every(key => allowed.includes(key) || same(before[key], after[key]));
}
function byId(collection: unknown): Map<string, RecordValue> | null {
  if (!Array.isArray(collection)) return null;
  const found = new Map<string, RecordValue>();
  for (const item of collection) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !text(item.id) || found.has(String(item.id))) return null;
    found.set(String(item.id), item as RecordValue);
  }
  return found;
}

/** Returns an explanation when the proposed write should be rejected. */
export function validateSupplierSnapshotWrite(
  incoming: Workspace, previous: Workspace, actor: SnapshotUser
): string | null {
  if (actor.role !== 'guest') return null;
  if (actor.app_role !== 'Supplier') return 'Supplier account role is invalid.';
  const before: Record<string, Map<string, RecordValue>> = {};
  const after: Record<string, Map<string, RecordValue>> = {};
  for (const collection of collections) {
    const original = byId(previous[collection] ?? []);
    const proposed = byId(incoming[collection] ?? []);
    if (!original || !proposed) return `Invalid or duplicate ${collection} records.`;
    before[collection] = original;
    after[collection] = proposed;
  }
  const vendor = [...before.suppliers.values()].find(s => text(s.name).toLowerCase() === text(actor.company_name).toLowerCase());
  const vendorId = text(vendor?.id) || `supplier-${actor.id}`;
  const vendorName = text(vendor?.name) || text(actor.company_name);
  if (!vendorName) return 'Supplier account is missing the registered company name.';
  const belongsTo = (row: RecordValue) => text(row.supplierId) === vendorId &&
    text(row.supplierName).toLowerCase() === vendorName.toLowerCase();

  for (const collection of collections) {
    const originals = before[collection];
    const proposed = after[collection];
    for (const [id, row] of originals) {
      const next = proposed.get(id);
      if (!next) return `Supplier cannot remove ${collection} record ${id}.`;
      if (same(row, next)) continue;
      if (collection === 'orders') {
        if (!belongsTo(row) || row.status !== 'Awaiting Supplier Signature' ||
            next.status !== 'Approved & Signed' || text(next.signedBy) !== actor.name ||
            !validTimestamp(next.signedAt) || !changesOnly(row, next, ['status', 'signedBy', 'signedAt']))
          return `Supplier cannot modify Purchase Order ${id} outside the signature action.`;
        continue;
      }
      if (collection === 'amendments') {
        const order = before.orders.get(text(row.poId));
        if (!order || !belongsTo(order) || row.approvalStatus !== 'Pending Supplier Response' ||
            next.approvalStatus !== 'Supplier Responded' || !text(next.supplierResponse) ||
            text(next.supplierResponse).length > 2000 || !validTimestamp(next.respondedAt) ||
            !changesOnly(row, next, ['approvalStatus','supplierResponse','respondedAt']))
          return `Supplier cannot modify amendment ${id} outside the response action.`;
        continue;
      }
      if (collection === 'proposalMeetings') {
        if (!belongsTo(row) || (row.rescheduleRequest as RecordValue | undefined)?.status === 'Pending')
          return `Supplier cannot modify meeting ${id}.`;
        const responded = row.status === 'Pending Response' &&
          ['Agreed','Declined'].includes(text(next.status)) &&
          changesOnly(row, next, ['status']);
        const cancelled = ['Pending Response','Agreed'].includes(text(row.status)) &&
          next.status === 'Cancelled' && ![...before.orders.values()].some(o => o.bidId === row.bidId) &&
          text(next.cancellationReason).length >= 1 && text(next.cancellationReason).length <= 500 &&
          text(next.cancelledBy) === actor.name && validTimestamp(next.cancelledAt) &&
          changesOnly(row, next, ['status','cancellationReason','cancelledBy','cancelledAt']);
        if (!responded && !cancelled) return `Supplier cannot modify meeting ${id} outside a response or cancellation.`;
        continue;
      }
      return `Supplier may not modify ${collection} record ${id}.`;
    }
    for (const [id, row] of proposed) {
      if (originals.has(id)) continue;
      if (collection === 'suppliers' && !vendor && id === `supplier-${actor.id}` &&
          text(row.name).toLowerCase() === vendorName.toLowerCase() &&
          row.contact === actor.name && row.email === actor.email && row.phone === '' &&
          row.category === 'Registered Supplier' &&
          changesOnly({}, row, ['id','name','contact','email','phone','category'])) continue;
      return `Supplier cannot create ${collection} record ${id} through the shared workspace.`;
    }
  }
  return null;
}
