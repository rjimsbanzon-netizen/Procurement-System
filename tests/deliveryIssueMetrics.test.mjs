import test from 'node:test';
import assert from 'node:assert/strict';
import { countUnresolvedDiscrepancies } from '../src/domain/deliveryIssueMetrics.ts';

test('dashboard matches three open issues shown in discrepancy tracker', () => {
  const issues = ['DEL-8004', 'DEL-8002', 'DEL-8001'].map(delivery_id => ({ delivery_id, status: 'Open' }));
  assert.equal(countUnresolvedDiscrepancies(issues), 3);
});

test('in-progress cases remain active until the tracker marks them resolved', () => {
  const issues = [
    { status: 'Open' }, { status: 'Investigating' },
    { status: 'Awaiting Supplier' }, { status: 'Replacement In Transit' },
    { status: 'Resolved' }
  ];
  assert.equal(countUnresolvedDiscrepancies(issues), 4);
});

test('resolved issues do not inflate the active dashboard count', () => {
  assert.equal(countUnresolvedDiscrepancies([{ status: 'Resolved' }, { status: ' resolved ' }]), 0);
  assert.equal(countUnresolvedDiscrepancies([]), 0);
});
