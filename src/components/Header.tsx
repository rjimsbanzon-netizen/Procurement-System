import { useEffect, useState } from 'react';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { loadStaffAssignments, getEffectivePosition, STAFF_ASSIGNMENTS_UPDATED } from '../domain/staffPositions';
import type { StaffAssignment } from '../domain/staffPositions';
import { DB, ui } from '../store/state';
export function Header() {
  const user = DB.currentUser;
  const [assignments,setAssignments]=useState<StaffAssignment[]>([]);
  const accountId=user?.id??'';
  const accountRole=user?.role??'';
  useEffect(()=>{
    if(!accountId || accountRole==='Supplier') {setAssignments([]);return;}
    let alive=true;
    let lastRequest=0;
    const refresh=(force=false)=>{
      const requestNumber=++lastRequest;
      void loadStaffAssignments(accountId,force).then(data=>{
        // Ignore older responses and responses for a previous login.
        if(alive && requestNumber===lastRequest)setAssignments(data);
      }).catch(error=>{
        console.warn('Could not refresh the displayed staff position:',error);
      });
    };
    refresh();
    const onAssignmentChanged=()=>refresh(true);
    window.addEventListener(STAFF_ASSIGNMENTS_UPDATED,onAssignmentChanged);
    const timer=window.setInterval(()=>refresh(true),30_000);
    return ()=>{
      alive=false;
      window.clearInterval(timer);
      window.removeEventListener(STAFF_ASSIGNMENTS_UPDATED,onAssignmentChanged);
    };
  },[accountId,accountRole]);
  const position = user ? getEffectivePosition(user, assignments) : null;
  const displayName = user?.role === 'Admin' ? 'Admin' : user?.name;
  const positionLabel = user?.role === 'Admin' ? 'Executive' : position
    ? ['Head','Finance Officer'].includes(position.name)
      ? `${position.name} • ${position.department}`
      : position.label
    : '';
  return <header className="enterprise-header bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm z-10">
    <div className="flex items-center space-x-3"><span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Module:</span>
      <h1 className="text-lg font-bold text-slate-800 capitalize">{ui.currentTab.replace('_', ' ')}</h1></div>
    <div className="flex items-center space-x-4">
      <NotificationBell />
      <div className="text-right hidden sm:block"><div className="text-sm font-bold text-slate-800">{displayName}</div>
        <div className="text-xs text-sky-600 font-semibold">{positionLabel}</div></div>
      <button id="logout-btn" title="Sign Out" type="button" className="p-2 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors">
        <i className="fa-solid fa-right-from-bracket text-lg" /></button>
    </div>
  </header>;
}
