export type Role = 'Admin' | 'Procurement Head' | 'Procurement Officer' | 'Employee' | 'Supplier';
export type PermissionRole = Role | 'Department Head' | 'Finance Officer' | 'Finance Head';
export type Permission =
  | 'create_pr' | 'approve_pr' | 'record_delivery' | 'manage_delivery_issues'
  | 'approve_amendment' | 'process_payment' | 'confirm_payment'
  | 'manage_users' | 'manage_suppliers' | 'rate_supplier'
  | 'manage_permissions' | 'view_all_po' | 'manage_bidding'
  | 'view_assigned_po' | 'view_supplier_portal' | 'submit_bids';

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  department: string;
  status: string;
  email?: string;
  supplierId?: string | null;
  companyName?: string;
  accessRevoked?: boolean;
  password?: string; // Local demo mode only; do not store real passwords client-side.
}
export interface ProcurementRecord {
  id: string;
  [field: string]: any;
}
export interface ProcurementState {
  currentUser: User | null;
  nonAdminUsersPruned: boolean;
  permissions: Record<PermissionRole, string[]>;
  users: User[];
  stockNeeds: ProcurementRecord[];
  bids: ProcurementRecord[];
  proposalMeetings: ProcurementRecord[];
  requisitions: ProcurementRecord[];
  orders: ProcurementRecord[];
  deliveries: ProcurementRecord[];
  amendments: ProcurementRecord[];
  payments: ProcurementRecord[];
  suppliers: ProcurementRecord[];
  ratings: ProcurementRecord[];
  auditLogs: ProcurementRecord[];
  accessControl?: ProcurementRecord[];
}
export type Tab = 'dashboard' | 'requisitions' | 'bidding' | 'orders' | 'delivery'
  | 'amendments' | 'payments' | 'suppliers' | 'audit' | 'users' | 'access_control'
  | 'notifications' | 'tracking' | 'documents' | 'pdf_generator';
