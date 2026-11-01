import {cloudRequest,CLOUD_API_BASE} from './cloud';
export type DelegationRole='Procurement Head'|'Finance Officer'|'Finance Head'|'Department Head';
export type RequestKind='Leave'|'Delegation';
export type ReviewStatus='Pending'|'Approved'|'Rejected'|'Cancelled';
export type Delegation={
 id:string;step_role:DelegationRole;department:string;primary_user_id:string;primary_name:string;
 delegate_user_id:string;delegate_name:string;starts_on:string;ends_on:string;reason:string;
 request_kind:RequestKind;review_status:ReviewStatus;submitted_by_name:string;
 reviewed_by:string|null;reviewed_at:string|null;review_note:string;
 created_at:string;created_by:string;revoked_at:string|null;
};
export type EligibleStaff={id:string;name:string;role:string;app_role:string;department:string;status:string;access_revoked:number};
export type DelegationList={delegations:Delegation[];activeRoles:DelegationRole[];activeDepartments:string[];staff:EligibleStaff[];
 principals:{role:DelegationRole;department:string;user:EligibleStaff|null}[];canRequest:boolean};
function connected(){if(!CLOUD_API_BASE)throw new Error('Approval delegation requires Cloudflare D1.');}
export const delegationAPI={
 async list():Promise<DelegationList>{connected();return cloudRequest('/delegations') as Promise<DelegationList>},
 async create(data:{stepRole:DelegationRole;department:string;delegateUserId:string;startsOn:string;endsOn:string;reason:string;requestKind:RequestKind}){
  connected();return cloudRequest('/delegations',{method:'POST',body:JSON.stringify(data)}) as Promise<{ok:boolean;id:string;status:ReviewStatus}>;
 },
 async decide(id:string,decision:'approve'|'reject',note:string){connected();return cloudRequest(`/delegations/${encodeURIComponent(id)}/decision`,{
  method:'POST',body:JSON.stringify({decision,note})
 });},
 async revoke(id:string){connected();return cloudRequest(`/delegations/${encodeURIComponent(id)}/revoke`,{method:'POST',body:'{}'});}
};
