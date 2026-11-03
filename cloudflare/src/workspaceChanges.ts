/** Record-level workspace writes. This is a compatibility layer over enterprise_state:
 * it avoids replacing unrelated records and checks the old value of every touched id.
 * A later migration can store records in separate D1 tables without changing the API.
 */
export const WORKSPACE_COLLECTIONS = [
  'stockNeeds', 'bids', 'proposalMeetings', 'requisitions', 'orders',
  'deliveries', 'amendments', 'payments', 'suppliers', 'ratings',
] as const;
export type WorkspaceCollection = typeof WORKSPACE_COLLECTIONS[number];
type Row = Record<string, unknown>;
export type Change = { collection: WorkspaceCollection; id: string; before: Row | null; after: Row | null };
export type Workspace = Record<string, unknown>;
export type Actor = {
  id: string; username: string; name: string; role: string; app_role: string;
  department: string; company_name: string;
};
const serial = (value: unknown) => JSON.stringify(value ?? null);
const same = (a: unknown, b: unknown) => serial(a) === serial(b);
const value = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const canManageProcurement = (user: Actor) => user.role === 'admin' || user.app_role === 'Procurement Head';
const canRecordDelivery = (user: Actor) => canManageProcurement(user) || user.app_role === 'Procurement Officer';
const ownsPR = (pr: Row, user: Actor) =>
  value(pr.requestedByUsername).toLowerCase() === user.username.toLowerCase() &&
  value(pr.department).toLowerCase() === user.department.toLowerCase();
const onlyFields = (before: Row, after: Row, fields: readonly string[]) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].every(key =>
    fields.includes(key) || same(before[key], after[key]));

/** Fail closed on duplicate ids, fabricated old values, and edits to other records. */
export function applyWorkspaceChanges(previous: Workspace, changes: Change[]): { next?: Workspace; error?: string } {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 40)
    return { error: 'Send 1–40 changed records per save.' };
  const next: Workspace = { ...previous };
  const seen = new Set<string>();
  for (const collection of WORKSPACE_COLLECTIONS) {
    const rows = previous[collection] ?? [];
    if (!Array.isArray(rows)) return { error: `Invalid ${collection} records on the server.` };
    const ids = new Set<string>();
    for (const row of rows) {
      if (!isRow(row) || !value(row.id) || ids.has(value(row.id)))
        return { error: `Invalid or duplicate record IDs in ${collection}.` };
      ids.add(value(row.id));
    }
    next[collection] = [...rows];
  }
  for (const change of changes) {
    if (!isRow(change) || !WORKSPACE_COLLECTIONS.includes(change.collection) ||
        typeof change.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(change.id) ||
        (change.before !== null && !isRow(change.before)) ||
        (change.after !== null && !isRow(change.after)) ||
        (change.after === null && change.before === null))
      return { error: 'Invalid record change.' };
    const key = `${change.collection}:${change.id}`;
    if (seen.has(key)) return { error: 'A record may only be changed once per request.' };
    seen.add(key);
    if ((change.before && change.before.id !== change.id) || (change.after && change.after.id !== change.id))
      return { error: 'Record ID must not change.' };
    const rows = next[change.collection] as Row[];
    const index = rows.findIndex(row => row.id === change.id);
    const stored = index >= 0 ? rows[index] : null;
    if (!same(stored, change.before))
      return { error: `Conflict: ${change.collection} ${change.id} was changed by another session. Refresh before retrying.` };
    if (same(stored, change.after)) return { error: 'No-op changes are not accepted.' };
    if (change.after === null) rows.splice(index, 1);
    else if (index === -1) rows.push(change.after);
    else rows[index] = change.after;
  }
  return { next };
}

