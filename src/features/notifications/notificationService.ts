import { DB } from '../../store/state';
import type { ProcurementRecord, ProcurementState, User } from '../../types/procurement';
import { getCloudNotificationSnapshot, getCloudReadIds, queueCloudNotificationRead } from './cloudNotificationSync';

/**
 * Notifications are derived from existing procurement records.
 * This keeps the starter compatible with the current Cloudflare D1 schema.
 * Cloud mode syncs read/unread state in D1 and polls the shared workspace.
 * Local demo mode keeps browser-local read state.
 */
export type NotificationKind = 'info' | 'success' | 'warning' | 'action';

export interface ProcurementNotification {
  id: string;
  title: string;
  description: string;
  createdAt?: string;
  kind: NotificationKind;
  targetTab: string;
  targetRecordId?: string;
  /** True for past audit events. History is not an outstanding unread alert. */
  historical?: boolean;
}

const KEY_PREFIX = 'procureflow_read_notifications_v1_';
const asString = (value: unknown): string => typeof value === 'string' ? value : '';
const isOwner = (record: ProcurementRecord, user: User) =>
  Boolean(record.requestedByUsername && user.username && record.requestedByUsername === user.username) ||
  (!record.requestedByUsername && record.requestedBy === user.name);

function userKey(user: User): string {
  return `${KEY_PREFIX}${encodeURIComponent(String(user.id || user.username))}`;
}

function readIds(user: User): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(userKey(user)) || '[]');
    return new Set([...(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []), ...getCloudReadIds(user)]);
  } catch {
    return new Set(getCloudReadIds(user));
  }
}

export function markNotificationRead(notificationId: string, user = DB.currentUser): void {
  if (!user || notificationId.startsWith('history:')) return;
  const read = readIds(user);
  read.add(notificationId);
  try { localStorage.setItem(userKey(user), JSON.stringify([...read].slice(-2000))); }
  catch { /* Storage may be unavailable in restricted browsing contexts. */ }
  queueCloudNotificationRead([notificationId], user);
}

export function markAllNotificationsRead(notifications: ProcurementNotification[], user = DB.currentUser): void {
  if (!user) return;
  const current = notifications.filter(notification => !notification.historical);
  if (!current.length) return;
  const read = readIds(user);
  current.forEach(notification => read.add(notification.id));
  try { localStorage.setItem(userKey(user), JSON.stringify([...read].slice(-2000))); }
  catch { /* No persistent read flags when storage is disabled. */ }
  queueCloudNotificationRead(current.map(notification => notification.id), user);
}

export function isNotificationRead(notification: ProcurementNotification, user = DB.currentUser): boolean {
  return notification.historical || Boolean(user && readIds(user).has(notification.id));
}

export function getUnreadCount(notifications: ProcurementNotification[], user = DB.currentUser): number {
  if (!user) return 0;
  const read = readIds(user);
  return notifications.filter(notification => !notification.historical && !read.has(notification.id)).length;
}

function sorted(notifications: ProcurementNotification[]): ProcurementNotification[] {
  return [...new Map(notifications.map(notification => [notification.id, notification])).values()]
    .sort((a, b) => (b.createdAt || '').replace(' ', 'T').localeCompare((a.createdAt || '').replace(' ', 'T')));
}

/**
 * Persistent activity history from the already-synced audit log. Audit entries
 * are only displayed when the relevant record is visible to this user.
 * This reconstructs historical events without requiring a Worker migration.
 * Older events cannot be reconstructed once the underlying audit log is deleted.
 */
