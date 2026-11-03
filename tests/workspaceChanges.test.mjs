import test from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkspaceChanges, authorizeWorkspaceChanges, validateWorkspaceLinks, projectWorkspace} from '../cloudflare/src/workspaceChanges.ts';
import {setWorkspaceBaseline, clearWorkspaceBaseline, getWorkspaceChanges, confirmWorkspaceChanges} from '../src/services/workspaceSync.ts';
const c = structuredClone;
const actor=(role, app_role, name='Alice')=>({id:'u1',username:'alice',name,role,app_role,department:'Operations',company_name:'Vendor A'});
const staff=actor('employee','Employee');
const head=actor('employee','Procurement Head');
const supplier=actor('guest','Supplier','Vendor Contact');
const workspace=()=>({stockNeeds:[{id:'n1',title:'Supplies',status:'Published',prId:'r1'},{id:'n2',title:'Private Draft',status:'Draft'}],
 bids:[{id:'b1',supplierId:'s1',supplierName:'Vendor A',needId:'n1',status:'Selected'},{id:'b2',supplierId:'s2',supplierName:'Vendor B',needId:'n1'}],
 proposalMeetings:[{id:'m1',supplierId:'s2',supplierName:'Vendor B'}],
 requisitions:[{id:'r1',status:'Pending',department:'Operations',requestedBy:'Alice',requestedByUsername:'alice',quantity:2,unitPrice:50,totalCost:100}],
 orders:[{id:'o1',status:'Awaiting Supplier Signature',supplierId:'s1',supplierName:'Vendor A',prId:'r1',quantity:2,totalCost:100},
         {id:'o2',status:'Approved & Signed',supplierId:'s2',supplierName:'Vendor B',prId:'r1',quantity:2,totalCost:250}],
 deliveries:[],amendments:[],payments:[{id:'p1',poId:'o2',status:'Pending',totalAmount:250,bankDetails:'private'}],
 suppliers:[{id:'s1',name:'Vendor A',contact:'Contact A'},{id:'s2',name:'Vendor B',contact:'Contact B'}],ratings:[],auditLogs:[{id:'log1',details:'Internal note'}],
 accessControl:[{role:'Admin',permissions:['manage_users']}], internalSecret:'must not leak'});
const change=(collection, before, after)=>({collection,id:String((after??before).id),before:c(before),after:c(after)});

