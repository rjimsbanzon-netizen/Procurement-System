// @ts-nocheck
import { closeModal } from '../../actions/modalActions';
import { DB, ui } from '../../store/state';

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
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Meeting Venue / Stream Link</label>
                        <input type="text" id="mtg-venue" required placeholder="e.g. HQ Conference Room A / Zoom Link" class="w-full text-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500">
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Meeting Notes / Agenda</label>
                        <input type="text" id="mtg-notes" placeholder="Agenda and presentation items..." class="w-full text-xs p-3 border border-slate-300 rounded-lg">
                    </div>

                    <div class="flex justify-end space-x-3 pt-3 border-t border-slate-100">
                        <button type="button" data-command="closeModal" class="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-semibold rounded-lg">Cancel</button>
                        <button type="submit" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm">Send Meeting Invite</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}
