// @ts-nocheck
import { renderApp, navigateTo } from '../core/renderBridge';
import { CLOUD_API_BASE } from '../services/cloud';
import { logAudit } from '../services/audit';
import { hasPermission } from '../domain/permissions';
import { requestInput } from '../services/actionDialogs';
import { Storage } from '../services/storage';
import { showToast } from '../services/toast';
import { DB } from '../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export function approvePR(id) {
    if (CLOUD_API_BASE) { showToast('Use the multi-level approval workflow instead.', 'warning'); navigateTo('approvals'); return; }
    const pr = DB.requisitions.find(r => r.id === id);
    if (pr) {
        pr.status = 'Approved';
        logAudit('PR Approved', `Purchase Requisition ${id} approved by ${DB.currentUser.name}.`);
        Storage.save(DB);
        showToast(`Requisition ${id} approved successfully.`, 'success');
        renderApp();
    }
}


export async function rejectPR(id) {
    if (CLOUD_API_BASE) { showToast('Use the multi-level approval workflow instead.', 'warning'); navigateTo('approvals'); return; }
    const pr = DB.requisitions.find(r => r.id === id);
    if (!pr || pr.status !== 'Pending' || !hasPermission('approve_pr')) {
        showToast('Only an authorized reviewer can reject a pending requisition.', 'error');
        return;
    }
    const reason = await requestInput({
        title: 'Reject Purchase Requisition',
        message: `Reject ${id}? This action ends the current requisition approval.`,
        label: 'Rejection reason', multiline: true, required: true, tone: 'danger',
        confirmText: 'Reject requisition'
    });
    if (reason === null) return;
    if (!reason.trim() || reason.trim().length > 1000) {
        showToast('Provide a reason of 1–1000 characters.', 'error');
        return;
    }
    // A second approver could have updated the demo record while the dialog was open.
    if (pr.status !== 'Pending') { showToast('This requisition is no longer pending.', 'warning'); return; }
    pr.status = 'Rejected';
    pr.rejectionReason = reason.trim();
    pr.rejectedAt = new Date().toISOString();
    pr.rejectedBy = DB.currentUser.name;
    logAudit('PR Rejected', `Purchase Requisition ${id} rejected by ${DB.currentUser.name}. Reason: ${reason.trim()}`);
    Storage.save(DB);
    showToast(`Requisition ${id} rejected.`, 'warning');
    renderApp();
}


export function viewPRDetails(id) {
    const pr = DB.requisitions.find(r => r.id === id);
    if (pr) {
        showToast(`PR Details: ${pr.itemTitle} - Specs: ${pr.specs}`, 'info');
    }
}
