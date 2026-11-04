/** Phase 5: end-to-end Worker HTTP contract tests using actual migrations + SQLite.
 * No network access and no production D1 data. Exercise the real API handlers.
 */
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {loadWorkerForTests} from './helpers/workerRunner.mjs';
import {LocalD1,emptyWorkspace} from './helpers/localD1.mjs';
let worker,dispose;
before(async()=>({worker,dispose}=await loadWorkerForTests()));
after(async()=>{if(dispose)await dispose();});
const clone=structuredClone;
const userAccounts=[
 {id:'admin',username:'admin',name:'Admin',role:'admin',app_role:'Admin',department:'Executive'},
 {id:'employee',username:'alice',name:'Alice',role:'employee',app_role:'Employee',department:'IT Systems'},
 {id:'hr-employee',username:'bob',name:'Bob',role:'employee',app_role:'Employee',department:'Human Resource'},
 {id:'head',username:'ithead',name:'IT Head',role:'employee',app_role:'Employee',department:'IT Systems'},
 {id:'proc',username:'proc',name:'Proc Head',role:'employee',app_role:'Procurement Head',department:'Procurement'},
 {id:'ops',username:'ops',name:'Operations Head',role:'employee',app_role:'Employee',department:'Operations'},
 {id:'finance',username:'fin',name:'Finance Officer',role:'employee',app_role:'Employee',department:'Finance & Accounting'},
 {id:'finhead',username:'finhead',name:'Finance Head',role:'employee',app_role:'Employee',department:'Finance & Accounting'},
 {id:'unassigned',username:'una',name:'Finance Employee',role:'employee',app_role:'Employee',department:'Finance & Accounting'},
 {id:'vendorA',username:'vendora',name:'Acme Rep',role:'guest',app_role:'Supplier',company_name:'Acme Supplies'},
 {id:'vendorB',username:'vendorb',name:'Beta Rep',role:'guest',app_role:'Supplier',company_name:'Beta Supplies'},
];
const request=async(db,user,path,{method='GET',body,token}={})=>{
 const headers=body===undefined?{}:{'Content-Type':'application/json'};
 if(token) headers.Authorization=`Bearer ${token}`;
 else if(user) headers.Authorization=`Bearer ${await login(db,user)}`;
 const res=await worker.fetch(new Request('https://api.test'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db,DOCUMENTS:{}});
 let data;try{data=await res.json();}catch{data=null;}
 return {status:res.status,data};
};
const tokens=new WeakMap();
async function login(db,user){
 let saved=tokens.get(db);
 if(saved?.[user])return saved[user];
 const result=await request(db,null,'/auth/login',{method:'POST',body:{username:user,password:'test-password-123'}});
 assert.equal(result.status,200,JSON.stringify(result));
 assert.ok(result.data.token,`No token for ${user}: ${JSON.stringify(result.data)}`);
 if(!saved){saved={};tokens.set(db,saved);}saved[user]=result.data.token;
 return saved[user];
}
function setup({workspace:input, financeFrom=0, adminFrom=0, financeHeadFrom=1000000}={}) {
 const db=new LocalD1();
 for(const account of userAccounts)db.seedUser(account);
 db.db.prepare("INSERT INTO finance_approvers(step_role,department,user_id) VALUES('Department Head','IT Systems','head')").run();
 db.db.prepare("INSERT INTO finance_approvers(step_role,department,user_id) VALUES('Department Head','Procurement','proc')").run();
 db.db.prepare("INSERT INTO finance_approvers(step_role,department,user_id) VALUES('Department Head','Finance & Accounting','finhead')").run();
 db.db.prepare("INSERT INTO finance_approvers(step_role,department,user_id) VALUES('Finance Officer','*','finance')").run();
 db.db.prepare('UPDATE finance_rules SET finance_from_cents=?,admin_from_cents=?,finance_head_from_cents=? WHERE id=1')
  .run(Math.round(financeFrom*100),Math.round(adminFrom*100),Math.round(financeHeadFrom*100));
 db.db.prepare("INSERT INTO department_budgets(department,allocated_cents,updated_by) VALUES('IT Systems',1000000,'admin')").run();
 const workspace=input??emptyWorkspace();
 db.seedWorkspace(workspace);
 return db;
}
const read=db=>JSON.parse(db.db.prepare('SELECT data FROM enterprise_state WHERE id=1').get().data);
const row=(db,collection,id)=>read(db)[collection].find(r=>r.id===id);
const delta=(collection,before,after)=>({collection,id:(after??before).id,before:before?clone(before):null,after:after?clone(after):null});
const patch=(db,as,changes)=>request(db,as,'/enterprise-state/changes',{method:'POST',body:{changes}});
const requisition=(id='PR-5')=>({id,itemTitle:'Circuit boards',specs:'Test components',quantity:5,unit:'pcs',unitPrice:100,totalCost:500,
 department:'IT Systems',requestedBy:'Alice',requestedByUsername:'alice',status:'Pending',targetDate:'2026-12-01'});
const seeded=()=>{
 const w=emptyWorkspace();w.suppliers=[
 {id:'SUP-A',name:'Acme Supplies',contact:'Sales A',bankDetails:'ACME-BANK',bankAccountNumber:'A-111'},
 {id:'SUP-B',name:'Beta Supplies',contact:'Sales B',bankDetails:'BETA-BANK'}];
 return w;
};

test('Phase 5 HTTP: bearer auth enforced; session login works; revoked users lose access',async()=>{
 const db=setup();try{
  assert.equal((await request(db,null,'/auth/me')).status,401);
  assert.equal((await request(db,null,'/auth/me',{token:'bogus'})).status,401);
  const me=await request(db,'alice','/auth/me');
  assert.equal(me.status,200);assert.equal(me.data.user.username,'alice');
  db.db.prepare("UPDATE users SET access_revoked=1 WHERE id='employee'").run();
  assert.equal((await request(db,'alice','/auth/me')).status,401);
 }finally{db.close();}
});

