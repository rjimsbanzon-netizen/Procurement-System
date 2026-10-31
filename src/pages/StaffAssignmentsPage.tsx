import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { DB } from '../store/state';
import { financeAPI } from '../services/finance';
import type { FinanceSettings } from '../services/finance';
import { invalidateStaffAssignments, isFinanceDepartment } from '../domain/staffPositions';
import { cloudRequest, mapCloudUser } from '../services/cloud';

type Person = { id:string; name:string; username:string; app_role:string; department:string };
type Duty = 'Department Head' | 'Finance Head' | 'Finance Officer';
type SavedDuty = 'Department Head' | 'Finance Officer';
const same=(a:string,b:string)=>a.trim().toLowerCase()===b.trim().toLowerCase();
const reserved=new Set(['procurement','finance & accounting','finance and accounting','finance','executive']);

function savedDuty(duty:Duty, department:string):{role:SavedDuty;department:string} {
  if(duty==='Finance Officer')return {role:'Finance Officer',department:'*'};
  if(duty==='Finance Head')return {role:'Department Head',department:'Finance & Accounting'};
  return {role:'Department Head',department};
}
function displayDuty(role:string, department:string){
  if(role==='Department Head'&&same(department,'Procurement'))return 'Procurement Head';
  if(role==='Department Head'&&isFinanceDepartment(department))return 'Finance Head';
  return role;
}

