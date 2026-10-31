import { HtmlView } from '../components/HtmlView';
import { BidEvaluationPanel } from '../components/BidEvaluationPanel';
import { renderBiddingView } from '../views/bidding';
import { canManageBidding } from '../domain/permissions';

/** Keep the original bidding, meeting and selection workflows intact. */
export default function BiddingPage() {
  return <div className="space-y-6">
    {canManageBidding() && <BidEvaluationPanel />}
    <HtmlView html={renderBiddingView()} />
  </div>;
}