test('Phase 5 HTTP: employee submits own PR; D1 index and immutable audit evidence remain synchronized',async()=>{
 const db=setup();try{
  const pr=requisition();
  const sent=await patch(db,'alice',[delta('requisitions',null,pr)]);
  assert.equal(sent.status,200,JSON.stringify(sent));
  assert.equal(row(db,'requisitions',pr.id).totalCost,500);
  const index=db.db.prepare("SELECT payload FROM workspace_record_index WHERE collection='requisitions' AND record_id=?").get(pr.id);
  assert.deepEqual(JSON.parse(index.payload),pr);
  const audit=db.db.prepare("SELECT action,actor_id FROM audit_evidence WHERE entity_type='requisitions' AND entity_ref=?").get(pr.id);
  assert.deepEqual({...audit},{action:'Created',actor_id:'employee'});
  assert.throws(()=>db.db.prepare("DELETE FROM audit_evidence WHERE entity_ref=?").run(pr.id),/cannot be deleted/);
  const outsider=await patch(db,'bob',[delta('requisitions',pr,{...pr,remarks:'Hacked'})]);
  assert.equal(outsider.status,403,JSON.stringify(outsider));
  assert.equal(row(db,'requisitions',pr.id).remarks,undefined);
 }finally{db.close();}
});

test('Phase 5 HTTP: parallel unrelated edits merge; stale changes are rejected (409)',async()=>{
 const w=seeded();w.requisitions=[requisition('PR-A'),requisition('PR-B')];
 const db=setup({workspace:w});try{
  const origA=clone(w.requisitions[0]),origB=clone(w.requisitions[1]);
  const a=await patch(db,'alice',[delta('requisitions',origA,{...origA,remarks:'first'})]);
  const b=await patch(db,'alice',[delta('requisitions',origB,{...origB,remarks:'second'})]);
  assert.equal(a.status,200,JSON.stringify(a));assert.equal(b.status,200,JSON.stringify(b));
  const stale=await patch(db,'alice',[delta('requisitions',origA,{...origA,remarks:'stale'})]);
  assert.equal(stale.status,409,JSON.stringify(stale));
  assert.equal(row(db,'requisitions',origA.id).remarks,'first');
  assert.equal(row(db,'requisitions',origB.id).remarks,'second');
 }finally{db.close();}
});

test('Phase 5 HTTP: supplier and department data isolation, Finance appointment required',async()=>{
 const w=seeded();w.requisitions=[requisition('PR-1'),{...requisition('PR-2'),requestedBy:'Bob',requestedByUsername:'bob',department:'Human Resource'}];
 w.stockNeeds=[{id:'NEED-1',prId:'PR-1',title:'Components',status:'Published'}];
 w.bids=[{id:'BID-A',needId:'NEED-1',supplierId:'SUP-A',supplierName:'Acme Supplies',status:'Submitted'},
         {id:'BID-B',needId:'NEED-1',supplierId:'SUP-B',supplierName:'Beta Supplies',status:'Submitted'}];
 w.payments=[{id:'PAY-1',poId:'PO-1',status:'Pending',bankDetails:'PRIVATE_REF',refNumber:'PRIVATE'}];
 const db=setup({workspace:w});try{
  const alice=await request(db,'alice','/enterprise-state');
  assert.equal(alice.status,200);assert.deepEqual(alice.data.data.requisitions.map(p=>p.id),['PR-1']);
  const vendor=await request(db,'vendora','/enterprise-state');
  assert.equal(vendor.status,200);assert.deepEqual(vendor.data.data.bids.map(p=>p.id),['BID-A']);
  assert.deepEqual(vendor.data.data.requisitions,[]);
  assert.ok(!JSON.stringify(vendor.data).includes('BETA-BANK'));
  const proc=await request(db,'proc','/enterprise-state');
  assert.equal(proc.status,200);assert.ok(!JSON.stringify(proc.data).includes('ACME-BANK'));
  const unassigned=await request(db,'una','/enterprise-state');
  assert.equal(unassigned.status,200);assert.ok(!JSON.stringify(unassigned.data).includes('PRIVATE_REF'));
  const fin=await request(db,'fin','/enterprise-state');
  assert.equal(fin.status,200);assert.ok(JSON.stringify(fin.data).includes('ACME-BANK'));
  const noAudit=await request(db,'bob','/audit-evidence');assert.equal(noAudit.status,403);
 }finally{db.close();}
});

test('Phase 5 HTTP: paginated D1 read rejects invalid limits and returns scoped results',async()=>{
 const w=seeded();w.requisitions=[requisition('PR-1'),requisition('PR-3'),{...requisition('PR-2'),department:'Human Resource',requestedBy:'Bob',requestedByUsername:'bob'}];
 const db=setup({workspace:w});try{
  const page=await request(db,'alice','/workspace-records?collection=requisitions&limit=1&offset=0');
  assert.equal(page.status,200,JSON.stringify(page));
  assert.equal(page.data.total,2);assert.deepEqual(page.data.records.map(r=>r.id),['PR-1']);
  assert.equal((await request(db,'alice','/workspace-records?collection=requisitions&limit=1000')).status,400);
  // Deliberately corrupt the derived index; API must report drift, not partial data.
  db.db.prepare("DELETE FROM workspace_record_index WHERE collection='requisitions' AND record_id='PR-1'").run();
  const drift=await request(db,'admin','/workspace-records?collection=requisitions');
  assert.equal(drift.status,409,JSON.stringify(drift));
 }finally{db.close();}
});

test('Phase 5 HTTP: requisition workflow enforces approval order, budget and independent decision makers',async()=>{
 const db=setup();try{
  const pr=requisition('PR-APP');
  assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  assert.equal((await request(db,'alice','/finance/approvals',{method:'POST',body:{prId:pr.id}})).status,403);
  const sent=await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}});
  assert.equal(sent.status,201,JSON.stringify(sent));
  assert.deepEqual(sent.data.steps,['Department Head','Procurement Head','Finance Officer','Admin']);
  assert.equal((await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}})).status,409);
  const decision=(as,choice='approve',comment='Approved for the test')=>request(db,as,`/finance/approvals/${pr.id}/decision`,{method:'POST',body:{decision:choice,comment}});
  assert.equal((await decision('fin')).status,403,'Finance must not jump Procurement');
  assert.equal((await decision('bob')).status,403);
  assert.equal((await decision('proc')).status,200);
  assert.equal((await decision('admin')).status,403,'Admin must not jump Finance');
  assert.equal((await decision('fin')).status,200);
  const final=await decision('admin');
  assert.equal(final.status,200,JSON.stringify(final));assert.equal(final.data.status,'Approved');
  assert.equal(row(db,'requisitions',pr.id).status,'Approved');
  assert.equal((await decision('admin')).status,409);
 }finally{db.close();}
});

