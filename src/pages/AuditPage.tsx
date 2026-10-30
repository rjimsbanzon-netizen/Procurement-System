import { HtmlView } from '../components/HtmlView';
import { renderAuditView } from '../views/audit';

/** React screen preserving the original audit workflow and table markup. */
export default function AuditPage() {
  return <HtmlView html={renderAuditView()} />;
}
