import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../db/dataService';
import type { PurchaseOrder, WorkflowCollection, WorkflowRecord } from '../types';

type Field = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'textarea';
};

type ModuleConfig = {
  collection: WorkflowCollection;
  title: string;
  description: string;
  prefix: string;
  fields: Field[];
  columns: Field[];
  writers: string[];
  defaultValues?: Record<string, string>;
};

const MODULES: Record<string, ModuleConfig> = {
  requisitions: {
    collection: 'requisitions',
    title: 'Purchase Requisitions',
    description: 'Submit purchase requests and review their approval progress.',
    prefix: 'PR',
    writers: ['admin', 'procurement_head', 'procurement_officer', 'employee'],
    fields: [
      { key: 'department', label: 'Department' },
      { key: 'itemTitle', label: 'Item or service' },
      { key: 'specs', label: 'Specifications', type: 'textarea' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'unitPrice', label: 'Unit price', type: 'number' },
      { key: 'targetDate', label: 'Target date', type: 'date' },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    columns: [
      { key: 'id', label: 'Request' },
      { key: 'itemTitle', label: 'Item' },
      { key: 'department', label: 'Department' },
      { key: 'quantity', label: 'Qty' },
      { key: 'totalCost', label: 'Total' },
      { key: 'status', label: 'Status' },
      { key: 'targetDate', label: 'Needed by' },
    ],
    defaultValues: { quantity: '1', unitPrice: '0' },
  },
  bidding: {
    collection: 'stockNeeds',
    title: 'Bidding & Proposals',
    description: 'Publish stock needs, collect supplier bids, and coordinate proposal meetings.',
    prefix: 'SN',
    writers: ['admin', 'procurement_head', 'procurement_officer'],
    fields: [
      { key: 'title', label: 'Stock need' },
      { key: 'targetQty', label: 'Target quantity', type: 'number' },
      { key: 'budgetCap', label: 'Budget cap', type: 'number' },
      { key: 'techSpecs', label: 'Technical specifications', type: 'textarea' },
      { key: 'status', label: 'Status' },
    ],
    columns: [
      { key: 'id', label: 'Reference' },
      { key: 'title', label: 'Stock need' },
      { key: 'targetQty', label: 'Quantity' },
      { key: 'budgetCap', label: 'Budget cap' },
      { key: 'status', label: 'Status' },
    ],
    defaultValues: { targetQty: '1', budgetCap: '0', status: 'Published' },
  },
  bids: {
    collection: 'bids',
    title: 'Supplier Bids',
    description: 'Review offers against published stock needs and submit supplier proposals.',
    prefix: 'BID',
    writers: ['supplier'],
    fields: [
      { key: 'needId', label: 'Stock need reference' },
      { key: 'supplierName', label: 'Supplier name' },
      { key: 'unitPrice', label: 'Unit price', type: 'number' },
      { key: 'totalCost', label: 'Total offer', type: 'number' },
      { key: 'leadTimeDays', label: 'Lead time (days)', type: 'number' },
      { key: 'notes', label: 'Proposal notes', type: 'textarea' },
    ],
    columns: [
      { key: 'id', label: 'Bid' },
      { key: 'needId', label: 'Stock need' },
      { key: 'supplierName', label: 'Supplier' },
      { key: 'unitPrice', label: 'Unit price' },
      { key: 'totalCost', label: 'Total offer' },
      { key: 'leadTimeDays', label: 'Lead time' },
      { key: 'status', label: 'Status' },
    ],
  },
  meetings: {
    collection: 'meetings',
    title: 'Proposal Meetings',
    description: 'Schedule proposal presentations and track supplier responses.',
    prefix: 'MTG',
    writers: ['admin', 'procurement_head', 'procurement_officer', 'supplier'],
    fields: [
      { key: 'needId', label: 'Stock need reference' },
      { key: 'bidId', label: 'Bid reference' },
      { key: 'supplierId', label: 'Supplier reference' },
      { key: 'supplierName', label: 'Supplier name' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'time', label: 'Time' },
      { key: 'venue', label: 'Venue' },
      { key: 'status', label: 'Status' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: [
      { key: 'id', label: 'Meeting' },
      { key: 'supplierName', label: 'Supplier' },
      { key: 'date', label: 'Date' },
      { key: 'time', label: 'Time' },
      { key: 'venue', label: 'Venue' },
      { key: 'status', label: 'Response' },
    ],
    defaultValues: { status: 'Pending Response' },
  },
  delivery: {
    collection: 'deliveries',
    title: 'Delivery Monitoring',
    description: 'Log incoming shipments, inspect deliveries, and record compliance.',
    prefix: 'DEL',
    writers: ['admin', 'procurement_head', 'procurement_officer'],
    fields: [
      { key: 'poId', label: 'Purchase order reference' },
      { key: 'supplierName', label: 'Supplier name' },
      { key: 'department', label: 'Department' },
      { key: 'itemTitle', label: 'Item' },
      { key: 'orderedQty', label: 'Ordered quantity', type: 'number' },
      { key: 'deliveredQty', label: 'Delivered quantity', type: 'number' },
      { key: 'expectedDate', label: 'Expected date', type: 'date' },
      { key: 'actualDate', label: 'Actual date', type: 'date' },
      { key: 'complianceStatus', label: 'Inspection status' },
      { key: 'remarks', label: 'Inspection notes', type: 'textarea' },
    ],
    columns: [
      { key: 'poId', label: 'Purchase order' },
      { key: 'supplierName', label: 'Supplier' },
      { key: 'itemTitle', label: 'Item' },
      { key: 'orderedQty', label: 'Ordered' },
      { key: 'deliveredQty', label: 'Delivered' },
      { key: 'actualDate', label: 'Received' },
      { key: 'complianceStatus', label: 'Inspection' },
    ],
    defaultValues: { orderedQty: '1', deliveredQty: '0', complianceStatus: 'Pending Inspection' },
  },
  amendments: {
    collection: 'amendments',
    title: 'Issues & Amendments',
    description: 'Track order discrepancies and submit changes for approval.',
    prefix: 'AMD',
    writers: ['admin', 'procurement_head'],
    fields: [
      { key: 'poId', label: 'Purchase order reference' },
      { key: 'reason', label: 'Reason for amendment', type: 'textarea' },
      { key: 'revisedQty', label: 'Revised quantity', type: 'number' },
      { key: 'revisedSpecs', label: 'Revised specifications', type: 'textarea' },
      { key: 'approvalStatus', label: 'Approval status' },
    ],
    columns: [
      { key: 'id', label: 'Amendment' },
      { key: 'poId', label: 'Purchase order' },
      { key: 'reason', label: 'Reason' },
      { key: 'revisedQty', label: 'Revised qty' },
      { key: 'approvalStatus', label: 'Status' },
    ],
    defaultValues: { approvalStatus: 'Pending Amendment' },
  },
  payments: {
    collection: 'payments',
    title: 'Payment Management',
    description: 'Track supplier disbursements, approvals, and transaction references.',
    prefix: 'PAY',
    writers: ['admin', 'procurement_head'],
    fields: [
      { key: 'poId', label: 'Purchase order reference' },
      { key: 'supplierName', label: 'Supplier name' },
      { key: 'department', label: 'Department' },
      { key: 'totalAmount', label: 'Total amount', type: 'number' },
      { key: 'paymentAmount', label: 'Payment amount', type: 'number' },
      { key: 'paymentMethod', label: 'Payment method' },
      { key: 'paymentDate', label: 'Payment date', type: 'date' },
      { key: 'status', label: 'Payment status' },
      { key: 'refNumber', label: 'Transaction reference' },
      { key: 'remarks', label: 'Remarks', type: 'textarea' },
    ],
    columns: [
      { key: 'id', label: 'Payment' },
      { key: 'poId', label: 'Purchase order' },
      { key: 'supplierName', label: 'Supplier' },
      { key: 'paymentAmount', label: 'Amount' },
      { key: 'paymentDate', label: 'Date' },
      { key: 'status', label: 'Status' },
      { key: 'refNumber', label: 'Reference' },
    ],
    defaultValues: { totalAmount: '0', paymentAmount: '0', status: 'Pending' },
  },
  ratings: {
    collection: 'ratings',
    title: 'Supplier Evaluations',
    description: 'Record supplier quality, delivery, pricing, and performance feedback.',
    prefix: 'RAT',
    writers: ['admin', 'procurement_head', 'procurement_officer'],
    fields: [
      { key: 'supplierId', label: 'Supplier reference' },
      { key: 'supplierName', label: 'Supplier name' },
      { key: 'rating', label: 'Overall rating (1–5)', type: 'number' },
      { key: 'qualityScore', label: 'Quality score', type: 'number' },
      { key: 'deliveryScore', label: 'Delivery score', type: 'number' },
      { key: 'pricingScore', label: 'Pricing score', type: 'number' },
      { key: 'feedback', label: 'Feedback', type: 'textarea' },
    ],
    columns: [
      { key: 'supplierName', label: 'Supplier' },
      { key: 'rating', label: 'Overall' },
      { key: 'qualityScore', label: 'Quality' },
      { key: 'deliveryScore', label: 'Delivery' },
      { key: 'pricingScore', label: 'Pricing' },
      { key: 'feedback', label: 'Feedback' },
      { key: 'createdAt', label: 'Date' },
    ],
  },
  audit: {
    collection: 'auditLogs',
    title: 'System Audit Trail',
    description: 'Review a time-ordered record of changes made in procurement workflows.',
    prefix: 'LOG',
    writers: [],
    fields: [],
    columns: [
      { key: 'timestamp', label: 'Timestamp' },
      { key: 'user', label: 'User' },
      { key: 'role', label: 'Role' },
      { key: 'action', label: 'Action' },
      { key: 'details', label: 'Details' },
    ],
  },
};

const ACCESS_ROLES = [
  'admin',
  'procurement_head',
  'procurement_officer',
  'employee',
  'supplier',
  'guest',
] as const;
const ACCESS_ACTIONS = [
  'create_pr',
  'approve_pr',
  'issue_po',
  'manage_bidding',
  'record_delivery',
  'approve_amendment',
  'process_payment',
  'rate_supplier',
  'manage_users',
  'manage_permissions',
  'submit_bids',
] as const;
const ROLE_ACTION_LIMITS: Record<string, readonly string[]> = {
  admin: ACCESS_ACTIONS,
  procurement_head: [
    'create_pr',
    'approve_pr',
    'issue_po',
    'manage_bidding',
    'record_delivery',
    'approve_amendment',
    'process_payment',
    'rate_supplier',
    'view_all_po',
  ],
  procurement_officer: [
    'create_pr',
    'issue_po',
    'manage_bidding',
    'record_delivery',
    'rate_supplier',
    'view_all_po',
  ],
  employee: ['create_pr'],
  supplier: ['submit_bids'],
  guest: [],
};
const CREATE_LABELS: Record<string, string> = {
  requisitions: 'New Requisition',
  bidding: 'Publish Stock Need',
  bids: 'Submit Bid',
  meetings: 'Schedule Meeting',
  delivery: 'Log Delivery',
  amendments: 'Initiate Amendment',
  payments: 'Process Payment',
  ratings: 'Rate Supplier',
};
const FORM_TITLES: Record<string, string> = {
  requisitions: 'New Purchase Requisition',
  bidding: 'Publish Stock Need',
  bids: 'Submit Supplier Bid',
  meetings: 'Schedule Proposal Meeting',
  delivery: 'Record Incoming Shipment',
  amendments: 'Initiate Order Amendment',
  payments: 'Process Supplier Payment',
  ratings: 'Evaluate Supplier',
};

function recordValue(record: WorkflowRecord, key: string): string {
  const value = record[key];
  return value == null ? '' : String(value);
}

function timestampNow(): string {
  return new Date().toISOString();
}

function createRecordId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export default function Operations({ view }: { view: string }) {
  const { user } = useAuth();
  const userRole = user ? String(user.role) : '';
  const [records, setRecords] = useState<WorkflowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Record<string, string>>(
    () => MODULES[view]?.defaultValues ?? {}
  );
  const config = MODULES[view];

  const load = useCallback(async () => {
    if (!config) return;
    try {
      setRecords(await dataService.listWorkflowRecords(config.collection));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load workflow data');
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    if (!config) return;
    let active = true;
    void dataService.listWorkflowRecords(config.collection)
      .then((items) => {
        if (!active) return;
        const visibleItems = user && userRole === 'employee' && config.collection === 'requisitions'
          ? items.filter((record) => record.requestedByUsername === user.username)
          : user && userRole === 'supplier' && ['bids', 'meetings'].includes(config.collection)
            ? items.filter((record) => record.supplierId === user.supplierId)
            : items;
        setRecords(visibleItems);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Failed to load workflow data');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [config, user, userRole]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      Object.values(record).some((value) => String(value).toLowerCase().includes(query))
    );
  }, [records, search]);

  if (!user) return null;

  if (view === 'accessControl') {
    return <AccessControl userRole={user.role} error={error} onError={setError} />;
  }
  if (!config) return null;

  const canWrite = config.writers.includes(user.role);

  const save = async (record: WorkflowRecord): Promise<boolean> => {
    setError('');
    setSuccess('');
    try {
      await dataService.upsertWorkflowRecord(config.collection, record);
      if (dataService.getMode() === 'local' && config.collection !== 'auditLogs') {
        await dataService.upsertWorkflowRecord('auditLogs', {
          id: createRecordId('LOG'),
          timestamp: timestampNow(),
          user: user.name,
          role: user.role,
          action: 'Workflow record saved',
          details: `${config.collection}: ${record.id}`,
        });
      }
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this record');
      return false;
    }
  };

  const createRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = createRecordId(config.prefix);
    const values: WorkflowRecord = { id };
    for (const [key, value] of Object.entries(config.defaultValues ?? {})) {
      values[key] = value;
    }
    for (const field of config.fields) {
      const rawValue = form[field.key] ?? '';
      values[field.key] = field.type === 'number' ? Number(rawValue) || 0 : rawValue.trim();
    }
    if (config.collection === 'requisitions') {
      const quantity = Number(values.quantity) || 0;
      const unitPrice = Number(values.unitPrice) || 0;
      values.totalCost = quantity * unitPrice;
      values.status = 'Pending';
      values.requestedBy = user.name;
      values.requestedByUsername = user.username;
      values.createdAt = timestampNow();
    } else if (config.collection === 'bids') {
      values.supplierId = user.supplierId ?? '';
      values.status = 'Submitted';
      values.submittedAt = timestampNow();
    } else {
      values.createdAt = timestampNow();
      if (userRole === 'supplier') values.supplierId = user.supplierId ?? '';
    }
    if (await save(values)) {
      setShowForm(false);
      setForm(config.defaultValues ?? {});
    }
  };

  const updateStatus = async (record: WorkflowRecord, status: string) => {
    await save({ ...record, status, approvalStatus: record.approvalStatus ? status : record.approvalStatus });
  };

  const issuePurchaseOrder = async (requisition: WorkflowRecord) => {
    const orderId = `PO-${requisition.id}`;
    setError('');
    setSuccess('');
    try {
      const existing = await dataService.listOrders();
      if (existing.some((order) => order.id === orderId)) {
        setSuccess(`Purchase order ${orderId} has already been issued.`);
        return;
      }
      const order: PurchaseOrder = {
        id: orderId,
        title: String(requisition.itemTitle ?? 'Purchase requisition'),
        description: `Requisition ${requisition.id}: ${String(requisition.specs ?? '')}`,
        amount: Number(requisition.totalCost) || 0,
        status: 'approved',
        requestedBy: String(requisition.requestedBy ?? user.name),
        requestedAt: timestampNow().slice(0, 10),
        supplier: requisition.supplierName ? String(requisition.supplierName) : undefined,
        category: String(requisition.department ?? 'Other'),
      };
      await dataService.upsertOrder(order);
      if (dataService.getMode() === 'local') {
        await dataService.upsertWorkflowRecord('auditLogs', {
          id: createRecordId('LOG'),
          timestamp: timestampNow(),
          user: user.name,
          role: user.role,
          action: 'Purchase order issued',
          details: `${orderId} for ${requisition.id}`,
        });
      }
      setSuccess(`Purchase order ${orderId} issued successfully.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not issue purchase order');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">PROCUREMENT WORKSPACE</p>
          <h1>{config.title}</h1>
          <p className="text-muted">{config.description}</p>
        </div>
        {canWrite && config.fields.length > 0 && !(view === 'meetings' && userRole === 'supplier') && (
          <button className="btn btn-primary" onClick={() => setShowForm((open) => !open)}>
            {showForm ? 'Cancel' : `+ ${CREATE_LABELS[view] ?? 'Create Record'}`}
          </button>
        )}
      </header>

      {error && <div className="error-message" role="alert">{error}</div>}
      {success && <p className="success-message" role="status">{success}</p>}

      {view === 'bidding' && <BiddingTabs />}

      {showForm && (
        <section className="panel workflow-form-panel">
          <h2>{FORM_TITLES[view] ?? `New ${config.title.replace(/s$/, '')}`}</h2>
          <form className="workflow-form" onSubmit={(event) => void createRecord(event)}>
            <div className="workflow-fields">
              {config.fields.map((field) => (
                <label key={field.key} className={`form-group ${field.type === 'textarea' ? 'wide' : ''}`}>
                  <span>{field.label}</span>
                  {field.type === 'textarea' ? (
                    <textarea
                      value={form[field.key] ?? ''}
                      rows={3}
                      required
                      onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                    />
                  ) : (
                    <input
                      type={field.type ?? 'text'}
                      min={
                        view === 'ratings' && field.type === 'number'
                          ? '1'
                          : ['quantity', 'targetQty', 'orderedQty', 'revisedQty'].includes(field.key)
                          ? '1'
                          : field.type === 'number'
                            ? '0'
                            : undefined
                      }
                      max={view === 'ratings' && field.type === 'number' ? '5' : undefined}
                      step={field.type === 'number' ? 'any' : undefined}
                      value={form[field.key] ?? ''}
                      required
                      onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                    />
                  )}
                </label>
              ))}
            </div>
            <button type="submit" className="btn btn-primary">Save</button>
          </form>
        </section>
      )}

      {view !== 'bidding' && <section className="panel workflow-panel">
        <div className="workflow-toolbar">
          <div>
            <h2>{view === 'audit' ? 'Recent Activity' : 'Records'}</h2>
            <span className="text-muted">{filteredRecords.length} records</span>
          </div>
          <input
            className="workflow-search"
            aria-label={`Search ${config.title}`}
            placeholder="Search records..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {loading ? (
          <p className="text-muted">Loading records…</p>
        ) : filteredRecords.length === 0 ? (
          <div className="workflow-empty">
            <span className="empty-icon">⌕</span>
            <strong>No records yet</strong>
            <span>{canWrite ? 'Create a record to start this workflow.' : 'Records will appear here when available.'}</span>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>{config.columns.map((column) => <th key={column.key}>{column.label}</th>)}
                  {canWrite && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id}>
                    {config.columns.map((column) => (
                      <td key={column.key} className={column.key === 'id' ? 'mono' : undefined}>
                        {column.key === 'status' || column.key === 'approvalStatus' || column.key === 'complianceStatus' ? (
                          <span className={`status-badge ${recordValue(record, column.key).toLowerCase().replaceAll(' ', '-')}`}>
                            {recordValue(record, column.key) || '—'}
                          </span>
                        ) : recordValue(record, column.key) || '—'}
                      </td>
                    ))}
                    {canWrite && (
                      <td>
                        <div className="action-buttons">
                          {view === 'requisitions' && record.status === 'Pending' && ['admin', 'procurement_head'].includes(user.role) && (
                            <>
                              <button className="btn btn-sm btn-success" onClick={() => void updateStatus(record, 'Approved')}>Approve</button>
                              <button className="btn btn-sm btn-danger" onClick={() => void updateStatus(record, 'Rejected')}>Reject</button>
                            </>
                          )}
                          {view === 'requisitions' && record.status === 'Approved' && !record.purchaseOrderId &&
                            ['admin', 'procurement_head', 'procurement_officer'].includes(user.role) && (
                            <button className="btn btn-sm btn-primary" onClick={() => void issuePurchaseOrder(record)}>
                              Issue PO
                            </button>
                          )}
                          {view === 'amendments' && record.approvalStatus === 'Pending Amendment' && (
                            <button className="btn btn-sm btn-success" onClick={() => void updateStatus(record, 'Approved Amendment')}>Approve</button>
                          )}
                          {view === 'payments' && record.status !== 'Paid' && (
                            <button className="btn btn-sm btn-success" onClick={() => void updateStatus(record, 'Paid')}>Mark Paid</button>
                          )}
                          {view === 'delivery' && record.complianceStatus === 'Pending Inspection' && (
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => void save({ ...record, complianceStatus: 'Completed - Verified' })}
                            >
                              Verify
                            </button>
                          )}
                          {view === 'meetings' && userRole === 'supplier' && record.status === 'Pending Response' && (
                            <>
                              <button className="btn btn-sm btn-success" onClick={() => void updateStatus(record, 'Accepted')}>Accept</button>
                              <button className="btn btn-sm btn-outline" onClick={() => void updateStatus(record, 'Declined')}>Decline</button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}
    </div>
  );
}

function BiddingTabs() {
  const { user } = useAuth();
  const userRole = user ? String(user.role) : '';
  const [tab, setTab] = useState<'stockNeeds' | 'bids' | 'meetings'>('stockNeeds');
  const [records, setRecords] = useState<WorkflowRecord[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void dataService.listWorkflowRecords(tab).then((items) => {
      setRecords(
        user && userRole === 'supplier' && (tab === 'bids' || tab === 'meetings')
          ? items.filter((record) => record.supplierId === user.supplierId)
          : items
      );
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not load workflow data');
    });
  }, [tab, user, userRole]);

  return (
    <section className="panel bidding-panel">
      <div className="workflow-tabs" role="tablist" aria-label="Bidding sections">
        {([
          ['stockNeeds', 'Published Stock Needs'],
          ['bids', 'Supplier Bids'],
          ['meetings', 'Proposal Meetings'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`workflow-tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <div className="error-message">{error}</div>}
      {records.length === 0 ? (
        <div className="workflow-empty compact">
          <strong>No {tab === 'stockNeeds' ? 'published needs' : tab} yet</strong>
          <span>{tab === 'stockNeeds' ? 'Procurement teams can publish stock needs above.' : 'Records will appear as suppliers and teams submit activity.'}</span>
        </div>
      ) : (
        <div className="bidding-record-grid">
          {records.map((record) => (
            <article key={record.id} className="bidding-record">
              <span className="mono">{record.id}</span>
              <strong>{recordValue(record, 'title') || recordValue(record, 'supplierName') || recordValue(record, 'needId')}</strong>
              <span>{recordValue(record, 'techSpecs') || recordValue(record, 'notes') || recordValue(record, 'venue')}</span>
              <div className="bidding-record-meta">
                {recordValue(record, 'budgetCap') && <span>Budget: ₱{Number(record.budgetCap).toLocaleString()}</span>}
                {recordValue(record, 'totalCost') && <span>Offer: ₱{Number(record.totalCost).toLocaleString()}</span>}
                {recordValue(record, 'date') && <span>{recordValue(record, 'date')} {recordValue(record, 'time')}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AccessControl({
  userRole,
  error,
  onError,
}: {
  userRole: string;
  error: string;
  onError: (message: string) => void;
}) {
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void dataService.listWorkflowRecords('accessControl').then((items) => {
      const stored = items.find((item) => item.id === 'rolePermissions');
      if (stored && typeof stored.permissions === 'string') {
        setPermissions(JSON.parse(stored.permissions) as Record<string, string[]>);
      } else {
        setPermissions({
          admin: [...ACCESS_ACTIONS],
          procurement_head: ACCESS_ACTIONS.filter((action) => !['manage_users', 'manage_permissions', 'submit_bids'].includes(action)),
          procurement_officer: ['create_pr', 'issue_po', 'manage_bidding', 'record_delivery', 'rate_supplier'],
          employee: ['create_pr'],
          supplier: ['submit_bids'],
          guest: [],
        });
      }
    }).catch((reason: unknown) => {
      onError(reason instanceof Error ? reason.message : 'Could not load access control');
    }).finally(() => setLoading(false));
  }, [onError]);

  const toggle = (role: string, action: string) => {
    setPermissions((current) => {
      const currentActions = current[role] ?? [];
      const next = currentActions.includes(action)
        ? currentActions.filter((item) => item !== action)
        : [...currentActions, action];
      return { ...current, [role]: next };
    });
  };

  const save = async () => {
    setSaved(false);
    try {
      await dataService.upsertWorkflowRecord('accessControl', {
        id: 'rolePermissions',
        permissions: JSON.stringify(permissions),
        updatedAt: timestampNow(),
      });
      setSaved(true);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Could not save access control');
    }
  };

  if (userRole !== 'admin') return <div className="page"><div className="error-message">Administrator access is required.</div></div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Access Control Matrix</h1>
          <p className="text-muted">Configure procurement permissions for each account role.</p>
        </div>
        <button className="btn btn-primary" onClick={() => void save()} disabled={loading}>Save Permissions</button>
      </header>
      {error && <div className="error-message" role="alert">{error}</div>}
      {saved && <p className="success-message">Permissions saved.</p>}
      <section className="panel table-wrapper">
        <table className="data-table access-table">
          <thead><tr><th>Permission</th>{ACCESS_ROLES.map((role) => <th key={role}>{role.replaceAll('_', ' ')}</th>)}</tr></thead>
          <tbody>
            {ACCESS_ACTIONS.map((action) => (
              <tr key={action}>
                <td>{action.replaceAll('_', ' ')}</td>
                {ACCESS_ROLES.map((role) => (
                  <td key={role}>
                    <input
                      type="checkbox"
                      aria-label={`${action.replaceAll('_', ' ')} for ${role.replaceAll('_', ' ')}`}
                      checked={(permissions[role] ?? []).includes(action)}
                      disabled={role === 'admin' || !ROLE_ACTION_LIMITS[role].includes(action)}
                      onChange={() => toggle(role, action)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
