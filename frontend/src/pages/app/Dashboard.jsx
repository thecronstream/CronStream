import { useAccount } from 'wagmi';
import { useProfile }        from '../../hooks/useProfile';
import CompanyDashboard    from './CompanyDashboard';
import ContractorDashboard from './ContractorDashboard';

export default function Dashboard() {
  const { address } = useAccount();
  const { profile, loading } = useProfile(address);

  if (loading && !profile) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl w-full">
        <div className="animate-pulse flex flex-col gap-4">
          <div className="h-7 bg-border rounded w-40" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="h-20 bg-surface border border-border rounded-2xl" />)}
          </div>
          <div className="h-48 bg-surface border border-border rounded-2xl" />
        </div>
      </div>
    );
  }

  if (profile?.role === 'company')     return <CompanyDashboard />;
  if (profile?.role === 'contractor')  return <ContractorDashboard />;

  // No profile yet — shouldn't normally reach here (Setup redirects first)
  return (
    <div className="p-4 sm:p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
      <p className="text-muted mb-4">Complete your profile setup to continue.</p>
      <a href="/app/setup" className="btn-primary text-sm">Go to Setup</a>
    </div>
  );
}
