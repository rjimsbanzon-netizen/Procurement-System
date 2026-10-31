import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

/** Feature 9-11 API. All routes run *after* existing Worker authentication. */
type Env = { DB: D1Database; DOCUMENTS: KVNamespace };
type User = { id: string; name: string; role: string; app_role: string; company_name: string };
type Row = Record<string, any>;
type Snapshot = Record<string, any[]>;
const allowedContexts = ['BID','MEETING','PO','DELIVERY','ISSUE'];
const accreditationTypes = ['Business Registration','Tax Certificate','Business Permit','Other'];
const requiredAccreditation = accreditationTypes.slice(0,3);
const maxFileSize = 5 * 1024 * 1024;
const j = (data: unknown, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type':'application/json','Cache-Control':'no-store' } });
const safe = (input: unknown) => typeof input === 'string' ? input.trim() : '';
const adminOrHead = (u: User) => u.role === 'admin' || u.app_role === 'Procurement Head';
const staff = (u: User) => adminOrHead(u) || u.app_role === 'Procurement Officer';
const isSupplier = (u: User) => u.role === 'guest' && u.app_role === 'Supplier';
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();

async function snapshot(env: Env): Promise<{ data: Snapshot; raw: string }> {
  const row = await env.DB.prepare('SELECT data FROM enterprise_state WHERE id=1').first<{data:string}>();
  const raw = row?.data || '';
  const parsed = raw ? JSON.parse(raw) as Snapshot : {};
  return { raw, data: parsed };
}
function supplierKey(data: Snapshot, user: User): { id: string; name: string } {
  const match = (data.suppliers || []).find(s => lower(s.name) === lower(user.company_name));
  return { id: safe(match?.id) || `supplier-${user.id}`, name: safe(match?.name) || user.company_name || user.name };
}
function context(data: Snapshot, type: string, id: string): { supplierId:string; supplierName:string } | null {
  if (!allowedContexts.includes(type)) return null;
  const entity: Record<string,string> = {BID:'bids',MEETING:'proposalMeetings',PO:'orders',DELIVERY:'deliveries',ISSUE:'amendments'};
  const record = (data[entity[type]] || []).find(x => x.id === id);
  if (!record) return null;
  const order = (type === 'DELIVERY' || type === 'ISSUE')
    ? (data.orders || []).find(x => x.id === record.poId) : null;
  const bid = type === 'MEETING' ? (data.bids || []).find(x => x.id === record.bidId) : null;
  const ref = order || bid || record;
  return { supplierId: safe(ref.supplierId || record.supplierId), supplierName: safe(ref.supplierName || record.supplierName) };
}
function canChat(user: User, partner: {supplierId:string; supplierName:string}, own: {id:string;name:string}) {
  return staff(user) || (isSupplier(user) && Boolean(partner.supplierName) &&
    (lower(partner.supplierName) === lower(own.name) || partner.supplierId === own.id));
}
function accreditedStatus(caseRow: Row | null, files: Row[], today: string): string {
  if (requiredAccreditation.some(cat => files.some(f => f.category === cat && f.valid_until < today) && !files.some(f => f.category === cat && f.valid_until >= today))) return 'Expired';
  if (!caseRow) return 'Not Submitted';
  if (caseRow.status === 'Approved' && requiredAccreditation.some(cat => !files.some(f => f.category === cat && f.valid_until >= today))) return 'Incomplete';
  return String(caseRow.status);
}
async function accreditationFor(env: Env, userId: string) {
  const acct = await env.DB.prepare('SELECT * FROM supplier_accreditations WHERE supplier_user_id=?').bind(userId).first<Row>();
  const docs = (await env.DB.prepare('SELECT id,supplier_user_id,category,file_name,mime_type,size,valid_until,uploaded_at FROM supplier_accreditation_files WHERE supplier_user_id=? ORDER BY uploaded_at DESC').bind(userId).all<Row>()).results;
  const today = new Date().toISOString().slice(0,10);
  return { supplierUserId:userId, status: accreditedStatus(acct, docs, today), reviewNote:acct?.review_note || '', reviewedAt:acct?.reviewed_at || null, documents:docs.map(d=>({id:d.id,category:d.category,fileName:d.file_name,size:d.size,validUntil:d.valid_until,uploadedAt:d.uploaded_at})), missing:requiredAccreditation.filter(cat=>!docs.some(d=>d.category===cat && d.valid_until>=today)) };
}
const validDate = (value:string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const types = new Map([['application/pdf','.pdf'],['image/png','.png'],['image/jpeg','.jpg'],['application/vnd.openxmlformats-officedocument.wordprocessingml.document','.docx']]);
const validText = (v: unknown, min: number, max: number) => typeof v==='string' && v.trim().length>=min && v.trim().length<=max;
const choice = (v: unknown, list: string[]) => typeof v==='string' && list.includes(v);
function validateQuote(q: Row): string | null {
  if (q.version!==1 || !validText(q.offeredModel,2,160)) return 'Provide a version 1 quotation with a valid product model.';
  if (!choice(q.specificationClaim,['fully-compliant','minor-deviations','non-compliant']) ||
      !validText(q.specificationExceptions,q.specificationClaim==='fully-compliant'?0:4,1000)) return 'Describe compliance and required specification exceptions.';
  if (!choice(q.deliveryCommitment,['firm','estimated','conditional'])) return 'Choose a valid delivery commitment.';
  if (!Number.isInteger(q.warrantyMonths) || q.warrantyMonths<0 || q.warrantyMonths>120 ||
      !choice(q.warrantyCoverage,['parts-labor','limited','none']) ||
      (q.warrantyMonths===0)!==(q.warrantyCoverage==='none') ||
      !validText(q.warrantyService,0,500)) return 'Provide a consistent warranty period and coverage.';
  if (![0,7,14,30].includes(q.replacementDays) || !choice(q.paymentCondition,['after-acceptance','net-15','net-30','advance-required']) ||
      !Number.isInteger(q.validityDays) || q.validityDays<1 || q.validityDays>365 ||
      !choice(q.afterSalesSupport,['included','limited','none'])) return 'Complete valid replacement, payment, and after-sales clauses.';
  if (!validText(q.supportingReference,0,160) || !validText(q.additionalClauses,0,1000) || q.supplierDeclaration!==true) return 'Complete and affirm the supplier quotation declaration.';
  return null;
}
export async function resetSourcingHistory(env:Env) {
  // Accreditation belongs to the user account, so it survives procurement resets.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sourcing_messages'),
    env.DB.prepare('DELETE FROM sourcing_deadlines')
  ]);
}


