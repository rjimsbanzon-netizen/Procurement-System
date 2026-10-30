import { DB, ui } from '../store/state';
import { canAccessTab } from '../domain/permissions';
import { navigateTo } from '../core/renderBridge';
import procureflowMark from '../procureflow-mark.png';

const employeeNav = [
  ['dashboard', 'Dashboard', 'fa-chart-pie'],
  ['requisitions', 'Purchase Requisitions', 'fa-file-signature'],
  ['bidding', 'Bidding & Proposals', 'fa-gavel'],
  ['orders', 'Purchase & Job Orders', 'fa-file-invoice-dollar'],
  ['delivery', 'Delivery Monitoring', 'fa-truck-ramp-box'],
  ['amendments', 'Issues & Amendments', 'fa-triangle-exclamation'],
  ['payments', 'Payment Management', 'fa-credit-card'],
  ['suppliers', 'Suppliers Directory', 'fa-building'],
  ['audit', 'Audit Logs', 'fa-clock-rotate-left'],
  ['users', 'User Verification', 'fa-users-gear'],
  ['access_control', 'Access Control Matrix', 'fa-shield-halved']
];
const supplierNav = [
  ['dashboard', 'Supplier Portal', 'fa-chart-pie'],
  ['bidding', 'Stock Needs & Bidding', 'fa-gavel'],
  ['orders', 'Assigned Purchase Orders', 'fa-file-invoice-dollar'],
  ['delivery', 'Deliveries & Shipments', 'fa-truck-ramp-box'],
  ['amendments', 'Order Amendments', 'fa-triangle-exclamation'],
  ['payments', 'Payment Status', 'fa-credit-card']
];

export function Sidebar() {
  const items = (DB.currentUser?.role === 'Supplier' ? supplierNav : employeeNav)
    .filter(([id]) => canAccessTab(id));
  return <aside className="enterprise-sidebar w-64 h-full min-h-0 bg-slate-900 text-slate-300 flex flex-col justify-between shrink-0 overflow-hidden shadow-xl">
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sidebar-brand p-5 flex items-center space-x-3 border-b border-slate-800">
        <div className="sidebar-mark"><img src={procureflowMark} alt="ProcureFlow" className="w-10 h-10 object-contain rounded-md" /></div>
        <div className="sidebar-brand-copy"><div className="font-bold text-white text-base leading-tight">ProcureFlow</div><div className="text-xs text-slate-400">Enterprise System</div></div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-3">
        {items.map(([id, label, icon]) => <button key={id} onClick={() => navigateTo(id)} type="button"
          className={'w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all '+
            (ui.currentTab === id ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30' : 'hover:bg-slate-800 hover:text-white text-slate-400')}>
          <i className={'fa-solid '+icon+' w-5 text-center'} /><span className="sidebar-nav-label">{label}</span>
        </button>)}
      </nav>
    </div>
    <div className="sidebar-foot shrink-0 p-4 border-t border-slate-800 text-xs text-slate-500">
      <div className="flex justify-between items-center mb-2"><span className="sidebar-foot-copy">Storage Sync</span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /></div>
      <button id="reset-db-btn" type="button" className="w-full text-left text-slate-400 hover:text-rose-400 transition-colors flex items-center space-x-1.5"><i className="fa-solid fa-arrow-rotate-left text-xs"/><span className="sidebar-foot-copy">Reset System Database</span></button>
    </div>
  </aside>;
}
