import { useEffect, useState, type FormEvent } from 'react';
import { DB } from '../store/state';
import { deleteAccreditation, downloadAccreditation, listAccreditation, reviewAccreditation, uploadAccreditation, type AccreditationCase, type AccreditationDocument } from '../services/sourcing';

const categories=['Business Registration','Tax Certificate','Business Permit','Other'];
const today=new Date().toISOString().slice(0,10);
export default function SupplierAccreditationPage() {
  const isSupplier=DB.currentUser?.role==='Supplier';
  const reviewer=['Admin','Procurement Head'].includes(DB.currentUser?.role||'');
  const [cases,setCases]=useState<AccreditationCase[]>([]);
  const [category,setCategory]=useState(categories[0]);
  const [validUntil,setValidUntil]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  async function reload(){try{const result=await listAccreditation();setCases(result.cases);setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{void reload();const timer=window.setInterval(()=>void reload(),60000);return ()=>window.clearInterval(timer);},[]);
  async function execute(task:()=>Promise<unknown>){setBusy(true);setError('');try{await task();await reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function upload(e:FormEvent){e.preventDefault();if (!file)return;void execute(async()=>{await uploadAccreditation(category,validUntil,file);setFile(null);const elem=document.querySelector<HTMLInputElement>('#accreditation-file');if(elem)elem.value='';});}
  function documentList(row:AccreditationCase) {
    return <div className="mt-3 space-y-2">{row.documents.map((doc:AccreditationDocument)=><div key={doc.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="min-w-0"><p className="break-words text-sm font-medium">{doc.category}: {doc.fileName}</p><p className={'text-xs '+(doc.validUntil<today?'text-rose-700':'text-slate-500')}>Valid until {doc.validUntil} · {(doc.size/1024).toFixed(0)} KB {doc.validUntil<today?'· Expired':''}</p></div>
      <div className="flex gap-2"><button onClick={()=>void execute(()=>downloadAccreditation(doc))} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">Download</button>
      {isSupplier && <button disabled={busy} onClick={()=>{if(window.confirm('Delete this document? The accreditation will require re-review.'))void execute(()=>deleteAccreditation(doc.id));}} className="rounded border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700">Delete</button>}</div>
    </div>)}</div>;
  }
  return <div className="space-y-5">
    <header className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-bold">Supplier Accreditation</h2>
      <p className="mt-1 text-sm text-slate-500">Suppliers upload registration, tax and permit documents; procurement management reviews compliance and expiration dates. Approval is required before submitting new bids.</p>
    </header>
    {error && <div role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    {isSupplier && <form onSubmit={upload} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
      <h3 className="sm:col-span-2 font-bold">Upload accreditation evidence</h3>
      <label className="text-xs font-semibold">Document type<select value={category} onChange={e=>setCategory(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 p-3 text-sm">{categories.map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="text-xs font-semibold">Expiration date<input type="date" value={validUntil} min={today} required onChange={e=>setValidUntil(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 p-3 text-sm" /></label>
      <label className="text-xs font-semibold sm:col-span-2">PDF / PNG / JPG / DOCX, max 5 MB<input id="accreditation-file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={e=>setFile(e.target.files?.[0]||null)} className="mt-1 block w-full rounded border border-slate-300 p-3 text-sm" /></label>
      <div className="sm:col-span-2"><button disabled={busy||!file||!validUntil} className="rounded bg-[#a64f32] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy?'Uploading…':'Upload document for review'}</button></div>
    </form>}
    <section className="space-y-4">{loading?<p className="text-sm text-slate-500">Loading accreditation records…</p>:cases.length?cases.map(row=><article key={row.supplierUserId} className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-bold text-slate-900">{row.name}</h3><p className="text-xs text-slate-500">{row.documents.length} document(s) · {row.reviewedAt?'Last review '+new Date(row.reviewedAt).toLocaleString():'Not yet reviewed'}</p></div>
      <span className={'rounded-full px-3 py-1 text-xs font-bold '+(row.status==='Approved'?'bg-emerald-100 text-emerald-800':row.status==='Expired'||row.status==='Rejected'?'bg-rose-100 text-rose-800':'bg-amber-100 text-amber-800')}>{row.status}</span></div>
      {row.missing.length>0 && <p className="mt-2 text-xs text-amber-800">Missing or expired required files: {row.missing.join(', ')}</p>}
      {row.reviewNote && <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600"><b>Review note:</b> {row.reviewNote}</p>}
      {documentList(row)}
      {reviewer && <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row">
        <input aria-label={`Review note for ${row.name}`} maxLength={1000} placeholder="Review note / rejection reason" value={notes[row.supplierUserId]||''} onChange={e=>setNotes(old=>({...old,[row.supplierUserId]:e.target.value}))} className="min-w-0 flex-1 rounded border border-slate-300 p-2 text-sm" />
        <button disabled={busy||row.missing.length>0} onClick={()=>void execute(()=>reviewAccreditation(row.supplierUserId,'Approved',notes[row.supplierUserId]||''))} className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Approve accreditation</button>
        <button disabled={busy||!(notes[row.supplierUserId]||'').trim()} onClick={()=>void execute(()=>reviewAccreditation(row.supplierUserId,'Rejected',notes[row.supplierUserId]))} className="rounded bg-rose-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Reject / Request changes</button>
      </div>}
    </article>):<p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No accredited supplier records yet.</p>}</section>
  </div>;
}
