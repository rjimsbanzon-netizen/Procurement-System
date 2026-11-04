import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { projectWorkspace, WORKSPACE_COLLECTIONS } from '../cloudflare/src/workspaceChanges.ts';
import { verifyWorkspaceRecordIndex } from '../cloudflare/src/workspaceRecordIndex.ts';

const migration = readFileSync(new URL('../cloudflare/migrations/0021_workspace_record_index.sql', import.meta.url), 'utf8');
const collections = ['stockNeeds','bids','proposalMeetings','requisitions','orders','deliveries','amendments','payments','suppliers','ratings'];
test('Phase 3 read-model allowlist matches the record-write collections',()=>{
  assert.deepEqual(collections,[...WORKSPACE_COLLECTIONS]);
});
const makeWorkspace = () => ({
  ...Object.fromEntries(collections.map(c => [c, []])),
  requisitions: [
    {id:'PR-IT',department:'IT Systems',requestedBy:'Ivy',requestedByUsername:'ivy',status:'Pending'},
    {id:'PR-HR',department:'Human Resources',requestedBy:'Henry',requestedByUsername:'henry',status:'Pending'}],
  stockNeeds: [{id:'NEED-IT',prId:'PR-IT',status:'Published'},{id:'NEED-HR',prId:'PR-HR',status:'Supplier Selected'}],
  bids:[{id:'BID-IT',needId:'NEED-IT',supplierId:'SUP-1'},{id:'BID-HR',needId:'NEED-HR',supplierId:'SUP-2'}],
  orders:[{id:'PO-IT',prId:'PR-IT',supplierId:'SUP-1'},{id:'PO-HR',prId:'PR-HR',supplierId:'SUP-2'}],
  payments:[{id:'PAY-IT',poId:'PO-IT',status:'Pending',totalAmount:300,bankDetails:'private'},
    {id:'PAY-HR',poId:'PO-HR',status:'Paid',totalAmount:800,refNumber:'secret'}],
  suppliers:[{id:'SUP-1',name:'Vendor A',email:'a@example.invalid',bankDetails:'private'},
    {id:'SUP-2',name:'Vendor B',email:'b@example.invalid'}],
  auditLogs:[{id:'LOG-1',details:'HR approval decision'}],
  privateInternalField:'must-not-be-sent',
});
const actor=(department,app_role='Employee',role='employee')=>({
  id:'u1',username:'ivy',name:'Ivy',department,app_role,role,company_name:''});
const getIds=(snapshot,collection)=>snapshot[collection].map(record=>record.id);

// These assertions verify the data that reaches the browser, not just hidden UI controls.
test('staff browser read is confined to its department and never receives payment references',()=>{
  const data=makeWorkspace(); const result=projectWorkspace(data,actor('IT Systems'));
  assert.deepEqual(getIds(result,'requisitions'),['PR-IT']);
  assert.deepEqual(getIds(result,'orders'),['PO-IT']);
  assert.deepEqual(getIds(result,'bids'),['BID-IT']);
  assert.deepEqual(getIds(result,'payments'),['PAY-IT']);
  assert.equal(result.payments[0].bankDetails,undefined);
  assert.deepEqual(result.auditLogs,[]);
  assert.equal(result.privateInternalField,undefined);
  assert.equal(result.suppliers[0].bankDetails,undefined);
  assert.equal(data.payments[0].bankDetails,'private', 'projection must not mutate canonical data');
});
test('procurement can operate across departments, but activity log remains admin-only',()=>{
  const data=makeWorkspace();
  const result=projectWorkspace(data,actor('Procurement','Procurement Head'));
  assert.deepEqual(getIds(result,'orders'),['PO-IT','PO-HR']);
  assert.equal(result.payments[0].bankDetails,undefined);
  assert.deepEqual(result.auditLogs,[]);
  assert.equal(result.privateInternalField,undefined);
});
test('finance-wide read requires a confirmed D1 appointment, not role text',()=>{
  const data=makeWorkspace(); const person=actor('Finance & Accounting','Employee'); person.username='finance';
  assert.deepEqual(getIds(projectWorkspace(data,person),'payments'),[]);
  const assigned=projectWorkspace(data,person,{financeAppointed:true});
  assert.deepEqual(getIds(assigned,'payments'),['PAY-IT','PAY-HR']);
  assert.equal(assigned.payments[0].bankDetails,'private');
});
test('admin retains complete canonical data for management and audit',()=>{
  const data=makeWorkspace();
  assert.equal(projectWorkspace(data,actor('Executive','Admin','admin')),data);
});

test('D1 migration creates synchronized rows on insert, update, deletion and admin reset',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE enterprise_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const original=makeWorkspace();
    // Mimic an existing legacy snapshot BEFORE applying the migration.
    db.prepare('INSERT INTO enterprise_state(id,data,updated_at) VALUES(1,?,?)')
      .run(JSON.stringify(original),'before-migration');
    db.exec(migration);
    const readIndex=()=>db.prepare('SELECT collection,record_id,payload FROM workspace_record_index ORDER BY collection,record_id').all();
    assert.equal(verifyWorkspaceRecordIndex(JSON.stringify(original),readIndex()).ok,true);
    const amended=structuredClone(original);
    amended.requisitions[0].status='Approved';
    amended.requisitions.splice(1,1);
    amended.orders.push({id:'PO-NEW',prId:'PR-IT',supplierId:'SUP-1'});
    const optimistic=db.prepare('UPDATE enterprise_state SET data=?,updated_at=? WHERE id=1 AND data=? RETURNING id');
    const committed=optimistic.all(JSON.stringify(amended),'after-change',JSON.stringify(original));
    assert.equal(committed.length,1);
    assert.equal(verifyWorkspaceRecordIndex(JSON.stringify(amended),readIndex()).ok,true);
    assert.equal(optimistic.all('{}','stale',JSON.stringify(original)).length,0);
    assert.equal(verifyWorkspaceRecordIndex(JSON.stringify(amended),readIndex()).ok,true);
    const cleared=Object.fromEntries(collections.map(c=>[c,[]]));
    db.prepare('UPDATE enterprise_state SET data=?,updated_at=? WHERE id=1')
      .run(JSON.stringify(cleared),'admin-reset');
    assert.equal(readIndex().length,0);
    db.prepare('DELETE FROM enterprise_state WHERE id=1').run();
    assert.equal(readIndex().length,0);
  } finally {db.close();}
});
test('index verification detects missing or tampered records without exposing payloads',()=>{
  const data=makeWorkspace();
  const report=verifyWorkspaceRecordIndex(JSON.stringify(data),[]);
  assert.equal(report.ok,false);
  assert.ok(report.mismatchCount>0);
  assert.ok(!JSON.stringify(report).includes('bankDetails'));
});
