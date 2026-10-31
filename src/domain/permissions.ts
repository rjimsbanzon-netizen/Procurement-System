// @ts-nocheck
import { DB } from '../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export function hasPermission(action) {
    if (!DB.currentUser) return false;
    const role = DB.currentUser.role;
    const userPerms = DB.permissions[role] || [];
    return userPerms.includes(action);
}


export function canAccessTab(tab) {
    if (!DB.currentUser) return false;
    const isSupplier = DB.currentUser.role === 'Supplier';
    switch (tab) {
        case 'dashboard': return !isSupplier || hasPermission('view_supplier_portal');
        case 'notifications': return true;
        case 'approvals': return !isSupplier;
        case 'budgets': return !isSupplier;
        case 'invoice_matching': return true;
        case 'documents':
        case 'pdf_generator': return true;
        case 'tracking': return isSupplier ? hasPermission('view_assigned_po') : hasPermission('create_pr') || hasPermission('approve_pr') || hasPermission('view_all_po');
        case 'bidding': return isSupplier ? hasPermission('submit_bids') : canManageBidding();
        case 'requisitions': return hasPermission('create_pr') || hasPermission('approve_pr');
        case 'orders': return hasPermission(isSupplier ? 'view_assigned_po' : 'view_all_po');
        case 'delivery':
            return isSupplier
                ? hasPermission('view_assigned_po')
                : hasPermission('view_all_po') || hasPermission('record_delivery') || canManageDeliveryIssues();
        case 'amendments':
            return isSupplier
                ? hasPermission('view_assigned_po')
                : canManageDeliveryIssues() || canApproveAmendments();
        case 'payments':
            return isSupplier
                ? hasPermission('view_assigned_po')
                : hasPermission('process_payment') || hasPermission('confirm_payment');
        case 'suppliers': return hasPermission('manage_suppliers') || hasPermission('rate_supplier');
        case 'audit': return DB.currentUser.role === 'Admin';
        case 'users': return DB.currentUser.role === 'Admin' && hasPermission('manage_users');
        case 'access_control': return DB.currentUser.role === 'Admin';
        default: return false;
    }
}


export function canManageBidding() {
    return ['Admin', 'Procurement Head'].includes(DB.currentUser?.role) && hasPermission('manage_bidding');
}


export function getAgreementFinalizationError(bidId) {
    if (!canManageBidding()) return 'Only the Procurement Head or Admin can finalize supplier agreements.';

    const bid = DB.bids.find(item => item.id === bidId);
    if (!bid) return 'The selected supplier bid could not be found.';

    const need = DB.stockNeeds.find(item => item.id === bid.needId);
    if (!need) return 'The procurement need linked to this bid could not be found.';

    const pr = DB.requisitions.find(item => item.id === need.prId);
    if (!pr) return 'The approved Purchase Requisition linked to this need could not be found.';

    if (DB.orders.some(order => order.bidId === bid.id)) {
        return `A Purchase Order has already been issued for bid ${bid.id}.`;
    }
    if (pr.status !== 'Approved') {
        return `Purchase Requisition ${pr.id} is "${pr.status}". It must be Approved before a Purchase Order can be issued.`;
    }
    if (need.selectedBidId !== bid.id) {
        return 'This bid is not the supplier currently selected for the procurement need.';
    }
    if (need.status !== 'Supplier Selected') {
        return `The procurement need is "${need.status}". It must be in Supplier Selected status before finalizing.`;
    }
    if (bid.status !== 'Selected') {
        return `The bid is "${bid.status}". Select this supplier before finalizing the agreement.`;
    }

    const meeting = DB.proposalMeetings.find(item => item.bidId === bid.id);
    if (meeting?.status !== 'Agreed') {
        return 'The selected supplier must agree to the proposal meeting before the agreement can be finalized.';
    }

    return null;
}


export function canManageDeliveryIssues() {
    return ['Admin', 'Procurement Head'].includes(DB.currentUser?.role) &&
        hasPermission('manage_delivery_issues');
}


export function canApproveAmendments() {
    return ['Admin', 'Procurement Head'].includes(DB.currentUser?.role) &&
        hasPermission('approve_amendment');
}