/** Reject new bids via the legacy unrestricted snapshot PUT endpoint. */
export function validateSourcingSnapshotWrite(input: Record<string, unknown>, previous: Record<string, unknown>, user: User): string | null {
  const incoming = Array.isArray(input.bids) ? input.bids as Row[] : [];
  const old = Array.isArray(previous.bids) ? previous.bids as Row[] : [];
  const oldById = new Map(old.map(b => [String(b.id), b]));
  const receivedIds = new Set(incoming.map(b => String(b.id)));
  if (incoming.some(b => !b || !oldById.has(String(b.id)))) {
    return 'New bids must use the secured /sourcing/bids endpoint to enforce deadlines and accreditation.';
  }
  const isFullReset = user.role === 'admin' && ['bids','stockNeeds','requisitions','orders','deliveries'].every(key => Array.isArray(input[key]) && (input[key] as unknown[]).length === 0);
  if (!isFullReset && old.some(b => !receivedIds.has(String(b.id)))) {
    return 'A bid was removed from the local snapshot. Refresh before saving; existing bids cannot be silently discarded.';
  }
  for (const proposed of incoming) {
    const existing = oldById.get(String(proposed.id));
    if (!existing) continue;
    for (const field of ['needId','supplierId','supplierName','unitPrice','totalCost','leadTimeDays','notes','quotationTerms','submittedAt']) {
      if (JSON.stringify(proposed[field] ?? null) !== JSON.stringify(existing[field] ?? null)) {
        return 'Submitted bid details are immutable. Refresh the page and use the existing procurement review workflow.';
      }
    }
    if (String(existing.status) !== String(proposed.status) && !adminOrHead(user)) {
      return 'Only Admin or Procurement Head may change bid selection status.';
    }
  }
  return null;
}

