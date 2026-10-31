// @ts-nocheck
import { renderApp } from '../core/renderBridge';
import { logAudit } from '../services/audit';
import { CLOUD_API_BASE, cloudRequest } from '../services/cloud';
import { Storage } from '../services/storage';
import { showToast } from '../services/toast';
import { DB } from '../store/state';

// Migrated from enterprise.html. Business rules / markup preserved.
export async function approveUser(userId) {
    const u = DB.users.find(usr => usr.id === userId);
    if (u) {
        if (CLOUD_API_BASE) {
            try {
                await cloudRequest(`/users/${encodeURIComponent(u.id)}`, {
                    method: 'PUT',
                    body: JSON.stringify({ status: 'approved', appRole: u.role, accessRevoked: false })
                });
            } catch (error) {
                showToast(error instanceof Error ? error.message : 'Account approval failed.', 'error');
                return;
            }
        }
        u.accessRevoked = false;
        u.status = 'Active';
        logAudit('User Authorized', `User ${u.name} (@${u.username}) approved by Administrator.`);
        Storage.save(DB);
        showToast('User account approved successfully.', 'success');
        renderApp();
    }
}


export async function rejectUser(userId) {
    const u = DB.users.find(usr => usr.id === userId);
    if (!u) return;
    if (CLOUD_API_BASE) {
        try {
            await cloudRequest(`/users/${encodeURIComponent(u.id)}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'rejected', appRole: u.role })
            });
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Account rejection failed.', 'error');
            return;
        }
    }
    u.status = 'Rejected';
    logAudit('User Registration Rejected', `Administrator rejected ${u.name} (@${u.username}).`);
    Storage.save(DB);
    showToast('User registration rejected.', 'warning');
    renderApp();
}


export async function revokeUser(userId) {
    const u = DB.users.find(usr => usr.id === userId);
    if (!u || u.role === 'Admin') return;
    if (!window.confirm(`Revoke access for ${u.name} (@${u.username})? They will be signed out and unable to sign in until access is restored.`)) return;
    if (CLOUD_API_BASE) {
        try {
            await cloudRequest(`/users/${encodeURIComponent(u.id)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    status: u.status === 'Rejected' ? 'rejected' : 'approved',
                    accessRevoked: true
                })
            });
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Access revocation failed.', 'error');
            return;
        }
    }
    u.accessRevoked = true;
    u.status = 'Access Revoked';
    logAudit('User Access Revoked', `Administrator revoked access for ${u.name} (@${u.username}).`);
    Storage.save(DB);
    showToast('User access revoked and active sessions invalidated.', 'success');
    renderApp();
}


export async function deleteUserAccount(userId) {
    const u = DB.users.find(usr => usr.id === userId);
    if (!u || u.role === 'Admin') return;
    if (!window.confirm(`Permanently delete ${u.name} (@${u.username})? This removes the account and all active sessions. This cannot be undone.`)) return;
    if (CLOUD_API_BASE) {
        try {
            await cloudRequest(`/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' });
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Account deletion failed.', 'error');
            return;
        }
    }
    DB.users = DB.users.filter(account => account.id !== userId);
    logAudit('User Account Deleted', `Administrator permanently deleted ${u.name} (@${u.username}).`);
    Storage.save(DB);
    showToast('User account deleted.', 'success');
    renderApp();
}


// The Users screen uses an explicit Save button. A changed dropdown alone is not
// a persisted permission change; this avoids misleading, unsaved visual state.
export async function saveUserRole(userId) {
    const selected = document.getElementById(`user-role-${userId}`);
    if (!(selected instanceof HTMLSelectElement)) {
        showToast('Role selector could not be found. Refresh and try again.', 'error');
        return;
    }
    await updateUserRole(userId, selected.value);
}


export async function updateUserRole(userId, newRole) {
    const u = DB.users.find(usr => usr.id === userId);
    const permittedRoles = ['Employee', 'Procurement Officer', 'Procurement Head', 'Supplier'];
    if (DB.currentUser?.role !== 'Admin' || !u || u.role === 'Admin' || !permittedRoles.includes(newRole)) {
        showToast('Only administrators can assign a supported user role.', 'error');
        renderApp();
        return;
    }
    if (u.role === newRole) {
        showToast(`${u.name} is already assigned as ${newRole}.`, 'info');
        renderApp();
        return;
    }

    const previousRole = u.role;
    try {
        if (CLOUD_API_BASE) {
            const result = await cloudRequest(`/users/${encodeURIComponent(u.id)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    status: u.status === 'Pending Verification' ? 'pending' : u.status === 'Rejected' ? 'rejected' : 'approved',
                    appRole: newRole,
                    accessRevoked: Boolean(u.accessRevoked)
                })
            });
            if (!result?.ok) throw new Error('Cloudflare did not confirm the role update.');

            // Read the saved row from D1, not the unpersisted select value.
            // User accounts are NOT stored in /enterprise-state.
            const accountRows = await cloudRequest('/users', { cache: 'no-store' });
            const stored = Array.isArray(accountRows) ? accountRows.find(item => item.id === u.id) : null;
            if (!stored || stored.app_role !== newRole) {
                throw new Error('Role update could not be verified in Cloudflare D1. Please refresh and check again.');
            }
        }
        u.role = newRole;
        logAudit('User Role Updated', `User ${u.name} role changed from ${previousRole} to ${newRole}.`);
        Storage.save(DB);
        showToast(`Saved: ${u.name} is now ${newRole}.`, 'success');
    } catch (error) {
        // Do not claim success or update the locally displayed role on failure.
        showToast(error instanceof Error ? `Role not saved: ${error.message}` : 'User role was not saved.', 'error');
    }
    renderApp();
}


export async function saveAccessControlMatrix() {
    if (DB.currentUser?.role !== 'Admin') {
        showToast('Administrator access is required to manage permissions.', 'error');
        return;
    }
    const checkboxes = document.querySelectorAll('input[type="checkbox"][data-role]');
    const newPerms = {
        'Admin': [],
        'Procurement Head': [],
        'Procurement Officer': [],
        'Employee': [],
        'Supplier': []
    };

    checkboxes.forEach(cb => {
        const role = cb.getAttribute('data-role');
        const action = cb.getAttribute('data-action');
        if (cb.checked) {
            if (!newPerms[role]) newPerms[role] = [];
            newPerms[role].push(action);
        }
    });

    try {
        if (CLOUD_API_BASE) {
            await cloudRequest('/access-control', {
                method: 'PUT',
                body: JSON.stringify({ permissions: newPerms })
            });
        }
        DB.permissions = newPerms;
        DB.accessControl = Object.entries(newPerms).map(([role, permissions]) => ({ role, permissions }));
        logAudit('Permissions Updated', 'Access Control Matrix permissions updated by Admin.');
        await Storage.flush();
        showToast('Permissions Matrix successfully updated.', 'success');
        renderApp();
    } catch (error) {
        showToast(
            error instanceof Error
                ? `Could not save the permissions matrix: ${error.message}`
                : 'Could not save the permissions matrix.',
            'error'
        );
    }
}
