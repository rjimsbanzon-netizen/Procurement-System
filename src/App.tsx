import NotificationsPage from './features/notifications/NotificationsPage';
import TrackingPage from './features/tracking/TrackingPage';
import DocumentsPage from './pages/DocumentsPage';
import PdfDocumentsPage from './pages/PdfDocumentsPage';
import ApprovalsPage from './pages/ApprovalsPage';
import BudgetsPage from './pages/BudgetsPage';
import InvoiceMatchingPage from './pages/InvoiceMatchingPage';
import DashboardPage from './pages/DashboardPage';
import BiddingPage from './pages/BiddingPage';
import RequisitionsPage from './pages/RequisitionsPage';
import OrdersPage from './pages/OrdersPage';
import DeliveryPage from './pages/DeliveryPage';
import AmendmentsPage from './pages/AmendmentsPage';
import PaymentsPage from './pages/PaymentsPage';
import SuppliersPage from './pages/SuppliersPage';
import AccessControlPage from './pages/AccessControlPage';
import AuditPage from './pages/AuditPage';
import UsersPage from './pages/UsersPage';
import { useEffect, useState } from 'react';
import { DB, ui, setDB } from './store/state';
import { CLOUD_API_BASE, restoreCloudSession } from './services/cloud';
import { Storage } from './services/storage';
import { registerRenderListener, renderApp } from './core/renderBridge';
import { attachAuthEvents } from './events/authEvents';
import { attachMainEvents } from './events/mainEvents';
import { canAccessTab } from './domain/permissions';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ModalHost } from './components/ModalHost';
import { AuthScreen } from './components/AuthScreen';

function CurrentPage() {
  if (!canAccessTab(ui.currentTab)) {
    return <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
      <i className="fa-solid fa-lock text-2xl mb-2"/><p>This section is not available for your account.</p>
    </div>;
  }
  switch (ui.currentTab) {
    case 'dashboard': return <DashboardPage />;
    case 'notifications': return <NotificationsPage />;
    case 'tracking': return <TrackingPage />;
    case 'documents': return <DocumentsPage />;
    case 'approvals': return <ApprovalsPage />;
    case 'budgets': return <BudgetsPage />;
    case 'invoice_matching': return <InvoiceMatchingPage />;
    case 'pdf_generator': return <PdfDocumentsPage />;
    case 'bidding': return <BiddingPage />;
    case 'requisitions': return <RequisitionsPage />;
    case 'orders': return <OrdersPage />;
    case 'delivery': return <DeliveryPage />;
    case 'amendments': return <AmendmentsPage />;
    case 'payments': return <PaymentsPage />;
    case 'suppliers': return <SuppliersPage />;
    case 'access_control': return <AccessControlPage />;
    case 'audit': return <AuditPage />;
    case 'users': return <UsersPage />;
    default: return <DashboardPage />;
  }
}

export default function App() {
  const [revision, trigger] = useState(0);

  useEffect(() => {
    registerRenderListener(() => trigger(n => n + 1));
    ui.authMode = 'login';
    setDB(CLOUD_API_BASE ? Storage.empty() : Storage.get());
    if (CLOUD_API_BASE) void restoreCloudSession();
    else renderApp();
    return () => registerRenderListener(null);
  }, []);

  // Re-bind existing form handlers to the DOM on every React commit (as the
  // original application did after replacing the page's HTML).
  useEffect(() => {
    if (DB.currentUser) attachMainEvents();
    else attachAuthEvents();
  });

  return <>
    {DB.currentUser ?
      <div key={revision} className="enterprise-shell flex h-screen min-h-0 bg-slate-100 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <Header />
          <main className="enterprise-main flex-1 min-h-0 overflow-y-auto p-4 md:p-6 bg-slate-50 custom-scrollbar"><CurrentPage /></main>
        </div>
        <ModalHost />
      </div>  : <div key={revision}><AuthScreen /></div>}
    <div id="toast-container" className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2 pointer-events-none" />
  </>;
}
