import { HtmlView } from '../components/HtmlView';
import { renderBiddingView } from '../views/bidding';

/** React screen preserving the original bidding workflow and table markup. */
export default function BiddingPage() {
  return <HtmlView html={renderBiddingView()} />;
}