/** Server role checks; never trust client-side role permissions or UI state. */
export function authorizeWorkspaceChanges(actor: Actor, changes: Change[]): string | null {
  for (const { collection, id, before, after } of changes) {
    if (actor.role === 'guest') {
      // Granular supplier actions are constrained by validateSupplierSnapshotWrite.
      if (actor.app_role !== 'Supplier' || !['orders', 'amendments', 'proposalMeetings', 'suppliers'].includes(collection))
        return `Supplier cannot modify ${collection} through this endpoint.`;
      continue;
    }
    if (actor.role === 'admin') continue; // Finance and sourcing validators still apply.
    if (collection === 'requisitions') {
      if (!before && after && after.status === 'Pending' && ownsPR(after, actor) && after.requestedBy === actor.name) continue;
      if (before && after && before.status === 'Pending' && after.status === 'Pending' &&
          ownsPR(before, actor) && ownsPR(after, actor) &&
          onlyFields(before, after, ['itemTitle','specs','quantity','unit','unitPrice','totalCost','targetDate','remarks'])) continue;
      // Procurement may transition an approved PR to In Process only while
      // creating the corresponding new PO. Approval itself remains Finance-owned.
      if (canManageProcurement(actor) && before && after && before.status === 'Approved' &&
          after.status === 'In Process' && onlyFields(before, after, ['status']) &&
          changes.some(other => other.collection === 'orders' && !other.before && other.after?.prId === id)) continue;
      return `Only the requester may create or edit their own pending requisition (${id}).`;
    }
    if (collection === 'stockNeeds' || collection === 'bids' || collection === 'proposalMeetings' ||
        collection === 'orders' || collection === 'amendments') {
      if (canManageProcurement(actor)) continue;
      return `Only Procurement Head or Admin can change ${collection}.`;
    }
    if (collection === 'payments') {
      if (canRecordDelivery(actor) && before && after &&
          onlyFields(before, after, ['deliveryVerified'])) continue;
      // PO creation also prepares a *Pending* payment; no authority to pay it.
      if (canManageProcurement(actor) && !before && after && after.status === 'Pending' &&
          changes.some(other => other.collection === 'orders' && !other.before && other.after?.id === after.poId)) continue;
      // Approved amendment reopens an unpaid payment with a corrected PO amount.
      if (canManageProcurement(actor) && before && after && before.status !== 'Paid' &&
          after.status === 'Pending' && onlyFields(before, after,
          ['totalAmount','paymentAmount','deliveryVerified','status']) &&
          changes.some(other => other.collection === 'amendments' && other.before &&
            other.after?.poId === after.poId && other.after.approvalStatus === 'Approved Amendment')) continue;
      // Actual disbursement is checked against D1 Finance appointments, thresholds
      // and matched invoice by validateFinanceSnapshotWrite, not by app_role labels.
      if (before && after && before.status === 'Pending' && after.status === 'Paid' &&
          onlyFields(before, after, ['status','paymentMethod','refNumber','paymentDate','processedBy']) &&
          after.processedBy === actor.name) continue;
      return 'Payment records must be changed through the authorized finance workflow.';
    }
    if (collection === 'deliveries' || collection === 'suppliers' || collection === 'ratings') {
      if (canRecordDelivery(actor)) continue;
      return `This account cannot change ${collection}.`;
    }
    return `This account cannot change ${collection}.`;
  }
  return null;
}

/** Suppliers get relevant public needs and their own records, not internal budgets or peer bids. */
export function projectWorkspace(previous: Workspace, actor: Actor): Workspace {
  if (actor.role !== 'guest') return previous;
  const suppliers = Array.isArray(previous.suppliers) ? previous.suppliers as Row[] : [];
  const vendor = suppliers.find(s => value(s.name).toLowerCase() === actor.company_name.toLowerCase());
  const supplierId = value(vendor?.id) || `supplier-${actor.id}`;
  const owns = (row: Row) => value(row.supplierId) === supplierId &&
    value(row.supplierName).toLowerCase() === actor.company_name.toLowerCase();
  const ownRows = (key: WorkspaceCollection) => ((previous[key] as Row[] | undefined) ?? []).filter(owns);
  const orders = ownRows('orders');
  const orderIds = new Set(orders.map(row => value(row.id)));
  return {
    stockNeeds: ((previous.stockNeeds as Row[] | undefined) ?? []).filter(row =>
      ['Published', 'Open', 'Bidding Open', 'Supplier Selected'].includes(value(row.status)) ||
      ownRows('bids').some(b => b.needId === row.id)),
    bids: ownRows('bids'),
    proposalMeetings: ownRows('proposalMeetings'),
    requisitions: [],
    orders,
    deliveries: ((previous.deliveries as Row[] | undefined) ?? []).filter(row => orderIds.has(value(row.poId))),
    amendments: ((previous.amendments as Row[] | undefined) ?? []).filter(row => orderIds.has(value(row.poId))),
    payments: ((previous.payments as Row[] | undefined) ?? []).filter(row => orderIds.has(value(row.poId)))
      .map(row => ({id:row.id,poId:row.poId,status:row.status,totalAmount:row.totalAmount,deliveryVerified:row.deliveryVerified})),
    suppliers: vendor ? [vendor] : [],
    ratings: ((previous.ratings as Row[] | undefined) ?? []).filter(row => row.supplierId === supplierId),
    auditLogs: [],
  };
}

