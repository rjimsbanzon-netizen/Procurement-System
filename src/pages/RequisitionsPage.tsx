import { HtmlView } from '../components/HtmlView';
import { renderRequisitionsView } from '../views/requisitions';

/** React screen preserving the original requisitions workflow and table markup. */
export default function RequisitionsPage() {
  return <HtmlView html={renderRequisitionsView()} />;
}
