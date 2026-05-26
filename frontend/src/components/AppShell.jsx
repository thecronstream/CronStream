import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { LayoutDashboard, Settings, Plus, LogOut, TrendingUp, ChevronRight } from 'lucide-react';
import { useProfile } from '../hooks/useProfile';
import { useCreateStream } from '../context/CreateStreamContext';
import CreateStreamModal from './CreateStreamModal';
import Watermark         from './Watermark';
import { LimelightNav }  from './LimelightNav';

const CHAIN_ICONS = {
  421614: '/arb.png',        // Arbitrum Sepolia
  46630:  '/robinhood.png',  // Robinhood Chain
};

export default function AppShell() {
  const { address }        = useAccount();
  const { profile }        = useProfile(address);
  const navigate           = useNavigate();
  const { openModal }      = useCreateStream();
  const { disconnect }     = useDisconnect();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isCompany    = profile?.role === 'company';
  const isContractor = profile?.role === 'contractor';

  const NAV = [
    { to: '/app/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={15} />, show: true },
    { to: '/app/income',    label: 'Income',    icon: <TrendingUp size={15} />,      show: isContractor },
    { to: '/app/profile',   label: 'Profile',   icon: <Settings size={15} />,        show: true },
    { to: '/app/settings',  label: 'Settings',  icon: <Settings size={15} />,        show: isCompany },
  ].filter(n => n.show);

  // Limelight nav items for mobile
  const mobileNavItems = [
    { id: 'dashboard', to: '/app/dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
    ...(isContractor ? [{ id: 'income',   to: '/app/income',   label: 'Income',   icon: <TrendingUp /> }] : []),
    ...(isCompany    ? [{ id: 'stream',                         label: 'Stream',   icon: <Plus />, onClick: openModal }] : []),
    { id: 'profile',   to: '/app/profile',   label: 'Profile',   icon: <Settings /> },
    ...(isCompany    ? [{ id: 'settings', to: '/app/settings', label: 'Settings', icon: <Settings /> }] : []),
  ];

  const initials = profile?.name
    ? profile.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : address?.slice(2, 4).toUpperCase() ?? '??';

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div
        className="px-5 py-4 border-b border-border cursor-pointer select-none shrink-0"
        onClick={() => { navigate('/'); setSidebarOpen(false); }}
      >
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="CronStream" className="w-6 h-6 rounded-md object-contain" />
          <span className="text-white font-semibold text-sm tracking-tight">CronStream</span>
        </div>
        {profile?.role && (
          <div className="mt-1 text-xs text-muted capitalize ml-8">{profile.role}</div>
        )}
      </div>

      {/* Company CTA */}
      {isCompany && (
        <div className="px-3 pt-3 shrink-0">
          <button
            onClick={() => { openModal(); setSidebarOpen(false); }}
            className="btn-primary w-full py-2 text-sm justify-center"
          >
            + New Stream
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 overflow-y-auto">
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
              ${isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white hover:bg-white/5'}`
            }
          >
            <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User identity footer */}
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
        <ConnectButton.Custom>
          {({ account, chain, openAccountModal, openChainModal, mounted }) => {
            if (!mounted || !account) return null;
            return (
              <div className="rounded-xl border border-border bg-dark/60 overflow-hidden">
                {/* Chain row */}
                <button
                  onClick={openChainModal}
                  className="w-full flex items-center gap-2 px-3 py-2 border-b border-border hover:bg-white/5 transition-colors"
                >
                  <div className="w-4 h-4 rounded-full overflow-hidden border border-border shrink-0">
                    {CHAIN_ICONS[chain?.id]
                      ? <img src={CHAIN_ICONS[chain.id]} alt={chain.name} className="w-full h-full object-contain" />
                      : chain?.hasIcon && chain.iconUrl
                        ? <img src={chain.iconUrl} alt={chain.name} className="w-full h-full" />
                        : <div className="w-full h-full bg-accent/20 flex items-center justify-center text-accent text-[8px] font-mono">{chain?.name?.[0] ?? '?'}</div>
                    }
                  </div>
                  <span className="text-xs text-muted truncate flex-1 text-left">{chain?.name ?? 'Unknown network'}</span>
                  <span className="text-muted text-xs">⇅</span>
                </button>

                {/* Profile row */}
                <button onClick={openAccountModal} className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors text-left border-b border-border">
                  <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center overflow-hidden shrink-0">
                    {profile?.avatar
                      ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
                      : <span className="text-accent text-[10px] font-mono font-bold">{initials}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    {profile?.username
                      ? <>
                          <div className="text-[10px] text-muted font-mono truncate leading-tight">@{profile.username}</div>
                          <div className="text-xs font-semibold text-white truncate leading-tight">{profile.name || account.address.slice(0, 10)}</div>
                        </>
                      : <div className="text-xs font-semibold text-white truncate leading-tight">
                          {profile?.name || `${account.address.slice(0, 6)}…${account.address.slice(-4)}`}
                        </div>
                    }
                  </div>
                  {profile?.role && (
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border shrink-0
                      ${profile.role === 'company'
                        ? 'border-accent/30 bg-accent/5 text-accent'
                        : 'border-border text-muted'}`}>
                      {profile.role}
                    </span>
                  )}
                </button>

                {/* Disconnect row */}
                <button
                  onClick={() => disconnect()}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-500/5 transition-colors group"
                >
                  <LogOut className="w-3.5 h-3.5 text-muted group-hover:text-red-400 transition-colors shrink-0" />
                  <span className="text-xs text-muted group-hover:text-red-400 transition-colors">Disconnect</span>
                </button>
              </div>
            );
          }}
        </ConnectButton.Custom>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-dark">

      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside className="hidden lg:flex w-56 bg-surface border-r border-border flex-col shrink-0 fixed top-0 left-0 bottom-0 z-30">
        <SidebarContent />
      </aside>

      {/* ── Mobile sidebar overlay ───────────────────────── */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 flex"
          onClick={() => setSidebarOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <aside
            className="relative w-64 bg-surface border-r border-border flex flex-col z-50"
            onClick={e => e.stopPropagation()}
          >
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* ── Main ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:ml-56 min-h-screen">

        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-20">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-8 h-8 flex flex-col items-center justify-center gap-1.5 rounded-lg hover:bg-border transition-colors"
          >
            <span className="w-5 h-px bg-white" />
            <span className="w-5 h-px bg-white" />
            <span className="w-3 h-px bg-white self-start" />
          </button>

          <img src="/logo.png" alt="CronStream" className="h-6 w-auto object-contain" />

          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openChainModal, mounted }) => {
              if (!mounted || !account) return <div className="w-8" />;
              return (
                <div className="flex items-center gap-1.5">
                  {(CHAIN_ICONS[chain?.id] || (chain?.hasIcon && chain.iconUrl)) && (
                    <button onClick={openChainModal} className="w-5 h-5 rounded-full overflow-hidden border border-border">
                      <img src={CHAIN_ICONS[chain?.id] ?? chain.iconUrl} alt="" className="w-full h-full object-contain" />
                    </button>
                  )}
                  <button
                    onClick={openAccountModal}
                    className="text-xs font-mono text-muted bg-surface border border-border px-2.5 py-1 rounded-lg"
                  >
                    {profile?.name || `${account.address.slice(0, 6)}…${account.address.slice(-4)}`}
                  </button>
                </div>
              );
            }}
          </ConnectButton.Custom>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>

        {/* ── Mobile bottom tab bar — limelight ────────── */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-20 bg-surface/95 backdrop-blur-md border-t border-border">
          <LimelightNav items={mobileNavItems} />
        </div>
      </div>

      {/* Tiled page watermark — z-index 0, sits behind everything */}
      <Watermark variant="page" />

      {/* Global modal */}
      <CreateStreamModal />
    </div>
  );
}
