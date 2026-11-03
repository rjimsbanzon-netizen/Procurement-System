import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSupplierSnapshotWrite} from '../cloudflare/src/snapshotAuthorization.ts';
const supplier={id:'u1',name:'Vendor Contact',email:'vendor@example.test',company_name:'Vendor Ltd',role:'guest',app_role:'Supplier'};
function workspace(){return {
  stockNeeds:[],bids:[{id:'b1',supplierId:'sup-1',supplierName:'Vendor Ltd',status:'Submitted'}],
  proposalMeetings:[{id:'m1',supplierId:'sup-1',supplierName:'Vendor Ltd',status:'Pending Response',bidId:'b1'}],
  requisitions:[{id:'r1',status:'Pending'}],
  orders:[{id:'o1',supplierId:'sup-1',supplierName:'Vendor Ltd',status:'Awaiting Supplier Signature',totalCost:900},
    {id:'o2',supplierId:'sup-2',supplierName:'Other Inc',status:'Awaiting Supplier Signature',totalCost:100}],
  deliveries:[],amendments:[{id:'a1',poId:'o1',approvalStatus:'Pending Supplier Response'}],
  payments:[],suppliers:[{id:'sup-1',name:'Vendor Ltd'}],ratings:[],auditLogs:[]
};}
const copy=x=>structuredClone(x);
test('supplier can accept only its own awaiting-signature order',()=>{
  const previous=workspace(),next=copy(previous);Object.assign(next.orders[0],{status:'Approved & Signed',signedBy:'Vendor Contact',signedAt:new Date().toISOString()});
  assert.equal(validateSupplierSnapshotWrite(next,previous,supplier),null);
});
test('supplier cannot change another vendor order or change its own amount',()=>{
  const previous=workspace(),next=copy(previous);
  next.orders[1].status='Approved & Signed';next.orders[1].signedBy='Vendor Contact';next.orders[1].signedAt=new Date().toISOString();
  assert.match(validateSupplierSnapshotWrite(next,previous,supplier),/cannot modify Purchase Order/);
  next.orders[1]=copy(previous.orders[1]);next.orders[0].totalCost=1;
  assert.match(validateSupplierSnapshotWrite(next,previous,supplier),/cannot modify Purchase Order/);
});
test('supplier cannot edit other business collections or create forged bids',()=>{
  const previous=workspace(),next=copy(previous);next.requisitions[0].status='Approved';
  assert.match(validateSupplierSnapshotWrite(next,previous,supplier),/may not modify requisitions/);
  next.requisitions=copy(previous.requisitions);next.bids.push({id:'fake'});
  assert.match(validateSupplierSnapshotWrite(next,previous,supplier),/cannot create bids/);
});
test('supplier may respond to an own amendment but cannot edit other fields',()=>{
  const previous=workspace(),next=copy(previous);Object.assign(next.amendments[0],{approvalStatus:'Supplier Responded',supplierResponse:'Delivery rescheduled',respondedAt:new Date().toISOString()});
  assert.equal(validateSupplierSnapshotWrite(next,previous,supplier),null);
  next.amendments[0].revisedQty=1;
  assert.match(validateSupplierSnapshotWrite(next,previous,supplier),/cannot modify amendment/);
});
test('supplier may accept a meeting but cannot reschedule it via shared state',()=>{
  const previous=workspace(),next=copy(previous);next.proposalMeetings[0].status='Agreed';
  assert.equal(validateSupplierSnapshotWrite(next,previous,supplier),null);
  next.proposalMeetings[0].date='2027-01-01';
  assert.match(validateSupplierSnapshotWrite(next,previous,supplier),/cannot modify meeting/);
});
test('non-suppliers still use their existing role-specific finance/sourcing checks',()=>{
  assert.equal(validateSupplierSnapshotWrite({}, {}, {...supplier,role:'employee',app_role:'Procurement Head'}),null);
});