test('disjoint changes merge without losing either session’s record',()=>{
 const original=workspace();
 const prBefore=original.requisitions[0], prAfter={...prBefore,remarks:'Edited in tab A'};
 const orderBefore=original.orders[0], orderAfter={...orderBefore,status:'Approved & Signed'};
 const first=applyWorkspaceChanges(original,[change('requisitions',prBefore,prAfter)]);
 assert.ok(first.next);
 const second=applyWorkspaceChanges(first.next,[change('orders',orderBefore,orderAfter)]);
 assert.equal(second.error,undefined);
 assert.equal(second.next.requisitions[0].remarks,'Edited in tab A');
 assert.equal(second.next.orders[0].status,'Approved & Signed');
 assert.equal(original.requisitions[0].remarks,undefined);
});
test('same-record stale edit is rejected with a descriptive conflict',()=>{
 const original=workspace(), base=original.requisitions[0];
 const first=applyWorkspaceChanges(original,[change('requisitions',base,{...base,remarks:'A'})]);
 const second=applyWorkspaceChanges(first.next,[change('requisitions',base,{...base,remarks:'B'})]);
 assert.match(second.error,/Conflict: requisitions r1/);
});
test('duplicate record updates and duplicate snapshot ids are rejected',()=>{
 const original=workspace(), row=original.requisitions[0], op=change('requisitions',row,{...row,remarks:'A'});
 assert.match(applyWorkspaceChanges(original,[op,op]).error,/only be changed once/);
 original.orders.push(c(original.orders[0]));
 assert.match(applyWorkspaceChanges(original,[op]).error,/duplicate record IDs/);
});
test('fabricated old value and record id replacement are rejected',()=>{
 const original=workspace(), before=original.requisitions[0];
 assert.match(applyWorkspaceChanges(original,[change('requisitions',{...before,status:'Approved'},{...before,status:'Rejected'})]).error,/Conflict:/);
 assert.match(applyWorkspaceChanges(original,[{collection:'requisitions',id:'r1',before,after:{...before,id:'r999'}}]).error,/Record ID/);
});
test('ordinary employee can create/edit only their own pending PR',()=>{
 const base=workspace().requisitions[0];
 assert.equal(authorizeWorkspaceChanges(staff,[change('requisitions',null,{...base,id:'r2'})]),null);
 assert.equal(authorizeWorkspaceChanges(staff,[change('requisitions',base,{...base,remarks:'Updated'})]),null);
 assert.match(authorizeWorkspaceChanges(staff,[change('requisitions',base,{...base,status:'Approved'})]),/requester/);
 assert.match(authorizeWorkspaceChanges(staff,[change('requisitions',null,{...base,id:'r2',requestedByUsername:'bob'})]),/requester/);
 assert.match(authorizeWorkspaceChanges(staff,[change('requisitions',null,{...base,id:'r2',requestedBy:'Different Person'})]),/requester/);
 assert.match(authorizeWorkspaceChanges(staff,[change('orders',null,{id:'o9',status:'Issued'})]),/Only Procurement Head/);
});
test('pending PR must have correct calculated amount',()=>{
 const original=workspace(); const before=original.requisitions[0], after={...before,totalCost:1};
 assert.match(validateWorkspaceLinks([change('requisitions',before,after)],original,original,staff),/invalid quantity or calculated total/);
});
test('Procurement Head may issue PO with linked approved PR only',()=>{
 const original=workspace(); original.requisitions[0].status='Approved'; const pr=original.requisitions[0], updated={...pr,status:'In Process'};
 const po={id:'o9',prId:'r1',needId:'n1',bidId:'b1',supplierId:'s1',supplierName:'Vendor A',status:'Awaiting Supplier Signature',createdByName:'Alice',quantity:2,unitPrice:50,totalCost:100};
 const ops=[change('requisitions',pr,updated),change('orders',null,po)];
 assert.equal(authorizeWorkspaceChanges(head,ops),null);
 assert.match(validateWorkspaceLinks(ops,original,original,head),/approved PR/);
 original.requisitions[0].status='Approved';original.stockNeeds[0].status='Supplier Selected';original.stockNeeds[0].selectedBidId='b1';
 assert.equal(validateWorkspaceLinks(ops,original,original,head),null);
});
test('pending payment can be created with new PO, but not paid without finance validation',()=>{
 const po={id:'o9'}, payment={id:'p9',poId:'o9',totalAmount:100,paymentAmount:100,status:'Pending'};
 assert.equal(authorizeWorkspaceChanges(head,[change('orders',null,po),change('payments',null,payment)]),null);
 const original=workspace(), pay=original.payments[0];
 assert.equal(authorizeWorkspaceChanges(staff,[change('payments',pay,{...pay,status:'Paid',processedBy:'Alice'})]),null,
   'Finance writes must reach D1 authority validation, even for delegated users');
 assert.match(authorizeWorkspaceChanges(staff,[change('payments',pay,{...pay,totalAmount:1})]),/Payment records/);
});
test('delivery cannot exceed signed PO quantities',()=>{
 const original=workspace(); const delivery={id:'d1',poId:'o2',prId:'r1',supplierName:'Vendor B',orderedQty:2,deliveredQty:3,recordedBy:'Alice',complianceStatus:'Pending Inspection'};
 assert.match(validateWorkspaceLinks([change('deliveries',null,delivery)],original,original,head),/exceeds/);
 delivery.deliveredQty=1;
 assert.equal(validateWorkspaceLinks([change('deliveries',null,delivery)],original,original,head),null);
});
test('supplier view excludes peer records and private workspace fields',()=>{
 const original=workspace(), view=projectWorkspace(original,supplier);
 assert.deepEqual(view.bids.map(b=>b.id),['b1']);
 assert.deepEqual(view.orders.map(o=>o.id),['o1']);
 assert.deepEqual(view.suppliers.map(s=>s.id),['s1']);
 assert.deepEqual(view.requisitions,[]); assert.deepEqual(view.payments,[]);
 assert.equal(view.internalSecret,undefined);assert.equal(view.accessControl,undefined);
 assert.equal(view.stockNeeds.some(n=>n.id==='n2'),false);
 assert.deepEqual(view.auditLogs,[]);
 assert.match(authorizeWorkspaceChanges(supplier,[change('payments',null,{id:'p1'})]),/Supplier cannot modify/);
});
test('client sends record-specific deltas and advances baseline after acknowledgement',()=>{
 clearWorkspaceBaseline();
 const before=workspace(); setWorkspaceBaseline(before,'token-a');
 const next=c(before);next.requisitions[0].remarks='Updated';
 const patches=getWorkspaceChanges(next,'token-a');
 assert.deepEqual(patches.map(p=>[p.collection,p.id]),[['requisitions','r1']]);
 confirmWorkspaceChanges(patches,'token-a');
 assert.equal(getWorkspaceChanges(next,'token-a').length,0);
 assert.throws(()=>getWorkspaceChanges(next,'token-b'),/revision is missing/);
 clearWorkspaceBaseline();
});
test('a failed save leaves the client baseline unchanged',()=>{
 const before=workspace();setWorkspaceBaseline(before,'token-a');
 const next=c(before);next.orders[0].status='Approved & Signed';
 assert.equal(getWorkspaceChanges(next,'token-a').length,1);
 assert.equal(getWorkspaceChanges(next,'token-a').length,1);
 clearWorkspaceBaseline();
});