test('Phase 5 HTTP: rejected request stays rejected; missing budget blocks final approval',async()=>{
 const db=setup();try{
  const pr=requisition('PR-REJ');assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  assert.equal((await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}})).status,201);
  const reject=await request(db,'proc',`/finance/approvals/${pr.id}/decision`,{method:'POST',body:{decision:'reject',comment:'Incomplete specification'}});
  assert.equal(reject.status,200,JSON.stringify(reject));
  assert.equal(row(db,'requisitions',pr.id).status,'Rejected');
  assert.equal((await request(db,'admin',`/finance/approvals/${pr.id}/decision`,{method:'POST',body:{decision:'approve',comment:''}})).status,409);
  const second=requisition('PR-NOBUDGET');assert.equal((await patch(db,'alice',[delta('requisitions',null,second)])).status,200);
  assert.equal((await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:second.id}})).status,201);
  for(const user of ['proc','fin'])assert.equal((await request(db,user,`/finance/approvals/${second.id}/decision`,{method:'POST',body:{decision:'approve',comment:''}})).status,200);
  db.db.prepare("DELETE FROM department_budgets WHERE department='IT Systems'").run();
  const denied=await request(db,'admin',`/finance/approvals/${second.id}/decision`,{method:'POST',body:{decision:'approve',comment:''}});
  assert.equal(denied.status,409,JSON.stringify(denied));
  assert.equal(row(db,'requisitions',second.id).status,'Pending');
 }finally{db.close();}
});

const quote={version:1,offeredModel:'FR4 printed circuit board',specificationClaim:'fully-compliant',specificationExceptions:'',
 deliveryCommitment:'firm',warrantyMonths:12,warrantyCoverage:'parts-labor',warrantyService:'Factory replacement',
 replacementDays:14,paymentCondition:'after-acceptance',validityDays:30,afterSalesSupport:'included',
 supportingReference:'',additionalClauses:'',supplierDeclaration:true};
function seedVendorAccreditation(db,id='vendorA'){
 db.db.prepare('INSERT INTO supplier_accreditations(supplier_user_id,status) VALUES(?,?)').run(id,'Approved');
 for(const [i,cat] of ['Business Registration','Tax Certificate','Business Permit'].entries())
   db.db.prepare(`INSERT INTO supplier_accreditation_files
    (id,supplier_user_id,category,file_name,mime_type,size,kv_key,valid_until)
    VALUES(?,?,?,?,?,?,?,?)`).run(`file-${id}-${i}`,id,cat,`${cat}.pdf`,'application/pdf',10,`test/${id}/${i}`,'2030-01-01');
}
function seedBiddingDeadline(db,needId,closesAt=new Date(Date.now()+86400000).toISOString()){
 db.db.prepare('INSERT INTO sourcing_deadlines(need_id,closes_at,updated_by) VALUES(?,?,?)')
   .run(needId,closesAt,'proc');
}
function awardedBase(){
 const w=seeded();w.requisitions=[{...requisition('PR-ORDER'),status:'Approved'}];
 w.stockNeeds=[{id:'NEED-ORDER',prId:'PR-ORDER',title:'Circuit boards',status:'Supplier Selected',selectedBidId:'BID-ORDER',targetQty:5}];
 w.bids=[{id:'BID-ORDER',needId:'NEED-ORDER',supplierId:'SUP-A',supplierName:'Acme Supplies',status:'Selected',unitPrice:100,totalCost:500,leadTimeDays:4}];
 return w;
}

// Supplied supplier quotations are server-owned. A UI status change cannot bypass accreditation or cutoffs.
test('Phase 5 HTTP: supplier bidding requires active accreditation and an open deadline; duplicates blocked',async()=>{
 const w=seeded();w.requisitions=[{...requisition('PR-BID'),status:'Approved'}];
 w.stockNeeds=[{id:'NEED-BID',prId:'PR-BID',title:'Circuit boards',status:'Published',targetQty:5}];
 const db=setup({workspace:w});try{
  const body={needId:'NEED-BID',unitPrice:100,leadTimeDays:4,notes:'Tests',quotationTerms:quote};
  const withoutAccreditation=await request(db,'vendora','/sourcing/bids',{method:'POST',body});
  assert.equal(withoutAccreditation.status,403,JSON.stringify(withoutAccreditation));
  seedVendorAccreditation(db);
  const withoutDeadline=await request(db,'vendora','/sourcing/bids',{method:'POST',body});
  assert.equal(withoutDeadline.status,409,JSON.stringify(withoutDeadline));
  seedBiddingDeadline(db,'NEED-BID');
  const accepted=await request(db,'vendora','/sourcing/bids',{method:'POST',body});
  assert.equal(accepted.status,201,JSON.stringify(accepted));
  assert.equal(accepted.data.bid.supplierName,'Acme Supplies');
  assert.equal((await request(db,'vendora','/sourcing/bids',{method:'POST',body})).status,409);
  assert.equal((await request(db,'vendorb','/sourcing/bids')).status,200);
  assert.deepEqual((await request(db,'vendorb','/sourcing/bids')).data.bids,[]);
  const injected=await patch(db,'vendora',[delta('bids',null,{id:'FAKE-BID',supplierId:'SUP-A',supplierName:'Acme Supplies'})]);
  assert.equal(injected.status,403,JSON.stringify(injected));
  // Another need may still be open but the deadline governs submission.
  const need2={id:'NEED-CLOSED',prId:'PR-BID',title:'Other supplies',status:'Published',targetQty:5};
  assert.equal((await patch(db,'proc',[delta('stockNeeds',null,need2)])).status,200);
  seedBiddingDeadline(db,'NEED-CLOSED',new Date(Date.now()-60000).toISOString());
  const expired=await request(db,'vendora','/sourcing/bids',{method:'POST',body:{...body,needId:need2.id}});
  assert.equal(expired.status,409,JSON.stringify(expired));
 }finally{db.close();}
});

