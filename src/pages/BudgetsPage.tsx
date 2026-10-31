import {useCallback,useEffect,useState} from 'react';
import {financeAPI} from '../services/finance';
import type {BudgetRow} from '../services/finance';
import {DB} from '../store/state';
import {navigateTo} from '../core/renderBridge';
const peso=(n:number)=>`₱${n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export default function BudgetsPage(){
  const [rows,setRows]=useState<BudgetRow[]>([]);
  const [department,setDepartment]=useState(''),[allocation,setAllocation]=useState('');
  const [financeFrom,setFinanceFrom]=useState('0'),[financeHeadFrom,setFinanceHeadFrom]=useState('1000000'),[adminFrom,setAdminFrom]=useState('0');
  const [error,setError]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
  const admin=DB.currentUser?.role==='Admin';
  const refresh=useCallback(async()=>{
    try {
      const [budget,config]=await Promise.all([financeAPI.budgets(),financeAPI.settings()]);
      setRows(budget.budgets);setFinanceFrom(String(config.financeFrom));setFinanceHeadFrom(String(config.financeHeadFrom));setAdminFrom(String(config.adminFrom));setError('');
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  },[admin]);
  useEffect(()=>{void refresh()},[refresh]);
  const departments=[...new Set([...rows.map(b=>b.department),...DB.requisitions.map(r=>String(r.department||''))].filter(Boolean))].sort();
  async function save(work:()=>Promise<unknown>,message:string){setBusy(true);setError('');setNote('');try{await work();setNote(message);await refresh();}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  return <section className="max-w-6xl mx-auto space-y-5">
    <div className="rounded-xl bg-white border p-5 flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-bold text-xl">Department Budget Management</h2><p className="text-sm text-slate-500 mt-1">Committed: approved requisitions or unpaid orders. Spent: paid orders. Remaining: allocation minus both.</p></div>{admin&&<button type="button" onClick={()=>navigateTo('staff_assignments')} className="rounded-lg border px-4 py-2 text-sm font-semibold text-[#a64f32]">Manage staff assignments</button>}</div>
    {error&&<p role="alert" className="p-3 border border-rose-200 bg-rose-50 rounded-lg text-rose-700 text-sm">{error}</p>}{note&&<p role="status" className="p-3 border border-emerald-200 bg-emerald-50 rounded-lg text-emerald-700 text-sm">{note}</p>}
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{rows.map(b=><article key={b.department} className="bg-white border rounded-xl p-5 space-y-3"><h3 className="font-semibold text-slate-900">{b.department}</h3>{!b.configured&&<p className="text-xs text-amber-700">No allocation configured</p>}<div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-slate-500 text-xs">Allocated</p><strong>{peso(b.allocated)}</strong></div><div><p className="text-slate-500 text-xs">Committed</p><strong>{peso(b.committed)}</strong></div><div><p className="text-slate-500 text-xs">Spent</p><strong>{peso(b.spent)}</strong></div><div><p className="text-slate-500 text-xs">Remaining</p><strong className={b.remaining<0?'text-rose-700':'text-emerald-700'}>{peso(b.remaining)}</strong></div></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#aa5638]" style={{width:`${b.allocated?Math.min(100,(b.spent+b.committed)/b.allocated*100):0}%`}}/></div></article>)}</div>
    {admin&&<div className="grid lg:grid-cols-2 gap-5">
      <form onSubmit={e=>{e.preventDefault();void save(()=>financeAPI.saveBudget(department,Number(allocation)),`Budget updated for ${department}.`)}} className="bg-white border rounded-xl p-5 space-y-3"><h3 className="font-bold">Set department allocation</h3><label className="block text-sm">Department<input list="budget-departments" value={department} onChange={e=>setDepartment(e.target.value)} required placeholder="e.g. IT Systems" className="mt-1 w-full border rounded-lg p-2"/><datalist id="budget-departments">{departments.map(d=><option key={d} value={d}/>)}</datalist></label><label className="block text-sm">Allocated amount (PHP)<input type="number" min="0" step="0.01" required value={allocation} onChange={e=>setAllocation(e.target.value)} className="mt-1 w-full border rounded-lg p-2"/></label><button disabled={busy} className="bg-[#aa5638] text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">Save allocation</button></form>
      <form onSubmit={e=>{e.preventDefault();void save(()=>financeAPI.saveSettings(Number(financeFrom),Number(financeHeadFrom),Number(adminFrom)),'Approval thresholds saved.')}} className="bg-white border rounded-xl p-5 space-y-3"><h3 className="font-bold">Approval rules</h3><p className="text-xs text-slate-500">Department Head submits; Procurement Head approves. Finance Officer reviews amounts above the Finance threshold. An independent Finance Head must then authorize high-value PRs before Admin. Enter 0 to always require the relevant approval; a Finance Head threshold must be at least the Finance Officer threshold.</p><label className="block text-sm">Require Finance approval from (PHP)<input type="number" min="0" step="0.01" value={financeFrom} onChange={e=>setFinanceFrom(e.target.value)} className="mt-1 w-full border rounded-lg p-2" required/></label><label className="block text-sm">Require Finance Head approval from (PHP)<input type="number" min="0" step="0.01" value={financeHeadFrom} onChange={e=>setFinanceHeadFrom(e.target.value)} className="mt-1 w-full border rounded-lg p-2" required/></label><label className="block text-sm">Require Admin approval from (PHP)<input type="number" min="0" step="0.01" value={adminFrom} onChange={e=>setAdminFrom(e.target.value)} className="mt-1 w-full border rounded-lg p-2" required/></label><button disabled={busy} className="bg-[#aa5638] text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">Save rules</button></form>

    </div>}
  </section>;
}
