import { HtmlView } from '../components/HtmlView';
import { renderBidComparisonView } from '../views/bidding';

export default function BidComparisonPage() {
  return <div className="space-y-5">
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Submitted Vendor Bids &amp; Comparison</h2>
      <p className="mt-1 text-sm text-slate-500">Review submitted quotations, compare vendor offers, select a supplier and proceed to proposal meetings and agreement finalization.</p>
    </div>
    <HtmlView html={renderBidComparisonView()} />
  </div>;
}
