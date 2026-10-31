// @ts-nocheck
import { closeModal } from '../../actions/modalActions';
import { DB, ui } from '../../store/state';
import { canCancelProposalMeeting } from '../../actions/biddingActions';
import { escapeMeetingText } from '../../domain/meetingSchedule';

// Migrated from enterprise.html. Business rules / markup preserved.
export function renderScheduleMeetingModal() {
    const bid = DB.bids.find(b => b.id === ui.selectedRecord);
    if (!bid) return '';
    const need = DB.stockNeeds.find(s => s.id === bid.needId) || { title: bid.needId };

    return `
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200">
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                    <div>
                        <h3 class="font-bold text-slate-800 text-lg">Schedule Proposal Meeting</h3>
                        <p class="text-xs text-slate-500">Vendor: ${bid.supplierName} &bull; Need: ${need.title}</p>
                    </div>
                    <button data-command="closeModal" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                </div>

                <form id="schedule-meeting-form" class="space-y-4">
                    <div>
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Meeting Format</label>
                        <select id="mtg-mode" required class="w-full text-xs p-2.5 border border-slate-300 rounded-lg">
                            <option value="Online">Online</option>
                            <option value="Face-to-face">Face-to-face</option>
                        </select>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Presentation Date</label>
                            <input type="date" id="mtg-date" required class="w-full text-xs p-2.5 border border-slate-300 rounded-lg">
                        </div>
                        <div>
                            <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Presentation Time</label>
                            <input type="time" id="mtg-time" required class="w-full text-xs p-2.5 border border-slate-300 rounded-lg">
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Duration</label>
                        <select id="mtg-duration" required class="w-full text-xs p-2.5 border border-slate-300 rounded-lg">
                            <option value="30">30 minutes</option>
                            <option value="60" selected>1 hour</option>
                            <option value="90">1 hour 30 minutes</option>
                            <option value="120">2 hours</option>
                        </select>
                    </div>
                    <div id="mtg-conflict-warning" role="alert" aria-live="polite" class="hidden p-3 bg-rose-50 border border-rose-300 rounded-lg text-xs text-rose-800"></div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Meeting Venue / Stream Link</label>
                        <input type="text" id="mtg-venue" required placeholder="e.g. HQ Conference Room A / Zoom Link" class="w-full text-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500">
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Meeting Notes / Agenda</label>
                        <input type="text" id="mtg-notes" maxlength="1000" placeholder="Agenda and presentation items..." class="w-full text-xs p-3 border border-slate-300 rounded-lg">
                    </div>

                    <div class="flex justify-end space-x-3 pt-3 border-t border-slate-100">
                        <button type="button" data-command="closeModal" class="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-semibold rounded-lg">Cancel</button>
                        <button type="submit" id="mtg-submit" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm">Send Meeting Invite</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}


export function renderCancelProposalMeetingModal() {
    const meeting = DB.proposalMeetings.find(item => item.id === ui.selectedRecord);
    if (!meeting || !canCancelProposalMeeting(meeting.id)) return '';
    return `
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200" role="dialog" aria-modal="true" aria-labelledby="cancel-meeting-title">
                <div class="flex items-start justify-between gap-4 mb-4">
                    <div>
                        <h3 id="cancel-meeting-title" class="font-bold text-slate-800 text-lg">Cancel Proposal Meeting</h3>
                        <p class="mt-1 text-xs text-slate-500">${escapeMeetingText(meeting.id)} · ${escapeMeetingText(meeting.date)} at ${escapeMeetingText(meeting.time)} · ${escapeMeetingText(meeting.supplierName)}</p>
                    </div>
                    <button type="button" data-command="closeModal" aria-label="Close" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 mb-4">
                    This will mark the meeting as Cancelled and release its reserved time. It will remain in the meeting history.
                    ${DB.orders.some(order => order.bidId === meeting.bidId) ? '<strong>A purchase order has already been issued; cancelling this meeting will NOT cancel or modify that purchase order.</strong>' : ''}
                </div>
                <form id="cancel-meeting-form" class="space-y-4">
                    <div>
                        <label for="mtg-cancel-reason" class="block text-xs font-semibold uppercase text-slate-600 mb-1">Reason for cancellation *</label>
                        <textarea id="mtg-cancel-reason" required minlength="3" maxlength="500" rows="3" placeholder="Explain why this meeting is being cancelled..." class="w-full p-3 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-rose-500"></textarea>
                    </div>
                    <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
                        <button type="button" data-command="closeModal" class="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-semibold rounded-lg">Keep Meeting</button>
                        <button type="submit" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg">Confirm Cancellation</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}
