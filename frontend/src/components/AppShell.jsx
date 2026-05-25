import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useProfile } from '../hooks/useProfile';
import { useCreateStream } from '../context/CreateStreamContext';
import CreateStreamModal from './CreateStreamModal';

export default function AppShell() {
  const { address }        = useAccount();
  const { profile }        = useProfile(address);
  const navigate           = useNavigate();
  const { openModal }      = useCreateStream();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isCompany    = profile?.role === 'company';
  const isContractor = profile?.role === 'contractor';

  const NAV = [
    { to: '/app/dashboard', label: 'Dashboard', icon: '⬡', show: true },
    { to: '/app/withdraw',  label: 'Withdraw',  icon: '↓', show: isContractor },
    { to: '/app/settings',  label: 'Settings',  icon: '⚙', show: true },
  ].filter(n => n.show);

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
            <span className="font-mono text-base w-5 text-center shrink-0">{icon}</span>
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
                    {chain?.hasIcon && chain.iconUrl
                      ? <img src={chain.iconUrl} alt={chain.name} className="w-full h-full" />
                      : <div className="w-full h-full bg-accent/20 flex items-center justify-center text-accent text-[8px] font-mono">{chain?.name?.[0] ?? '?'}</div>
                    }
                  </div>
                  <span className="text-xs text-muted truncate flex-1 text-left">{chain?.name ?? 'Unknown network'}</span>
                  <span className="text-muted text-xs">⇅</span>
                </button>

                {/* Profile row */}
                <button onClick={openAccountModal} className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors text-left">
                  {/* Avatar */}
                  <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center overflow-hidden shrink-0">
                    {profile?.avatar
                      ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
                      : <span className="text-accent text-[10px] font-mono font-bold">{initials}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate leading-tight">
                      {profile?.name || `${account.address.slice(0, 6)}…${account.address.slice(-4)}`}
                    </div>
                    {profile?.username && (
                      <div className="text-[10px] text-muted font-mono truncate leading-tight">@{profile.username}</div>
                    )}
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
                  {chain?.hasIcon && chain.iconUrl && (
                    <button onClick={openChainModal} className="w-5 h-5 rounded-full overflow-hidden border border-border">
                      <img src={chain.iconUrl} alt="" className="w-full h-full" />
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

        {/* ── Mobile bottom tab bar ─────────────────────── */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 bg-surface/95 backdrop-blur-md border-t border-border flex items-center">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium transition-all
                ${isActive ? 'text-accent' : 'text-muted'}`
              }
            >
              <span className="text-base font-mono">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
          {isCompany && (
            <button
              onClick={openModal}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium text-accent"
            >
              <span className="text-base font-mono w-7 h-7 bg-accent text-dark rounded-lg flex items-center justify-center">+</span>
              <span>Stream</span>
            </button>
          )}
        </nav>
      </div>

      {/* Global modal */}
      <CreateStreamModal />
    </div>
  );
}
