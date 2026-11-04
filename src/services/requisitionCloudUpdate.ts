import { DB } from '../store/state';
import { CLOUD_TOKEN_KEY } from './cloud';
import { confirmWorkspaceChanges } from './workspaceSync';

/** After authenticated server-owned PR actions, acknowledge ONLY the changed PR.
 * This keeps the save baseline aligned without overwriting unrelated local edits.
 */
export function receiveServerRequisition(pr: Record<string,any>):void {
  const token = localStorage.getItem(CLOUD_TOKEN_KEY);
  if(!token)throw new Error('Sign in again to refresh the requisition.');
  confirmWorkspaceChanges([{collection:'requisitions',id:pr.id,after:pr}],token);
  const index = DB.requisitions.findIndex(item=>item.id===pr.id);
  if(index>=0)DB.requisitions[index]=pr as typeof DB.requisitions[number];
  else DB.requisitions.unshift(pr as typeof DB.requisitions[number]);
}
