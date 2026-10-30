// @ts-nocheck
import { INITIAL_STATE } from '../data/initialState';
import { syncRequisitionStatuses } from '../domain/procurement';
import { CLOUD_API_BASE, CLOUD_RECORD_COLLECTIONS, CLOUD_TOKEN_KEY, cloudRequest } from './cloud';
import { showToast } from './toast';
import { DB, setDB } from '../store/state';

// Local persistence + serialized Cloudflare API sync.
let cloudSaveQueue = Promise.resolve();
let cloudSaveError = null;
export class Storage {
    static empty() {
        return {
            ...INITIAL_STATE,
            currentUser: null,
            permissions: Object.fromEntries(
                Object.entries(INITIAL_STATE.permissions).map(([role, permissions]) => [role, [...permissions]])
            ),
            users: [],
            stockNeeds: [],
            bids: [],
            proposalMeetings: [],
            requisitions: [],
            orders: [],
            deliveries: [],
            amendments: [],
            payments: [],
            suppliers: [],
            ratings: [],
            auditLogs: [],
            accessControl: [],
            nonAdminUsersPruned: true
        };
    }

    static get() {
        const data = localStorage.getItem('eprocurement_db');
        if (!data) {
            localStorage.setItem('eprocurement_db', JSON.stringify(INITIAL_STATE));
            return INITIAL_STATE;
        }
        try {
            const parsed = JSON.parse(data);
            // Ensure permissions fallback if upgraded
            if (!parsed.permissions) parsed.permissions = INITIAL_STATE.permissions;
            if (!parsed.ratings) parsed.ratings = INITIAL_STATE.ratings;
            if (!parsed.stockNeeds) parsed.stockNeeds = INITIAL_STATE.stockNeeds;
            if (!parsed.bids) parsed.bids = INITIAL_STATE.bids;
            if (!parsed.proposalMeetings) parsed.proposalMeetings = INITIAL_STATE.proposalMeetings;
            if (!parsed.nonAdminUsersPruned) {
                const originalUserCount = Array.isArray(parsed.users) ? parsed.users.length : 0;
                parsed.users = (Array.isArray(parsed.users) ? parsed.users : [])
                    .filter(user => user.role === 'Admin');
                if (parsed.currentUser && parsed.currentUser.role !== 'Admin') {
                    parsed.currentUser = null;
                }
                parsed.nonAdminUsersPruned = true;
                if (parsed.users.length < originalUserCount) {
                    parsed.auditLogs = Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [];
                    parsed.auditLogs.unshift({
                        id: 'log-' + Date.now(),
                        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
                        user: 'System',
                        role: 'System',
                        action: 'Non-admin Accounts Removed',
                        details: 'One-time account cleanup removed all non-admin enterprise user accounts.'
                    });
                }
                localStorage.setItem('eprocurement_db', JSON.stringify(parsed));
            }
            Object.keys(parsed.permissions).forEach(role => {
                const rolePermissions = parsed.permissions[role];
                if (rolePermissions.includes('issue_po') && !rolePermissions.includes('manage_suppliers')) {
                    rolePermissions.push('manage_suppliers');
                }
            });
            return parsed;
        } catch(e) {
            return INITIAL_STATE;
        }
    }

    static save(state) {
        syncRequisitionStatuses(state);
        localStorage.setItem('eprocurement_db', JSON.stringify(state));
        const token = CLOUD_API_BASE ? localStorage.getItem(CLOUD_TOKEN_KEY) : null;
        if (!token) return;

        const data = Object.fromEntries(
            CLOUD_RECORD_COLLECTIONS.map(collection => [collection, state[collection]])
        );
        cloudSaveQueue = cloudSaveQueue.then(async () => {
            await cloudRequest('/enterprise-state', {
                method: 'PUT',
                body: JSON.stringify({ data })
            }, token);
            cloudSaveError = null;
        }).catch(error => {
            cloudSaveError = error;
            console.error('Enterprise data could not be saved to Cloudflare D1.', error);
            showToast('Cloud save failed. Your latest changes are not confirmed in D1.', 'error');
        });
    }

    static async flush() {
        await cloudSaveQueue;
        if (cloudSaveError) {
            const error = cloudSaveError;
            cloudSaveError = null;
            throw error;
        }
    }

    static async reset() {
        const freshState = Storage.empty();
        freshState.users = (DB.users || []).filter(user => user.role === 'Admin');
        freshState.currentUser = DB.currentUser?.role === 'Admin' ? DB.currentUser : null;
        setDB(freshState);
        Storage.save(DB);
        try {
            await Storage.flush();
        } catch {
            return;
        }
        location.reload();
    }
}
