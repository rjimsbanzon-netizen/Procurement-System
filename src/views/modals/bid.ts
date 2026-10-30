// @ts-nocheck
import { closeModal } from '../../actions/modalActions';
import { DB, ui } from '../../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export function renderSubmitBidModal() {
    const need = DB.stockNeeds.find(s => s.id === ui.selectedRecord);
    if (!need) return '';

    return `
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200">
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                    <div>
                        <h3 class="font-bold text-slate-800 text-lg">Apply / Submit Bid</h3>
                        <p class="text-xs text-slate-500">${need.title} (${need.id})</p>
                    </div>
                    <button data-command="closeModal" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                </div>

                <form id="submit-bid-form" class="space-y-4">
                    <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                        <p><span class="font-semibold text-slate-700">Required Target Qty:</span> ${need.targetQty} units</p>
                        <p><span class="font-semibold text-slate-700">Max Budget Cap:</span> ₱${(need.budgetCap || 0).toLocaleString()}</p>
                        <p><span class="font-semibold text-slate-700">Your Total Bid:</span> <span id="bid-total-preview">Enter a unit price</span></p>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Offered Unit Price (₱ PHP)</label>
                            <input type="number" id="bid-unit-price" min="0" step="0.01" required placeholder="e.g. 1200" class="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500">
                        </div>
                        <div>
                            <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Delivery Lead Time (Days)</label>
                            <input type="number" id="bid-lead-time" min="1" required placeholder="e.g. 10" class="w-full text-xs p-2.5 border border-slate-300 rounded-lg">
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold uppercase text-slate-600 mb-1">Product Notes / Warranty / Terms</label>
                        <textarea id="bid-notes" rows="3" required placeholder="Specify model numbers, support agreements, warranties included..." class="w-full text-xs p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500"></textarea>
                    </div>

                    <div class="flex justify-end space-x-3 pt-3 border-t border-slate-100">
                        <button type="button" data-command="closeModal" class="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-semibold rounded-lg">Cancel</button>
                        <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm">Submit Proposal Bid</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}