function historyFromAudit(state: ProcurementState, user: User): ProcurementNotification[] {
  const entries = Array.isArray(state.auditLogs) ? state.auditLogs : [];
  const admin = user.role === 'Admin';
  const manager = user.role === 'Procurement Head';
  const officer = user.role === 'Procurement Officer';
  const employee = user.role === 'Employee';
  const supplier = user.role === 'Supplier';

  // Explicit allowlist; authentication, passwords, access settings and other
  // administrative audit details must never leak to supplier/staff feeds.
  const events: Record<string, { title: string; tab: string; kind: NotificationKind; category: string }> = {
    'PR Created': { title: 'Requisition submitted', tab: 'requisitions', kind: 'info', category: 'pr' },
    'PR Approved': { title: 'Requisition approved', tab: 'requisitions', kind: 'success', category: 'pr' },
    'PR Rejected': { title: 'Requisition rejected', tab: 'requisitions', kind: 'warning', category: 'pr' },
    'Stock Need Published': { title: 'Stock need published', tab: 'bidding', kind: 'info', category: 'need' },
    'Bid Submitted': { title: 'Supplier bid submitted', tab: 'bidding', kind: 'info', category: 'need' },
    'Supplier Selected': { title: 'Supplier selected', tab: 'bidding', kind: 'success', category: 'need' },
    'Supplier Bid Evaluated': { title: 'Bid evaluation recorded', tab: 'bidding', kind: 'info', category: 'bid' },
    'Proposal Meeting Scheduled': { title: 'Proposal meeting scheduled', tab: 'bidding', kind: 'info', category: 'meeting' },
    'Proposal Meeting Cancelled': { title: 'Proposal meeting cancelled', tab: 'bidding', kind: 'warning', category: 'meeting' },
    'Meeting Response': { title: 'Meeting response received', tab: 'bidding', kind: 'info', category: 'meeting' },
    'PO Issued': { title: 'Purchase order issued', tab: 'orders', kind: 'info', category: 'po' },
    'PO Signed by Supplier': { title: 'Purchase order signed', tab: 'orders', kind: 'success', category: 'po' },
    'Delivery Recorded': { title: 'Delivery recorded', tab: 'delivery', kind: 'info', category: 'delivery' },
    'Delivery Inspected': { title: 'Delivery inspection recorded', tab: 'delivery', kind: 'success', category: 'delivery' },
    'Amendment Issued': { title: 'Amendment issued', tab: 'amendments', kind: 'warning', category: 'amendment' },
    'Amendment Approved': { title: 'Amendment approved', tab: 'amendments', kind: 'success', category: 'amendment' },
    'Amendment Rejected': { title: 'Amendment rejected', tab: 'amendments', kind: 'warning', category: 'amendment' },
    'Supplier Amendment Response': { title: 'Supplier responded to amendment', tab: 'amendments', kind: 'info', category: 'amendment' },
    'Disbursement Completed': { title: 'Payment completed', tab: 'payments', kind: 'success', category: 'payment' },
    'Supplier Evaluated': { title: 'Supplier evaluation recorded', tab: 'suppliers', kind: 'info', category: 'supplier' },
  };
  const categories: Record<string, string> = { pr: 'PR', need: 'SN', bid: 'BID', meeting: 'MTG',
    po: 'PO', delivery: 'DEL', amendment: 'AMD', payment: 'PAY', supplier: 'sup' };
  const records: Record<string, ProcurementRecord[]> = {
    pr: state.requisitions, need: state.stockNeeds, bid: state.bids,
    meeting: state.proposalMeetings, po: state.orders, delivery: state.deliveries,
    amendment: state.amendments, payment: state.payments, supplier: state.suppliers
  };
  const findOrder = (poId: string | undefined) => state.orders.find(o => o.id === poId);
  const linkedSupplier = (category: string, record: ProcurementRecord) => {
    if (category === 'po') return record.supplierId;
    if (category === 'delivery' || category === 'amendment' || category === 'payment') return findOrder(record.poId)?.supplierId;
    if (category === 'meeting') return record.supplierId;
    if (category === 'bid') return record.supplierId;
    if (category === 'supplier') return record.id;
    if (category === 'need') return null;
    return null;
  };
  return entries.flatMap((entry) => {
    const event = events[asString(entry.action)];
    if (!event || !asString(entry.details)) return [];
    const { category } = event;
    const expectedPrefix = categories[category];
    const pattern = new RegExp('\\b' + expectedPrefix + '-[a-zA-Z0-9_-]+\\b', 'i');
    const reference = asString(entry.details).match(pattern)?.[0] || '';
    const record = records[category]?.find(r => asString(r.id).toLowerCase() === reference.toLowerCase());

    // Except for a published stock need, do not show details of deleted or
    // unrelated business records to a non-administrator.
    if (!admin && !record) return [];
    if (employee) {
      if (category !== 'pr' || !record || !isOwner(record, user)) return [];
    } else if (supplier) {
      if (category === 'need') {
        if (entry.action !== 'Stock Need Published' || !record ||
          (record.status !== 'Published' && !state.bids.some(b => b.needId === record.id && b.supplierId === user.supplierId))) return [];
      } else if (!record || !user.supplierId || linkedSupplier(category, record) !== user.supplierId) {
        return [];
      }
      // Do not reveal evaluations or supplier-internal activity.
      if (entry.action === 'Supplier Bid Evaluated' || entry.action === 'Supplier Evaluated') return [];
    } else if (officer && !['pr', 'po', 'delivery', 'amendment', 'payment'].includes(category)) {
      return [];
    } else if (!admin && !manager && !officer) {
      return [];
    }

    // For supplier/employee users, use a generic description based on their
    // own related record; do not expose free-text internal audit comments.
    const description = admin || manager || officer
      ? asString(entry.details)
      : `${reference} · ${event.title}.`;
    const id = asString(entry.id) || `${asString(entry.timestamp)}:${asString(entry.action)}:${asString(entry.details)}`;
    return [{
      id: `history:${id}:${asString(entry.action)}`,
      title: event.title,
      description,
      createdAt: asString(entry.timestamp),
      kind: event.kind,
      targetTab: event.tab,
      targetRecordId: record?.id || reference || undefined,
      historical: true,
    }];
  });
}

