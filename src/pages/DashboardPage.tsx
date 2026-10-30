import { HtmlView } from '../components/HtmlView';
import { renderDashboardView } from '../views/dashboard';

/** React screen preserving the original dashboard workflow and table markup. */
export default function DashboardPage() {
  return <HtmlView html={renderDashboardView()} />;
}
