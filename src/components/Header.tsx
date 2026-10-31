import { NotificationBell } from '../features/notifications/NotificationBell';
import { DB, ui } from '../store/state';
export function Header() {
  const user = DB.currentUser;
  return <header className="enterprise-header bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm z-10">
    <div className="flex items-center space-x-3"><span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Module:</span>
      <h1 className="text-lg font-bold text-slate-800 capitalize">{ui.currentTab.replace('_', ' ')}</h1></div>
    <div className="flex items-center space-x-4">
      <NotificationBell />
      <div className="text-right hidden sm:block"><div className="text-sm font-bold text-slate-800">{user?.name}</div>
        <div className="text-xs text-sky-600 font-semibold">{user?.role} • {user?.department}</div></div>
      <button id="logout-btn" title="Sign Out" type="button" className="p-2 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors">
        <i className="fa-solid fa-right-from-bracket text-lg" /></button>
    </div>
  </header>;
}