/** Resolve alerts for the logged-in user's authorized slice of procurement data. */
export function getNotifications(state: ProcurementState = DB, user: User | null = state.currentUser): ProcurementNotification[] {
  if (!user) return [];
  // When online, prefer the latest D1-backed snapshot for cross-device notifications.
  // This is read-only: never replace DB while someone is editing a form.
  const live = getCloudNotificationSnapshot(user);
  if (live && state === DB) state = { ...state, ...live };
  const result: ProcurementNotification[] = [];
  const add = (notification: ProcurementNotification) => result.push(notification);
  const supplier = user.role === 'Supplier';
  const employee = user.role === 'Employee';
  const approver = user.role === 'Admin' || user.role === 'Procurement Head';
  const procurement = approver || user.role === 'Procurement Officer';
  const supplierId = user.supplierId;

  if (employee) {
    state.requisitions.filter(pr => isOwner(pr, user)).forEach(pr => {
      const status = asString(pr.status);
      if (!['Approved', 'Rejected', 'In Process', 'Completed'].includes(status)) return;
      add({
        id: `pr-status:${pr.id}:${status}`,
        title: `Requisition ${status}`,
        description: `${pr.id} · ${asString(pr.itemTitle) || 'Purchase request'} is ${status.toLowerCase()}.`,
        createdAt: asString(pr.updatedAt),
        kind: status === 'Rejected' ? 'warning' : 'success',
        targetTab: 'tracking', targetRecordId: pr.id
      });
    });
  }

  if (approver) {
    state.requisitions.filter(pr => pr.status === 'Pending').forEach(pr => {
      add({
        id: `pr-awaiting-approval:${pr.id}`,
        title: 'Requisition needs approval',
        description: `${pr.id} · ${asString(pr.itemTitle)} (${asString(pr.department)})`,
        createdAt: asString(pr.createdAt), kind: 'action', targetTab: 'requisitions', targetRecordId: pr.id
      });
    });
    state.bids.filter(bid => bid.status === 'Submitted').forEach(bid => {
      add({
        id: `bid-submitted:${bid.id}`,
        title: 'New supplier quotation',
        description: `${asString(bid.supplierName)} submitted bid ${bid.id}.`,
        createdAt: asString(bid.submittedAt), kind: 'action', targetTab: 'bidding', targetRecordId: bid.id
      });
    });
  }

  if (supplier) {
    state.stockNeeds.filter(need => need.status === 'Published').forEach(need => {
      const alreadyBid = Boolean(supplierId) && state.bids.some(bid => bid.needId === need.id && bid.supplierId === supplierId);
      if (!alreadyBid) add({
        id: `need-published:${need.id}`,
        title: 'New bidding opportunity',
        description: `${asString(need.title)} · Bids are open.`,
        createdAt: asString(need.createdAt), kind: 'action', targetTab: 'bidding', targetRecordId: need.id
      });
    });
    state.proposalMeetings.filter(meeting => Boolean(supplierId) && meeting.supplierId === supplierId && meeting.status === 'Pending Response').forEach(meeting => {
      add({
        id: `meeting-invitation:${meeting.id}`,
        title: 'Proposal meeting invitation',
        description: `Respond to meeting ${meeting.id} with procurement.`,
        createdAt: asString(meeting.createdAt || meeting.date), kind: 'action', targetTab: 'bidding', targetRecordId: meeting.id
      });
    });
    state.orders.filter(order => Boolean(supplierId) && order.supplierId === supplierId).forEach(order => {
      add({
        id: `supplier-order:${order.id}:${order.status}`,
        title: 'Purchase order assigned',
        description: `${order.id} · ${asString(order.itemTitle) || 'New order'} (${asString(order.status)}).`,
        createdAt: asString(order.poDate), kind: 'info', targetTab: 'orders', targetRecordId: order.id
      });
    });
    state.payments.filter(payment => {
      const po = state.orders.find(order => order.id === payment.poId);
      return Boolean(supplierId) && po?.supplierId === supplierId && payment.status === 'Paid';
    }).forEach(payment => {
      add({
        id: `supplier-payment:${payment.id}:paid`,
        title: 'Payment confirmed',
        description: `${payment.poId} · Payment has been marked paid.`,
        createdAt: asString(payment.paymentDate), kind: 'success', targetTab: 'payments', targetRecordId: payment.id
      });
    });
  }

  if (procurement) {
    state.deliveries.filter(delivery => delivery.complianceStatus === 'Pending Inspection').forEach(delivery => {
      add({
        id: `delivery-inspection:${delivery.id}`,
        title: 'Delivery awaiting inspection',
        description: `${delivery.id} · ${asString(delivery.itemTitle)} requires inspection.`,
        createdAt: asString(delivery.updatedAt || delivery.actualDate),
        kind: 'action', targetTab: 'delivery', targetRecordId: delivery.id
      });
    });
    state.amendments.filter(amendment => ['Pending', 'Pending Approval'].includes(asString(amendment.status))).forEach(amendment => {
      add({
        id: `amendment-review:${amendment.id}`,
        title: 'Amendment needs review',
        description: `${amendment.id} is awaiting an approval decision.`,
        createdAt: asString(amendment.createdAt),
        kind: 'warning', targetTab: 'amendments', targetRecordId: amendment.id
      });
    });
  }
  return sorted([...result, ...historyFromAudit(state, user)]);
}
