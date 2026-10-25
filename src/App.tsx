import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import PurchaseOrders from './components/PurchaseOrders';
import Suppliers from './components/Suppliers';
import Users from './components/Users';
import About from './components/About';
import './App.css';

function AppContent() {
  const { isAuthenticated } = useAuth();
  const [activeView, setActiveView] = useState('dashboard');

  if (!isAuthenticated) {
    return <Login onSuccess={() => setActiveView('dashboard')} />;
  }

  return (
    <div className="app-shell">
      <Navbar activeView={activeView} onNavigate={setActiveView} />
      <main className="main-content">
        {activeView === 'dashboard' && <Dashboard />}
        {activeView === 'orders' && <PurchaseOrders />}
        {activeView === 'suppliers' && <Suppliers />}
        {activeView === 'users' && <Users />}
        {activeView === 'about' && <About />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
