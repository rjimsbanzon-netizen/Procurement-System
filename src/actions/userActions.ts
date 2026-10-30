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


export async function updateUserRole(userId, newRole) {
    const u = DB.users.find(usr => usr.id === userId);
    if (u) {
        if (CLOUD_API_BASE) {
            try {
                await cloudRequest(`/users/${encodeURIComponent(u.id)}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        status: u.status === 'Pending Verification' ? 'pending' : u.status === 'Rejected' ? 'rejected' : 'approved',
                        appRole: newRole,
                        accessRevoked: u.accessRevoked || false
                    })
                });
            } catch (error) {
                showToast(error instanceof Error ? error.message : 'User role update failed.', 'error');
                renderApp();
                return;
            }
        }
        u.role = newRole;
        logAudit('User Role Updated', `User ${u.name} role changed to ${newRole}.`);
        Storage.save(DB);
        showToast(`User role updated to ${newRole}.`, 'info');
        renderApp();
    }
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
