import React, {useEffect, useState} from 'react';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {AppLayout} from './components/AppLayout';
import {SplashScreen} from './components/SplashScreen';
import {APP_SECTIONS, CURRENT_APP_STAGE} from './config/navigation';
import {AuthProvider, useAuth} from './context/AuthContext';
import {BackupPage} from './pages/BackupPage';
import {CollectionsPage} from './pages/CollectionsPage';
import {CustomersPage} from './pages/CustomersPage';
import {ExpensesPage} from './pages/ExpensesPage';
import {HomePage} from './pages/HomePage';
import {InvoicesPage} from './pages/InvoicesPage';
import {ItemsPage} from './pages/ItemsPage';
import {LoginPage} from './pages/LoginPage';
import {PurchasesPage} from './pages/PurchasesPage';
import {ReportsPage} from './pages/ReportsPage';
import {SalesQuickPage} from './pages/SalesQuickPage';
import {SalesReturnsPage} from './pages/SalesReturnsPage';
import {SettingsPage} from './pages/SettingsPage';
import {SuppliersPage} from './pages/SuppliersPage';
import {TreasuryPage} from './pages/TreasuryPage';
import {UnderDevelopmentPage} from './pages/UnderDevelopmentPage';
import {UsersPermissionsPage} from './pages/UsersPermissionsPage';
import {WarehousesPage} from './pages/WarehousesPage';

const AppGate: React.FC = () => {
  const {isBooting, session, companySettings} = useAuth();
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinSplashElapsed(true), 450);
    return () => window.clearTimeout(timer);
  }, []);

  if (isBooting || !minSplashElapsed) {
    return <SplashScreen companyName={companySettings?.companyName} />;
  }

  if (!session) {
    return <LoginPage />;
  }

  const stageLaterSections = APP_SECTIONS.filter(
    (s) => s.implementedInStage > CURRENT_APP_STAGE
  );

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/sales" element={<SalesQuickPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/returns" element={<SalesReturnsPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/warehouses" element={<WarehousesPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        <Route path="/purchase-returns" element={<PurchasesPage initialTab="returns" />} />
        <Route path="/treasury" element={<TreasuryPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/users" element={<UsersPermissionsPage />} />
        <Route path="/backup" element={<BackupPage />} />
        {stageLaterSections.map((sec) => (
          <Route
            key={sec.path}
            path={sec.path}
            element={<UnderDevelopmentPage path={sec.path} />}
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppGate />
      </AuthProvider>
    </BrowserRouter>
  );
}