test('Phase 5 HTTP: awarded bid -> PO -> supplier acceptance -> inspection -> invoice match -> Finance payment',async()=>{
 const db=setup({workspace:awardedBase()});try{
  const approved=row(db,'requisitions','PR-ORDER');
  const po={id:'PO-ORDER',prId:'PR-ORDER',needId:'NEED-ORDER',bidId:'BID-ORDER',supplierId:'SUP-A',supplierName:'Acme Supplies',
     itemTitle:'Circuit boards',status:'Awaiting Supplier Signature',createdByName:'Proc Head',quantity:5,unit:'pcs',unitPrice:100,totalCost:500,department:'IT Systems'};
  const pay={id:'PAY-ORDER',poId:'PO-ORDER',totalAmount:500,paymentAmount:500,status:'Pending',supplierName:'Acme Supplies',department:'IT Systems',deliveryVerified:false};
  const issue=await patch(db,'proc',[delta('requisitions',approved,{...approved,status:'In Process'}),delta('orders',null,po),delta('payments',null,pay)]);
  assert.equal(issue.status,200,JSON.stringify(issue));
  const otherSigner=await patch(db,'vendorb',[delta('orders',po,{...po,status:'Approved & Signed',signedBy:'Beta Rep',signedAt:new Date().toISOString()})]);
  assert.equal(otherSigner.status,403,JSON.stringify(otherSigner));
  const signed={...po,status:'Approved & Signed',signedBy:'Acme Rep',signedAt:new Date().toISOString()};
  const accepted=await patch(db,'vendora',[delta('orders',po,signed)]);
  assert.equal(accepted.status,200,JSON.stringify(accepted));
  // Fraudulent amount alteration on signed PO is refused.
  assert.equal((await patch(db,'vendora',[delta('orders',signed,{...signed,totalCost:1})])).status,403);
  const delivery={id:'DEL-ORDER',poId:'PO-ORDER',prId:'PR-ORDER',supplierName:'Acme Supplies',department:'IT Systems',
   orderedQty:5,deliveredQty:5,recordedBy:'Proc Head',complianceStatus:'Pending Inspection',itemTitle:'Circuit boards'};
  assert.equal((await patch(db,'proc',[delta('deliveries',null,delivery)])).status,200);
  const invalidPayment=await patch(db,'fin',[delta('payments',pay,{...pay,status:'Paid',processedBy:'Finance Officer',paymentMethod:'Bank transfer',refNumber:'TXN-1',paymentDate:'2026-11-04'})]);
  assert.equal(invalidPayment.status,409,'Payment must be denied without verified delivery and invoice');
  const verified={...delivery,complianceStatus:'Completed - Verified',remarks:'Quantity and quality confirmed'};
  const inspected=await patch(db,'proc',[delta('deliveries',delivery,verified)]);
  assert.equal(inspected.status,200,JSON.stringify(inspected));
  const noDocument=await request(db,'vendora','/finance/invoices',{method:'POST',body:{poId:po.id,invoiceNo:'INV-ORDER',amount:500,invoiceDate:'2026-11-04'}});
  assert.equal(noDocument.status,400,JSON.stringify(noDocument));
  // A private, supplier-owned document metadata row represents a successful upload.
  db.db.prepare(`INSERT INTO procurement_documents (id,entity_type,entity_id,category,file_name,mime_type,size,kv_key,uploader_id,uploader_name,created_at)
      VALUES ('DOC-ORDER','PO','PO-ORDER','Invoice','invoice.pdf','application/pdf',150,'private/DOC-ORDER','vendorA','Acme Rep','2026-11-04')`).run();
  assert.equal((await request(db,'vendorb','/finance/invoices',{method:'POST',body:{poId:po.id,invoiceNo:'INV-FAKE',amount:500,invoiceDate:'2026-11-04',documentId:'DOC-ORDER'}})).status,403);
  const invoice=await request(db,'vendora','/finance/invoices',{method:'POST',body:{poId:po.id,invoiceNo:'INV-ORDER',amount:500,invoiceDate:'2026-11-04',documentId:'DOC-ORDER'}});
  assert.equal(invoice.status,201,JSON.stringify(invoice));
  const invoiceId=invoice.data.id;
  assert.equal((await request(db,'proc',`/finance/invoices/${invoiceId}/match`,{method:'POST',body:{}})).status,403);
  const matched=await request(db,'fin',`/finance/invoices/${invoiceId}/match`,{method:'POST',body:{}});
  assert.equal(matched.status,200,JSON.stringify(matched));
  assert.equal((await request(db,'fin',`/finance/invoices/${invoiceId}/match`,{method:'POST',body:{}})).status,409);
  assert.equal((await request(db,'fin',`/finance/match-status/${po.id}`)).data.matched,true);
  const paid={...pay,status:'Paid',processedBy:'Finance Officer',paymentMethod:'Bank transfer',refNumber:'TXN-ORDER',paymentDate:'2026-11-04'};
  const attemptedByAdmin=await patch(db,'admin',[delta('payments',pay,paid)]);
  assert.equal(attemptedByAdmin.status,409,'Admin cannot disburse Finance payment');
  const completed=await patch(db,'fin',[delta('payments',pay,paid)]);
  assert.equal(completed.status,200,JSON.stringify(completed));
  assert.equal(row(db,'payments',pay.id).status,'Paid');
  assert.equal((await patch(db,'fin',[delta('payments',paid,{...paid,refNumber:'CHANGED'})])).status,403);
 }finally{db.close();}
});

