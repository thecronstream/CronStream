import { Routes, Route, Navigate } from 'react-router-dom';
import { useAccount } from 'wagmi';

import Landing       from './pages/Landing';
import Privacy       from './pages/Privacy';
import Terms         from './pages/Terms';
import PublicProfile from './pages/PublicProfile';
import Setup        from './pages/app/Setup';
import Dashboard    from './pages/app/Dashboard';
import StreamDetail from './pages/app/StreamDetail';
import Withdraw     from './pages/app/Withdraw';
import Settings     from './pages/app/Settings';
import AppShell     from './components/AppShell';
import LogoLoader   from './components/LogoLoader';

function ProtectedRoute({ children }) {
  const { isConnected, isConnecting, isReconnecting } = useAccount();
  // Show 3D loader while wagmi is re-hydrating session from localStorage
  if (isConnecting || isReconnecting) return <LogoLoader label="Connecting…" />;
  if (!isConnected) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/"        element={<Landing />} />
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
        <Route path="withdraw"      element={<Withdraw />} />
        <Route path="settings"      element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
