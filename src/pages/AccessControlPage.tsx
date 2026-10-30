import { HtmlView } from '../components/HtmlView';
import { renderAccessControlView } from '../views/accessControl';

/** React screen preserving the original accesscontrol workflow and table markup. */
export default function AccessControlPage() {
  return <HtmlView html={renderAccessControlView()} />;
}
