import {useEffect,useMemo,useState} from 'react';
import {DB} from '../store/state';
import {canAccessTab,getCurrentPermissionRole} from '../domain/permissions';
import {navigateTo} from '../core/renderBridge';
import {CLOUD_API_BASE} from '../services/cloud';
import {contractsAPI,type Contract} from '../services/contracts';
import type {ProcurementRecord} from '../types/procurement';

type Result={type:string;tab:string;id:string;description:string;supplier:string;department:string;status:string;date:string;amount:string;searchText:string};
const sources:[keyof typeof DB,string,string][]=[
 ['requisitions','Purchase Requisition','requisitions'],['stockNeeds','Stock Need','bidding'],['bids','Supplier Bid','bid_comparison'],
 ['proposalMeetings','Proposal Meeting','proposal_meetings'],['orders','Purchase Order','orders'],
 ['deliveries','Delivery','delivery'],['amendments','Amendment','amendments'],['payments','Payment','payments']
];
const text=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v):'';
const dateOf=(r:ProcurementRecord)=>text(r.createdAt||r.submittedAt||r.poDate||r.updatedAt||r.actualDate||r.paymentDate||r.date||r.targetDate).slice(0,10);
const norm=(v:unknown)=>text(v).toLowerCase();
const php=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?`₱${n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`:''};
function records(contracts:Contract[]):Result[]{
 const suppliers=new Map(DB.suppliers.map(s=>[s.id,text(s.name)]));
 const needs=new Map(DB.stockNeeds.map(n=>[n.id,n]));
 const bids=new Map(DB.bids.map(b=>[b.id,b]));
 const orders=new Map(DB.orders.map(o=>[o.id,o]));
 const prs=new Map(DB.requisitions.map(p=>[p.id,p]));
 const resolveSupplier=(r:ProcurementRecord,type:string)=>{
   const relatedOrder=orders.get(r.poId);
   const relatedBid=bids.get(r.bidId);
   if(type==='Stock Need')return '';
   return text(r.supplierName||r.supplier||suppliers.get(r.supplierId)||relatedOrder?.supplierName||relatedBid?.supplierName||suppliers.get(relatedBid?.supplierId)||'');
 };
 const resolveDept=(r:ProcurementRecord)=>{
   const need=needs.get(r.needId)||needs.get(bids.get(r.bidId)?.needId);
   const order=orders.get(r.poId);
   return text(r.department||order?.department||prs.get(r.prId)?.department||prs.get(need?.prId)?.department);
 };
 const all=sources.flatMap(([key,type,tab])=>(Array.isArray(DB[key])?(DB[key] as ProcurementRecord[]):[]).map(r=>{
   const supplier=resolveSupplier(r,type),department=resolveDept(r),status=text(r.status||r.deliveryStatus||r.complianceStatus||'—');
   const label=text(r.itemTitle||r.title||r.supplierName||r.description||r.remarks||r.notes||r.agenda||r.name||type);
   const amount=php(r.totalCost??r.totalAmount??r.paymentAmount??r.bidAmount??r.unitPrice);
   return {type,tab,id:text(r.id),description:label,supplier,department,status,date:dateOf(r),amount,
      searchText:[r.id,r.prId,r.poId,r.needId,r.bidId,label,supplier,department,status,r.refNumber].map(norm).join(' ')};
 }));
 for(const c of contracts){const entry={type:'Contract',tab:'contracts',id:c.reference,description:c.title,supplier:c.supplier_name,department:'Procurement',status:c.status,date:c.created_at.slice(0,10),amount:php(c.price),searchText:[c.reference,c.title,c.supplier_name,c.po_id,c.status].map(norm).join(' ')};all.push(entry);}
 return all;
}
export default function GlobalSearchPage(){
 const [query,setQuery]=useState(''),[supplier,setSupplier]=useState('All'),[department,setDepartment]=useState('All'),[status,setStatus]=useState('All');
 const [from,setFrom]=useState(''),[through,setThrough]=useState(''),[kind,setKind]=useState('All'),[limit,setLimit]=useState(50);
 const [contracts,setContracts]=useState<Contract[]>([]),[contractError,setContractError]=useState('');
 const [revision,setRevision]=useState(0);
 useEffect(()=>{if(!CLOUD_API_BASE||!canAccessTab('contracts'))return;let valid=true;
   void contractsAPI.list().then(x=>{if(valid)setContracts(x.contracts)}).catch(e=>{if(valid)setContractError(e instanceof Error?e.message:String(e))});
   return()=>{valid=false};
 },[revision]);
 const all=useMemo(()=>records(contracts),[contracts,revision]);
 const me=DB.currentUser;
 const role=getCurrentPermissionRole();
 const full=['Admin','Procurement Head','Procurement Officer','Finance Officer','Finance Head'].includes(role??'');
 const scoped=all.filter(r=>{
  if(!canAccessTab(r.tab))return false;
  if(full)return true;
  if(role==='Department Head')return norm(r.department)===norm(me?.department);
  if(r.type==='Purchase Requisition')return DB.requisitions.some(p=>p.id===r.id&&(p.requestedByUsername===me?.username||p.requestedBy===me?.name));
  return false;
 });
 const distinct=(key:'supplier'|'department'|'status'|'type')=>[...new Set(scoped.map(r=>r[key]).filter(s=>s && s!=='—'))].sort((a,b)=>a.localeCompare(b));
 const filtered=scoped.filter(r=>(!query||r.searchText.includes(norm(query).trim()))&&
  (supplier==='All'||r.supplier===supplier)&&(department==='All'||r.department===department)&&
  (status==='All'||r.status===status)&&(kind==='All'||r.type===kind)&&
  (!from||r.date>=from)&&(!through||r.date<=through)).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const reset=()=>{setQuery('');setSupplier('All');setDepartment('All');setStatus('All');setKind('All');setFrom('');setThrough('');setLimit(50)};
 const filtersClass='rounded-lg border border-slate-200 bg-white p-2.5 text-sm text-slate-700';
 return <section className="max-w-7xl mx-auto space-y-5">
  <header className="bg-white border rounded-xl p-5 flex items-center justify-between gap-3 flex-wrap"><div><h2 className="text-xl font-bold text-slate-900">Global Search &amp; Filters</h2><p className="text-sm text-slate-500 mt-1">Find procurement transactions across requests, bidding, meetings, orders, deliveries, payments and contracts. Results follow your module permissions.</p></div><button onClick={()=>{setRevision(n=>n+1)}} className="border px-4 py-2 text-sm rounded-lg font-semibold">Refresh transactions</button></header>
  {contractError&&<p className="bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 rounded-lg">Contract results not available: {contractError}. Other records can still be searched.</p>}
  <div className="bg-white border rounded-xl p-4 space-y-4"><div className="relative"><i className="fa-solid fa-magnifying-glass absolute left-4 top-3.5 text-slate-400"/><input autoFocus className="border rounded-lg w-full pl-11 p-3" aria-label="Search all procurement transactions" placeholder="Reference, supplier, department, status, description…" value={query} onChange={e=>{setQuery(e.target.value);setLimit(50)}}/></div>
   <div className="grid sm:grid-cols-2 xl:grid-cols-6 gap-3">
    <label className="text-xs font-bold text-slate-500 uppercase">Record type<select className={'w-full block mt-1 '+filtersClass} value={kind} onChange={e=>setKind(e.target.value)}><option>All</option>{distinct('type').map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="text-xs font-bold text-slate-500 uppercase">Supplier<select className={'w-full block mt-1 '+filtersClass} value={supplier} onChange={e=>setSupplier(e.target.value)}><option>All</option>{distinct('supplier').map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="text-xs font-bold text-slate-500 uppercase">Department<select className={'w-full block mt-1 '+filtersClass} value={department} onChange={e=>setDepartment(e.target.value)}><option>All</option>{distinct('department').map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="text-xs font-bold text-slate-500 uppercase">Status<select className={'w-full block mt-1 '+filtersClass} value={status} onChange={e=>setStatus(e.target.value)}><option>All</option>{distinct('status').map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="text-xs font-bold text-slate-500 uppercase">From<input type="date" className={'w-full block mt-1 '+filtersClass} value={from} max={through||undefined} onChange={e=>setFrom(e.target.value)} /></label>
    <label className="text-xs font-bold text-slate-500 uppercase">Through<input type="date" className={'w-full block mt-1 '+filtersClass} value={through} min={from||undefined} onChange={e=>setThrough(e.target.value)}/></label>
   </div><div className="flex flex-wrap justify-between gap-2 items-center"><p className="text-sm text-slate-500">{filtered.length} matching transactions of {scoped.length} accessible records</p><button onClick={reset} className="text-[#a64f32] font-semibold text-sm hover:underline">Clear all filters</button></div>
  </div>
  <div className="bg-white border rounded-xl overflow-hidden"><div className="overflow-x-auto"><table className="text-sm w-full text-left"><thead className="bg-slate-50 text-slate-600"><tr>{['Reference / type','Transaction','Supplier','Department','Status','Date','Value',''].map((h,i)=><th key={i} className="p-3">{h}</th>)}</tr></thead><tbody>{filtered.slice(0,limit).map((r,index)=><tr className="border-t" key={`${r.type}-${r.id}-${index}`}><td className="p-3 whitespace-nowrap"><span className="font-bold text-[#a64f32]">{r.id}</span><span className="block text-xs text-slate-500">{r.type}</span></td><td className="p-3 min-w-40 max-w-64 break-words">{r.description}</td><td className="p-3">{r.supplier||'—'}</td><td className="p-3">{r.department||'—'}</td><td className="p-3"><span className="px-2 py-1 bg-slate-100 rounded-md text-xs font-semibold">{r.status}</span></td><td className="p-3 whitespace-nowrap">{r.date||'—'}</td><td className="p-3 whitespace-nowrap">{r.amount||'—'}</td><td className="p-3"><button className="text-[#a64f32] font-semibold hover:underline whitespace-nowrap" onClick={()=>navigateTo(r.tab)}>Open module</button></td></tr>)}</tbody></table>{filtered.length===0&&<div className="p-10 text-center text-slate-500">No transactions match your search and filters.</div>}</div>
   {filtered.length>limit&&<div className="p-4 border-t text-center"><button onClick={()=>setLimit(n=>n+50)} className="px-4 py-2 border rounded-lg text-sm font-semibold">Show next 50 results</button></div>}
  </div>
 </section>;
}
