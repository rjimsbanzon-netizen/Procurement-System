import { HtmlView } from '../components/HtmlView';
import { renderUsersView } from '../views/users';

/** React screen preserving the original users workflow and table markup. */
export default function UsersPage() {
  return <HtmlView html={renderUsersView()} />;
}