/** Relationship/integrity checks for writes that span several records. */
export function validateWorkspaceLinks(changes: Change[], previous: Workspace, next: Workspace, actor: Actor): string | null {
  const old = (collection: WorkspaceCollection) => (previous[collection] as Row[] | undefined) ?? [];
  const updated = (collection: WorkspaceCollection) => (next[collection] as Row[] | undefined) ?? [];
  const price = (v: unknown) => Number.isFinite(v) && typeof v === 'number' && v >= 0 && v <= 1e11;
  for (const {collection,id,before,after} of changes) {
    if (collection === 'requisitions' && after && actor.role !== 'admin') {
      const qty = Number(after.quantity);
      if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 100000000 || !price(after.unitPrice) ||
          !price(after.totalCost) || Math.abs(Number(after.totalCost) - Math.round(qty * Number(after.unitPrice) * 100) / 100) > 0.01)
        return `Requisition ${id} has an invalid quantity or calculated total.`;
    }
    if (collection === 'payments' && before && after && before.status === 'Pending' && after.status === 'Paid') {
      if (after.processedBy !== actor.name || value(after.paymentMethod).length < 2 ||
          value(after.paymentMethod).length > 80 || value(after.refNumber).length < 2 ||
          value(after.refNumber).length > 150 || !/^\d{4}-\d{2}-\d{2}$/.test(value(after.paymentDate)))
        return `Payment ${id} needs a valid method, reference, date, and authenticated processor.`;
    }
    if (collection === 'amendments' && !before && after) {
      const delivery = old('deliveries').find(d => d.id === after.delId && d.poId === after.poId);
      const po = old('orders').find(o => o.id === after.poId);
      if (!delivery || !po ||
          !['Issue Flagged - Quantity Shortage','Issue Flagged - Damaged / Defective Goods','Non-Compliant Specifications'].includes(value(delivery.complianceStatus)) ||
          old('payments').some(p => p.poId === po.id && p.status === 'Paid') ||
          old('amendments').some(a => a.delId === delivery.id && ['Pending Supplier Response','Supplier Responded'].includes(value(a.approvalStatus))) ||
          after.approvalStatus !== 'Pending Supplier Response' || after.supplierId !== po.supplierId ||
          after.supplierName !== po.supplierName || after.requestedBy !== actor.name ||
          !Number.isSafeInteger(after.revisedQty) || Number(after.revisedQty) < 1 ||
          value(after.reason).length < 1 || value(after.revisedSpecs).length < 1)
        return `Amendment ${id} requires an unresolved delivery issue on an unpaid Purchase Order.`;
    }
    if (collection === 'orders' && !before && after) {
      const bid = old('bids').find(b => b.id === after.bidId);
      const need = old('stockNeeds').find(n => n.id === after.needId);
      const pr = old('requisitions').find(p => p.id === after.prId);
      if (!bid || !need || !pr || bid.needId !== need.id || need.prId !== pr.id ||
          pr.status !== 'Approved' || bid.status !== 'Selected' || need.selectedBidId !== bid.id ||
          need.status !== 'Supplier Selected' || after.supplierId !== bid.supplierId ||
          after.supplierName !== bid.supplierName || after.status !== 'Awaiting Supplier Signature' ||
          (actor.role !== 'admin' && after.createdByName !== actor.name) ||
          !Number.isSafeInteger(after.quantity) || Number(after.quantity) < 1 ||
          !price(after.unitPrice) || !price(after.totalCost) ||
          Math.abs(Number(after.totalCost) - Number(after.quantity) * Number(after.unitPrice)) > 0.01)
        return `Purchase Order ${id} must reference the approved PR and awarded supplier at the agreed price.`;
      if (updated('orders').filter(o => o.bidId === bid.id).length > 1)
        return `A Purchase Order already exists for bid ${bid.id}.`;
    }
    if (collection === 'payments' && !before && after) {
      const po = changes.find(c => c.collection === 'orders' && !c.before && c.after?.id === after.poId)?.after;
      if (!po || after.status !== 'Pending' ||
          Number(after.totalAmount) !== Number(po.totalCost) ||
          Number(after.paymentAmount) !== Number(po.totalCost) ||
          updated('payments').filter(payment => payment.poId === po.id).length > 1)
        return `Payment ${id} must be a single pending payment for its newly issued Purchase Order.`;
    }
    if (collection === 'deliveries') {
      const po = old('orders').find(o => o.id === (after || before)?.poId);
      if (!po) return `Delivery ${id} has no existing Purchase Order.`;
      if (!before && after) {
        const qty = Number(after.deliveredQty);
        const already = old('deliveries').filter(d => d.poId === po.id)
          .reduce((sum, d) => sum + Number(d.deliveredQty || 0), 0);
        if (!['Approved & Signed','Issued'].includes(value(po.status)) ||
            !Number.isSafeInteger(qty) || qty < 1 || already + qty > Number(po.quantity) ||
            after.complianceStatus !== 'Pending Inspection' || after.recordedBy !== actor.name ||
            after.prId !== po.prId || after.supplierName !== po.supplierName ||
            after.orderedQty !== po.quantity)
          return `Delivery ${id} exceeds the signed Purchase Order or has invalid recording details.`;
      } else if (before && after) {
        const inspecting = before.complianceStatus === 'Pending Inspection' &&
          ['Completed - Verified','Issue Flagged - Quantity Shortage',
           'Issue Flagged - Damaged / Defective Goods','Non-Compliant Specifications'].includes(value(after.complianceStatus)) &&
          onlyFields(before, after, ['complianceStatus','remarks']);
        const amendment = canManageProcurement(actor) &&
          after.complianceStatus === 'Pending Inspection' &&
          changes.some(c => c.collection === 'amendments' && c.before && c.after &&
            c.after.delId === id && c.after.approvalStatus === 'Approved Amendment') &&
          onlyFields(before, after, ['orderedQty','specs','complianceStatus','remarks']);
        if (!inspecting && !amendment) return `Delivery ${id} can only be inspected or reopened through an approved amendment.`;
      } else return `Delivery ${id} cannot be deleted from the shared history.`;
    }
  }
  return null;
}
