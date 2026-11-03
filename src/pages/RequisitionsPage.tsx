import { formatQuantity } from '../domain/measurementUnits';
import { ownsRequisition } from '../domain/ownerIdentity';
import { useCurrentUser, useRequisitions } from '../hooks/useProcurementData';
import { useState } from 'react';
import { ui } from '../store/state';
import { renderApp, navigateTo, openTracking } from '../core/renderBridge';
import { canManageBidding, hasPermission } from '../domain/permissions';
import { getAvailableRequisitions } from '../domain/procurement';
import { approvePR, rejectPR } from '../actions/requisitionActions';
import { openCreateStockNeedModal } from '../actions/biddingActions';
import { CLOUD_API_BASE } from '../services/cloud';
import { EmptyState } from '../components/FeedbackState';
import { ScreenPanel, StatusPill, fieldClass, mainButton, peso, secondaryButton } from '../components/CoreScreenUI';

/** Real React list/search/actions, not an HTML string injected into the page. */
export default function RequisitionsPage() {
  const [query, setQuery] = useState(ui.searchQuery || '');
  const [status, setStatus] = useState('All');
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const user = useCurrentUser();
  const all = useRequisitions();
  const details = all.find(r => r.id === detailsId);
  const available = new Set(getAvailableRequisitions().map(pr => pr.id));
  const search = query.trim().toLowerCase();
  const reqs = all.filter(r => (status === 'All' || r.status === status) &&
    (!search || [r.id, r.department, r.itemTitle, r.specs, r.status, r.requestedBy].some(value => String(value || '').toLowerCase().includes(search))));
  const statuses = [...new Set(all.map(r => String(r.status)))].sort();
  const openCreate = () => { ui.currentModal = 'create_pr'; renderApp(); };
  const canEditLocal = (r: typeof all[number]) => !CLOUD_API_BASE && r.status === 'Pending' &&
    ownsRequisition(r,user);
  const edit = (id: string) => { ui.selectedRecord = id; ui.currentModal = 'edit_pr'; renderApp(); };
  const actionButtons = (r: typeof all[number]) => <>
    {r.status === 'Pending' && (CLOUD_API_BASE
      ? <button type="button" className={secondaryButton} onClick={() => navigateTo('approvals')}>View Approvals</button>
      : hasPermission('approve_pr') && <><button type="button" className={secondaryButton} onClick={() => approvePR(r.id)}>Approve</button><button type="button" className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700" onClick={() => rejectPR(r.id)}>Reject</button></>)}
    {r.status === 'Approved' && canManageBidding() && available.has(r.id) && <button type="button" className={mainButton} onClick={() => openCreateStockNeedModal(r.id)}>Publish Need</button>}
    {canEditLocal(r) && <button type="button" className={secondaryButton} onClick={() => edit(r.id)}>Edit</button>}
    <button type="button" className={secondaryButton} onClick={() => openTracking(r.id)}><i className="fa-solid fa-route" aria-hidden="true"/> Track</button>
    <button type="button" className={secondaryButton} title="View requisition details" aria-label={`View ${r.id} details`} onClick={() => setDetailsId(r.id)}><i className="fa-solid fa-eye" aria-hidden="true"/> Details</button>
  </>;
  return <div className="space-y-4 pb-6">
    <div className="flex flex-col flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
      <div><h2 className="text-lg font-bold text-slate-900">Purchase Requisitions</h2><p className="text-xs text-slate-500">{reqs.length} of {all.length} requests shown</p></div>
      {hasPermission('create_pr') && <button type="button" className={mainButton} onClick={openCreate}><i aria-hidden="true" className="fa-solid fa-plus"/>Create Purchase Requisition</button>}
    </div>
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_200px]">
      <label className="min-w-0 text-sm font-semibold text-slate-700">Search requests<input type="search" className={`${fieldClass} mt-1`} value={query} onChange={event => { setQuery(event.target.value); ui.searchQuery = event.target.value; }} placeholder="PR number, item, department…"/></label>
      <label className="text-sm font-semibold text-slate-700">Status<select className={`${fieldClass} mt-1`} value={status} onChange={event => setStatus(event.target.value)}><option value="All">All statuses</option>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
    </div>
    <ScreenPanel heading="Requisition register" description="Track the request, review its approval status, or publish an approved procurement need.">
      {reqs.length === 0 ? <EmptyState icon="fa-file-signature" title={all.length ? 'No matching requisitions' : 'No purchase requisitions yet'} description={all.length ? 'Try another reference, department or status.' : 'Create a requisition to begin procurement.'} action={hasPermission('create_pr') && !all.length ? <button type="button" className={mainButton} onClick={openCreate}>Create requisition</button> : undefined}/>
        : <>
          {/* A card list on narrow screens avoids forcing the entire PR register into a 920px scroll area. */}
          <div className="grid gap-3 md:hidden">
            {reqs.map(r => <article key={r.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="break-all text-xs font-extrabold text-[#a64f32]">{r.id}</div>
                  <h3 className="mt-1 break-words text-sm font-bold text-slate-900">{r.itemTitle}</h3>
                  <div className="mt-2 text-xs text-slate-500">{r.department}</div>
                </div>
                <div className="shrink-0"><StatusPill status={r.status}/></div>
              </div>
              <p className="mt-3 line-clamp-3 break-words text-xs text-slate-600">{r.specs || 'No specifications provided.'}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-[#f8f6f1] p-3 text-xs">
                <div className="min-w-0"><dt className="text-slate-500">Quantity</dt><dd className="mt-1 break-words font-semibold text-slate-900">{formatQuantity(r.quantity, r.unit)}</dd></div>
                <div className="min-w-0"><dt className="text-slate-500">Needed by</dt><dd className="mt-1 break-words font-semibold text-slate-900">{r.targetDate || '—'}</dd></div>
                <div className="col-span-2 min-w-0"><dt className="text-slate-500">Estimated cost</dt><dd className="mt-1 break-words font-bold text-slate-900">{peso(r.totalCost)}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">{actionButtons(r)}</div>
            </article>)}
          </div>
          <div className="hidden min-w-0 overflow-x-auto md:block" tabIndex={0} role="region" aria-label="Scrollable purchase requisitions table">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-slate-600"><tr>{['PR Number', 'Department', 'Item & Specifications', 'Target Needed', 'Estimated Cost', 'Status', 'Actions'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">{reqs.map(r => <tr key={r.id} className="hover:bg-slate-50/80">
                <td className="p-3 font-bold text-[#a64f32]">{r.id}</td>
                <td className="p-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold">{r.department}</span></td>
                <td className="max-w-[320px] p-3"><strong className="text-slate-900">{r.itemTitle}</strong><p className="mt-1 truncate text-xs text-slate-500" title={String(r.specs || '')}>{r.specs}</p><div className="mt-1 text-xs text-slate-400">Qty: {formatQuantity(r.quantity, r.unit)} · Unit price: {peso(r.unitPrice)}</div></td>
                <td className="whitespace-nowrap p-3">{r.targetDate || '—'}</td>
                <td className="whitespace-nowrap p-3 font-semibold">{peso(r.totalCost)}</td>
                <td className="p-3"><StatusPill status={r.status}/></td>
                <td className="p-3"><div className="flex flex-wrap gap-1.5">{actionButtons(r)}</div></td>
              </tr>)}</tbody>
            </table>
          </div>
        </>}
    </ScreenPanel>
    {details && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setDetailsId(null); }}><section role="dialog" aria-modal="true" aria-label={`Requisition ${details.id} details`} className="w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6"><header className="mb-4 flex items-start justify-between gap-3 border-b pb-3"><div><p className="text-xs font-bold uppercase text-[#a64f32]">Purchase Requisition · {details.id}</p><h3 className="mt-1 text-lg font-bold text-slate-900">{details.itemTitle}</h3></div><button type="button" className={secondaryButton} onClick={() => setDetailsId(null)} aria-label="Close requisition details"><i className="fa-solid fa-xmark"/></button></header><div className="grid gap-3 text-sm sm:grid-cols-2">{[['Department',details.department],['Requested by',details.requestedBy || '—'],['Quantity',formatQuantity(details.quantity, details.unit)],['Unit price',peso(details.unitPrice)],['Estimated total',peso(details.totalCost)],['Needed by',details.targetDate || '—'],['Created',details.createdAt || '—']].map(([label, value]) => <div key={label}><div className="text-xs font-semibold text-slate-500">{label}</div><div className="mt-1 break-words font-medium text-slate-900">{value}</div></div>)}<div className="sm:col-span-2"><div className="text-xs font-semibold text-slate-500">Specifications & requirements</div><p className="mt-1 whitespace-pre-wrap break-words">{details.specs}</p></div><div className="sm:col-span-2"><div className="text-xs font-semibold text-slate-500">Justification</div><p className="mt-1 whitespace-pre-wrap break-words">{details.remarks || '—'}</p></div><div className="sm:col-span-2"><StatusPill status={details.status}/></div></div><footer className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4"><button type="button" className={secondaryButton} onClick={() => { setDetailsId(null); openTracking(details.id); }}>Track</button><button type="button" className={mainButton} onClick={() => setDetailsId(null)}>Close</button></footer></section></div>}
    {CLOUD_API_BASE && <p className="text-xs text-slate-500">Submitted requisitions are protected by the multi-step cloud approval process. Editing an active cloud requisition is disabled until a secured change-request workflow is available.</p>}
  </div>;
}
