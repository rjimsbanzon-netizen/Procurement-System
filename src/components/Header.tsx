import { useEffect, useState } from 'react';
import procureflowMark from '../procureflow-mark.png';
import { NotificationBell } from '../features/notifications/NotificationBell';
import {PwaSupport} from './PwaSupport';
import { loadStaffAssignments, getEffectivePosition } from '../domain/staffPositions';
import type { StaffAssignment } from '../domain/staffPositions';
import { DB, ui } from '../store/state';
import { getCurrentPermissionRole } from '../domain/permissions';
import { renderApp } from '../core/renderBridge';
const MODULE_TITLES: Record<string, string> = {
  bidding: 'Stock Needs & Bidding',
  bidding_deadlines: 'Bidding Deadlines',
  bid_comparison: 'Submitted Vendor Bids & Comparison',
  bid_evaluation: 'Supplier Bid Evaluation',
  proposal_meetings: 'Proposal Meetings',
  global_search: 'Global Search & Filters',
  approval_delegation: 'Approval Delegation',
  contracts: 'Contract Management',
  supplier_analytics: 'Supplier Performance Analytics',
};

export function Header({ onOpenMenu, isMenuOpen }: { onOpenMenu: () => void; isMenuOpen: boolean }) {
  const user = DB.currentUser;
  const [assignments,setAssignments]=useState<StaffAssignment[]>([]);
  const accountId=user?.id??'';
  const accountRole=user?.role??'';
  useEffect(()=>{
    if (!accountId || accountRole==='Supplier') return;
    let alive=true;
    const refresh=()=>{
      const previous=getCurrentPermissionRole();
      void loadStaffAssignments(accountId).then(data=>{
        if(!alive)return;
        setAssignments(data);
        // Recompute navigation and permissions after D1 staff responsibility changes.
        if(getCurrentPermissionRole()!==previous)renderApp();
      }).catch(()=>{/* Keep the last verified position when temporarily offline. */});
    };
    refresh();
    const timer=setInterval(refresh,30_000);
    return ()=>{alive=false;clearInterval(timer);};
  },[accountId,accountRole]);
  const position = user ? getEffectivePosition(user, assignments) : null;
  const positionLabel = user?.role==='Admin' ? 'Executive' : position ? (['Head','Finance Head','Finance Officer'].includes(position.name) ? `${position.name} • ${position.department}` : position.label) : '';
  return <header className="enterprise-header pf-app-header bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm z-10">
    <div className="pf-header-leading flex min-w-0 items-center gap-3">
      <button type="button" className="pf-menu-toggle" onClick={onOpenMenu} aria-label="Open navigation menu" aria-controls="procureflow-sidebar" aria-expanded={isMenuOpen} aria-haspopup="dialog">
        <i className="fa-solid fa-bars" aria-hidden="true" />
      </button>
      <img src={procureflowMark} alt="" aria-hidden="true" className="pf-header-mark" />
      <div className="pf-header-module min-w-0"><span className="pf-module-label text-sm font-semibold text-slate-500 uppercase tracking-wider">Module:</span>
        <h1 className="pf-module-title text-lg font-bold text-slate-800 capitalize">{MODULE_TITLES[ui.currentTab] || ui.currentTab.replace(/_/g, ' ')}</h1>
      </div>
    </div>
    <div className="pf-header-tools flex items-center gap-3">
      <PwaSupport />
      <NotificationBell />
      <div className="text-right hidden sm:block"><div className="text-sm font-bold text-slate-800">{user?.role==='Admin'?'Admin':user?.name}</div>
        <div className="text-xs text-sky-600 font-semibold">{positionLabel}</div></div>
      <button id="logout-btn" title="Sign Out" type="button" className="p-2 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors">
        <i className="fa-solid fa-right-from-bracket text-lg" /></button>
    </div>
  </header>;
}