test('Phase 5 HTTP: discrepancy tracker requires verified reinspection before resolving',async()=>{
 const w=awardedBase();w.requisitions[0].status='In Process';
 w.orders=[{id:'PO-ISSUE',prId:'PR-ORDER',supplierId:'SUP-A',supplierName:'Acme Supplies',department:'IT Systems',itemTitle:'Circuit boards',
   status:'Approved & Signed',quantity:5,totalCost:500,unit:'pcs'}];
 w.deliveries=[{id:'DEL-ISSUE',poId:'PO-ISSUE',prId:'PR-ORDER',supplierName:'Acme Supplies',department:'IT Systems',itemTitle:'Circuit boards',orderedQty:5,deliveredQty:4,
  complianceStatus:'Issue Flagged - Quantity Shortage',remarks:'Missing 1 piece'}];
 const db=setup({workspace:w});try{
  const departmentView=await request(db,'ops','/operations/discrepancies');
  assert.equal(departmentView.status,200);
  assert.equal(departmentView.data.discrepancies.length,0,'Operations employee without cross-department appointment gets only its own scope');
  const tracker=await request(db,'proc','/operations/discrepancies');
  assert.equal(tracker.status,200,JSON.stringify(tracker));
  assert.equal(tracker.data.discrepancies.length,1);
  assert.equal(tracker.data.discrepancies[0].status,'Open');
  const blocked=await request(db,'proc','/operations/discrepancies/DEL-ISSUE',{method:'PATCH',body:{status:'Resolved',resolutionNotes:'Supplier will replace'}});
  assert.equal(blocked.status,409,JSON.stringify(blocked));
  const analyzing=await request(db,'proc','/operations/discrepancies/DEL-ISSUE',{method:'PATCH',body:{status:'Investigating',resolutionNotes:'Contacted supplier'}});
  assert.equal(analyzing.status,200,JSON.stringify(analyzing));
  // A new corrected inspection may come from a previously approved amendment;
  // here the canonical workspace is seeded with the resulting verified status.
  const current=read(db);
  current.deliveries[0].complianceStatus='Completed - Verified';
  db.db.prepare('UPDATE enterprise_state SET data=? WHERE id=1').run(JSON.stringify(current));
  const closed=await request(db,'proc','/operations/discrepancies/DEL-ISSUE',{method:'PATCH',body:{status:'Resolved',resolutionNotes:'Replacement verified'}});
  assert.equal(closed.status,200,JSON.stringify(closed));
  assert.equal((await request(db,'proc','/operations/discrepancies')).data.discrepancies[0].status,'Resolved');
 }finally{db.close();}
});

test('Phase 5 HTTP: high-value approval requires distinct Finance Head signoff before Admin',async()=>{
 const db=setup({financeHeadFrom:400});try{
  const pr=requisition('PR-HIGH');assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  const submit=await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}});
  assert.equal(submit.status,201,JSON.stringify(submit));
  const normal=(as,decision='approve')=>request(db,as,`/finance/approvals/${pr.id}/decision`,{method:'POST',body:{decision,comment:'Checked'}});
  const signoff=(as)=>request(db,as,`/finance/approvals/${pr.id}/finance-head`,{method:'POST',body:{decision:'approve',comment:'Authorized'}});
  assert.equal((await signoff('finhead')).status,409,'Finance Head cannot authorize before Finance Officer');
  assert.equal((await normal('proc')).status,200);
  assert.equal((await normal('fin')).status,200);
  assert.equal((await normal('admin')).status,409,'Admin requires independent head signoff');
  assert.equal((await signoff('fin')).status,403,'Finance Officer cannot self-approve as Finance Head');
  assert.equal((await signoff('finhead')).status,200);
  const finish=await normal('admin');assert.equal(finish.status,200,JSON.stringify(finish));
  assert.equal(row(db,'requisitions',pr.id).status,'Approved');
 }finally{db.close();}
});

test('Phase 5 HTTP: partial delivery blocks Finance match until all quantities pass inspection',async()=>{
 const w=awardedBase();w.requisitions[0].status='In Process';
 w.orders=[{id:'PO-PART',prId:'PR-ORDER',supplierId:'SUP-A',supplierName:'Acme Supplies',quantity:5,unit:'pcs',totalCost:500,status:'Approved & Signed',department:'IT Systems'}];
 w.payments=[{id:'PAY-PART',poId:'PO-PART',totalAmount:500,paymentAmount:500,status:'Pending',supplierName:'Acme Supplies',department:'IT Systems'}];
 w.deliveries=[{id:'DEL-PART-1',poId:'PO-PART',prId:'PR-ORDER',supplierName:'Acme Supplies',orderedQty:5,deliveredQty:3,
   complianceStatus:'Completed - Verified',recordedBy:'Proc Head',department:'IT Systems'}];
 const db=setup({workspace:w});try{
  db.db.prepare(`INSERT INTO procurement_documents(id,entity_type,entity_id,category,file_name,mime_type,size,kv_key,uploader_id,uploader_name,created_at)
    VALUES('DOC-PART','PO','PO-PART','Invoice','invoice.pdf','application/pdf',100,'private/part','vendorA','Acme Rep','2026-11-04')`).run();
  const invoice=await request(db,'vendora','/finance/invoices',{method:'POST',body:{poId:'PO-PART',invoiceNo:'INV-PART',amount:500,
    invoiceDate:'2026-11-04',documentId:'DOC-PART'}});
  assert.equal(invoice.status,201,JSON.stringify(invoice));
  const match=()=>request(db,'fin',`/finance/invoices/${invoice.data.id}/match`,{method:'POST',body:{}});
  const premature=await match();
  assert.equal(premature.status,409,JSON.stringify(premature));
  assert.ok(premature.data.reasons.some(reason=>/quantities|inspection/i.test(reason)));
  const second={id:'DEL-PART-2',poId:'PO-PART',prId:'PR-ORDER',supplierName:'Acme Supplies',orderedQty:5,deliveredQty:2,
   complianceStatus:'Pending Inspection',recordedBy:'Proc Head',department:'IT Systems'};
  assert.equal((await patch(db,'proc',[delta('deliveries',null,second)])).status,200);
  assert.equal((await match()).status,409);
  assert.equal((await patch(db,'proc',[delta('deliveries',second,{...second,complianceStatus:'Completed - Verified',remarks:'2 pieces accepted'})])).status,200);
  assert.equal((await match()).status,200);
 }finally{db.close();}
});

