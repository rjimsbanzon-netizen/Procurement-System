import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import {CLOUD_API_BASE} from '../services/cloud';
import {DB} from '../store/state';
import {contractsAPI,type Contract,type Renewal} from '../services/contracts';
import {confirmAction,requestInput} from '../services/actionDialogs';

const php=(n:number)=>`₱${n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const PH_today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
type ContractForm={reference:string;title:string;supplierId:string;poId:string;startsOn:string;endsOn:string;price:string;pricingTerms:string;renewalNoticeDays:string;notes:string};
const initial=():ContractForm=>({reference:'',title:'',supplierId:'',poId:'',startsOn:PH_today(),endsOn:'',price:'',pricingTerms:'',renewalNoticeDays:'30',notes:''});
function statusTag(status:string){return status==='Active'?'bg-emerald-100 text-emerald-800':status==='Expired'?'bg-rose-100 text-rose-700':status==='Terminated'?'bg-slate-200 text-slate-700':'bg-sky-100 text-sky-800'}
export default function ContractsPage(){
 const [records,setRecords]=useState<Contract[]>([]),[loaded,setLoaded]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [filter,setFilter]=useState('All'),[search,setSearch]=useState('');
 const [mode,setMode]=useState<'none'|'new'|'edit'|'renew'|'history'>('none');
 const [selected,setSelected]=useState<Contract|null>(null),[form,setForm]=useState<ContractForm>(initial());
 const [renewEnd,setRenewEnd]=useState(''),[renewPrice,setRenewPrice]=useState(''),[renewReason,setRenewReason]=useState('');
 const [history,setHistory]=useState<Renewal[]>([]);
 const me=DB.currentUser;
 const manager=me?.role==='Admin'||me?.role==='Procurement Head';
 const suppliers=DB.suppliers.filter(s=>s?.id && s?.name);
 const refresh=useCallback(async()=>{const data=await contractsAPI.list();setRecords(data.contracts);setLoaded(true);},[]);
 useEffect(()=>{if(!CLOUD_API_BASE){setLoaded(true);return;}void refresh().catch(e=>{setError(e instanceof Error?e.message:String(e));setLoaded(true)})},[refresh]);
 const alerts=records.filter(r=>r.status!=='Terminated'&&r.daysUntilExpiry<=r.renewal_notice_days);
 const shown=useMemo(()=>records.filter(r=>(filter==='All'||r.status===filter||filter==='Expiring'&&r.status!=='Terminated'&&r.daysUntilExpiry<=r.renewal_notice_days)&&
    [r.reference,r.title,r.supplier_name,r.po_id,r.status].some(t=>String(t??'').toLowerCase().includes(search.toLowerCase()))),[records,filter,search]);
 const close=()=>{setMode('none');setSelected(null);setHistory([])};
 const modify=(key:keyof ContractForm,value:string)=>setForm(prev=>({...prev,[key]:value}));
 const create=()=>{setForm(initial());setSelected(null);setMode('new');setError('');};
 const edit=(r:Contract)=>{setSelected(r);setForm({reference:r.reference,title:r.title,supplierId:r.supplier_id,poId:r.po_id??'',startsOn:r.starts_on,endsOn:r.ends_on,price:String(r.price),pricingTerms:r.pricing_terms,renewalNoticeDays:String(r.renewal_notice_days),notes:r.notes});setMode('edit');setError('')};
 const renew=(r:Contract)=>{setSelected(r);setRenewEnd('');setRenewPrice(String(r.price));setRenewReason('');setMode('renew');setError('')};
 async function loadHistory(r:Contract){setSelected(r);setError('');setBusy(true);
  try{const result=await contractsAPI.renewals(r.id);setHistory(result.renewals);setMode('history')}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   const payload={reference:form.reference.trim(),title:form.title.trim(),supplierId:form.supplierId,poId:form.poId.trim(),startsOn:form.startsOn,endsOn:form.endsOn,price:Number(form.price),pricingTerms:form.pricingTerms,renewalNoticeDays:Number(form.renewalNoticeDays),notes:form.notes};
   if(mode==='new')await contractsAPI.create(payload);
   else if(mode==='edit'&&selected)await contractsAPI.update(selected.id,payload);
   else return;
   close();await refresh();setNotice('Contract saved successfully to the cloud database.');
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 async function renewSubmit(e:FormEvent){e.preventDefault();if(!selected)return;setBusy(true);setError('');setNotice('');
  try{await contractsAPI.renew(selected.id,{newEndsOn:renewEnd,price:Number(renewPrice),reason:renewReason.trim()});
   close();await refresh();setNotice('Contract renewed. Previous dates and negotiated prices are in renewal history.');}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 async function terminate(r:Contract){
  const reason=await requestInput({title:'Terminate Contract',message:`Terminate ${r.reference}? This is a final action.`,label:'Termination reason',required:true,multiline:true,tone:'danger',confirmText:'Review termination'});
  if(!reason)return;
  if(!await confirmAction({title:'Confirm Contract Termination',message:`Permanently mark contract ${r.reference} as terminated? Procurement history will remain visible.`,tone:'danger',confirmText:'Terminate contract'}))return;
  setBusy(true);setError('');setNotice('');try{await contractsAPI.terminate(r.id,reason);await refresh();setNotice('Contract terminated and retained in the register.');}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 return <section className="max-w-7xl mx-auto space-y-5">
  <header className="bg-white border rounded-xl p-5 flex justify-between flex-wrap gap-3 items-center"><div><h2 className="text-xl font-bold text-slate-900">Contract Management</h2><p className="text-sm text-slate-500 mt-1">Monitor supplier agreements, validity, negotiated prices, renewal history and expiration warnings.</p></div><div className="flex gap-2"><button onClick={()=>void refresh().catch(e=>setError(String(e)))} className="rounded-lg px-4 py-2 border text-sm font-semibold">Refresh</button>{manager&&<button onClick={create} className="bg-[#ae5837] text-white rounded-lg px-4 py-2 text-sm font-semibold"><i className="fa-solid fa-plus mr-2"/>New Contract</button>}</div></header>
  {!CLOUD_API_BASE&&<p className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-lg text-sm">Contract management requires Cloudflare D1. Apply migration 0013 before using it.</p>}
  {error&&<p role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-lg text-sm">{error}</p>}
  {notice&&<p role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-lg text-sm">{notice}</p>}
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[
   ['Contracts',records.length,'fa-file-contract'],['Active',records.filter(c=>c.status==='Active').length,'fa-circle-check'],['Expiring / expired',alerts.length,'fa-bell'],['Terminated',records.filter(c=>c.status==='Terminated').length,'fa-circle-xmark']
  ].map(([label,val,icon])=><div key={label} className="border rounded-xl bg-white p-4"><p className="text-xs uppercase tracking-wide text-slate-500"><i className={`fa-solid ${icon} mr-2 text-[#ae5837]`}/>{label}</p><p className="font-bold text-2xl mt-2 text-slate-900">{val}</p></div>)}</div>
  {alerts.length>0&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-bold text-amber-900"><i className="fa-solid fa-triangle-exclamation mr-2"/>Contract renewal / expiration alerts</h3><p className="text-xs mt-1 mb-3 text-amber-800">Alerts are triggered when an active contract is within its configured notice period or has expired.</p><div className="space-y-2">{alerts.map(c=><div key={c.id} className="flex justify-between gap-3 flex-wrap text-sm text-amber-900"><span><strong>{c.reference}</strong> · {c.supplier_name}</span><span>{c.status==='Expired'?`Expired ${c.ends_on}`:`Expires ${c.ends_on} (${c.daysUntilExpiry} days)`}</span></div>)}</div></div>}
  <div className="bg-white border rounded-xl overflow-hidden"><div className="p-4 border-b flex flex-wrap gap-3"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search contract, supplier, PO…" className="border rounded-lg p-2.5 text-sm flex-1 min-w-56" aria-label="Search contracts"/><select value={filter} onChange={e=>setFilter(e.target.value)} className="border p-2.5 rounded-lg text-sm">{['All','Active','Upcoming','Expired','Expiring','Terminated'].map(s=><option key={s}>{s}</option>)}</select></div>
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{['Reference / Agreement','Supplier','PO','Validity','Negotiated price','Status / notice','Actions'].map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{shown.map(c=><tr className="border-t align-top" key={c.id}><td className="p-3"><strong className="text-[#a64f32]">{c.reference}</strong><p className="text-slate-700 mt-1">{c.title}</p></td><td className="p-3">{c.supplier_name}</td><td className="p-3">{c.po_id||'—'}</td><td className="p-3 whitespace-nowrap">{c.starts_on}<p className="text-slate-500">to {c.ends_on}</p></td><td className="p-3 whitespace-nowrap">{php(c.price)}<p className="text-xs text-slate-500">{c.pricing_terms||'Price per agreement'}</p></td><td className="p-3"><span className={'inline-block rounded-full px-2 py-1 text-xs font-bold '+statusTag(c.status)}>{c.status}</span>{c.status!=='Terminated'&&c.daysUntilExpiry<=c.renewal_notice_days&&<p className="text-amber-700 text-xs mt-1">{c.status==='Expired'?'Past expiry':'Renewal notice'}</p>}</td><td className="p-3"><div className="flex flex-wrap gap-2">{manager&&c.status!=='Terminated'&&<><button disabled={busy} onClick={()=>edit(c)} className="text-slate-700 hover:underline font-semibold">Edit</button><button disabled={busy} onClick={()=>renew(c)} className="text-emerald-700 hover:underline font-semibold">Renew</button><button disabled={busy} onClick={()=>void terminate(c)} className="text-rose-700 hover:underline font-semibold">Terminate</button></>}{manager&&<button disabled={busy} onClick={()=>void loadHistory(c)} className="text-[#a64f32] hover:underline font-semibold">History</button>}</div></td></tr>)}</tbody></table>{loaded&&shown.length===0&&<p className="p-8 text-sm text-slate-500 text-center">No contracts match the current filters.</p>}{!loaded&&<p className="p-6 text-sm text-slate-500">Loading cloud contracts…</p>}</div>
  </div>
  {mode!=='none'&&<div role="presentation" className="fixed inset-0 z-[85] bg-slate-950/60 backdrop-blur-sm p-4 flex items-center justify-center"><section role="dialog" aria-modal="true" aria-label={mode==='new'?'New contract':mode==='edit'?'Edit contract':mode==='renew'?'Renew contract':'Renewal history'} className="bg-white rounded-2xl max-h-[90vh] overflow-y-auto w-full max-w-2xl shadow-2xl p-6 space-y-4">
    <div className="flex justify-between items-start gap-3"><div><h3 className="font-bold text-lg text-slate-900">{mode==='new'?'New supplier contract':mode==='edit'?'Edit contract':mode==='renew'?`Renew ${selected?.reference}`:`Renewal history · ${selected?.reference}`}</h3><p className="text-xs text-slate-500">{mode==='renew'?'Renewals keep the previous expiration and pricing history.':'Changes are saved to the shared cloud database.'}</p></div><button type="button" onClick={close} className="text-slate-500 hover:text-slate-900" aria-label="Close"><i className="fa-solid fa-xmark"/></button></div>
    {(mode==='new'||mode==='edit')&&<form className="space-y-4" onSubmit={save}><div className="grid sm:grid-cols-2 gap-3">
     <label className="text-xs font-semibold uppercase text-slate-600">Contract reference<input required disabled={mode==='edit'} value={form.reference} onChange={e=>modify('reference',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal" placeholder="CTR-2026-001" maxLength={60}/></label>
     <label className="text-xs font-semibold uppercase text-slate-600">Title<input required value={form.title} onChange={e=>modify('title',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal" placeholder="Office IT supply agreement" maxLength={180}/></label>
     <label className="text-xs font-semibold uppercase text-slate-600">Supplier<select required disabled={mode==='edit'} value={form.supplierId} onChange={e=>modify('supplierId',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal"><option value="">Choose registered supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
     <label className="text-xs font-semibold uppercase text-slate-600">Linked PO (optional)<select disabled={mode==='edit'} value={form.poId} onChange={e=>modify('poId',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal"><option value="">Not linked to a PO</option>{DB.orders.filter(o=>!form.supplierId||o.supplierId===form.supplierId).map(o=><option key={o.id} value={o.id}>{o.id} · {o.itemTitle}</option>)}</select></label>
     <label className="text-xs font-semibold uppercase text-slate-600">Start date<input required disabled={mode==='edit'} type="date" value={form.startsOn} onChange={e=>modify('startsOn',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal" /></label>
     <label className="text-xs font-semibold uppercase text-slate-600">Expiration date<input required disabled={mode==='edit'} type="date" min={form.startsOn} value={form.endsOn} onChange={e=>modify('endsOn',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal" /></label>
     <label className="text-xs font-semibold uppercase text-slate-600">Negotiated unit price (PHP)<input required type="number" min="0" step="0.01" value={form.price} onChange={e=>modify('price',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal" /></label>
     <label className="text-xs font-semibold uppercase text-slate-600">Renewal alert (days)<input required type="number" min="1" max="365" step="1" value={form.renewalNoticeDays} onChange={e=>modify('renewalNoticeDays',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal" /></label>
    </div><label className="text-xs font-semibold uppercase text-slate-600 block">Pricing terms<textarea value={form.pricingTerms} onChange={e=>modify('pricingTerms',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal" rows={2} maxLength={1500} placeholder="Per item, fixed rate, discount schedule, etc." /></label>
    <label className="text-xs font-semibold uppercase text-slate-600 block">Notes<textarea value={form.notes} onChange={e=>modify('notes',e.target.value)} className="mt-1 block border rounded-lg p-2.5 w-full text-sm font-normal" rows={2} maxLength={2000}/></label>
    {mode==='edit'&&<p className="text-xs text-amber-700">Supplier, reference, and term dates cannot be changed here. Use Renew to extend expiration and keep a dated history.</p>}
    <div className="flex justify-end gap-2 border-t pt-4"><button type="button" className="rounded-lg border px-4 py-2" onClick={close}>Cancel</button><button type="submit" disabled={busy} className="rounded-lg bg-[#a64f32] text-white px-4 py-2 font-semibold disabled:opacity-50">{busy?'Saving…':'Save contract'}</button></div>
    </form>}
    {mode==='renew'&&<form onSubmit={renewSubmit} className="space-y-4"><p className="text-sm text-slate-600">Current expiration: <strong>{selected?.ends_on}</strong>. Current negotiated price: <strong>{php(selected?.price??0)}</strong>.</p><label className="text-sm block font-semibold">New expiration<input required type="date" min={selected?.ends_on} value={renewEnd} onChange={e=>setRenewEnd(e.target.value)} className="mt-1 w-full border rounded-lg p-2.5 font-normal" /></label><label className="text-sm block font-semibold">Renewed negotiated price (PHP)<input required type="number" min="0" step="0.01" className="mt-1 w-full border rounded-lg p-2.5 font-normal" value={renewPrice} onChange={e=>setRenewPrice(e.target.value)}/></label><label className="text-sm block font-semibold">Renewal reason / terms<textarea required minLength={5} maxLength={1000} rows={3} className="mt-1 w-full border rounded-lg p-2.5 font-normal" value={renewReason} onChange={e=>setRenewReason(e.target.value)}/></label><div className="flex justify-end gap-2"><button type="button" onClick={close} className="border rounded-lg px-4 py-2">Cancel</button><button disabled={busy||!renewEnd||renewEnd<=(selected?.ends_on||'')} className="bg-[#a64f32] text-white font-semibold rounded-lg px-4 py-2">{busy?'Saving…':'Renew contract'}</button></div></form>}
    {mode==='history'&&<div className="space-y-3">{!history.length?<p className="text-sm text-slate-500">No renewals recorded yet.</p>:history.map(r=><div className="border rounded-lg p-3 text-sm" key={r.id}><strong>{r.previous_ends_on} → {r.new_ends_on}</strong><p className="text-slate-600">{php(r.previous_price_cents/100)} → {php(r.new_price_cents/100)}</p><p className="mt-1">{r.reason}</p><p className="text-xs text-slate-500 mt-1">{r.renewed_at}</p></div>)}<div className="flex justify-end"><button className="border rounded-lg px-4 py-2" onClick={close}>Close</button></div></div>}
  </section></div>}
 </section>;
}
