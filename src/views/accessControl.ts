// @ts-nocheck
import { saveAccessControlMatrix } from '../actions/userActions';
import { DB } from '../store/state';
import { renderDashboardView } from './dashboard';

// Migrated from enterprise.html. Business rules / markup preserved.
export function renderAccessControlView() {
    if (DB.currentUser?.role !== 'Admin') return renderDashboardView();
    const rolesList = ['Admin', 'Procurement Head', 'Procurement Officer', 'Employee', 'Supplier'];
    const allActions = [
        { key: 'create_pr', label: 'Create Purchase Requisition' },
        { key: 'approve_pr', label: 'Approve / Reject Requisitions' },
        { key: 'manage_suppliers', label: 'Manage Supplier Directory' },
        { key: 'manage_bidding', label: 'Create & Manage Bidding / Meetings' },
        { key: 'record_delivery', label: 'Log Deliveries & Inspections' },
        { key: 'manage_delivery_issues', label: 'Handle Delivery Issues' },
        { key: 'approve_amendment', label: 'Approve Order Amendments' },
        { key: 'process_payment', label: 'Process Financial Payments' },
        { key: 'confirm_payment', label: 'Confirm Payment Completion' },
        { key: 'rate_supplier', label: 'Rate & Evaluate Suppliers' },
        { key: 'manage_users', label: 'Manage & Verify Users' },
        { key: 'manage_permissions', label: 'Manage Access Control Matrix' },
        { key: 'view_all_po', label: 'View All Purchase Orders' },
        { key: 'view_assigned_po', label: 'View Assigned Purchase Orders' },
        { key: 'view_supplier_portal', label: 'Access Supplier Portal' },
        { key: 'submit_bids', label: 'Submit Supplier Bids' }
    ];

    return `
        <div class="space-y-4">
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div class="flex justify-between items-center mb-6">
                    <div>
                        <h3 class="text-lg font-bold text-slate-800">Position Accessibility Management Matrix</h3>
                        <p class="text-xs text-slate-500">Configure role-based feature permissions. Procurement Officers are the delivery staff role; Employees are requesters. Admin access to this matrix is always retained.</p>
                    </div>
                    <button data-command="saveAccessControlMatrix" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors flex items-center space-x-2">
                        <i class="fa-solid fa-floppy-disk"></i>
                        <span>Save Permissions Matrix</span>
                    </button>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm text-slate-700 border-collapse">
                        <thead class="bg-slate-100 uppercase text-xs font-bold border-b border-slate-200">
                            <tr>
                                <th class="p-4 border-r border-slate-200">Feature Permission / Action</th>
                                ${rolesList.map(r => `
                                    <th class="p-4 text-center border-r border-slate-200">${r}</th>
                                `).join('')}
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                            ${allActions.map(action => `
                                <tr class="hover:bg-slate-50">
                                    <td class="p-4 font-semibold text-slate-800 border-r border-slate-200">${action.label}</td>
                                    ${rolesList.map(role => {
                                        const isChecked = (DB.permissions[role] || []).includes(action.key);
                                        const isLockedAdminPermission =
                                            role === 'Admin' && ['manage_users', 'manage_permissions'].includes(action.key);
                                        return `
                                            <td class="p-4 text-center border-r border-slate-200">
                                                <input type="checkbox" data-role="${role}" data-action="${action.key}" ${isChecked ? 'checked' : ''} ${isLockedAdminPermission ? 'disabled' : ''} class="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500 cursor-pointer">
                                            </td>
                                        `;
                                    }).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}