export default function StaffAssignmentsPage(){
  const admin=DB.currentUser?.role==='Admin';
  const [settings,setSettings]=useState<FinanceSettings|null>(null);
  const [people,setPeople]=useState<Person[]>([]);
  const [departments,setDepartments]=useState<string[]>([]);
  const [duty,setDuty]=useState<Duty>('Department Head');
  const [department,setDepartment]=useState('');
  const [userId,setUserId]=useState('');
  const [newDepartment,setNewDepartment]=useState('');
  const [transferUser,setTransferUser]=useState('');
  const [transferDepartment,setTransferDepartment]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');

  const reload=useCallback(async()=>{
    if(!admin)return;
    try{
      const [config,staff,catalog,accounts]=await Promise.all([
        financeAPI.settings(),financeAPI.staff(),financeAPI.departments(),cloudRequest('/users')
      ]);
      setSettings(config);
      setPeople(staff.people);
      setDepartments(catalog.departments);
      // Reflect Procurement Head account-role promotion/demotion and employee
      // transfers on User Verification without needing a new login.
      if(Array.isArray(accounts)) DB.users=accounts.map(u=>mapCloudUser(u,DB.suppliers as never[]));
      setError('');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  },[admin]);
  useEffect(()=>{void reload()},[reload]);

  if(!admin)return <div className="rounded-lg border bg-white p-5 text-rose-700">Administrator access required.</div>;
  const assignments=settings?.assignments??[];
  const saved=savedDuty(duty,department);
  const current=assignments.find(a=>a.step_role===saved.role && same(a.department,saved.department));
  const eligible=people.filter(person=>{
    if(duty==='Finance Officer'||duty==='Finance Head'){
      if(person.app_role!=='Employee'||!isFinanceDepartment(person.department))return false;
    }else{
      if(!department||!same(person.department,department))return false;
      if(person.app_role!=='Employee' &&
        !(same(department,'Procurement')&&person.app_role==='Procurement Head'))return false;
    }
    return !assignments.some(a=>a.user_id===person.id&&a.step_role!==saved.role);
  });
  const financeHead=assignments.find(a=>a.step_role==='Department Head'&&isFinanceDepartment(a.department));
  const financeOfficer=assignments.find(a=>a.step_role==='Finance Officer');
  const hasConflict=Boolean(financeHead&&financeOfficer&&financeHead.user_id===financeOfficer.user_id);
  const currentFinanceInvalid=financeOfficer&&!people.some(p=>p.id===financeOfficer.user_id&&p.app_role==='Employee'&&isFinanceDepartment(p.department));
  const mismatchedProcurementHeads=people.filter(p=>p.app_role==='Procurement Head'&&!same(p.department,'Procurement'));

  async function operate(action:()=>Promise<unknown>,success:string){
    setBusy(true);setError('');setMessage('');
    try{
      await action();
      invalidateStaffAssignments();
      await reload();
      setMessage(success);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  function assign(event:FormEvent){
    event.preventDefault();
    if(!userId||(duty==='Department Head'&&!department))return;
    if(!eligible.some(p=>p.id===userId)){
      setError('Choose an active employee who belongs to this department.');return;
    }
    if(current&&current.user_id!==userId&&!window.confirm(
      `Replace ${current.name} as ${displayDuty(saved.role,saved.department)}? The previous Head returns to Employee; their account and historical PRs remain.`
    ))return;
    void operate(async()=>{
      await financeAPI.assign(saved.role,saved.department,userId);
      setUserId('');
    },`Saved ${displayDuty(saved.role,saved.department)} to Cloudflare. Only the new appointed Head has this responsibility.`);
  }
  function remove(role:SavedDuty,dep:string,id:string,name:string){
    if(!window.confirm(`Remove ${name} as ${displayDuty(role,dep)}? Pending approvals may pause until you assign a replacement.`))return;
    void operate(()=>financeAPI.unassign(role,dep,id),`${name} is no longer ${displayDuty(role,dep)}.`);
  }
  function createDepartment(event:FormEvent){
    event.preventDefault();
    const name=newDepartment.trim();
    if(!name)return;
    void operate(async()=>{await financeAPI.addDepartment(name);setNewDepartment('')},`Created department: ${name}. You can now transfer an employee and appoint its Head.`);
  }
  function renameDepartment(name:string){
    const renamed=window.prompt(`Rename ${name} to:`,name)?.trim();
    if(!renamed||renamed===name)return;
    if(!window.confirm(`Rename ${name} to ${renamed}? This changes the department for its staff and current assignments. Existing procurement history is protected.`))return;
    void operate(()=>financeAPI.renameDepartment(name,renamed),`Department renamed to ${renamed}.`);
  }
  function deleteDepartment(name:string){
    if(!window.confirm(`Remove department ${name}? This works only when it has no staff, assigned Head, history or allocated budget.`))return;
    void operate(()=>financeAPI.removeDepartment(name),`Removed unused department ${name}.`);
  }
  function moveEmployee(event:FormEvent){
    event.preventDefault();
    const person=people.find(p=>p.id===transferUser);
    if(!person||!transferDepartment)return;
    if(!window.confirm(`Move ${person.name} from ${person.department} to ${transferDepartment}? Historical PRs stay in their original department.`))return;
    void operate(async()=>{
      await financeAPI.moveEmployee(transferUser,transferDepartment);
      setTransferUser('');setTransferDepartment('');
    },`${person.name} is now assigned to ${transferDepartment}.`);
  }
  function correctProcurementHead(person:Person){
    if(!window.confirm(`Correct ${person.name}'s saved department to Procurement? Historical PRs remain unchanged.`))return;
    void operate(()=>financeAPI.correctProcurementDepartment(person.id),`${person.name}'s home department is now Procurement.`);
  }

  return <section className="mx-auto max-w-6xl space-y-5">
    {error&&<div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
    {message&&<div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}
    {hasConflict&&<div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Finance Head and Finance Officer currently point to the same account. Choose two different Finance employees.</div>}
    {currentFinanceInvalid&&<div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">The current Finance Officer is no longer an eligible Finance &amp; Accounting employee. Reassign them.</div>}
    {mismatchedProcurementHeads.length>0&&<div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
      <h3 className="font-bold text-amber-900">Procurement Head department corrections</h3>
      {mismatchedProcurementHeads.map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{p.name} has department <strong>{p.department}</strong>.</span><button type="button" disabled={busy} onClick={()=>correctProcurementHead(p)} className="rounded-md bg-[#a64f32] px-3 py-2 text-white disabled:opacity-50">Correct to Procurement</button></div>)}
    </div>}

    <form onSubmit={assign} className="rounded-xl border bg-white p-5 space-y-4">
      <h3 className="font-bold">Assign one Head per department</h3>
      <p className="text-sm text-slate-500">Select any registered department, including Procurement. An appointment replaces the previous Head automatically. Procurement Head receives the existing Procurement Head account role; other Heads are recorded as assignments. Finance Head and Finance Officer must be different Finance &amp; Accounting employees.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold">Responsibility
          <select className="mt-1 block w-full rounded-lg border p-2.5 font-normal" value={duty} onChange={e=>{setDuty(e.target.value as Duty);setDepartment('');setUserId('')}}>
            <option value="Department Head">Department Head</option>
            <option value="Finance Officer">Finance Officer</option>
            <option value="Finance Head">Finance Head</option>
          </select>
        </label>
        <label className="text-sm font-semibold">Department
          <select className="mt-1 block w-full rounded-lg border p-2.5 font-normal disabled:bg-slate-100" value={duty==='Department Head'?department:'Finance & Accounting'} onChange={e=>{setDepartment(e.target.value);setUserId('')}} disabled={duty!=='Department Head'} required={duty==='Department Head'}>
            {duty==='Department Head'?<><option value="">Choose a department</option>{departments.map(name=><option key={name} value={name}>{name}</option>)}</>:<option value="Finance & Accounting">Finance &amp; Accounting</option>}
          </select>
          {duty==='Finance Officer'&&<span className="mt-1 block text-xs font-normal text-slate-500">Home department: Finance &amp; Accounting. Approval scope: all departments.</span>}
        </label>
        <label className="text-sm font-semibold">Select employee
          <select className="mt-1 block w-full rounded-lg border p-2.5 font-normal" value={userId} onChange={e=>setUserId(e.target.value)} required>
            <option value="">Choose eligible employee</option>
            {eligible.map(p=><option key={p.id} value={p.id}>{p.name} (@{p.username}) · {p.department}</option>)}
          </select>
        </label>
      </div>
      {eligible.length===0&&<p className="text-sm text-amber-800">{duty==='Department Head'&&!department?'Choose a department first.':'No eligible employee is currently registered under this department. You can transfer an employee below. Heads and Finance Officers must be active and approved.'}</p>}
      {current&&<p className="text-sm text-slate-600">Currently assigned: <strong>{current.name}</strong>. Select a different employee to replace them.</p>}
      <button type="submit" disabled={busy||!userId||(duty==='Department Head'&&!department)} className="rounded-lg bg-[#a64f32] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy?'Saving…':duty==='Finance Officer'?'Save Finance Officer':duty==='Finance Head'?'Save Finance Head':'Save Department Head'}</button>
    </form>

    <section className="rounded-xl border bg-white p-5 space-y-4">
      <div><h3 className="font-bold">Manage departments</h3><p className="text-sm text-slate-500 mt-1">Add departments, rename departments not used in procurement history, or remove an unused department. Procurement, Finance &amp; Accounting, and Executive are reserved department names for system workflows.</p></div>
      <form onSubmit={createDepartment} className="flex flex-wrap gap-2">
        <input aria-label="New department name" className="min-w-56 flex-1 rounded-lg border p-2.5 text-sm" value={newDepartment} onChange={e=>setNewDepartment(e.target.value)} maxLength={80} placeholder="New department name, e.g. Marketing" required />
        <button type="submit" disabled={busy||!newDepartment.trim()} className="rounded-lg bg-[#a64f32] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Add department</button>
      </form>
      <div className="grid gap-2 md:grid-cols-2">
        {departments.map(name=><div key={name} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
          <span className="font-semibold">{name}</span>
          <span className="flex shrink-0 gap-2">
            <button type="button" disabled={busy||reserved.has(name.toLowerCase())} onClick={()=>renameDepartment(name)} className="rounded border px-2.5 py-1.5 text-slate-700 disabled:opacity-40" title={reserved.has(name.toLowerCase())?'Required system department':'Rename'}>Edit</button>
            <button type="button" disabled={busy||reserved.has(name.toLowerCase())} onClick={()=>deleteDepartment(name)} className="rounded border border-rose-200 px-2.5 py-1.5 text-rose-700 disabled:opacity-40" title="Remove only if unused">Remove</button>
          </span>
        </div>)}
      </div>
    </section>

    <form onSubmit={moveEmployee} className="rounded-xl border bg-white p-5 space-y-4">
      <div><h3 className="font-bold">Transfer an employee to another department</h3><p className="mt-1 text-sm text-slate-500">For newly created departments, transfer an active regular employee before appointing their Head. Assigned Heads, Finance reviewers and employees with pending approval requests must be reassigned or completed first.</p></div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold">Employee
          <select className="mt-1 block w-full rounded-lg border p-2.5 font-normal" value={transferUser} onChange={e=>setTransferUser(e.target.value)} required>
            <option value="">Choose employee</option>
            {people.filter(p=>p.app_role==='Employee'&&!assignments.some(a=>a.user_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name} · {p.department}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">New department
          <select className="mt-1 block w-full rounded-lg border p-2.5 font-normal" value={transferDepartment} onChange={e=>setTransferDepartment(e.target.value)} required><option value="">Choose department</option>{departments.map(dep=><option value={dep} key={dep}>{dep}</option>)}</select>
        </label>
      </div>
      <button type="submit" disabled={busy||!transferUser||!transferDepartment} className="rounded-lg bg-[#a64f32] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save employee department</button>
    </form>

    <section className="rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">Current assignments</h3><button type="button" disabled={busy} onClick={()=>{void reload()}} className="rounded-lg border px-3 py-2 text-sm">Refresh</button></div>
      {!settings?<p className="mt-4 text-sm text-slate-500">Loading assignments…</p>:assignments.length===0?<p className="mt-4 text-sm text-slate-500">No assignments yet.</p>:
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-slate-50 text-slate-700"><th className="p-3">Responsibility</th><th className="p-3">Department</th><th className="p-3">Assigned employee</th><th className="p-3">Action</th></tr></thead><tbody>
          {assignments.map(a=><tr key={`${a.step_role}/${a.department}`} className="border-b last:border-0"><td className="p-3 font-semibold">{displayDuty(a.step_role,a.department)}</td><td className="p-3">{a.step_role==='Finance Officer'&&a.department==='*'?<><span>Finance &amp; Accounting</span><span className="block text-xs text-slate-500">Review scope: all departments</span></>:a.department}</td><td className="p-3">{a.name}</td><td className="p-3"><button type="button" disabled={busy} className="rounded border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50" onClick={()=>remove(a.step_role as SavedDuty,a.department,a.user_id,a.name)}>Remove</button></td></tr>)}
        </tbody></table></div>}
    </section>
  </section>;
}
