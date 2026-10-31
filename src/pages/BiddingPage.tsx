import BiddingDeadlinesPanel from './BiddingDeadlinesPanel';
import { useState } from 'react';
import { HtmlView } from '../components/HtmlView';
import { BidEvaluationPanel } from '../components/BidEvaluationPanel';
import { renderBiddingView } from '../views/bidding';
import { canManageBidding } from '../domain/permissions';

/** Keep the original bidding, meeting and selection workflows intact. */
export default function BiddingPage() {
  const [, refresh] = useState(0);
  return <div className="space-y-6">
    <BiddingDeadlinesPanel onUpdated={() => refresh(n=>n+1)} />
    {canManageBidding() && <BidEvaluationPanel />}
    <HtmlView html={renderBiddingView()} />
  </div>;
}
