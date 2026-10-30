// @ts-nocheck
import { renderApp } from '../core/renderBridge';
import { canManageBidding, getAgreementFinalizationError } from '../domain/permissions';
import { logAudit } from '../services/audit';
import { Storage } from '../services/storage';
import { showToast } from '../services/toast';
import { DB, ui } from '../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export function openCreateStockNeedModal(prId = null) {
    if (!canManageBidding()) {
        showToast('Only the Procurement Head or Admin can publish procurement needs.', 'error');
        return;
    }
    ui.selectedRecord = prId || null;
    ui.currentModal = 'create_stock_need';
    renderApp();
}


export function openSubmitBidModal(needId) {
    const need = DB.stockNeeds.find(item => item.id === needId);
    if (DB.currentUser.role !== 'Supplier' || !need || need.status !== 'Published' ||
        DB.bids.some(item => item.needId === needId && item.supplierId === DB.currentUser.supplierId)) {
        showToast('This procurement need is not accepting a bid from your account.', 'error');
        return;
    }
    ui.selectedRecord = needId;
    ui.currentModal = 'submit_bid';
    renderApp();
}


export function openScheduleMeetingModal(bidId) {
    const bid = DB.bids.find(item => item.id === bidId);
    const need = DB.stockNeeds.find(item => item.id === bid?.needId);
    if (!canManageBidding() || !bid || !need || bid.status !== 'Selected' ||
        need.selectedBidId !== bid.id) {
        showToast('Select a supplier before scheduling a proposal meeting.', 'error');
        return;
    }
    ui.selectedRecord = bidId;
    ui.currentModal = 'schedule_meeting';
    renderApp();
}


export function selectBid(bidId) {
    const bid = DB.bids.find(item => item.id === bidId);
    const need = DB.stockNeeds.find(item => item.id === bid?.needId);
    const pr = DB.requisitions.find(item => item.id === need?.prId);
    if (!canManageBidding() || !bid || !need || !pr || pr.status !== 'Approved' ||
        need.status !== 'Published' || bid.status !== 'Submitted') {
        showToast('This supplier proposal cannot be selected for the current procurement need.', 'error');
        return;
    }

    DB.bids.filter(item => item.needId === need.id).forEach(item => {
        item.status = item.id === bid.id ? 'Selected' : 'Not Selected';
    });
    need.status = 'Supplier Selected';
    need.selectedBidId = bid.id;
    logAudit('Supplier Selected', `${bid.supplierName} selected for ${need.id} after proposal review.`);
    Storage.save(DB);
    showToast(`${bid.supplierName} selected. Schedule a proposal discussion next.`, 'success');
    renderApp();
}


export function openFinalizeAgreementModal(bidId) {
    const blockReason = getAgreementFinalizationError(bidId);
    if (blockReason) {
        showToast(blockReason, 'error');
        return;
    }
    ui.selectedRecord = bidId;
    ui.currentModal = 'finalize_agreement';
    renderApp();
}


export function respondProposalMeeting(mtgId, responseStatus) {
    const mtg = DB.proposalMeetings.find(m => m.id === mtgId);
    if (DB.currentUser.role === 'Supplier' && mtg &&
        mtg.supplierId === DB.currentUser.supplierId &&
        mtg.status === 'Pending Response' &&
        ['Agreed', 'Declined'].includes(responseStatus)) {
        mtg.status = responseStatus;
        logAudit('Meeting Response', `Supplier ${mtg.supplierName} responded ${responseStatus} to meeting invite ${mtgId}`);
        Storage.save(DB);
        showToast(`Meeting response sent: ${responseStatus}`, 'success');
        renderApp();
    } else {
        showToast('This meeting invite cannot be updated.', 'error');
    }
}
