// @ts-nocheck
import { deadlineIsOpen, deadlinesLoaded, loadDeadlines } from '../services/sourcing';
import { renderApp } from '../core/renderBridge';
import { ACTIVE_MEETING_STATUSES, findMeetingConflicts } from '../domain/meetingSchedule';
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


export async function openSubmitBidModal(needId) {
    try { await loadDeadlines(); } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not verify bidding deadline.', 'error');
        return;
    }
    if (!deadlineIsOpen(needId)) {
        showToast('Bidding is closed or its deadline is not configured. Late bids cannot be submitted.', 'error');
        return;
    }
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
        need.selectedBidId !== bid.id || DB.orders.some(o => o.bidId === bidId)) {
        showToast('Select a supplier before scheduling a proposal meeting.', 'error');
        return;
    }
    if (DB.proposalMeetings.some(m => m.bidId === bidId && ACTIVE_MEETING_STATUSES.some(status => status === m.status))) {
        showToast('This bid already has an active meeting. Cancel that meeting before rescheduling.', 'warning');
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
        if (responseStatus === 'Agreed' && findMeetingConflicts(mtg, DB.proposalMeetings, mtg.id).length) {
            showToast('This time overlaps another active proposal meeting. Ask procurement to reschedule before accepting.', 'warning');
            return;
        }
        mtg.status = responseStatus;
        logAudit('Meeting Response', `Supplier ${mtg.supplierName} responded ${responseStatus} to meeting invite ${mtgId}`);
        Storage.save(DB);
        showToast(`Meeting response sent: ${responseStatus}`, 'success');
        renderApp();
    } else {
        showToast('This meeting invite cannot be updated.', 'error');
    }
}


/** Both the procurement team and the invited supplier can cancel an active invite. */
export function canCancelProposalMeeting(meetingId: string): boolean {
    const meeting = DB.proposalMeetings.find(m => m.id === meetingId);
    if (!meeting || !ACTIVE_MEETING_STATUSES.some(status => status === meeting.status)) return false;
    // Procurement staff may cancel a historical meeting even after a PO, but that
    // cancellation does NOT revoke or modify the purchase order.
    if (canManageBidding()) return true;
    if (DB.orders.some(order => order.bidId === meeting.bidId)) return false;
    return (
        DB.currentUser?.role === 'Supplier' &&
        meeting.supplierId === DB.currentUser.supplierId
    );
}

export function openCancelProposalMeetingModal(meetingId: string): void {
    if (!canCancelProposalMeeting(meetingId)) {
        showToast('You cannot cancel this meeting in its current state.', 'error');
        return;
    }
    ui.selectedRecord = meetingId;
    ui.currentModal = 'cancel_meeting';
    renderApp();
}

export function cancelProposalMeeting(meetingId: string, reason: string): boolean {
    if (!canCancelProposalMeeting(meetingId)) {
        showToast('This meeting is no longer eligible for cancellation.', 'error');
        return false;
    }
    const cleanedReason = reason.trim();
    if (!cleanedReason || cleanedReason.length > 500) {
        showToast('Please enter a cancellation reason (1–500 characters).', 'error');
        return false;
    }
    const meeting = DB.proposalMeetings.find(m => m.id === meetingId);
    meeting.status = 'Cancelled';
    meeting.cancellationReason = cleanedReason;
    meeting.cancelledBy = DB.currentUser.name;
    meeting.cancelledAt = new Date().toISOString();
    logAudit('Proposal Meeting Cancelled', `Meeting ${meeting.id} with ${meeting.supplierName} cancelled by ${DB.currentUser.name}. Reason: ${cleanedReason}`);
    Storage.save(DB);
    showToast(`Meeting ${meeting.id} cancelled. Its time slot is available again.`, 'success');
    return true;
}
