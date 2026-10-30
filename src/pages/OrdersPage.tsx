import { HtmlView } from '../components/HtmlView';
import { renderOrdersView } from '../views/orders';

/** React screen preserving the original orders workflow and table markup. */
export default function OrdersPage() {
  return <HtmlView html={renderOrdersView()} />;
}
