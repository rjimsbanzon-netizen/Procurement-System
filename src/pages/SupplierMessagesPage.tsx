import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DB, ui } from '../store/state';
import { markMessageNotificationsRead } from '../features/notifications/notificationService';
import { getMessages, postMessage, type Message } from '../services/sourcing';

const types = {BID:'Bids & quotations',MEETING:'Proposal meetings',PO:'Purchase orders',DELIVERY:'Deliveries',ISSUE:'Issues & amendments'} as const;
type ContextType = keyof typeof types;

export default function SupplierMessagesPage() {
  const supplier=DB.currentUser?.role==='Supplier';
  const options = useMemo(()=>{
    const own=(s:any)=>s.supplierId===DB.currentUser?.supplierId || (s.supplierName && String(s.supplierName).toLowerCase()===String(DB.currentUser?.companyName||'').toLowerCase());
    const rows:{type:ContextType;id:string;label:string}[]=[];
    const add=(records:any[],type:ContextType,title:(r:any)=>string)=>records.filter(r=>!supplier||own(r)).forEach(r=>rows.push({type,id:r.id,label:`${r.id} — ${title(r)}`}));
    add(DB.bids,'BID',r=>r.supplierName);
    add(DB.proposalMeetings,'MEETING',r=>r.supplierName);
    add(DB.orders,'PO',r=>r.supplierName||r.itemTitle);
    add(DB.deliveries,'DELIVERY',r=>r.supplierName||r.itemTitle);
    add(DB.amendments,'ISSUE',r=>r.supplierName||'Delivery issue');
    return rows;
  },[supplier]);
  const [selection,setSelection]=useState(()=>ui.messageSelection || '');
  const [messages,setMessages]=useState<Message[]>([]);
  const [draft,setDraft]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const selected=options.find(x=>`${x.type}|${x.id}`===selection);
  useEffect(()=>{
    if (!selected) {setMessages([]);return;}
    let active=true;
    const load=async()=>{try {const r=await getMessages(selected.type,selected.id);if(active){setMessages(r.messages);setError('');markMessageNotificationsRead(r.messages.filter(m=>m.senderUserId!==DB.currentUser?.id).map(m=>m.id));}}catch(e){if(active)setError((e as Error).message);}finally{if(active)setLoading(false);}};
    setLoading(true);void load();
    const timer=window.setInterval(()=>{void load();},15000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[selection]);
  async function send(e:FormEvent) {
    e.preventDefault();
    if (!selected||!draft.trim()||busy) return;
    setBusy(true);
    try {await postMessage(selected.type,selected.id,draft);setDraft('');setMessages((await getMessages(selected.type,selected.id)).messages);setError('');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="space-y-5">
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <label className="mb-2 block text-xs font-bold uppercase text-slate-600">Select transaction</label>
      <select className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm" value={selection} onChange={e=>{ui.messageSelection=e.target.value;setSelection(e.target.value);}}>
        <option value="">Choose a bid, meeting, order or issue</option>
        {Object.entries(types).map(([key,title])=><optgroup key={key} label={title}>{options.filter(x=>x.type===key).map(x=><option value={`${x.type}|${x.id}`} key={`${x.type}|${x.id}`}>{x.label}</option>)}</optgroup>)}
      </select>
      {!options.length && <p className="mt-3 text-sm text-slate-500">No eligible transactions yet. Discussions become available after a supplier has submitted a bid or received an order.</p>}
      {error && <p role="alert" className="mt-3 rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {selected && <>
        <div className="mt-4 min-h-48 max-h-[48vh] space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-4">
          {loading && !messages.length && <p className="text-xs text-slate-500">Loading discussion…</p>}
          {!loading && !messages.length && <p className="text-sm text-slate-500">No messages yet. Start the discussion below.</p>}
          {messages.map(msg=><div key={msg.id} className={'rounded-lg border p-3 '+(msg.senderUserId===DB.currentUser?.id?'ml-5 border-sky-200 bg-sky-50':'mr-5 border-slate-200 bg-white')}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs"><b>{msg.senderName} · {msg.senderRole}</b><span className="text-slate-500">{new Date(msg.createdAt).toLocaleString()}</span></div>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{msg.body}</p>
          </div>)}
        </div>
        <form onSubmit={e=>void send(e)} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <textarea aria-label="New message" required minLength={1} maxLength={2000} rows={3} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Type a question, clarification, or delivery update…" className="min-w-0 flex-1 rounded-lg border border-slate-300 p-3 text-sm" />
          <button disabled={busy||!draft.trim()} className="self-end rounded-lg bg-[#a64f32] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{busy?'Sending…':'Send message'}</button>
        </form>
      </>}
    </div>
  </div>;
}