test('Phase 5 HTTP: large payment can be processed only by appointed Finance Head, not Officer or Admin',async()=>{
 const w=awardedBase();w.requisitions[0].status='In Process';
 w.orders=[{id:'PO-HIGH-PAY',prId:'PR-ORDER',supplierId:'SUP-A',supplierName:'Acme Supplies',quantity:5,unit:'pcs',totalCost:500,
   status:'Approved & Signed',department:'IT Systems'}];
 w.deliveries=[{id:'DEL-HIGH-PAY',poId:'PO-HIGH-PAY',prId:'PR-ORDER',supplierName:'Acme Supplies',orderedQty:5,deliveredQty:5,
   complianceStatus:'Completed - Verified',recordedBy:'Proc Head',department:'IT Systems'}];
 w.payments=[{id:'PAY-HIGH',poId:'PO-HIGH-PAY',totalAmount:500,paymentAmount:500,status:'Pending',supplierName:'Acme Supplies',department:'IT Systems'}];
 const db=setup({workspace:w,financeHeadFrom:400});try{
  db.db.prepare(`INSERT INTO procurement_documents(id,entity_type,entity_id,category,file_name,mime_type,size,kv_key,uploader_id,uploader_name,created_at)
    VALUES('DOC-HIGH','PO','PO-HIGH-PAY','Invoice','invoice.pdf','application/pdf',100,'private/high','vendorA','Acme Rep','2026-11-04')`).run();
  db.db.prepare(`INSERT INTO supplier_invoices (id,po_id,supplier_name,invoice_number,amount_cents,invoice_date,document_id,status,submitted_by,submitted_at,matched_by,matched_at)
    VALUES('INV-HIGH','PO-HIGH-PAY','Acme Supplies','INV-HIGH',50000,'2026-11-04','DOC-HIGH','Matched','vendorA','2026-11-04','finance','2026-11-04')`).run();
  const before=row(db,'payments','PAY-HIGH');
  const after={...before,status:'Paid',paymentMethod:'Bank transfer',refNumber:'HIGH-REF',paymentDate:'2026-11-04',processedBy:'Finance Head'};
  assert.equal((await patch(db,'admin',[delta('payments',before,after)])).status,409);
  assert.equal((await patch(db,'fin',[delta('payments',before,{...after,processedBy:'Finance Officer'})])).status,409);
  const high=await patch(db,'finhead',[delta('payments',before,after)]);
  assert.equal(high.status,200,JSON.stringify(high));
  assert.equal(row(db,'payments','PAY-HIGH').processedBy,'Finance Head');
 }finally{db.close();}
});

test('Phase 5 HTTP: supplier discussion cannot be read or spoofed by competing vendor',async()=>{
 const w=seeded();w.stockNeeds=[{id:'N-CHAT',status:'Published',title:'Parts',prId:'PR-CHAT'}];
 w.bids=[{id:'BID-CHAT',needId:'N-CHAT',supplierId:'SUP-A',supplierName:'Acme Supplies',status:'Submitted'}];
 const db=setup({workspace:w});try{
  assert.equal((await request(db,'vendorb','/sourcing/messages?entityType=BID&entityId=BID-CHAT')).status,403);
  const send=await request(db,'vendora','/sourcing/messages',{method:'POST',body:{entityType:'BID',entityId:'BID-CHAT',message:'Can you confirm the specification?'}});
  assert.equal(send.status,201,JSON.stringify(send));
  const reply=await request(db,'proc','/sourcing/messages',{method:'POST',body:{entityType:'BID',entityId:'BID-CHAT',message:'Please follow the quotation terms.'}});
  assert.equal(reply.status,201,JSON.stringify(reply));
  const own=await request(db,'vendora','/sourcing/messages?entityType=BID&entityId=BID-CHAT');
  assert.equal(own.status,200,JSON.stringify(own));
  assert.deepEqual(own.data.messages.map(m=>m.body),['Can you confirm the specification?','Please follow the quotation terms.']);
  assert.equal((await request(db,'vendorb','/sourcing/message-alerts')).data.alerts.length,0);
 }finally{db.close();}
});

test('Phase 5 HTTP: Admin audit review preserves original evidence and stores review history',async()=>{
 const db=setup();try{
  const pr=requisition('PR-AUDIT');
  assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  const audit=db.db.prepare("SELECT id,after_json FROM audit_evidence WHERE entity_type='requisitions' AND entity_ref='PR-AUDIT'").get();
  assert.ok(audit);
  const review=await request(db,'admin',`/audit-evidence/${audit.id}/review`,{method:'PUT',body:{status:'Flagged',note:'Investigate amount'}});
  assert.equal(review.status,200,JSON.stringify(review));
  assert.equal((await request(db,'alice',`/audit-evidence/${audit.id}/reviews`)).status,403);
  const history=await request(db,'admin',`/audit-evidence/${audit.id}/reviews`);
  assert.equal(history.status,200,JSON.stringify(history));
  assert.equal(history.data.reviews.length,1);
  assert.equal(db.db.prepare('SELECT after_json FROM audit_evidence WHERE id=?').get(audit.id).after_json,audit.after_json);
  assert.throws(()=>db.db.prepare('UPDATE audit_evidence SET actor_id=? WHERE id=?').run('forged',audit.id),/immutable/);
 }finally{db.close();}
});

test('Requisition register: API flags only the assigned rejector; reason is retained and final',async()=>{
 const db=setup();try{
  const pr=requisition('PR-REGISTER-REJECT');
  assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  assert.equal((await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}})).status,201);
  const listing=async name => {
   const response=await request(db,name,'/finance/approvals');
   assert.equal(response.status,200,JSON.stringify(response));
   return response.data.requests.find(item=>item.prId===pr.id);
  };
  assert.equal((await listing('alice')).canReject,false,'requester cannot reject own request');
  assert.equal((await listing('fin')).canReject,false,'later stage cannot reject yet');
  assert.equal((await listing('admin')).canReject,false,'admin cannot jump ahead');
  assert.equal((await listing('proc')).canReject,true,'current approver may reject from register');
  const endpoint=`/finance/approvals/${pr.id}/decision`;
  assert.equal((await request(db,'proc',endpoint,{method:'POST',body:{decision:'reject',comment:'   '}})).status,400);
  assert.equal((await request(db,'proc',endpoint,{method:'POST',body:{decision:'reject',comment:'x'.repeat(1001)}})).status,400);
  assert.equal((await request(db,'alice',endpoint,{method:'POST',body:{decision:'reject',comment:'Not allowed'}})).status,403);
  assert.equal((await request(db,'proc',endpoint,{method:'POST',body:{decision:'reject',comment:'Please correct the technical specifications.'}})).status,200);
  assert.equal(row(db,'requisitions',pr.id).status,'Rejected');
  const history=await listing('alice');
  assert.equal(history.status,'Rejected');
  assert.equal(history.canReject,false);
  assert.equal(history.steps.find(item=>item.status==='Rejected').comment,'Please correct the technical specifications.');
  assert.equal((await request(db,'proc',endpoint,{method:'POST',body:{decision:'approve',comment:''}})).status,409);
 }finally{db.close();}
});

