import { HtmlView } from '../components/HtmlView';
import { renderSuppliersView } from '../views/suppliers';

/** React screen preserving the original suppliers workflow and table markup. */
export default function SuppliersPage() {
  return <HtmlView html={renderSuppliersView()} />;
}
