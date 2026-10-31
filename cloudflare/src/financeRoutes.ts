/** ProcureFlow features 6–8. Additive, authenticated D1 routes; no user-role migration. */
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

export interface FinanceEnv { DB: D1Database; DOCUMENTS: KVNamespace }
export interface FinanceUser {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'employee' | 'guest';
  app_role: string;
  department: string;
  company_name: string;
}
type Row = Record<string, any>;
type Snapshot = { requisitions: Row[]; orders: Row[]; payments: Row[]; deliveries: Row[] };
const toCents = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};
const amount = (cents: number) => cents / 100;
const same = (a: unknown,b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
function reply(value: unknown, status = 200, cors: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
async function snapshot(env: FinanceEnv): Promise<{data:Snapshot; text:string}> {
  const row = await env.DB.prepare('SELECT data FROM enterprise_state WHERE id=1').first<{data:string}>();
  const text = row?.data ?? '';
  const obj = text ? JSON.parse(text) as Partial<Snapshot> : {};
  return { data: {requisitions:obj.requisitions ?? [],orders:obj.orders ?? [], payments:obj.payments ?? [],deliveries:obj.deliveries ?? []}, text };
}
async function getBudgetRows(env: FinanceEnv) {
  return (await env.DB.prepare('SELECT department,allocated_cents,updated_at FROM department_budgets ORDER BY department').all<Row>()).results;
}
function usage(data: Snapshot, dept: string) {
  let committedCents=0,spentCents=0;
  for (const pr of data.requisitions) {
    if (!same(pr.department,dept) || !['Approved','In Process','Completed'].includes(pr.status)) continue;
    const po = data.orders.find(o=>o.prId===pr.id);
    if (po) {
      const paid = data.payments.some(p=>p.poId===po.id && p.status==='Paid');
      const cents = toCents(po.totalCost ?? 0);
      if (Number.isNaN(cents)) continue;
      if (paid) spentCents += cents; else committedCents += cents;
    } else if (pr.status==='Approved') committedCents += toCents(pr.totalCost ?? 0) || 0;
  }
  return {committedCents,spentCents};
}
async function budgetStatus(env:FinanceEnv, data:Snapshot) {
  const budgets = await getBudgetRows(env);
  const departments = [...new Set([...budgets.map(b=>b.department),...data.requisitions.map(pr=>String(pr.department ?? ''))].filter(Boolean))].sort();
  return departments.map(department=>{
    const row = budgets.find(b=>b.department===department);
    const allocatedCents = Number(row?.allocated_cents ?? 0);
    const {committedCents,spentCents}=usage(data,department);
    return {department,allocated:amount(allocatedCents),committed:amount(committedCents),spent:amount(spentCents),remaining:amount(allocatedCents-committedCents-spentCents),configured:Boolean(row)};
  });
}
async function approverSettings(env:FinanceEnv) {
  const rules = await env.DB.prepare('SELECT finance_from_cents,admin_from_cents FROM finance_rules WHERE id=1').first<Row>();
  const assignments = (await env.DB.prepare('SELECT a.step_role,a.department,a.user_id,u.name,u.app_role,u.department AS user_department FROM finance_approvers a JOIN users u ON u.id=a.user_id ORDER BY a.step_role,a.department').all<Row>()).results;
  return {financeFrom:amount(Number(rules?.finance_from_cents??0)),adminFrom:amount(Number(rules?.admin_from_cents??0)), assignments};
}
function canSeeDepartment(user: FinanceUser, dept: string):boolean {
  return user.role==='admin' || user.app_role==='Procurement Head' || user.app_role==='Finance Officer' || same(user.department,dept);
}
async function canApproveStep(env:FinanceEnv,user:FinanceUser,role:string,department:string):Promise<boolean> {
  if(role==='Admin')return user.role==='admin';
  if(role==='Department Head')return false; // The Department Head submits requests but never approves their own PR.
  if(role==='Procurement Head')return user.app_role==='Procurement Head';
  const row=await env.DB.prepare('SELECT user_id FROM finance_approvers WHERE step_role=? AND department=?').bind(role,role==='Finance Officer'?'*':department).first<{user_id:string}>();
  return row?.user_id===user.id;
}
async function approvalList(env:FinanceEnv,user:FinanceUser,data:Snapshot) {
  const requests=(await env.DB.prepare('SELECT * FROM pr_approval_requests ORDER BY created_at DESC').all<Row>()).results;
  const steps=(await env.DB.prepare('SELECT * FROM pr_approval_steps ORDER BY pr_id,step_no').all<Row>()).results;
  return requests.filter(r=>canSeeDepartment(user,r.department)||r.requested_by===user.id)
    .map(r=>({prId:r.pr_id,requestedBy:r.requested_by,department:r.department,amount:amount(r.amount_cents),status:r.status,currentStep:r.current_step,totalSteps:r.total_steps,createdAt:r.created_at,pr:data.requisitions.find(p=>p.id===r.pr_id)??null,steps:steps.filter(s=>s.pr_id===r.pr_id).map(s=>({number:s.step_no,role:s.step_role,status:s.status,comment:s.comment,decidedAt:s.decided_at,decidedBy:s.decided_by})),}));
}
function verifyDelivery(data:Snapshot,po:Row):boolean {
  const ds=data.deliveries.filter(d=>d.poId===po.id);
  return ds.length>0 && ds.every(d=>d.complianceStatus==='Completed - Verified') && ds.reduce((s,d)=>s+Number(d.deliveredQty??0),0)>=Number(po.quantity??0);
}
function inspectInvoice(data:Snapshot,invoice:Row) {
  const reasons:string[]=[];
  const po=data.orders.find(o=>o.id===invoice.po_id);
  if(!po)reasons.push('Purchase Order is missing.');
  else {
    if(!['Approved & Signed','Issued'].includes(po.status) && !data.payments.some(p=>p.poId===po.id&&p.status==='Paid')) reasons.push('Purchase Order is not signed/issued.');
    if(toCents(po.totalCost)!==Number(invoice.amount_cents))reasons.push('Invoice amount does not equal PO total.');
    if(!verifyDelivery(data,po))reasons.push('Delivery quantities and inspection are not fully verified.');
  }
  return {po,reasons};
}
function canSeeInvoice(user:FinanceUser,inv:Row) { return user.role!=='guest' || same(user.company_name,inv.supplier_name); }
export async function handleFinanceRoutes(request:Request,env:FinanceEnv,user:FinanceUser,cors:HeadersInit):Promise<Response|null> {
  const path = new URL(request.url).pathname;
  if(!path.startsWith('/finance/'))return null;
  const method=request.method;
  const admin=user.role==='admin';
  const staff=user.role!=='guest';
  if(path==='/finance/summary'&&method==='GET') {
    if(!staff)return reply({error:'Staff access required.'},403,cors);
    const {data}=await snapshot(env);
    const all=await budgetStatus(env,data);
    const financeAssigned = await env.DB.prepare("SELECT 1 AS assigned FROM finance_approvers WHERE step_role='Finance Officer' AND user_id=?").bind(user.id).first();
    return reply({budgets:all.filter(b=>Boolean(financeAssigned)||canSeeDepartment(user,b.department))},200,cors);
  }
  if(path==='/finance/staff'&&method==='GET') {
    if(!admin)return reply({error:'Admin only.'},403,cors);
    const people=(await env.DB.prepare("SELECT id,name,username,app_role,department FROM users WHERE role!='guest' AND status='approved' AND access_revoked=0 ORDER BY name").all<Row>()).results;
    return reply({people},200,cors);
  }
  if(path==='/finance/settings'&&method==='GET') {
    if(!staff)return reply({error:'Staff access required.'},403,cors);
    return reply(await approverSettings(env),200,cors);
  }
  if(path==='/finance/settings'&&method==='PUT') {
    if(!admin)return reply({error:'Admin only.'},403,cors);
    const body=await request.json() as Row;
    const finance=toCents(body.financeFrom),top=toCents(body.adminFrom);
    if(!Number.isSafeInteger(finance)||!Number.isSafeInteger(top))return reply({error:'Thresholds must be nonnegative numbers.'},400,cors);
    await env.DB.prepare("INSERT INTO finance_rules(id,finance_from_cents,admin_from_cents) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET finance_from_cents=excluded.finance_from_cents,admin_from_cents=excluded.admin_from_cents,updated_at=datetime('now')").bind(finance,top).run();
    return reply({ok:true},200,cors);
  }
  if(path==='/finance/assignments'&&method==='PUT') {
    if(!admin)return reply({error:'Admin only.'},403,cors);
    const body=await request.json() as Row;
    if(!['Department Head','Finance Officer'].includes(body.role)||typeof body.userId!=='string'||typeof body.department!=='string')return reply({error:'Invalid assignment.'},400,cors);
    const department=body.role==='Finance Officer'?'*':body.department.trim();
    if(!department)return reply({error:'Department required.'},400,cors);
    const target=await env.DB.prepare("SELECT id,role,department,status,access_revoked FROM users WHERE id=?").bind(body.userId).first<Row>();
    if(!target||target.role==='guest'||target.status!=='approved'||target.access_revoked) return reply({error:'Select an active staff account.'},400,cors);
    if(body.role==='Department Head'&&!same(target.department,department)&&target.role!=='admin')return reply({error:'Department Head must belong to the selected department.'},400,cors);
    await env.DB.prepare("INSERT INTO finance_approvers(step_role,department,user_id) VALUES(?,?,?) ON CONFLICT(step_role,department) DO UPDATE SET user_id=excluded.user_id,updated_at=datetime('now')").bind(body.role,department,body.userId).run();
    return reply({ok:true},200,cors);
  }
  if(path==='/finance/budgets'&&method==='PUT') {
    if(!admin)return reply({error:'Admin only.'},403,cors);
    const body=await request.json() as Row;
    const department=typeof body.department==='string'?body.department.trim():'';
    const cents=toCents(body.allocated);
    if(!department||department.length>120||!Number.isSafeInteger(cents))return reply({error:'Enter a valid department and allocation.'},400,cors);
    const {data}=await snapshot(env);
    const use=usage(data,department);
    if(cents<use.committedCents+use.spentCents)return reply({error:'Allocation cannot be smaller than current committed + spent amounts.'},409,cors);
    await env.DB.prepare("INSERT INTO department_budgets(department,allocated_cents,updated_by) VALUES(?,?,?) ON CONFLICT(department) DO UPDATE SET allocated_cents=excluded.allocated_cents,updated_by=excluded.updated_by,updated_at=datetime('now')").bind(department,cents,user.id).run();
    return reply({ok:true},200,cors);
  }
  if(path==='/finance/approvals'&&method==='GET') {
    if(!staff)return reply({error:'Staff access required.'},403,cors);
    const {data}=await snapshot(env);
    const financeAssigned = await env.DB.prepare("SELECT 1 AS assigned FROM finance_approvers WHERE step_role='Finance Officer' AND user_id=?").bind(user.id).first();
    return reply({requests:await approvalList(env,financeAssigned?{...user,app_role:'Finance Officer'}:user,data)},200,cors);
  }
  if(path==='/finance/approvals'&&method==='POST') {
    if(!staff)return reply({error:'Staff access required.'},403,cors);
    const body=await request.json() as Row;
    const {data}=await snapshot(env);
    const pr=data.requisitions.find(r=>r.id===body.prId);
    if(!pr||pr.status!=='Pending')return reply({error:'Only a pending PR can enter the workflow.'},409,cors);
    // Department Head is the submitting authority, NOT an approval step.
    // An Admin can submit legacy/unassigned PRs so records are not stranded.
    const departmentHead=await env.DB.prepare(
      "SELECT user_id FROM finance_approvers WHERE step_role='Department Head' AND department=?"
    ).bind(pr.department).first<{user_id:string}>();
    if(!departmentHead) {
      return reply({error:`Assign a Department Head for ${pr.department} under Department Budgets before submitting this requisition.`},409,cors);
    }
    if(!admin && (departmentHead.user_id!==user.id || !same(user.department,pr.department))) {
      return reply({error:`Only the assigned Department Head for ${pr.department} can submit this requisition. Ask the administrator to assign them under Department Budgets.`},403,cors);
    }
    const cents=toCents(pr.totalCost);
    if(!Number.isSafeInteger(cents))return reply({error:'Invalid PR amount.'},400,cors);
    const rules=await approverSettings(env);
    // Step 1 is an audit-only SUBMISSION marker. Approval starts at step 2.
    // Retaining this row keeps the existing D1 schema (total_steps >= 2) intact.
    const steps=['Department Head','Procurement Head'];
    if(cents>=toCents(rules.financeFrom))steps.push('Finance Officer');
    if(cents>=toCents(rules.adminFrom))steps.push('Admin');
    const now=new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO pr_approval_requests(pr_id,department,amount_cents,current_step,total_steps,requested_by,created_at) VALUES(?,?,?,2,?,?,?)').bind(pr.id,pr.department,cents,steps.length,departmentHead.user_id,now),
        env.DB.prepare("INSERT INTO pr_approval_steps(pr_id,step_no,step_role,status,comment,decided_at) VALUES(?,1,'Department Head','Approved',?,?)")
          .bind(pr.id,'Request submitted by Department Head; this is not an approval.',now),
        ...steps.slice(1).map((role,i)=>env.DB.prepare('INSERT INTO pr_approval_steps(pr_id,step_no,step_role) VALUES(?,?,?)').bind(pr.id,i+2,role))
      ]);
    } catch(e) { if(String(e).includes('UNIQUE')||String(e).includes('constraint')) return reply({error:'This PR already has an approval workflow.'},409,cors);throw e; }
    return reply({ok:true,steps},201,cors);
  }
  const decisionPath=path.match(/^\/finance\/approvals\/([^/]+)\/decision$/);
  if(decisionPath&&method==='POST') {
    if(!staff)return reply({error:'Staff access required.'},403,cors);
    const prId=decodeURIComponent(decisionPath[1]);
    const body=await request.json() as Row;
    if(!['approve','reject'].includes(body.decision)||typeof body.comment!=='string'||body.comment.length>1000||body.decision==='reject'&&!body.comment.trim())return reply({error:'Valid decision required; rejection must explain why.'},400,cors);
    const row=await env.DB.prepare('SELECT * FROM pr_approval_requests WHERE pr_id=?').bind(prId).first<Row>();
    if(!row||row.status!=='Pending')return reply({error:'Approval request is not pending.'},409,cors);
    const step=await env.DB.prepare('SELECT * FROM pr_approval_steps WHERE pr_id=? AND step_no=?').bind(prId,row.current_step).first<Row>();
    if(!step||step.status!=='Pending'||!await canApproveStep(env,user,step.step_role,row.department))return reply({error:'You are not the assigned approver for this step.'},403,cors);
    if(row.requested_by===user.id) return reply({error:'You cannot approve a requisition that you submitted. Another authorized approver must act.'},403,cors);
    const {data,text}=await snapshot(env);
    const pr=data.requisitions.find(p=>p.id===prId);
    // Report which invariant failed instead of blaming the requester for an edit.
    if(!pr)return reply({error:`${prId} is missing from the shared procurement records. An older device may have overwritten the cloud snapshot. Ask Admin to restore it; do not submit a duplicate.`,code:'PR_MISSING'},409,cors);
    if(pr.status!=='Pending')return reply({error:`${prId} shows status ${pr.status} while its multi-level approval remains Pending. Ask Admin to review and reconcile the status.`,code:'PR_STATUS_DESYNC',prStatus:pr.status},409,cors);
    if(toCents(pr.totalCost)!==Number(row.amount_cents))return reply({error:`${prId} amount is ${amount(toCents(pr.totalCost))} PHP, but ${amount(Number(row.amount_cents))} PHP was submitted for approval. Approval is blocked until Admin reviews this discrepancy.`,code:'PR_AMOUNT_MISMATCH'},409,cors);
    if(!same(pr.department,row.department))return reply({error:`${prId} department no longer matches the submitted approval request. Admin investigation is required.`,code:'PR_DEPARTMENT_MISMATCH'},409,cors);
    const final=body.decision==='reject'||row.current_step>=row.total_steps;
    const now=new Date().toISOString();
    if(body.decision==='approve'&&final) {
      const b=await env.DB.prepare('SELECT allocated_cents FROM department_budgets WHERE department=?').bind(row.department).first<Row>();
      const use=usage(data,row.department);
      if(!b||Number(b.allocated_cents)-use.spentCents-use.committedCents<Number(row.amount_cents))return reply({error:'Department budget missing or insufficient for final approval.'},409,cors);
    }
    const state=body.decision==='reject'?'Rejected':final?'Approved':'Pending';
    if(final){pr.status=state;}
    const changes=[
      env.DB.prepare("UPDATE pr_approval_steps SET status=?,decided_by=?,comment=?,decided_at=? WHERE pr_id=? AND step_no=? AND status='Pending'").bind(body.decision==='reject'?'Rejected':'Approved',user.id,body.comment.trim(),now,prId,row.current_step),
      env.DB.prepare("UPDATE pr_approval_requests SET status=?,current_step=?,decided_at=? WHERE pr_id=? AND status='Pending' AND current_step=?").bind(state,final?row.current_step:row.current_step+1,final?now:null,prId,row.current_step)
    ];
    if(final)changes.push(env.DB.prepare('UPDATE enterprise_state SET data=?,updated_at=? WHERE id=1 AND data=?').bind(JSON.stringify({...JSON.parse(text),requisitions:data.requisitions}),now,text));
    const results=await env.DB.batch(changes);
    if(results.some(r=>r.meta.changes!==1))return reply({error:'Concurrent workflow update detected. Refresh and retry; contact admin if status remains inconsistent.'},409,cors);
    return reply({ok:true,status:state,nextStep:final?null:row.current_step+1},200,cors);
  }
  // A pre-existing desync can arise if a stale browser snapshot changed a PR's
  // status while the D1 approval request remained Pending. Do not auto-approve it.
  // Admin may explicitly restore only a matching, unused PR to Pending.
  const reconcilePath=path.match(/^\/finance\/approvals\/([^/]+)\/reconcile$/);
  if(reconcilePath&&method==='POST') {
    if(!admin)return reply({error:'Only Admin can reconcile an approval status.'},403,cors);
    const prId=decodeURIComponent(reconcilePath[1]);
    const row=await env.DB.prepare('SELECT * FROM pr_approval_requests WHERE pr_id=?').bind(prId).first<Row>();
    if(!row||row.status!=='Pending')return reply({error:'There is no pending workflow for this PR.'},409,cors);
    const step=await env.DB.prepare('SELECT * FROM pr_approval_steps WHERE pr_id=? AND step_no=?').bind(prId,row.current_step).first<Row>();
    if(!step||step.status!=='Pending')return reply({error:'Approval steps are inconsistent; manual review is required.'},409,cors);
    const {data,text}=await snapshot(env);
    const pr=data.requisitions.find(p=>p.id===prId);
    if(!pr)return reply({error:'PR is missing from the shared snapshot. Restore its original record before proceeding.'},409,cors);
    if(pr.status==='Pending')return reply({ok:true,alreadyPending:true},200,cors);
    if(pr.status!=='Approved')return reply({error:`Cannot automatically reconcile status ${pr.status}. Review purchase orders and receipts first.`},409,cors);
    if(toCents(pr.totalCost)!==Number(row.amount_cents)||!same(pr.department,row.department))return reply({error:'Amount or department does not match the original submission. Do not reset without a manual review.'},409,cors);
    const entire=text?JSON.parse(text) as Record<string,unknown>:{};
    const stockNeeds=Array.isArray(entire.stockNeeds)?entire.stockNeeds as Row[]:[];
    if(data.orders.some(o=>o.prId===prId)||stockNeeds.some(sn=>sn.prId===prId))return reply({error:'A bidding need or Purchase Order already references this PR. Manual reconciliation is required.'},409,cors);
    pr.status='Pending';
    const auditLogs=Array.isArray(entire.auditLogs)?entire.auditLogs as Row[]:[];
    auditLogs.unshift({id:`log-reconcile-${crypto.randomUUID()}`,timestamp:new Date().toISOString(),user:user.name,role:'Admin',action:'PR Approval Status Reconciled',details:`Restored ${prId} to Pending; approval workflow still awaiting ${step.step_role}.`});
    const next=JSON.stringify({...entire,requisitions:data.requisitions,auditLogs});
    if(next.length>1_000_000)return reply({error:'Enterprise data exceeds the allowed size; ask Admin to archive old audit records.'},413,cors);
    const result=await env.DB.prepare('UPDATE enterprise_state SET data=?,updated_at=? WHERE id=1 AND data=?')
      .bind(next,new Date().toISOString(),text).run();
    if(result.meta.changes!==1)return reply({error:'Cloud data changed during reconciliation. Refresh and retry.'},409,cors);
    return reply({ok:true,prId,status:'Pending',nextApprover:step.step_role},200,cors);
  }
  if(path==='/finance/invoices'&&method==='GET') {
    const invoiceStaff=admin || ['Procurement Head','Procurement Officer'].includes(user.app_role) ||
      (staff && await canApproveStep(env,user,'Finance Officer','*'));
    if(!invoiceStaff && user.role!=='guest')return reply({invoices:[]},200,cors);
    const {data}=await snapshot(env);
    const invoices=(await env.DB.prepare('SELECT * FROM supplier_invoices ORDER BY submitted_at DESC').all<Row>()).results.filter(i=>canSeeInvoice(user,i));
    return reply({invoices:invoices.map(i=>({id:i.id,poId:i.po_id,supplierName:i.supplier_name,invoiceNo:i.invoice_number,amount:amount(i.amount_cents),invoiceDate:i.invoice_date,documentId:i.document_id,status:i.status,submittedAt:i.submitted_at,matchedAt:i.matched_at,reasons:inspectInvoice(data,i).reasons}))},200,cors);
  }
  if(path==='/finance/invoices'&&method==='POST') {
    // Only the supplier who owns the PO may submit the official invoice.
    // Procurement and Admin review it; an assigned Finance Officer confirms the match.
    if(user.role!=='guest' || user.app_role!=='Supplier')return reply({error:'Only the supplier account may submit an invoice. Staff and Admin can review it but cannot submit it on the supplier’s behalf.'},403,cors);
    const body=await request.json() as Row;
    const {data}=await snapshot(env);
    const po=data.orders.find(o=>o.id===body.poId);
    if(!po)return reply({error:'Purchase Order not found.'},404,cors);
    if(!same(user.company_name,po.supplierName))return reply({error:'Invoice must belong to your company.'},403,cors);
    if(!['Approved & Signed','Issued'].includes(String(po.status)))return reply({error:'The supplier must accept the Purchase Order before submitting an invoice.'},409,cors);
    const number=typeof body.invoiceNo==='string'?body.invoiceNo.trim():'';
    const cents=toCents(body.amount);
    const date=typeof body.invoiceDate==='string'?body.invoiceDate:'';
    if(!number||number.length>100||!Number.isSafeInteger(cents)||!/^(20\d\d)-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date))return reply({error:'Enter a valid invoice number, amount and date.'},400,cors);
    const id=crypto.randomUUID();
    const documentId=typeof body.documentId==='string'&&body.documentId.trim()?body.documentId.trim():null;
    if(!documentId)return reply({error:'Upload an invoice document linked to this PO before submitting.'},400,cors);
    const doc=await env.DB.prepare('SELECT id,uploader_id FROM procurement_documents WHERE id=? AND entity_type=? AND entity_id=? AND category=?').bind(documentId,'PO',po.id,'Invoice').first<Row>();
    if(!doc)return reply({error:'Choose an Invoice-category document linked to this PO.'},400,cors);
    if(doc.uploader_id!==user.id)return reply({error:'The invoice file must be uploaded by your own supplier account.'},403,cors);
    try{await env.DB.prepare('INSERT INTO supplier_invoices(id,po_id,supplier_name,invoice_number,amount_cents,invoice_date,document_id,submitted_by,submitted_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,po.id,po.supplierName,number,cents,date,documentId,user.id,new Date().toISOString()).run();}
    catch(e){if(String(e).includes('UNIQUE')||String(e).includes('constraint'))return reply({error:'Invoice number already registered for this supplier.'},409,cors);throw e;}
    return reply({ok:true,id},201,cors);
  }
  // Authenticated download for the invoice itself. Finance assignees may have an Employee
  // app role, so the general PO-document route would otherwise deny them access.
  const attachmentMatch=path.match(/^\/finance\/invoices\/([^/]+)\/attachment$/);
  if(attachmentMatch&&method==='GET') {
    const invoiceId=decodeURIComponent(attachmentMatch[1]);
    const inv=await env.DB.prepare('SELECT id,po_id,supplier_name,document_id FROM supplier_invoices WHERE id=?')
      .bind(invoiceId).first<Row>();
    if(!inv)return reply({error:'Invoice not found.'},404,cors);
    const permitted=admin || ['Procurement Head','Procurement Officer'].includes(user.app_role) ||
      (user.role==='guest'&&same(user.company_name,inv.supplier_name)) ||
      (staff&&await canApproveStep(env,user,'Finance Officer','*'));
    if(!permitted)return reply({error:'You are not authorized to download this invoice.'},403,cors);
    const doc=await env.DB.prepare("SELECT kv_key,file_name,mime_type FROM procurement_documents WHERE id=? AND entity_type='PO' AND entity_id=? AND category='Invoice'")
      .bind(inv.document_id,inv.po_id).first<{kv_key:string;file_name:string;mime_type:string}>();
    if(!doc)return reply({error:'The linked invoice file is missing from Document Management.'},404,cors);
    const data=await env.DOCUMENTS.get(doc.kv_key,'arrayBuffer');
    if(!data)return reply({error:'The invoice file is missing from cloud storage.'},404,cors);
    const filename=doc.file_name.replace(/[^a-zA-Z0-9._() -]/g,'_');
    return new Response(data,{status:200,headers:{...cors,
      'Content-Type':doc.mime_type,
      'Content-Disposition':`attachment; filename="${filename}"`,
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
    }});
  }
  const invoiceMatch=path.match(/^\/finance\/invoices\/([^/]+)\/match$/);
  if(invoiceMatch&&method==='POST') {
    if(!staff)return reply({error:'Staff access required.'},403,cors);
    const finance=await canApproveStep(env,user,'Finance Officer','*');
    if(!finance)return reply({error:'Only the assigned Finance Officer may confirm an invoice match. Admin can assign a reviewer in Department Budgets.'},403,cors);
    const id=decodeURIComponent(invoiceMatch[1]);
    const inv=await env.DB.prepare('SELECT * FROM supplier_invoices WHERE id=?').bind(id).first<Row>();
    if(!inv)return reply({error:'Invoice not found.'},404,cors);
    if(inv.status!=='Submitted')return reply({error:'Invoice is already matched.'},409,cors);
    const {data}=await snapshot(env);
    const check=inspectInvoice(data,inv);
    if(check.reasons.length)return reply({error:'PO, delivery and invoice do not match.',reasons:check.reasons},409,cors);
    const linkedDocument=await env.DB.prepare("SELECT id FROM procurement_documents WHERE id=? AND entity_type='PO' AND entity_id=? AND category='Invoice'")
      .bind(inv.document_id,inv.po_id).first();
    if(!linkedDocument)return reply({error:'The submitted invoice attachment is missing; it must be restored before verification.'},409,cors);
    const paid=data.payments.some(p=>p.poId===inv.po_id&&p.status==='Paid');
    if(paid)return reply({error:'PO has already been paid.'},409,cors);
    const existing=await env.DB.prepare("SELECT id FROM supplier_invoices WHERE po_id=? AND status='Matched'").bind(inv.po_id).first();
    if(existing)return reply({error:'Another invoice has been matched to this PO.'},409,cors);
    await env.DB.prepare("UPDATE supplier_invoices SET status='Matched',matched_by=?,matched_at=? WHERE id=? AND status='Submitted'").bind(user.id,new Date().toISOString(),id).run();
    return reply({ok:true},200,cors);
  }
  const matchStatus=path.match(/^\/finance\/match-status\/([^/]+)$/);
  if(matchStatus&&method==='GET') {
    const poId=decodeURIComponent(matchStatus[1]);
    const {data}=await snapshot(env);
    const po=data.orders.find(o=>o.id===poId);
    if(!po||user.role==='guest'&&!same(user.company_name,po.supplierName))return reply({error:'PO not available.'},404,cors);
    const inv=await env.DB.prepare("SELECT * FROM supplier_invoices WHERE po_id=? AND status='Matched' LIMIT 1").bind(poId).first<Row>();
    const reasons=inv?inspectInvoice(data,inv).reasons:['No verified invoice match for this Purchase Order.'];
    if(inv){
      const linked=await env.DB.prepare("SELECT id FROM procurement_documents WHERE id=? AND entity_type='PO' AND entity_id=? AND category='Invoice'")
        .bind(inv.document_id,poId).first();
      if(!linked)reasons.push('Matched invoice attachment is missing.');
    }
    return reply({matched:!!inv&&reasons.length===0,reasons,invoiceId:inv?.id??null},200,cors);
  }
  // The Admin may restore ONE missing original record from a trusted JSON backup.
  // Never manufacture a PR or PO from incomplete workflow metadata.
  if(path==='/finance/admin/restore-record'&&method==='POST') {
    if(!admin)return reply({error:'Administrator account required.'},403,cors);
    const body=await request.json() as Row;
    if(!['PR','PO'].includes(body.kind)||!body.record||typeof body.record!=='object'||Array.isArray(body.record))
      return reply({error:'A saved PR or PO object from a backup is required.'},400,cors);
    const record=body.record as Row;
    const kind=body.kind as 'PR'|'PO';
    if(typeof record.id!=='string'||!(/^(PR|PO)-[A-Za-z0-9_-]{1,50}$/.test(record.id)) ||
       (kind==='PR'&&!record.id.startsWith('PR-')) || (kind==='PO'&&!record.id.startsWith('PO-')))
      return reply({error:'The backup record has an invalid reference.'},400,cors);
    if(JSON.stringify(record).length>20_000)return reply({error:'The selected record is too large.'},413,cors);
    const {data,text}=await snapshot(env);
    if(!text)return reply({error:'No shared procurement snapshot exists. Contact an administrator.'},409,cors);
    const original=JSON.parse(text) as Record<string,unknown>;
    const records=kind==='PR'?data.requisitions:data.orders;
    if(records.some(item=>item.id===record.id))return reply({error:`${record.id} already exists; no replacement was made.`},409,cors);
    if(kind==='PR') {
      const approval=await env.DB.prepare('SELECT status,department,amount_cents FROM pr_approval_requests WHERE pr_id=?')
        .bind(record.id).first<Row>();
      if(!approval)return reply({error:'No saved D1 approval workflow exists for this PR. Do not create a new approval history from an unverified record.'},409,cors);
      if(typeof record.itemTitle!=='string'||!record.itemTitle.trim()||typeof record.specs!=='string'||!record.specs.trim()||
         !Number.isInteger(Number(record.quantity))||Number(record.quantity)<1||!Number.isFinite(Number(record.unitPrice))||
         !Number.isFinite(Number(record.totalCost))||
         toCents(record.totalCost)!==Number(approval.amount_cents)||
         toCents(Number(record.quantity)*Number(record.unitPrice))!==Number(approval.amount_cents)||
         !same(record.department,approval.department)||record.status!==approval.status ||
         typeof record.createdAt!=='string'||!record.createdAt||
         typeof record.requestedBy!=='string'||!record.requestedBy.trim())
        return reply({error:'Backup PR does not match the original workflow (department, amount, status, requester, or required details). No record restored.'},409,cors);
      if(approval.status==='Pending'&&(data.orders.some(o=>o.prId===record.id)||
          (Array.isArray(original.stockNeeds)&&(original.stockNeeds as Row[]).some(sn=>sn.prId===record.id))))
        return reply({error:'This pending PR has a linked stock need or PO. Manual investigation required.'},409,cors);
    } else {
      const pr=data.requisitions.find(item=>item.id===record.prId);
      const orphanInvoice=await env.DB.prepare('SELECT supplier_name,amount_cents FROM supplier_invoices WHERE po_id=? LIMIT 1')
        .bind(record.id).first<Row>();
      const linkedDelivery=data.deliveries.some(item=>item.poId===record.id);
      const linkedPayment=data.payments.some(item=>item.poId===record.id);
      if(!orphanInvoice&&!linkedDelivery&&!linkedPayment)
        return reply({error:'No existing invoice, delivery, or payment references this missing PO. Restore is limited to orphaned historical orders.'},409,cors);
      if(!pr||!['Approved','In Process','Completed'].includes(pr.status))
        return reply({error:'Restore the corresponding approved requisition before the PO.'},409,cors);
      if(!['Issued','Approved & Signed'].includes(record.status)||
         typeof record.supplierName!=='string'||!record.supplierName.trim()||
         typeof record.itemTitle!=='string'||!record.itemTitle.trim()||
         !Number.isInteger(Number(record.quantity))||Number(record.quantity)<1||
         !Number.isSafeInteger(toCents(record.totalCost))||toCents(record.totalCost)<0||
         !same(record.prId,pr.id)||!same(record.department,pr.department)||
         (orphanInvoice&&(!same(orphanInvoice.supplier_name,record.supplierName)||
           Number(orphanInvoice.amount_cents)!==toCents(record.totalCost))))
        return reply({error:'PO backup does not agree with its existing PR or supplier invoice, or is missing signed/issued details.'},409,cors);
    }
    records.push(record);
    const logs=Array.isArray(original.auditLogs)?original.auditLogs as Row[]:[];
    logs.unshift({id:`log-restore-${crypto.randomUUID()}`,timestamp:new Date().toISOString(),
      user:user.name,role:'Admin',action:'Historical Record Restored',
      details:`${kind} ${record.id} restored from an Admin-supplied JSON backup; original approvals and invoice states were not altered.`});
    const next=JSON.stringify({...original,[kind==='PR'?'requisitions':'orders']:records,auditLogs:logs});
    if(next.length>1_000_000)return reply({error:'Cloud snapshot size limit exceeded. Record not restored.'},413,cors);
    const result=await env.DB.prepare('UPDATE enterprise_state SET data=?,updated_at=? WHERE id=1 AND data=?')
      .bind(next,new Date().toISOString(),text).run();
    if(result.meta.changes!==1)return reply({error:'Cloud data changed during restoration. Refresh and retry.'},409,cors);
    return reply({ok:true,kind,id:record.id},200,cors);
  }
  // A full reset must also clear the D1 approvals and invoice rows; a normal
  // enterprise-state PUT only clears JSON and leaves misleading orphan history.
  if(path==='/finance/admin/reset-workspace'&&method==='POST') {
    if(!admin)return reply({error:'Only the Administrator can reset procurement history.'},403,cors);
    const body=await request.json() as Row;
    if(body.confirmation!=='RESET')return reply({error:'Type RESET to confirm the complete procurement history reset.'},400,cors);
    const {text}=await snapshot(env);
    const prior=text?JSON.parse(text) as Record<string,unknown>:{};
    const blank=['stockNeeds','bids','proposalMeetings','requisitions','orders','deliveries',
      'amendments','payments','suppliers','ratings'].reduce((obj,key)=>({...obj,[key]:[]}),{} as Record<string,unknown>);
    const resetLog={id:`log-reset-${crypto.randomUUID()}`,timestamp:new Date().toISOString(),
      user:user.name,role:'Admin',action:'Procurement Records Reset',
      details:'Admin cleared procurement records, PR approval history, invoices and notification read history. User accounts, Finance settings, and uploaded documents were retained.'};
    const data={...prior,...blank,auditLogs:[resetLog]};
    const now=new Date().toISOString();
    // D1 batch is transactional. Never reset only the JSON while keeping old
    // approval/invoice rows (the source of the orphan records in the screenshots).
    await env.DB.batch([
      env.DB.prepare('DELETE FROM supplier_invoices'),
      env.DB.prepare('DELETE FROM pr_approval_steps'),
      env.DB.prepare('DELETE FROM pr_approval_requests'),
      env.DB.prepare('DELETE FROM notification_reads'),
      env.DB.prepare('INSERT INTO enterprise_state(id,data,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(JSON.stringify(data),now)
    ]);
    return reply({ok:true,auditLogs:[resetLog]},200,cors);
  }
  return reply({error:'Finance route not found.'},404,cors);
}

/** Reject direct client-side bypasses of approval and three-way match when cloud-syncing. */
export async function validateFinanceSnapshotWrite(env:FinanceEnv, incoming:Record<string,unknown>, previous:Record<string,unknown>,actor:FinanceUser):Promise<string|null> {
  const priorLogs=Array.isArray(previous.auditLogs)?previous.auditLogs as Row[]:[];
  const incomingLogs=Array.isArray(incoming.auditLogs)?incoming.auditLogs as Row[]:[];
  const latestReset=priorLogs.find(log=>log.action==='Procurement Records Reset' &&
    typeof log.id==='string' && log.id.startsWith('log-reset-'));
  if(latestReset&&!incomingLogs.some(log=>log.id===latestReset.id))
    return 'This device has an outdated workspace from before the Admin reset. Sign out and sign back in before saving.';
  const oldPrs=(Array.isArray(previous.requisitions)?previous.requisitions:[]) as Row[];
  const newPrs=(Array.isArray(incoming.requisitions)?incoming.requisitions:[]) as Row[];
  // Only genuine D1 Admin accounts may clear the shared procurement workspace.
  // Excluding auditLogs permits a new audit event to remain after an authorized reset.
  const businessCollections=['stockNeeds','bids','proposalMeetings','requisitions','orders','deliveries','amendments','payments','suppliers','ratings'];
  const clearsEveryCollection=businessCollections.every(k=>Array.isArray(incoming[k])&&(incoming[k] as unknown[]).length===0);
  const previouslyHadRecords=businessCollections.some(k=>Array.isArray(previous[k])&&(previous[k] as unknown[]).length>0);
  if(clearsEveryCollection&&previouslyHadRecords)
    return actor.role==='admin'
      ? 'Use the Admin Reset System Database control so approval and invoice history are also cleared.'
      : 'Only Admin may reset or clear the shared procurement database.';
  // Full-snapshot saves may originate from another open browser session.
  // Once a PR enters D1 approvals, its pending details must not be silently
  // changed, removed or overwritten by a stale local snapshot.
  const pendingWorkflows=(await env.DB.prepare("SELECT pr_id,department,amount_cents FROM pr_approval_requests WHERE status='Pending'").all<Row>()).results;
  const protectedFields=['id','status','department','itemTitle','specs','quantity','unitPrice','totalCost','targetDate','remarks','requestedBy','requestedByUsername','createdAt'];
  for(const approval of pendingWorkflows){
    const before=oldPrs.filter(p=>p.id===approval.pr_id);
    const after=newPrs.filter(p=>p.id===approval.pr_id);
    // An older approval request can already refer to a PR missing from BOTH
    // the stored snapshot and the incoming snapshot. Do not reject unrelated
    // audit/notification/business updates just because of that pre-existing
    // inconsistency. The approval endpoint still prevents approving a missing PR.
    // Crucially, adding, removing, duplicating or changing any tracked PR is
    // still rejected while its approval request is Pending.
    if(before.length===0&&after.length===0)continue;
    if(before.length!==1||after.length!==1)return `PR ${approval.pr_id} is under multi-level approval and cannot be added, removed, duplicated, or replaced by an outdated device. Reload procurement data first.`;
    if(protectedFields.some(field=>JSON.stringify(before[0][field]??null)!==JSON.stringify(after[0][field]??null)))
      return `PR ${approval.pr_id} is under multi-level approval and its submitted fields cannot be overwritten by a stale browser session. Refresh and retry.`;
  }
  const oldPayments=(Array.isArray(previous.payments)?previous.payments:[]) as Row[];
  const newPayments=(Array.isArray(incoming.payments)?incoming.payments:[]) as Row[];
  const newOrders=(Array.isArray(incoming.orders)?incoming.orders:[]) as Row[];
  const oldOrders=(Array.isArray(previous.orders)?previous.orders:[]) as Row[];
  // Prevent routine full-snapshot writes from silently deleting issued POs or
  // approved requisitions. An Admin reset uses the separate atomic endpoint.
  for (const old of oldOrders) {
    if(newOrders.some(po=>po.id===old.id))continue;
    const historicalInvoice=await env.DB.prepare('SELECT id FROM supplier_invoices WHERE po_id=? LIMIT 1')
      .bind(old.id).first<Row>();
    const linked=oldPayments.some(payment=>payment.poId===old.id) ||
      (Array.isArray(previous.deliveries) && (previous.deliveries as Row[]).some(d=>d.poId===old.id));
    if(historicalInvoice || linked || ['Issued','Approved & Signed'].includes(old.status))
      return `PO ${old.id} is missing from this device's save but has historical commitments. Reload the workspace instead of overwriting the PO.`;
  }
  for (const old of oldPrs) {
    if(newPrs.some(pr=>pr.id===old.id))continue;
    const approval=await env.DB.prepare('SELECT pr_id FROM pr_approval_requests WHERE pr_id=? LIMIT 1')
      .bind(old.id).first<Row>();
    if(approval || oldOrders.some(po=>po.prId===old.id) || ['Approved','In Process','Completed'].includes(old.status))
      return `PR ${old.id} is missing from this device's save but is part of an approval or order history. Reload the workspace instead.`;
  }
  for(const po of newOrders){
    if(oldOrders.some(o=>o.id===po.id))continue;
    if(actor.role!=='admin'&&actor.app_role!=='Procurement Head')return `Only Procurement Head/Admin may issue new POs.`;
    const pr=oldPrs.find(r=>r.id===po.prId);
    if(!pr||pr.status!=='Approved')return `PO ${po.id} requires an approved Purchase Requisition.`;
    const budget=await env.DB.prepare('SELECT allocated_cents FROM department_budgets WHERE department=?').bind(pr.department).first<Row>();
    if(!budget)return `Department budget is missing for ${pr.department}.`;
    const summary=usage({requisitions:oldPrs,orders:oldOrders,payments:oldPayments,deliveries:[]},pr.department);
    const before=toCents(pr.totalCost),actual=toCents(po.totalCost);
    if(!Number.isSafeInteger(actual)||Number(budget.allocated_cents)-summary.committedCents-summary.spentCents<actual-before)
      return `Insufficient department allocation for PO ${po.id}.`;
  }
  for(const pr of newPrs){
    const old=oldPrs.find(r=>r.id===pr.id);
    if(old?.status==='Pending'&&!['Pending','Rejected'].includes(pr.status)){
      const req=await env.DB.prepare('SELECT status FROM pr_approval_requests WHERE pr_id=?').bind(pr.id).first<Row>();
      if(req?.status!=='Approved')return `PR ${pr.id} must complete the multi-level approval workflow first.`;
    }
    if(old?.status==='Approved'&&pr.status==='Pending')return `Cannot reverse approved PR ${pr.id} via snapshot save.`;
  }
  for(const payment of newPayments){
    const old=oldPayments.find(p=>p.id===payment.id);
    if(payment.status==='Paid'&&old?.status!=='Paid'){
      const po=newOrders.find(o=>o.id===payment.poId);
      if(!po)return `Payment ${payment.id} is missing its Purchase Order.`;
      const inv=await env.DB.prepare("SELECT * FROM supplier_invoices WHERE po_id=? AND status='Matched' LIMIT 1").bind(payment.poId).first<Row>();
      if(!inv)return `Payment blocked for ${payment.poId}: three-way invoice match is required.`;
      const document=await env.DB.prepare("SELECT id FROM procurement_documents WHERE id=? AND entity_type='PO' AND entity_id=? AND category='Invoice'")
        .bind(inv.document_id,payment.poId).first();
      if(!document)return `Payment blocked for ${payment.poId}: matched invoice attachment is missing.`;
      const data=incoming as unknown as Snapshot;
      const test=inspectInvoice(data,inv);
      if(test.reasons.length)return `Payment blocked for ${payment.poId}: ${test.reasons.join(' ')}`;
    }
  }
  return null;
}
