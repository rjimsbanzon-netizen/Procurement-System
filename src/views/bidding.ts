// @ts-nocheck
import { openCreateStockNeedModal, openFinalizeAgreementModal, openScheduleMeetingModal, openSubmitBidModal, respondProposalMeeting, selectBid } from '../actions/biddingActions';
import { canManageBidding, getAgreementFinalizationError } from '../domain/permissions';
import { DB } from '../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export function renderBiddingView() {
    const isSupplier = DB.currentUser.role === 'Supplier';
    const canCreateNeed = canManageBidding();

    return `
        <div class="space-y-6">
            <div class="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div>
                    <h3 class="font-bold text-slate-800 text-lg">Stock Need Creation & Vendor Bidding Portal</h3>
                    <p class="text-xs text-slate-500">Publish procurement needs, collect supplier bids, schedule meetings, and confirm presentation schedules.</p>
                </div>
                ${canCreateNeed ? `
                    <button data-command="openCreateStockNeedModal" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center space-x-2">
                        <i class="fa-solid fa-bullhorn"></i>
                        <span>Publish Stock Need</span>
                    </button>
                ` : ''}
            </div>

            <!-- Published Stock Needs Section -->
            <div class="space-y-4">
                <h4 class="font-bold text-slate-800 flex items-center gap-2">
                    <i class="fa-solid fa-box-open text-sky-600"></i>
                    <span>Published Stock Needs for Bidding</span>
                </h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${DB.stockNeeds.filter(sn => !isSupplier || sn.status === 'Published').length === 0 ? `
                        <div class="col-span-2 bg-white p-8 text-center rounded-xl border border-slate-200 text-slate-400">
                            <i class="fa-solid fa-folder-open text-3xl mb-2"></i>
                            <p class="text-sm">No stock needs published for bidding yet.</p>
                        </div>
                    ` : DB.stockNeeds.filter(sn => !isSupplier || sn.status === 'Published').map(sn => {
                        const bidCount = DB.bids.filter(b => b.needId === sn.id).length;
                        const userBid = isSupplier ? DB.bids.find(b => b.needId === sn.id && b.supplierId === DB.currentUser.supplierId) : null;
                        const linkedPR = DB.requisitions.find(pr => pr.id === sn.prId);
                        return `
                            <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
                                <div>
                                    <div class="flex justify-between items-start">
                                        <div>
                                            <span class="text-xs font-bold text-sky-600">${sn.id}</span>
                                            <h5 class="font-bold text-slate-900 text-base mt-0.5">${sn.title}</h5>
                                        </div>
                                        <span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-semibold">${sn.status}</span>
                                    </div>
                                    <div class="mt-3 bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs space-y-1">
                                        <p><span class="font-semibold text-slate-700">Target Qty:</span> ${sn.targetQty} units</p>
                                        <p><span class="font-semibold text-slate-700">Budget Cap:</span> ₱${(sn.budgetCap || 0).toLocaleString()}</p>
                                        <p><span class="font-semibold text-slate-700">Tech Specs:</span> ${sn.techSpecs}</p>
                                        ${linkedPR ? `<p><span class="font-semibold text-slate-700">Purchase Request:</span> ${linkedPR.id}</p>` : ''}
                                    </div>
                                </div>

                                <div class="pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                                    <span class="text-slate-500"><i class="fa-solid fa-gavel mr-1"></i> ${bidCount} Bids Submitted</span>

                                    ${isSupplier ? `
                                        ${userBid ? `
                                            <span class="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg font-semibold">
                                                <i class="fa-solid fa-check mr-1"></i> Bid Submitted (₱${userBid.totalCost.toLocaleString()})
                                            </span>
                                        ` : `
                                            <button data-command="openSubmitBidModal" data-arg1="${sn.id}" class="px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold transition-colors flex items-center space-x-1.5">
                                                <i class="fa-solid fa-hand-holding-dollar"></i>
                                                <span>Apply / Submit Bid</span>
                                            </button>
                                        `}
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- Submitted Bids Comparison & Meeting Scheduling Section (Admin/Procurement View) -->
            ${!isSupplier ? `
                <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div class="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                        <div>
                            <h4 class="font-bold text-slate-800">Submitted Vendor Bids & Comparison</h4>
                            <p class="text-xs text-slate-500">Review vendor offers and schedule proposal presentation meetings.</p>
                        </div>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-sm text-slate-600">
                            <thead class="bg-slate-100 text-slate-700 uppercase font-semibold text-xs border-b border-slate-200">
                                <tr>
                                    <th class="p-4">Stock Need</th>
                                    <th class="p-4">Supplier</th>
                                    <th class="p-4 text-right">Unit Price</th>
                                    <th class="p-4 text-right">Total Offer</th>
                                    <th class="p-4">Lead Time</th>
                                    <th class="p-4">Product Notes</th>
                                    <th class="p-4 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200">
                                ${DB.bids.length === 0 ? `
                                    <tr><td colspan="7" class="p-8 text-center text-slate-400">No bids submitted yet.</td></tr>
                                ` : DB.bids.map(b => {
                                    const need = DB.stockNeeds.find(s => s.id === b.needId) || { title: b.needId };
                                    const meeting = DB.proposalMeetings.find(m => m.bidId === b.id);
                                    const finalizeError = getAgreementFinalizationError(b.id);
                                    return `
                                        <tr class="hover:bg-slate-50">
                                            <td class="p-4 font-bold text-sky-600">${need.title}</td>
                                            <td class="p-4 font-medium text-slate-900">${b.supplierName}</td>
                                            <td class="p-4 text-right font-semibold">₱${b.unitPrice.toLocaleString()}</td>
                                            <td class="p-4 text-right font-bold text-slate-900">₱${b.totalCost.toLocaleString()}</td>
                                            <td class="p-4 text-xs font-medium text-slate-700">${b.leadTimeDays} Days</td>
                                            <td class="p-4 text-xs text-slate-500 truncate max-w-xs" title="${b.notes}">${b.notes}</td>
                                            <td class="p-4 text-center space-y-2">
                                                ${b.status === 'Selected' ? `
                                                    <span class="block px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Selected supplier</span>
                                                    ${meeting?.status === 'Agreed' ? `
                                                        ${canCreateNeed && !finalizeError
                                                            ? `<button data-command="openFinalizeAgreementModal" data-arg1="${b.id}" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-semibold">Finalize Terms & Issue PO</button>`
                                                            : canCreateNeed
                                                                ? `<span class="block max-w-xs text-xs text-rose-700">Cannot issue PO: ${finalizeError}</span>`
                                                                : ''}
                                                    ` : meeting?.status === 'Pending Response' ? `
                                                        <span class="text-xs text-amber-700">Meeting response pending</span>
                                                    ` : canCreateNeed ? `
                                                        <button data-command="openScheduleMeetingModal" data-arg1="${b.id}" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-semibold transition-colors">
                                                            <i class="fa-solid fa-calendar-plus mr-1"></i>${meeting?.status === 'Declined' ? 'Reschedule Meeting' : 'Schedule Meeting'}
                                                        </button>
                                                    ` : ''}
                                                ` : b.status === 'Submitted' && need.status === 'Published' && canCreateNeed ? `
                                                    <button data-command="selectBid" data-arg1="${b.id}" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold">
                                                        <i class="fa-solid fa-check mr-1"></i>Select Supplier
                                                    </button>
                                                ` : `
                                                    <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${b.status === 'Not Selected' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}">${b.status}</span>
                                                `}
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            ` : ''}

            <!-- Proposal Meetings & Schedule Acceptance Section -->
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h4 class="font-bold text-slate-800">Proposal Presentation Meetings</h4>
                        <p class="text-xs text-slate-500">Meeting invites, venue schedule, and supplier confirmations.</p>
                    </div>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm text-slate-600">
                        <thead class="bg-slate-100 text-slate-700 uppercase font-semibold text-xs border-b border-slate-200">
                            <tr>
                                <th class="p-4">Meeting Ref</th>
                                <th class="p-4">Supplier</th>
                                <th class="p-4">Date & Time</th>
                                <th class="p-4">Venue</th>
                                <th class="p-4">Status</th>
                                <th class="p-4 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                            ${DB.proposalMeetings.length === 0 ? `
                                <tr><td colspan="6" class="p-8 text-center text-slate-400">No proposal meetings scheduled yet.</td></tr>
                            ` : DB.proposalMeetings.filter(m => !isSupplier || m.supplierId === DB.currentUser.supplierId).map(m => `
                                <tr class="hover:bg-slate-50">
                                    <td class="p-4 font-bold text-sky-600">${m.id}</td>
                                    <td class="p-4 font-medium text-slate-900">${m.supplierName}</td>
                                    <td class="p-4 text-xs font-semibold text-slate-800">${m.date} at ${m.time}</td>
                                    <td class="p-4 text-xs text-slate-600">
                                        <div class="font-semibold">${m.meetingMode || 'Venue'}</div>
                                        <div>${m.venue}</div>
                                    </td>
                                    <td class="p-4">
                                        <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${
                                            m.status === 'Agreed' ? 'bg-emerald-100 text-emerald-800' :
                                            m.status === 'Declined' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                                        }">${m.status}</span>
                                    </td>
                                    <td class="p-4 text-center space-x-2">
                                        ${isSupplier && m.status === 'Pending Response' ? `
                                            <button data-command="respondProposalMeeting" data-arg1="${m.id}" data-arg2="Agreed" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold transition-colors">
                                                <i class="fa-solid fa-check mr-1"></i> Agree to Schedule
                                            </button>
                                            <button data-command="respondProposalMeeting" data-arg1="${m.id}" data-arg2="Declined" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold transition-colors">
                                                <i class="fa-solid fa-xmark mr-1"></i> Disagree / Request Change
                                            </button>
                                        ` : `
                                            <span class="text-xs text-slate-400">${m.status}</span>
                                        `}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}
