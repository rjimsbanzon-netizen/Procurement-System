import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseRecordPageConfig, visibleRecordPage, validateIndexedCount, validateIndexedPage } from '../cloudflare/src/workspaceRecordPages.ts';
import { projectWorkspace, WORKSPACE_COLLECTIONS } from '../cloudflare/src/workspaceChanges.ts';

const actor = (department, app_role = 'Employee', role = 'employee', company_name = '') => ({
  id: 'person-1', username: 'amy', name: 'Amy', department, app_role, role, company_name,
});
const workspace = () => ({
  ...Object.fromEntries(WORKSPACE_COLLECTIONS.map(key => [key, []])),
  requisitions: [
    {id:'PR-101',department:'IT Systems',requestedByUsername:'amy',status:'Pending'},
    {id:'PR-102',department:'Human Resource',requestedByUsername:'other',status:'Pending'},
    {id:'PR-103',department:'IT Systems',requestedByUsername:'amy',status:'Approved'},
  ],
  orders: [{id:'PO-101',prId:'PR-101',status:'Issued'},{id:'PO-102',prId:'PR-102',status:'Issued'}],
  payments: [{id:'PAY-101',poId:'PO-101',status:'Pending',totalAmount:1000,bankDetails:'SECRET',refNumber:'RESTRICTED'}],
  suppliers: [{id:'SUP-1',name:'ACME',email:'orders@invalid.test',bankDetails:'PRIVATE',bankAccountNumber:'12345',paymentTerms:'Net 30',companyProfile:{bankAccount:{number:'1234'},office:'Davao'}}],
  auditLogs: [{id:'LOG-1',action:'Closed'}],
  internalSecret: 'NEVER EXPOSE',
});

for (const [query, expected] of [
  ['collection=payments', {collection:'payments',offset:0,limit:25}],
  ['collection=requisitions&offset=2&limit=100', {collection:'requisitions',offset:2,limit:100}],
]) test(`Phase 4 accepts valid bounded page: ${query}`, () => {
  assert.deepEqual(parseRecordPageConfig(new URL('https://api.invalid/workspace-records?'+query)),expected);
});

for (const query of [
  'collection=__proto__','collection=payments&limit=101','collection=payments&limit=0',
  'collection=payments&offset=-1','collection=payments&offset=1.4',
  'collection=payments&limit=10&limit=20','collection=payments&sortBy=id',
  'collection=payments&offset=100001','collection=payments&limit=1e2',
]) test(`Phase 4 rejects invalid page: ${query}`, () => {
  assert.ok('error' in parseRecordPageConfig(new URL('https://api.invalid/workspace-records?'+query)));
});

test('Phase 4 only pages department-visible records with accurate counts and stable order', () => {
  const state=workspace();
  const config={collection:'requisitions',offset:0,limit:1};
  const first=visibleRecordPage(state,actor('IT Systems'),{},config);
  assert.deepEqual(first.records.map(r=>r.id),['PR-101']);
  assert.equal(first.total,2);
  assert.equal(first.nextOffset,1);
  const second=visibleRecordPage(state,actor('IT Systems'),{},{...config,offset:1});
  assert.deepEqual(second.records.map(r=>r.id),['PR-103']);
  assert.equal(second.nextOffset,null);
  assert.equal(visibleRecordPage(state,actor('IT Systems'),{},{...config,offset:99}).records.length,0);
});

test('Phase 4 hides financial reference and supplier bank details from Procurement', () => {
  const state=workspace();
  const person=actor('Procurement','Procurement Head');
  const snapshot=projectWorkspace(state,person);
  assert.equal(snapshot.payments[0].bankDetails,undefined);
  assert.equal(snapshot.payments[0].refNumber,undefined);
  assert.equal(snapshot.suppliers[0].bankDetails,undefined);
  assert.equal(snapshot.suppliers[0].bankAccountNumber,undefined);
  assert.equal(snapshot.suppliers[0].paymentTerms,'Net 30');
  assert.equal(snapshot.suppliers[0].companyProfile.bankAccount,undefined);
  assert.equal(snapshot.suppliers[0].companyProfile.office,'Davao');
  assert.equal(state.suppliers[0].bankDetails,'PRIVATE');
  assert.equal(visibleRecordPage(state,person,{}, {collection:'suppliers',offset:0,limit:10}).records[0].bankDetails,undefined);
});

