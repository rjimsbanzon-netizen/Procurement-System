// @ts-nocheck
import { approveUser, deleteUserAccount, rejectUser, revokeUser, updateUserRole } from '../actions/userActions';
import { DB } from '../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export function renderUsersView() {
    return `
        <div class="space-y-4">
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h3 class="font-bold text-slate-800">User Account & Authorization Management</h3>
                        <p class="text-xs text-slate-500 mt-1">Registration creates an Employee account; choose a position and click Save Role to persist it in Cloudflare D1. Procurement Officer is the delivery staff role for purchase orders, delivery logging, and inspection. Role permissions can be customized in Access Control Matrix.</p>
                    </div>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm text-slate-600">
                        <thead class="bg-slate-100 text-slate-700 uppercase font-semibold text-xs border-b border-slate-200">
                            <tr>
                                <th class="p-4">User</th>
                                <th class="p-4">Email & Dept</th>
                                <th class="p-4">Assigned Position</th>
                                <th class="p-4">Status</th>
                                <th class="p-4 text-center">Account Controls</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200">
                            ${DB.users.map(u => `
                                <tr class="hover:bg-slate-50">
                                    <td class="p-4 font-bold text-slate-900">${u.name} <span class="text-xs text-slate-400">(@${u.username})</span></td>
                                    <td class="p-4 text-xs">
                                        <div>${u.email}</div>
                                        <div class="text-slate-400">${u.companyName || u.department}</div>
                                    </td>
                                    <td class="p-4">
                                        ${u.role === 'Admin' ? `<span class="text-xs font-semibold text-slate-700">Administrator</span>` : `
                                            <div class="flex flex-wrap items-center gap-2">
                                                <select id="user-role-${u.id}" aria-label="Role for ${u.username}" class="text-xs border border-slate-300 rounded px-2 py-2 focus:ring-2 focus:ring-sky-500">
                                                    <option value="Employee" ${u.role === 'Employee' ? 'selected' : ''}>Employee</option>
                                                    <option value="Procurement Officer" ${u.role === 'Procurement Officer' ? 'selected' : ''}>Procurement Officer / Delivery Staff</option>
                                                    <option value="Procurement Head" ${u.role === 'Procurement Head' ? 'selected' : ''}>Procurement Head</option>
                                                    <option value="Supplier" ${u.role === 'Supplier' ? 'selected' : ''}>Supplier</option>
                                                </select>
                                                <button type="button" data-command="saveUserRole" data-arg1="${u.id}" class="px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-semibold transition-colors">Save Role</button>
                                            </div>
                                            <p class="mt-1 text-[11px] font-semibold text-slate-600">Saved role: ${u.role}</p>
                                            <p class="mt-1 max-w-xs text-[11px] text-slate-500">${getRoleAuthorizationSummary(u.role)}</p>
                                        `}
                                    </td>
                                    <td class="p-4">
                                        <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${
                                            u.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : u.status === 'Rejected' || u.status === 'Access Revoked' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                                        }">${u.status}</span>
                                    </td>
                                    <td class="p-4 text-center">
                                        ${u.role === 'Admin' ? `
                                            <span class="text-xs text-slate-400">Protected</span>
                                        ` : `
                                            <div class="flex justify-center gap-2">
                                                ${u.status === 'Pending Verification' || u.status === 'Rejected' || u.status === 'Access Revoked' ? `
                                                    <button data-command="approveUser" data-arg1="${u.id}" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow-sm transition-colors">${u.status === 'Pending Verification' ? 'Approve' : 'Restore Access'}</button>
                                                ` : `
                                                    <button data-command="revokeUser" data-arg1="${u.id}" class="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold shadow-sm transition-colors">Revoke Access</button>
                                                `}
                                                ${u.status === 'Pending Verification' ? `
                                                    <button data-command="rejectUser" data-arg1="${u.id}" class="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold shadow-sm transition-colors">Reject</button>
                                                ` : ''}
                                                <button data-command="deleteUserAccount" data-arg1="${u.id}" class="px-3 py-1 bg-slate-700 hover:bg-slate-800 text-white rounded text-xs font-semibold shadow-sm transition-colors">Delete Account</button>
                                            </div>
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


export function getRoleAuthorizationSummary(role) {
    switch (role) {
        case 'Admin': return 'System administration, user verification, audit logs, and permission management.';
        case 'Procurement Head': return 'Procurement approvals, bidding, delivery issue resolution, amendments, and payments.';
        case 'Procurement Officer': return 'Purchase requisitions and orders, delivery logging and inspection, and supplier directory.';
        case 'Supplier': return 'Supplier portal, bid submission, assigned orders, delivery updates, and payment status.';
        case 'Employee':
        default: return 'Create and track purchase requisitions for your department.';
    }
}
