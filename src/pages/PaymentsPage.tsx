import { useEffect, useState } from 'react';
import { HtmlView } from '../components/HtmlView';
import { renderPaymentsView } from '../views/payments';
import { CLOUD_API_BASE } from '../services/cloud';
import { financeAPI, type FinanceSettings } from '../services/finance';
import { DB } from '../store/state';

/** Read-only for non-Finance roles; the Worker always performs the final payment authorization. */
export default function PaymentsPage() {
  const [settings,setSettings]=useState<FinanceSettings|null>(null);
  const [error,setError]=useState('');
  const accountId=DB.currentUser?.id;
  useEffect(()=>{
    if(!CLOUD_API_BASE||!accountId||DB.currentUser?.role==='Supplier')return;
    let current=true;
    void financeAPI.settings().then(data=>{if(current){setSettings(data);setError('');}})
      .catch(e=>{if(current)setError(e instanceof Error?e.message:String(e));});
    return ()=>{current=false;};
  },[accountId]);
  return <>
    {error&&<p role="alert" className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Payment assignments unavailable: {error}. Processing is disabled until they load.</p>}
    <HtmlView html={renderPaymentsView(settings)} />
  </>;
}
