// @ts-nocheck
import { renderApp } from '../core/renderBridge';
import { logAudit } from '../services/audit';
import { Storage } from '../services/storage';
import { showToast } from '../services/toast';
import { DB } from '../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export function approvePR(id) {
    const pr = DB.requisitions.find(r => r.id === id);
    if (pr) {
        pr.status = 'Approved';
        logAudit('PR Approved', `Purchase Requisition ${id} approved by ${DB.currentUser.name}.`);
        Storage.save(DB);
        showToast(`Requisition ${id} approved successfully.`, 'success');
        renderApp();
    }
}


export function rejectPR(id) {
    const pr = DB.requisitions.find(r => r.id === id);
    if (pr) {
        pr.status = 'Rejected';
        logAudit('PR Rejected', `Purchase Requisition ${id} rejected by ${DB.currentUser.name}.`);
        Storage.save(DB);
        showToast(`Requisition ${id} rejected.`, 'warning');
        renderApp();
    }
}


export function viewPRDetails(id) {
    const pr = DB.requisitions.find(r => r.id === id);
    if (pr) {
        showToast(`PR Details: ${pr.itemTitle} - Specs: ${pr.specs}`, 'info');
    }
}
