// @ts-nocheck
import { openProcessPaymentModal } from '../actions/orderActions';
import { hasPermission } from '../domain/permissions';
import { isOrderFullyVerified } from '../domain/procurement';
import { DB } from '../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export function renderPaymentsView() {
    let payList = DB.payments;
    if (DB.currentUser.role === 'Supplier') {
        const mySup = DB.suppliers.find(s => s.id === DB.currentUser.supplierId);
        if (mySup) payList = payList.filter(p => p.supplierName === mySup.name);
    }

    return `
        <div class="space-y-4">
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h3 class="font-bold text-slate-800">Financial Disbursements & Payment Approvals</h3>
                        <p class="text-xs text-slate-500">Payments require a signed PO, fully verified goods receipt, and a matched supplier invoice.</p><button data-command="navigateTo" data-arg1="invoice_matching" class="mt-2 text-xs font-bold text-[#aa5638]">Open Invoice &amp; PO Matching</button>
                    </div>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm text-slate-600">
                        <thead class="bg-slate-100 text-slate-700 uppercase font-semibold text-xs border-b border-slate-200">
                            <tr>
                                <th class="p-4">PO Ref</th>
                                <th class="p-4">Supplier</th>
                                <th class="p-4">Delivery Status</th>
                                <th class="p-4 text-right">Order Amount</th>
                                <th class="p-4">Method & Reference</th>
                                <th class="p-4">Payment Status</th>
                                <th class="p-4 text-center">Payment Control</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                            ${payList.length === 0 ? `
                                <tr><td colspan="7" class="p-8 text-center text-slate-400">No payment transactions.</td></tr>
                            ` : payList.map(p => `
                                <tr class="hover:bg-slate-50">
                                    <td class="p-4 font-bold text-sky-600">${p.poId}</td>
                                    <td class="p-4 font-medium text-slate-900">${p.supplierName}</td>
                                    <td class="p-4">
                                        ${isOrderFullyVerified(p.poId)
                                            ? `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full"><i class="fa-solid fa-check mr-1"></i> Verified</span>`
                                            : `<span class="px-2.5 py-1 bg-rose-100 text-rose-800 text-xs font-semibold rounded-full"><i class="fa-solid fa-lock mr-1"></i> Unverified / On Hold</span>`
                                        }
                                    </td>
                                    <td class="p-4 text-right font-bold text-slate-900">₱${(p.totalAmount || 0).toLocaleString()}</td>
                                    <td class="p-4 text-xs">
                                        <div class="font-semibold text-slate-800">${p.paymentMethod || 'Not Selected'}</div>
                                        <div class="text-slate-500">${p.refNumber ? 'Ref: ' + p.refNumber : 'No Ref'}</div>
                                    </td>
                                    <td class="p-4">${renderPaymentStatusBadge(p.status)}</td>
                                    <td class="p-4 text-center">
                                        ${hasPermission('process_payment') ? `
                                            ${p.status === 'Paid' ? `
                                                <span class="text-xs text-emerald-600 font-semibold"><i class="fa-solid fa-shield-check mr-1"></i> Confirmed Paid</span>
                                            ` : `
                                                <button data-command="openProcessPaymentModal" data-arg1="${p.id}" ${!isOrderFullyVerified(p.poId) ? 'disabled' : ''} class="px-3 py-1.5 ${!isOrderFullyVerified(p.poId) ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} rounded-md text-xs font-semibold shadow-sm transition-colors">
                                                    <i class="fa-solid fa-money-check-dollar mr-1"></i> Process Payment
                                                </button>
                                            `}
                                        ` : `<span class="text-xs text-slate-400">View Only</span>`}
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


export function renderPaymentStatusBadge(status) {
    switch(status) {
        case 'Paid':
            return `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-semibold inline-flex items-center"><i class="fa-solid fa-check-circle mr-1"></i> Paid</span>`;
        case 'Processing':
            return `<span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold inline-flex items-center"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Processing</span>`;
        case 'On Hold':
            return `<span class="px-2.5 py-1 bg-rose-100 text-rose-800 rounded-full text-xs font-semibold inline-flex items-center"><i class="fa-solid fa-hand mr-1"></i> On Hold</span>`;
        default:
            return `<span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold inline-flex items-center"><i class="fa-solid fa-clock mr-1"></i> Pending</span>`;
    }
}