export async function handleSourcingRoutes(request:Request, env:Env, user:User, cors:HeadersInit):Promise<Response|null> {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (!path.startsWith('/sourcing/')) return null;
  const fail = (message:string, code=400) => j({error:message},code,cors);

  if (path === '/sourcing/deadlines' && method === 'GET') {
    const rows = (await env.DB.prepare('SELECT need_id,closes_at,manually_closed FROM sourcing_deadlines').all<Row>()).results;
    return j({deadlines:rows.map(r=>({needId:r.need_id,closesAt:r.closes_at,manuallyClosed:Boolean(r.manually_closed),open:!r.manually_closed && Date.parse(r.closes_at)>Date.now()})),serverNow:new Date().toISOString()},200,cors);
  }
  const deadlineMatch = path.match(/^\/sourcing\/deadlines\/([^/]+)$/);
  if (deadlineMatch && method === 'PUT') {
    if (!adminOrHead(user)) return fail('Only Admin or Procurement Head may configure bidding deadlines.',403);
    const needId = decodeURIComponent(deadlineMatch[1]);
    const body = await request.json() as Row;
    const closesAt = safe(body.closesAt);
    const manualClosed = body.manuallyClosed === true;
    if (!closesAt || !Number.isFinite(Date.parse(closesAt)) || !/Z$/.test(closesAt) || (!manualClosed && Date.parse(closesAt) <= Date.now())) return fail('Enter a future UTC deadline (with Z) before opening bidding.');
    const {data}=await snapshot(env);
    if (!(data.stockNeeds || []).some(x=>x.id===needId && x.status==='Published')) return fail('This stock need is not published or no longer accepts bids.',409);
    await env.DB.prepare('INSERT INTO sourcing_deadlines(need_id,closes_at,manually_closed,updated_by) VALUES(?,?,?,?) ON CONFLICT(need_id) DO UPDATE SET closes_at=excluded.closes_at,manually_closed=excluded.manually_closed,updated_by=excluded.updated_by,updated_at=datetime(\'now\')')
      .bind(needId,new Date(closesAt).toISOString(),manualClosed?1:0,user.id).run();
    return j({ok:true,needId,closesAt:new Date(closesAt).toISOString(),manuallyClosed:manualClosed},200,cors);
  }

  // Server-side acceptance: a tampered browser cannot submit after the deadline.
  if (path === '/sourcing/bids' && method === 'POST') {
    if (!isSupplier(user)) return fail('Only approved supplier accounts may submit a quotation.',403);
    const body = await request.json() as Row;
    const needId = safe(body.needId);
    const unit = Number(body.unitPrice), days = Number(body.leadTimeDays);
    if (!needId || !Number.isFinite(unit) || unit<=0 || unit>1e10 || !Number.isInteger(days) || days<1 || days>365) return fail('Enter a valid procurement need, price, and delivery lead time.');
    const terms = body.quotationTerms;
    if (JSON.stringify(body).length > 15000) return fail('Quotation details are too large.');
    if (!terms || typeof terms !== 'object') return fail('Complete the quotation terms.');
    const termsError=validateQuote(terms);
    if (termsError) return fail(termsError);
    const accredited = await accreditationFor(env,user.id);
    if (accredited.status !== 'Approved') return fail(`Accreditation required before submitting a bid (status: ${accredited.status}).`,403);
    const deadline = await env.DB.prepare('SELECT closes_at,manually_closed FROM sourcing_deadlines WHERE need_id=?').bind(needId).first<Row>();
    if (!deadline || deadline.manually_closed || Date.parse(deadline.closes_at)<=Date.now()) return fail('Bidding is closed or the submission deadline has not been configured.',409);
    for (let attempt=0; attempt<4; attempt++) {
      const {data,raw} = await snapshot(env);
      if (!raw) return fail('The procurement workspace has not been created yet.',409);
      const need=(data.stockNeeds || []).find(n=>n.id===needId);
      if (!need || need.status!=='Published') return fail('This procurement requirement is no longer open for bidding.',409);
      const own=supplierKey(data,user);
      if ((data.bids || []).some(b=>b.needId===needId && (b.supplierId===own.id || lower(b.supplierName)===lower(own.name)))) return fail('Your supplier account has already submitted a bid for this need.',409);
      // Recheck deadline as near as possible to commit, including when retries occur.
      if (deadline.manually_closed || Date.parse(deadline.closes_at)<=Date.now()) return fail('The bidding deadline has passed.',409);
      const bid={id:`BID-${crypto.randomUUID()}`,needId,supplierId:own.id,supplierName:own.name,unitPrice:unit,totalCost:Math.round(unit*Number(need.targetQty)*100)/100,leadTimeDays:days,notes:safe(body.notes).slice(0,1000)||safe(terms.offeredModel),quotationTerms:terms,submittedAt:new Date().toISOString(),status:'Submitted'};
      if (!Number.isFinite(bid.totalCost) || bid.totalCost<=0) return fail('Invalid total quotation amount.');
      const dataCopy={...data,bids:[bid,...(data.bids||[])],auditLogs:[{id:`log-${crypto.randomUUID()}`,action:'Bid Submitted',details:`${own.name} submitted a quotation for ${needId}`,user:own.name,role:'Supplier',timestamp:new Date().toISOString()},...(data.auditLogs||[])]};
      const updated=await env.DB.prepare('UPDATE enterprise_state SET data=?,updated_at=datetime(\'now\') WHERE id=1 AND data=?').bind(JSON.stringify(dataCopy),raw).run();
      if (updated.meta.changes===1) return j({ok:true,bid},201,cors);
    }
    return fail('Another user updated the workspace. Refresh and retry the bid submission.',409);
  }

  // Cross-device notification feed for the authenticated account. Never expose
  // another supplier's discussion, and never notify the sender about their own message.
  // Read/unread receipts use the existing /notifications/read D1 endpoint.
  if (path === '/sourcing/message-alerts' && method === 'GET') {
    if (!staff(user) && !isSupplier(user)) return fail('Messaging is not available to this account.', 403);
    const { data } = await snapshot(env);
    const own = supplierKey(data, user);
    const supplierAccount = isSupplier(user);
    // Keep the query bounded and use D1's supplier_id index when available.
    // Do not include message bodies in the notification response.
    const sql = `SELECT id,entity_type,entity_id,supplier_id,sender_user_id,sender_name,created_at
      FROM sourcing_messages ${supplierAccount ? 'WHERE supplier_id = ?' : ''}
      ORDER BY created_at DESC,id DESC LIMIT 300`;
    const query = env.DB.prepare(sql);
    const messages = (await (supplierAccount ? query.bind(own.id) : query).all<Row>()).results;
    const partnerCache = new Map<string, {supplierId:string; supplierName:string} | null>();
    const alerts = [] as Array<{id:string;entityType:string;entityId:string;senderName:string;createdAt:string}>;
    for (const row of messages) {
      if (row.sender_user_id === user.id) continue;
      const key = `${row.entity_type}|${row.entity_id}`;
      if (!partnerCache.has(key)) partnerCache.set(key, context(data, String(row.entity_type), String(row.entity_id)));
      const partner = partnerCache.get(key);
      if (!partner || !partner.supplierName || !canChat(user, partner, own)) continue;
      alerts.push({id:String(row.id),entityType:String(row.entity_type),entityId:String(row.entity_id),
        senderName:String(row.sender_name),createdAt:String(row.created_at)});
      if (alerts.length >= 200) break;
    }
    return j({alerts}, 200, cors);
  }

  if (path==='/sourcing/messages' && (method==='GET'||method==='POST')) {
    const body=method==='POST' ? await request.json() as Row : null;
    const type=safe(body?.entityType || url.searchParams.get('entityType'));
    const id=safe(body?.entityId || url.searchParams.get('entityId'));
    const {data}=await snapshot(env);
    const partner=context(data,type,id);
    if (!partner || !partner.supplierName) {
      // This is a missing cloud record, not an unregistered API route.
      // Do not recreate a quotation from an untrusted client snapshot.
      return fail(`Cannot open ${type || 'transaction'} ${id || ''}: the original transaction is missing from shared Cloudflare records. Ask Admin to restore the original record from a verified backup. Do not create a duplicate.`,409);
    }
    if (!canChat(user,partner,supplierKey(data,user))) return fail('This discussion is not available to your account.',403);
    if (method==='GET') {
      const messages=(await env.DB.prepare('SELECT id,entity_type,entity_id,sender_user_id,sender_name,sender_role,body,created_at FROM sourcing_messages WHERE entity_type=? AND entity_id=? ORDER BY created_at ASC,id ASC LIMIT 400').bind(type,id).all<Row>()).results;
      return j({messages:messages.map(m=>({id:m.id,entityType:m.entity_type,entityId:m.entity_id,senderUserId:m.sender_user_id,senderName:m.sender_name,senderRole:m.sender_role,body:m.body,createdAt:m.created_at}))},200,cors);
    }
    const message=safe(body?.message);
    if (!message || message.length>2000) return fail('Message must contain 1–2000 characters.');
    const uid=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO sourcing_messages(id,entity_type,entity_id,supplier_id,sender_user_id,sender_name,sender_role,body,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(uid,type,id,partner.supplierId,user.id,user.name,user.app_role,message,new Date().toISOString()).run();
    return j({ok:true,id:uid},201,cors);
  }

  if (path==='/sourcing/accreditation' && method==='GET') {
    if (!isSupplier(user) && !adminOrHead(user)) return fail('Supplier or procurement management access required.',403);
    if (isSupplier(user)) return j({cases:[{...(await accreditationFor(env,user.id)),name:user.company_name||user.name}]},200,cors);
    const accounts=(await env.DB.prepare("SELECT id,name,company_name FROM users WHERE role='guest' AND status='approved' AND access_revoked=0 ORDER BY company_name").all<Row>()).results;
    return j({cases:await Promise.all(accounts.map(async u=>({...await accreditationFor(env,u.id),name:u.company_name||u.name})))},200,cors);
  }
  if (path==='/sourcing/accreditation/files' && method==='POST') {
    if (!isSupplier(user)) return fail('Only suppliers may submit accreditation documents.',403);
    const form=await request.formData();
    const category=safe(form.get('category')), validUntil=safe(form.get('validUntil'));
    const file=form.get('file');
    if (!accreditationTypes.includes(category)||!validDate(validUntil)||validUntil<=new Date().toISOString().slice(0,10)) return fail('Select a valid document category and a future expiry date.');
    if (!(file instanceof File)||file.size<1||file.size>maxFileSize||!types.has(file.type) || !(file.type==='image/jpeg' ? /\.jpe?g$/i.test(file.name) : String(file.name).toLowerCase().endsWith(types.get(file.type)!))) return fail('Allowed files: PDF, PNG, JPG, DOCX (maximum 5 MB).');
    const name=String(file.name).replace(/[^\w.\- ()]/g,'_').slice(0,180);
    const fileId=crypto.randomUUID(), key=`sourcing/accreditation/${user.id}/${fileId}`;
    await env.DOCUMENTS.put(key,await file.arrayBuffer());
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO supplier_accreditation_files(id,supplier_user_id,category,file_name,mime_type,size,kv_key,valid_until) VALUES(?,?,?,?,?,?,?,?)')
          .bind(fileId,user.id,category,name,file.type,file.size,key,validUntil),
        env.DB.prepare("INSERT INTO supplier_accreditations(supplier_user_id,status,review_note,reviewed_by,reviewed_at) VALUES(?,'Pending','',NULL,NULL) ON CONFLICT(supplier_user_id) DO UPDATE SET status='Pending',review_note='',reviewed_by=NULL,reviewed_at=NULL,updated_at=datetime('now')").bind(user.id)
      ]);
    } catch(e) { await env.DOCUMENTS.delete(key); throw e; }
    return j({ok:true,fileId},201,cors);
  }
  const fileMatch=path.match(/^\/sourcing\/accreditation\/files\/([^/]+)$/);
  if (fileMatch && (method==='GET'||method==='DELETE')) {
    const file=await env.DB.prepare('SELECT * FROM supplier_accreditation_files WHERE id=?').bind(decodeURIComponent(fileMatch[1])).first<Row>();
    if (!file) return fail('Accreditation document not found.',404);
    if (file.supplier_user_id!==user.id && !adminOrHead(user)) return fail('Access denied.',403);
    if (method==='GET') {
      const bytes=await env.DOCUMENTS.get(file.kv_key,'arrayBuffer');
      if (!bytes) return fail('Document storage object is missing.',404);
      const cleanName=String(file.file_name).replace(/["\r\n\\]/g,'_');
      return new Response(bytes,{status:200,headers:{...cors,'Content-Type':file.mime_type,'Content-Disposition':`attachment; filename="${cleanName}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    if (file.supplier_user_id!==user.id) return fail('Only the supplier may replace or delete their uploaded document.',403);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM supplier_accreditation_files WHERE id=?').bind(file.id),
      env.DB.prepare("UPDATE supplier_accreditations SET status='Pending',review_note='',reviewed_by=NULL,reviewed_at=NULL,updated_at=datetime('now') WHERE supplier_user_id=?").bind(user.id)
    ]);
    await env.DOCUMENTS.delete(file.kv_key);
    return j({ok:true},200,cors);
  }
  const review=path.match(/^\/sourcing\/accreditation\/review\/([^/]+)$/);
  if (review && method==='POST') {
    if (!adminOrHead(user)) return fail('Only Admin or Procurement Head may review accreditation.',403);
    const id=decodeURIComponent(review[1]);
    const account=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='guest' AND status='approved' AND access_revoked=0").bind(id).first();
    if (!account) return fail('Active supplier account not found.',404);
    const body=await request.json() as Row;
    const status=safe(body.status),note=safe(body.note);
    if (!['Approved','Rejected'].includes(status)||note.length>1000||(status==='Rejected'&&!note)) return fail('Choose Approved or Rejected, and provide a rejection reason.');
    const data=await accreditationFor(env,id);
    if (status==='Approved' && data.missing.length) return fail(`Required documents missing or expired: ${data.missing.join(', ')}`,409);
    await env.DB.prepare("INSERT INTO supplier_accreditations(supplier_user_id,status,review_note,reviewed_by,reviewed_at) VALUES(?,?,?,?,?) ON CONFLICT(supplier_user_id) DO UPDATE SET status=excluded.status,review_note=excluded.review_note,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=datetime('now')")
      .bind(id,status,note,user.id,new Date().toISOString()).run();
    return j({ok:true,status},200,cors);
  }
  return fail('Unknown sourcing endpoint.',404);
}