test('Requisition register: Finance Head gets independent rejection capability for high-value requests',async()=>{
 const db=setup({financeHeadFrom:100});try{
  const pr=requisition('PR-HEAD-REGISTER');
  assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  assert.equal((await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}})).status,201);
  const endpoint=`/finance/approvals/${pr.id}/decision`;
  for(const user of ['proc','fin'])assert.equal((await request(db,user,endpoint,{method:'POST',body:{decision:'approve',comment:'Reviewed'}})).status,200);
  const listing=async name=>(await request(db,name,'/finance/approvals')).data.requests.find(r=>r.prId===pr.id);
  assert.equal((await listing('finhead')).canRejectFinanceHead,true);
  assert.equal((await listing('alice')).canRejectFinanceHead,false);
  assert.equal((await listing('fin')).canRejectFinanceHead,false);
  const reject=await request(db,'finhead',`/finance/approvals/${pr.id}/finance-head`,{method:'POST',body:{decision:'reject',comment:'Incomplete funding justification'}});
  assert.equal(reject.status,200,JSON.stringify(reject));
  assert.equal(row(db,'requisitions',pr.id).status,'Rejected');
  assert.equal((await listing('alice')).financeHead.comment,'Incomplete funding justification');
  assert.equal((await listing('finhead')).canRejectFinanceHead,false);
 }finally{db.close();}
});

test('Requisition revision: only assigned Head or Admin may reject an unsubmitted draft',async()=>{
 const db=setup();try{
  const pr=requisition('PR-DRAFT-REJECT');
  assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  const url=`/finance/requisitions/${pr.id}/reject-draft`;
  const caps=await request(db,'ithead','/finance/requisitions/capabilities');
  assert.ok(caps.data.draftRejectableIds.includes(pr.id),JSON.stringify(caps));
  assert.equal((await request(db,'alice',url,{method:'POST',body:{reason:'Changes needed'}})).status,403);
  assert.equal((await request(db,'bob',url,{method:'POST',body:{reason:'Changes needed'}})).status,403);
  assert.equal((await request(db,'ithead',url,{method:'POST',body:{reason:''}})).status,400);
  const rejected=await request(db,'ithead',url,{method:'POST',body:{reason:'Specify the required voltage rating'}});
  assert.equal(rejected.status,200,JSON.stringify(rejected));
  assert.equal(row(db,'requisitions',pr.id).status,'Rejected');
  assert.equal(row(db,'requisitions',pr.id).rejectionReason,'Specify the required voltage rating');
  assert.equal((await request(db,'ithead',url,{method:'POST',body:{reason:'Again'}})).status,409);
  const own=await request(db,'alice','/finance/requisitions/capabilities');
  assert.ok(own.data.editableRejectedIds.includes(pr.id));
  assert.ok(!own.data.draftRejectableIds.includes(pr.id));
 }finally{db.close();}
});

test('Requisition revision: requester can edit and resubmit rejected draft, preserving original reason and number',async()=>{
 const db=setup();try{
  const pr=requisition('PR-DRAFT-REV');
  assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  const path=`/finance/requisitions/${pr.id}`;
  assert.equal((await request(db,'ithead',path+'/reject-draft',{method:'POST',body:{reason:'Missing specification'}})).status,200);
  const fields={itemTitle:'Circuit boards - revised',specs:'Test components, rated 24V',quantity:5,unit:'pcs',unitPrice:110,totalCost:550,targetDate:'2026-12-10',remarks:'Required for testing'};
  const revise=(as,fields,expectedVersion=0,expectedUpdatedAt='')=>request(db,as,path+'/revise',{method:'POST',body:{fields,expectedVersion,expectedUpdatedAt}});
  assert.equal((await revise('bob',fields)).status,403);
  assert.equal((await revise('alice',{...fields,requestedByUsername:'bob'})).status,400);
  assert.equal((await revise('alice',{...fields,totalCost:1})).status,400);
  assert.equal((await request(db,'alice',path+'/resubmit',{method:'POST',body:{note:'corrected',expectedVersion:0,expectedUpdatedAt:'stale'}})).status,409);
  const revised=await revise('alice',fields);
  assert.equal(revised.status,200,JSON.stringify(revised));
  assert.equal(row(db,'requisitions',pr.id).status,'Rejected');
  assert.equal(row(db,'requisitions',pr.id).totalCost,550);
  assert.equal((await request(db,'alice',path+'/resubmit',{method:'POST',body:{note:'' ,expectedVersion:0,expectedUpdatedAt:row(db,'requisitions',pr.id).revisedAt}})).status,400);
  const resub=await request(db,'alice',path+'/resubmit',{method:'POST',body:{note:'Added voltage and updated cost',expectedVersion:0,expectedUpdatedAt:row(db,'requisitions',pr.id).revisedAt}});
  assert.equal(resub.status,200,JSON.stringify(resub));
  assert.equal(resub.data.pr.id,pr.id);
  assert.equal(row(db,'requisitions',pr.id).status,'Pending');
  assert.equal(row(db,'requisitions',pr.id).resubmissionCount,1);
  const history=await request(db,'alice',path+'/history');
  assert.equal(history.status,200,JSON.stringify(history));
  assert.equal(history.data.history.length,1);
  assert.equal(history.data.history[0].rejectionReason,'Missing specification');
  assert.equal(history.data.history[0].pr.totalCost,500);
  assert.equal((await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}})).status,201);
  assert.equal((await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}})).status,409);
  assert.equal((await request(db,'bob',path+'/history')).status,403);
 }finally{db.close();}
});

