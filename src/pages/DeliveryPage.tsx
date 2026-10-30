import { HtmlView } from '../components/HtmlView';
import { renderDeliveryView } from '../views/delivery';

/** React screen preserving the original delivery workflow and table markup. */
export default function DeliveryPage() {
  return <HtmlView html={renderDeliveryView()} />;
}