test('Phase 4 authenticated Finance appointment can read full finance records', () => {
  const state=workspace();
  const person=actor('Finance & Accounting','Finance Officer');
  const unappointed=visibleRecordPage(state,person,{}, {collection:'payments',offset:0,limit:10});
  assert.equal(unappointed.total,1, 'own departmental PO status remains visible');
  assert.equal(unappointed.records[0].bankDetails,undefined);
  const scoped=visibleRecordPage(state,person,{financeAppointed:true},{collection:'payments',offset:0,limit:10});
  assert.equal(scoped.records[0].bankDetails,'SECRET');
  assert.equal(visibleRecordPage(state,person,{financeAppointed:true},{collection:'suppliers',offset:0,limit:10}).records[0].bankDetails,'PRIVATE');
});

test('Phase 4 supplier read never exposes other suppliers or internal payments', () => {
  const state=workspace();
  const person=actor('External','Supplier','guest','Different supplier');
  const data=projectWorkspace(state,person);
  assert.deepEqual(data.requisitions,[]);
  assert.deepEqual(data.payments,[]);
  assert.deepEqual(data.suppliers,[]);
  assert.equal(data.internalSecret,undefined);
  assert.deepEqual(visibleRecordPage(state,person,{}, {collection:'requisitions',offset:0,limit:10}).records,[]);
});

test('Phase 4 detects index count drift, missing rows and altered source content', () => {
  const state=workspace();
  assert.equal(validateIndexedCount(state,'requisitions',3),null);
  assert.match(validateIndexedCount(state,'requisitions',2),/out of sync/);
  assert.match(validateIndexedCount(state,'requisitions',4),/out of sync/);
  const record=state.requisitions[0];
  assert.equal(validateIndexedPage(state,'requisitions',[record],[{record_id:'PR-101',payload:JSON.stringify(record)}]),null);
  assert.match(validateIndexedPage(state,'requisitions',[record],[]),/missing/);
  assert.match(validateIndexedPage(state,'requisitions',[record],[{record_id:'PR-101',payload:JSON.stringify({...record,status:'Forged'})}]),/outdated/);
});

const migration=readFileSync(new URL('../cloudflare/migrations/0022_immutable_audit_evidence.sql',import.meta.url),'utf8');
test('Phase 4 audit guards allow Admin reviews, but prohibit evidence rewriting or deletion', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE audit_evidence(id TEXT PRIMARY KEY, occurred_at TEXT, actor_id TEXT, actor_name TEXT,
        actor_role TEXT, entity_type TEXT, entity_ref TEXT, action TEXT, before_json TEXT, after_json TEXT,
        review_state TEXT DEFAULT 'Unreviewed', review_note TEXT DEFAULT '', reviewer_id TEXT, reviewed_at TEXT);
      CREATE TABLE audit_evidence_reviews(id TEXT PRIMARY KEY, evidence_id TEXT REFERENCES audit_evidence(id),
        reviewer_id TEXT, old_state TEXT, new_state TEXT, note TEXT, recorded_at TEXT);`);
    db.prepare(`INSERT INTO audit_evidence (id,occurred_at,actor_id,actor_name,actor_role,entity_type,entity_ref,action,before_json,after_json)
      VALUES ('log-1','2026-01-01','a1','Admin','Admin','payments','PAY-01','Created',NULL,'{}')`).run();
    db.exec(migration);
    db.prepare("UPDATE audit_evidence SET review_state='Reviewed',reviewer_id='a2',reviewed_at='2026-01-02' WHERE id='log-1'").run();
    db.prepare("INSERT INTO audit_evidence_reviews(id,evidence_id,reviewer_id,old_state,new_state,note,recorded_at) VALUES('rev-1','log-1','a2','Unreviewed','Reviewed','','2026-01-02')").run();
    assert.throws(()=>db.prepare("UPDATE audit_evidence SET after_json='tampered' WHERE id='log-1'").run(),/immutable/);
    assert.throws(()=>db.prepare("DELETE FROM audit_evidence WHERE id='log-1'").run(),/cannot be deleted/);
    assert.throws(()=>db.prepare("UPDATE audit_evidence_reviews SET note='tampered' WHERE id='rev-1'").run(),/cannot be rewritten/);
    assert.throws(()=>db.prepare("DELETE FROM audit_evidence_reviews WHERE id='rev-1'").run(),/cannot be deleted/);
    db.exec(migration); // migration can be retried without losing evidence
    assert.equal(db.prepare("SELECT after_json FROM audit_evidence WHERE id='log-1'").get().after_json,'{}');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_evidence_reviews').get().n,1);
  } finally {db.close();}
});
