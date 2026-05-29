import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAccount } from 'wagmi';

import Landing       from './pages/Landing';
import Faucet        from './pages/Faucet';
import SiwePrompt   from './components/SiwePrompt';
import Privacy       from './pages/Privacy';
import Terms         from './pages/Terms';
import PublicProfile from './pages/PublicProfile';
import NotFound      from './pages/NotFound';
import ErrorPage     from './pages/ErrorPage';
import Setup         from './pages/app/Setup';
import Dashboard     from './pages/app/Dashboard';
import StreamDetail  from './pages/app/StreamDetail';
import Settings      from './pages/app/Settings';
import Profile       from './pages/app/Profile';
import IncomeHistory  from './pages/app/IncomeHistory';
import StreamHistory  from './pages/app/StreamHistory';
import CompanyHistory from './pages/app/CompanyHistory';
import AppShell     from './components/AppShell';
import LogoLoader   from './components/LogoLoader';

function ProtectedRoute({ children }) {
  const { isConnected, isConnecting, isReconnecting } = useAccount();
  const [timedOut, setTimedOut] = useState(false);

  // If wagmi is still reconnecting after 3s, stop waiting and let it resolve
  useEffect(() => {
    if (!isConnecting && !isReconnecting) { setTimedOut(false); return; }
    const t = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, [isConnecting, isReconnecting]);

  const stillWaiting = (isConnecting || isReconnecting) && !timedOut;
  if (stillWaiting) return <LogoLoader label="Connecting…" />;
  if (!isConnected)  return <Navigate to="/" replace />;
  return (
    <>
      <SiwePrompt />
      {children}
    </>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/"        element={<Landing />} />
      <Route path="/faucet"  element={<Faucet />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms"   element={<Terms />} />
      <Route path="/p/:username" element={<PublicProfile />} />

      {/* App — wallet required */}
      <Route path="/app" element={
        <ProtectedRoute>
          <AppShell />
        </ProtectedRoute>
      }>
        <Route index                element={<Navigate to="/app/dashboard" replace />} />
        <Route path="setup"         element={<Setup />} />
        <Route path="dashboard"     element={<Dashboard />} />
        {/* /app/stream/create now opens the modal — redirect to dashboard */}
        <Route path="stream/create" element={<Navigate to="/app/dashboard" replace />} />
        <Route path="stream/:id"    element={<StreamDetail />} />
        <Route path="withdraw"      element={<Navigate to="/app/dashboard" replace />} />
        <Route path="income"        element={<IncomeHistory />} />
        <Route path="history"           element={<StreamHistory />} />
        <Route path="company-history"  element={<CompanyHistory />} />
        <Route path="profile"       element={<Profile />} />
        <Route path="settings"      element={<Settings />} />
      </Route>

      {/* Dev preview only — remove before launch */}
      {import.meta.env.DEV && <Route path="/error-preview" element={<ErrorPage error={{ message: 'Example runtime crash: Cannot read properties of undefined' }} />} />}

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
