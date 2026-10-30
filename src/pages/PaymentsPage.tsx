import { HtmlView } from '../components/HtmlView';
import { renderPaymentsView } from '../views/payments';

/** React screen preserving the original payments workflow and table markup. */
export default function PaymentsPage() {
  return <HtmlView html={renderPaymentsView()} />;
}