test('Requisition revision: rejected approval cycle is archived and can start over at Department Head submission',async()=>{
 const db=setup();try{
  const pr=requisition('PR-ROUNDTRIP');
  assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  assert.equal((await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}})).status,201);
  assert.equal((await request(db,'ithead',`/finance/requisitions/${pr.id}/reject-draft`,{method:'POST',body:{reason:'Should fail'}})).status,409);
  const rejected=await request(db,'proc',`/finance/approvals/${pr.id}/decision`,{method:'POST',body:{decision:'reject',comment:'Wrong components'}});
  assert.equal(rejected.status,200,JSON.stringify(rejected));
  const path=`/finance/requisitions/${pr.id}`;
  const edit=await request(db,'alice',path+'/revise',{method:'POST',body:{fields:{itemTitle:'Replacement parts',specs:'Correct part number',quantity:3,unit:'pcs',unitPrice:100,totalCost:300,targetDate:'2026-12-02',remarks:'Updated'},expectedVersion:0,expectedUpdatedAt:''}});
  assert.equal(edit.status,200,JSON.stringify(edit));
  const rs=await request(db,'alice',path+'/resubmit',{method:'POST',body:{note:'Corrected part number and quantity',expectedVersion:0,expectedUpdatedAt:edit.data.pr.revisedAt}});
  assert.equal(rs.status,200,JSON.stringify(rs));
  assert.equal(db.db.prepare('SELECT * FROM pr_approval_requests WHERE pr_id=?').get(pr.id),undefined);
  const history=await request(db,'alice',path+'/history');
  assert.equal(history.data.history[0].workflow.status,'Rejected');
  assert.equal(history.data.history[0].steps.find(step=>step.status==='Rejected').comment,'Wrong components');
  const restarted=await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:pr.id}});
  assert.equal(restarted.status,201,JSON.stringify(restarted));
  const active=db.db.prepare('SELECT status,amount_cents FROM pr_approval_requests WHERE pr_id=?').get(pr.id);
  assert.equal(active.status,'Pending');assert.equal(active.amount_cents,30000);
  assert.equal((await request(db,'alice',path+'/resubmit',{method:'POST',body:{note:'again',expectedVersion:1,expectedUpdatedAt:edit.data.pr.revisedAt}})).status,409);
 }finally{db.close();}
});

test('Requisition revision: stale saves cannot resurrect rejected or resubmitted records',async()=>{
 const db=setup();try{
  const pr=requisition('PR-STALE-REV');
  assert.equal((await patch(db,'alice',[delta('requisitions',null,pr)])).status,200);
  const reject=await request(db,'admin',`/finance/requisitions/${pr.id}/reject-draft`,{method:'POST',body:{reason:'Test rejection'}});
  assert.equal(reject.status,200,JSON.stringify(reject));
  const stale=await patch(db,'alice',[delta('requisitions',pr,{...pr,remarks:'Old browser edit'})]);
  assert.equal(stale.status,409,JSON.stringify(stale));
  const resub=await request(db,'alice',`/finance/requisitions/${pr.id}/resubmit`,{method:'POST',body:{note:'Corrected justification',expectedVersion:0,expectedUpdatedAt:''}});
  assert.equal(resub.status,200,JSON.stringify(resub));
  assert.equal((await request(db,'alice',`/finance/requisitions/${pr.id}/resubmit`,{method:'POST',body:{note:'Double-click retry',expectedVersion:0,expectedUpdatedAt:''}})).status,409);
  assert.equal((await request(db,'alice',`/finance/requisitions/${pr.id}/history`)).data.history.length,1);
 }finally{db.close();}
});

test('Requisition revision: stable requester ID survives a changed username and a second rejection cycle',async()=>{
 const w=emptyWorkspace();w.requisitions=[{...requisition('PR-REPEAT'),requestedByUserId:'employee',requestedByUsername:'former-name'}];
 const db=setup({workspace:w});try{
  const path='/finance/requisitions/PR-REPEAT';
  const first=await request(db,'ithead',path+'/reject-draft',{method:'POST',body:{reason:'No delivery timeline'}});
  assert.equal(first.status,200,JSON.stringify(first));
  const firstRev=await request(db,'alice',path+'/revise',{method:'POST',body:{fields:{itemTitle:'Circuit boards',specs:'Specified delivery timeline',quantity:5,unit:'pcs',unitPrice:100,totalCost:500,targetDate:'2026-12-15',remarks:'Confirmed lead time'},expectedVersion:0,expectedUpdatedAt:''}});
  assert.equal(firstRev.status,200,JSON.stringify(firstRev));
  assert.equal((await request(db,'alice',path+'/resubmit',{method:'POST',body:{note:'Confirmed supplier delivery timeline',expectedVersion:0,expectedUpdatedAt:firstRev.data.pr.revisedAt}})).status,200);
  assert.equal((await request(db,'ithead','/finance/approvals',{method:'POST',body:{prId:'PR-REPEAT'}})).status,201);
  assert.equal((await request(db,'proc','/finance/approvals/PR-REPEAT/decision',{method:'POST',body:{decision:'reject',comment:'Quantity exceeds need'}})).status,200);
  const twice=await request(db,'alice',path+'/resubmit',{method:'POST',body:{note:'Reduced the requested quantity after review',expectedVersion:1,expectedUpdatedAt:firstRev.data.pr.revisedAt}});
  assert.equal(twice.status,200,JSON.stringify(twice));
  const history=await request(db,'alice',path+'/history');
  assert.equal(history.status,200);
  assert.equal(history.data.history.length,2);
  assert.deepEqual(history.data.history.map(h=>h.cycle),[1,0]);
  assert.deepEqual(history.data.history.map(h=>h.rejectionReason),['Quantity exceeds need','No delivery timeline']);
 }finally{db.close();}
});

test('Requisition revision: linked sourcing records block draft rejection and edits',async()=>{
 const w=emptyWorkspace();w.requisitions=[requisition('PR-LINKED')];w.stockNeeds=[{id:'NEED-LINKED',prId:'PR-LINKED',status:'Published'}];
 const db=setup({workspace:w});try{
  const r=await request(db,'ithead','/finance/requisitions/PR-LINKED/reject-draft',{method:'POST',body:{reason:'Needs correction'}});
  assert.equal(r.status,409,JSON.stringify(r));
  assert.equal(row(db,'requisitions','PR-LINKED').status,'Pending');
 }finally{db.close();}
});
