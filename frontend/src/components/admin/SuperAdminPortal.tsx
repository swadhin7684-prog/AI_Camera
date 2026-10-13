import React, { useState, useEffect } from 'react';
import {
  Shield,
  Building2,
  Users,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Search,
  Plus,
  RefreshCw,
  LogOut,
  ArrowLeft,
  Key,
  Copy,
  Check,
  Edit2,
  Lock,
  FileText,
  AlertCircle,
  User,
  LogIn
} from 'lucide-react';
import {
  adminApi,
  CompanyAccount,
  AdminDashboardData,
  AuditLogItem
} from '../../services/adminApi';
import { cloudLicenseService } from '../../services/firebase';

interface SuperAdminPortalProps {
  onBackToApp?: () => void;
  standalone?: boolean;
}

export const SuperAdminPortal: React.FC<SuperAdminPortalProps> = ({ onBackToApp, standalone = false }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!adminApi.getToken());
  const [adminUser, setAdminUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'companies' | 'audit' | 'profile'>('dashboard');

  // Login & Setup State
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Initial Setup State
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);
  const [setupUsername, setSetupUsername] = useState('superadmin');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');

  // Dashboard Data
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [companies, setCompanies] = useState<CompanyAccount[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyEmail, setNewCompanyEmail] = useState('');
  const [newCompanyPhone, setNewCompanyPhone] = useState('');
  const [newCompanyPlan, setNewCompanyPlan] = useState('Enterprise');
  const [newCompanyUsers, setNewCompanyUsers] = useState(10);
  const [newCompanyDays, setNewCompanyDays] = useState(365);
  const [createResult, setCreateResult] = useState<CompanyAccount | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Renew License Modal
  const [renewingCompany, setRenewingCompany] = useState<CompanyAccount | null>(null);
  const [renewDays, setRenewDays] = useState(365);

  // Check setup status & auth on mount
  useEffect(() => {
    checkInitialState();
  }, []);

  const checkInitialState = async () => {
    try {
      const setup = await adminApi.getSetupStatus();
      if (!setup.is_initialized) {
        setIsSetupNeeded(true);
      } else {
        setIsSetupNeeded(false);
        const token = adminApi.getToken();
        if (token) {
          try {
            const me = await adminApi.getMe();
            setAdminUser(me.admin);
            setIsAuthenticated(true);
            loadAdminData();
          } catch (_) {
            adminApi.clearToken();
            setIsAuthenticated(false);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [dash, compRes, logsRes] = await Promise.all([
        adminApi.getDashboard(),
        adminApi.getCompanies(statusFilter, searchQuery),
        adminApi.getAuditLogs(50)
      ]);
      setDashboard(dash);
      setCompanies(compRes.companies || []);
      setAuditLogs(logsRes.logs || []);
    } catch (e: any) {
      if (e.message?.includes('Not authenticated') || e.message?.includes('401')) {
        adminApi.clearToken();
        setIsAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadAdminData();
    }
  }, [isAuthenticated, statusFilter, searchQuery]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await adminApi.login(loginIdentifier, loginPassword);
      setAdminUser(res.admin);
      setIsAuthenticated(true);
      loadAdminData();
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleInitialSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (setupPassword !== setupConfirm) {
      setLoginError('Passwords do not match');
      return;
    }
    if (setupPassword.length < 8) {
      setLoginError('Password must be at least 8 characters');
      return;
    }
    setLoginLoading(true);
    try {
      const setupRes = await adminApi.initialSetup({
        username: setupUsername,
        email: setupEmail,
        password: setupPassword
      });
      setIsSetupNeeded(false);
      // Auto login with new credentials
      if (setupRes.token) {
        adminApi.setToken(setupRes.token);
        setAdminUser(setupRes.admin);
        setIsAuthenticated(true);
        loadAdminData();
      } else {
        const res = await adminApi.login(setupUsername, setupPassword);
        setAdminUser(res.admin);
        setIsAuthenticated(true);
        loadAdminData();
      }
    } catch (err: any) {
      setLoginError(err.message || 'Setup failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await adminApi.logout();
    setIsAuthenticated(false);
    setAdminUser(null);
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await adminApi.createCompany({
        name: newCompanyName,
        contact_email: newCompanyEmail,
        contact_phone: newCompanyPhone,
        plan_type: newCompanyPlan,
        max_users: Number(newCompanyUsers),
        validity_days: Number(newCompanyDays)
      });
      setCreateResult(res.company);
      loadAdminData();

      // Sync company metadata to Firebase Cloud Firestore for remote station activation
      try {
        await cloudLicenseService.createCompanyInCloud({
          company_id: res.company.company_id,
          name: res.company.name,
          contact_email: res.company.contact_email,
          contact_phone: res.company.contact_phone,
          plan_type: res.company.plan_type,
          max_users: Number(newCompanyUsers),
          validity_days: Number(newCompanyDays)
        });
      } catch (cloudErr) {
        console.warn('Note: Could not sync company to cloud Firestore immediately:', cloudErr);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to create company account');
    }
  };

  const handleStatusChange = async (companyId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const confirmMsg = `Are you sure you want to change status to ${nextStatus} for ${companyId}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await adminApi.updateCompanyStatus(companyId, nextStatus);
      loadAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    }
  };

  const handleRenewLicense = async () => {
    if (!renewingCompany) return;
    try {
      await adminApi.renewLicense(renewingCompany.company_id, renewDays);
      setRenewingCompany(null);
      loadAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to renew license');
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // If Not Authenticated, show Login / Setup screen
  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 bg-[#070b14] flex flex-col items-center justify-center p-6 z-50 select-none">
        <div className="w-full max-w-md bg-[#0F172A] border border-[#1E293B] rounded-2xl p-8 shadow-2xl relative">
          {!standalone && onBackToApp ? (
            <button
              onClick={onBackToApp}
              className="absolute top-5 left-5 text-[#64748B] hover:text-[#38BDF8] flex items-center space-x-1.5 text-xs transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Safety Console</span>
            </button>
          ) : (
            <div className="absolute top-5 left-5 flex items-center space-x-1.5 text-xs text-[#38BDF8] bg-[#38BDF8]/10 border border-[#38BDF8]/20 px-2.5 py-1 rounded-lg">
              <Shield className="w-3.5 h-3.5" />
              <span className="font-semibold">SentinelX Admin Authority</span>
            </div>
          )}

          <div className="flex flex-col items-center text-center mt-6 mb-8">
            <div className="w-14 h-14 bg-gradient-to-br from-[#0EA5E9]/20 to-[#6366F1]/10 border border-[#38BDF8]/40 rounded-2xl flex items-center justify-center mb-4 shadow-[0_0_25px_rgba(14,165,233,0.3)]">
              <Shield className="w-7 h-7 text-[#38BDF8]" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-wide uppercase">
              Sentinel<span className="text-[#38BDF8]">X</span> Super Admin
            </h1>
            <p className="text-xs text-[#94A3B8] mt-1">
              {isSetupNeeded ? 'First-Time Master Administrator Setup' : 'Authorized Control Plane Access'}
            </p>
          </div>

          {loginError && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start space-x-2 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          {isSetupNeeded ? (
            <form onSubmit={handleInitialSetup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                  Admin Username
                </label>
                <input
                  type="text"
                  required
                  value={setupUsername}
                  onChange={(e) => setSetupUsername(e.target.value)}
                  className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                  Admin Email
                </label>
                <input
                  type="email"
                  required
                  value={setupEmail}
                  onChange={(e) => setSetupEmail(e.target.value)}
                  placeholder="admin@sentinelx.ai"
                  className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                  Master Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  value={setupConfirm}
                  onChange={(e) => setSetupConfirm(e.target.value)}
                  className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
                />
              </div>
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full mt-2 bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] hover:from-[#0369A1] hover:to-[#0284C7] text-white font-semibold py-3 rounded-xl text-sm transition shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50"
              >
                {loginLoading ? 'Provisioning...' : 'Provision Master Admin Account'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                  Username or Email
                </label>
                <input
                  type="text"
                  required
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="admin or admin@sentinelx.ai"
                  className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                  Admin Password
                </label>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
                />
              </div>
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full mt-2 bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] hover:from-[#0369A1] hover:to-[#0284C7] text-white font-semibold py-3 rounded-xl text-sm transition shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50"
              >
                {loginLoading ? 'Verifying Credentials...' : 'Authenticate Super Admin'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#070b14] text-[#F8FAFC] flex flex-col z-50 select-none overflow-hidden">
      {/* Super Admin Header */}
      <header className="h-16 bg-[#0B1120] border-b border-[#1E293B] px-8 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 bg-[#0EA5E9]/20 border border-[#38BDF8]/40 rounded-xl flex items-center justify-center">
              <Shield className="w-5 h-5 text-[#38BDF8]" />
            </div>
            <div>
              <div className="font-extrabold text-sm tracking-wider uppercase">
                Sentinel<span className="text-[#38BDF8]">X</span> <span className="text-xs bg-[#38BDF8]/15 text-[#38BDF8] px-2 py-0.5 rounded-full border border-[#38BDF8]/30 ml-1">Super Admin</span>
              </div>
              <div className="text-[10px] text-[#94A3B8]">Industrial Platform Governance &amp; Commercial Licensing</div>
            </div>
          </div>

          <div className="h-6 w-px bg-[#1E293B] mx-2" />

          {/* Navigation Tabs */}
          <nav className="flex space-x-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'dashboard'
                  ? 'bg-[#1E293B] text-[#38BDF8] border border-[#38BDF8]/30'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              Command Overview
            </button>
            <button
              onClick={() => setActiveTab('companies')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'companies'
                  ? 'bg-[#1E293B] text-[#38BDF8] border border-[#38BDF8]/30'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              Company Accounts
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'audit'
                  ? 'bg-[#1E293B] text-[#38BDF8] border border-[#38BDF8]/30'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              Security Audit Trail
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 ${
                activeTab === 'profile'
                  ? 'bg-[#1E293B] text-[#38BDF8] border border-[#38BDF8]/30'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Admin Profile</span>
            </button>
          </nav>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadAdminData}
            disabled={loading}
            className="p-2 bg-[#1E293B] hover:bg-[#334155] border border-[#334155] rounded-lg text-[#94A3B8] hover:text-white transition"
            title="Refresh Registry"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#38BDF8]' : ''}`} />
          </button>

          {!standalone && onBackToApp && (
            <button
              onClick={onBackToApp}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#1E293B] hover:bg-[#334155] border border-[#334155] rounded-lg text-xs font-medium text-[#94A3B8] hover:text-[#38BDF8] transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Switch to Company View</span>
            </button>
          )}

          <button
            onClick={handleLogout}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-xs font-medium text-red-400 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 overflow-y-auto p-8 max-w-7xl w-full mx-auto space-y-6">
        {/* ==================== TAB: DASHBOARD ==================== */}
        {activeTab === 'dashboard' && (
          <>
            {/* Metric Cards */}
            <div className="grid grid-cols-5 gap-5">
              <div className="bg-[#0F172A] border border-[#1E293B] p-5 rounded-2xl">
                <div className="flex items-center justify-between text-[#94A3B8] mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Companies</span>
                  <Building2 className="w-5 h-5 text-[#38BDF8]" />
                </div>
                <div className="text-3xl font-extrabold text-white">{dashboard?.total_companies ?? 0}</div>
                <div className="text-[11px] text-[#64748B] mt-1">Enterprise client accounts</div>
              </div>

              <div className="bg-[#0F172A] border border-[#1E293B] p-5 rounded-2xl">
                <div className="flex items-center justify-between text-[#94A3B8] mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider">Active Licenses</span>
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="text-3xl font-extrabold text-emerald-400">{dashboard?.active_companies ?? 0}</div>
                <div className="text-[11px] text-[#64748B] mt-1">Operating normally</div>
              </div>

              <div className="bg-[#0F172A] border border-[#1E293B] p-5 rounded-2xl">
                <div className="flex items-center justify-between text-[#94A3B8] mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider">Suspended</span>
                  <XCircle className="w-5 h-5 text-amber-400" />
                </div>
                <div className="text-3xl font-extrabold text-amber-400">{dashboard?.suspended_companies ?? 0}</div>
                <div className="text-[11px] text-[#64748B] mt-1">Access revoked by Admin</div>
              </div>

              <div className="bg-[#0F172A] border border-[#1E293B] p-5 rounded-2xl">
                <div className="flex items-center justify-between text-[#94A3B8] mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider">Expired</span>
                  <AlertTriangle className="w-5 h-5 text-rose-400" />
                </div>
                <div className="text-3xl font-extrabold text-rose-400">{dashboard?.expired_licenses ?? 0}</div>
                <div className="text-[11px] text-[#64748B] mt-1">Subscription ended</div>
              </div>

              <div className="bg-[#0F172A] border border-[#1E293B] p-5 rounded-2xl">
                <div className="flex items-center justify-between text-[#94A3B8] mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider">Expiry &le; 14 Days</span>
                  <Clock className="w-5 h-5 text-sky-400" />
                </div>
                <div className="text-3xl font-extrabold text-sky-400">{dashboard?.approaching_expiry ?? 0}</div>
                <div className="text-[11px] text-[#64748B] mt-1">Approaching renewal</div>
              </div>
            </div>

            {/* Header + Quick Create */}
            <div className="flex items-center justify-between pt-4">
              <div>
                <h2 className="text-lg font-bold text-white tracking-wide">Client Companies Directory</h2>
                <p className="text-xs text-[#94A3B8]">Review customer accounts, validities, and license tokens.</p>
              </div>
              <button
                onClick={() => {
                  setCreateResult(null);
                  setShowCreateModal(true);
                }}
                className="flex items-center space-x-2 bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] hover:from-[#0369A1] hover:to-[#0284C7] text-white px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-[0_0_15px_rgba(14,165,233,0.3)]"
              >
                <Plus className="w-4 h-4" />
                <span>Onboard New Company</span>
              </button>
            </div>

            {/* Quick Preview Table */}
            <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1E293B]/60 text-[#94A3B8] uppercase tracking-wider border-b border-[#1E293B]">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Company ID</th>
                    <th className="py-3 px-4 font-semibold">Company Name</th>
                    <th className="py-3 px-4 font-semibold">Contact Email</th>
                    <th className="py-3 px-4 font-semibold">Plan</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold">License Expiry</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B]/60">
                  {companies.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[#64748B]">
                        No registered company accounts found. Click "Onboard New Company" to create one.
                      </td>
                    </tr>
                  ) : (
                    companies.slice(0, 8).map((c) => (
                      <tr key={c.company_id} className="hover:bg-[#1E293B]/30 transition">
                        <td className="py-3 px-4 font-mono font-bold text-[#38BDF8]">{c.company_id}</td>
                        <td className="py-3 px-4 font-semibold text-white">{c.name}</td>
                        <td className="py-3 px-4 text-[#94A3B8]">{c.contact_email}</td>
                        <td className="py-3 px-4">
                          <span className="bg-[#1E293B] px-2 py-0.5 rounded text-[11px] font-medium text-[#E2E8F0]">
                            {c.plan_type}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              c.license_status === 'ACTIVE'
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                : c.license_status === 'SUSPENDED'
                                ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                                : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                            }`}
                          >
                            {c.license_status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[#94A3B8]">
                          {c.license_expiry ? c.license_expiry.slice(0, 10) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => copyToClipboard(c.license_key, c.company_id)}
                            className="p-1.5 hover:bg-[#1E293B] rounded text-[#94A3B8] hover:text-[#38BDF8] transition"
                            title="Copy License Key"
                          >
                            {copiedKey === c.company_id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleStatusChange(c.company_id, c.license_status)}
                            className={`px-2 py-1 rounded text-[10px] font-bold border transition ${
                              c.license_status === 'ACTIVE'
                                ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/15'
                                : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15'
                            }`}
                          >
                            {c.license_status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ==================== TAB: COMPANIES FULL ==================== */}
        {activeTab === 'companies' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by ID, name or email..."
                    className="bg-[#0F172A] border border-[#1E293B] rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-[#64748B] outline-none w-72 focus:border-[#38BDF8]"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-[#0F172A] border border-[#1E293B] rounded-xl px-3 py-2 text-xs text-[#94A3B8] outline-none"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="EXPIRED">Expired</option>
                </select>
              </div>

              <button
                onClick={() => {
                  setCreateResult(null);
                  setShowCreateModal(true);
                }}
                className="flex items-center space-x-1.5 bg-[#0284C7] hover:bg-[#0369A1] text-white px-3.5 py-2 rounded-xl text-xs font-bold transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Company</span>
              </button>
            </div>

            <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1E293B]/60 text-[#94A3B8] uppercase tracking-wider border-b border-[#1E293B]">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Company ID</th>
                    <th className="py-3 px-4 font-semibold">Company Name</th>
                    <th className="py-3 px-4 font-semibold">Plan &amp; Users</th>
                    <th className="py-3 px-4 font-semibold">License Key</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold">License Expiry</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B]/60">
                  {companies.map((c) => (
                    <tr key={c.company_id} className="hover:bg-[#1E293B]/30 transition">
                      <td className="py-3.5 px-4 font-mono font-bold text-[#38BDF8]">{c.company_id}</td>
                      <td className="py-3.5 px-4 font-semibold text-white">
                        <div>{c.name}</div>
                        <div className="text-[10px] text-[#64748B] font-normal">{c.contact_email}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-white">{c.plan_type}</div>
                        <div className="text-[10px] text-[#64748B]">Max Users: {c.max_users}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-[#94A3B8]">
                        <div className="flex items-center space-x-1.5">
                          <span>{c.license_key}</span>
                          <button
                            onClick={() => copyToClipboard(c.license_key, c.company_id)}
                            className="p-1 hover:bg-[#1E293B] rounded text-[#64748B] hover:text-[#38BDF8]"
                          >
                            {copiedKey === c.company_id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            c.license_status === 'ACTIVE'
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                              : c.license_status === 'SUSPENDED'
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                              : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                          }`}
                        >
                          {c.license_status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-[#94A3B8]">
                        {c.license_expiry ? c.license_expiry.slice(0, 10) : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => setRenewingCompany(c)}
                          className="px-2 py-1 rounded text-[10px] font-semibold border border-sky-500/30 text-sky-400 hover:bg-sky-500/15 transition"
                        >
                          Renew
                        </button>
                        <button
                          onClick={() => handleStatusChange(c.company_id, c.license_status)}
                          className={`px-2 py-1 rounded text-[10px] font-semibold border transition ${
                            c.license_status === 'ACTIVE'
                              ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/15'
                              : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15'
                          }`}
                        >
                          {c.license_status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================== TAB: AUDIT LOGS ==================== */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">Administrative Security Audit Log</h2>
              <p className="text-xs text-[#94A3B8]">Immutable chronological record of administrative actions and license updates.</p>
            </div>

            <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1E293B]/60 text-[#94A3B8] uppercase tracking-wider border-b border-[#1E293B]">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Timestamp (UTC)</th>
                    <th className="py-3 px-4 font-semibold">Action</th>
                    <th className="py-3 px-4 font-semibold">Actor Admin</th>
                    <th className="py-3 px-4 font-semibold">Target</th>
                    <th className="py-3 px-4 font-semibold">Audit Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B]/60 font-mono text-[11px]">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#1E293B]/30 transition">
                      <td className="py-3 px-4 text-[#64748B]">{log.created_at ? log.created_at.replace('T', ' ').slice(0, 19) : ''}</td>
                      <td className="py-3 px-4">
                        <span className="bg-[#1E293B] text-[#38BDF8] px-2 py-0.5 rounded font-bold text-[10px]">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-emerald-400">{log.actor_admin_id}</td>
                      <td className="py-3 px-4 text-white">{log.target_type}: {log.target_id}</td>
                      <td className="py-3 px-4 text-[#94A3B8] font-sans">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================== TAB: ADMIN PROFILE ==================== */}
        {activeTab === 'profile' && (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Header Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#1E293B]">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 bg-gradient-to-br from-[#0EA5E9]/20 to-[#6366F1]/10 border border-[#38BDF8]/40 rounded-2xl flex items-center justify-center shadow-lg shadow-[#0EA5E9]/10">
                  <Shield className="w-7 h-7 text-[#38BDF8]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-wide">Master Administrator Profile</h2>
                  <p className="text-xs text-[#94A3B8] mt-1">Control Plane Security Authority & Commercial Licensing Management</p>
                </div>
              </div>

              {/* Login and Logout buttons inside Admin Profile */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleLogout}
                  className="flex items-center space-x-2 px-4 py-2 bg-[#1E293B] hover:bg-[#334155] border border-[#334155] text-gray-200 hover:text-white rounded-xl text-xs font-semibold transition"
                  title="Switch to another administrator account"
                >
                  <LogIn className="w-4 h-4 text-[#38BDF8]" />
                  <span>Login / Switch Admin</span>
                </button>

                <button
                  onClick={handleLogout}
                  className="flex items-center space-x-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-xs font-semibold transition shadow-sm"
                  title="Terminate current administrator session"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log Out</span>
                </button>
              </div>
            </div>

            {/* Profile Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Account Credentials */}
              <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-[#1E293B]">
                  <div className="flex items-center space-x-2 text-sm font-semibold text-white">
                    <User className="w-4 h-4 text-[#38BDF8]" />
                    <span>Administrator Identity</span>
                  </div>
                  <span className="text-[10px] bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                    {adminUser?.role || 'SUPER_ADMIN'}
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-[#64748B] block mb-0.5 uppercase font-semibold text-[10px] tracking-wider">Admin Username</span>
                    <span className="text-white text-sm font-bold">{adminUser?.username || 'superadmin'}</span>
                  </div>

                  <div>
                    <span className="text-[#64748B] block mb-0.5 uppercase font-semibold text-[10px] tracking-wider">Official Email</span>
                    <span className="text-gray-300 font-medium">{adminUser?.email || 'admin@sentinelx.ai'}</span>
                  </div>

                  <div>
                    <span className="text-[#64748B] block mb-0.5 uppercase font-semibold text-[10px] tracking-wider">Unique Admin ID</span>
                    <span className="text-[#38BDF8] font-mono font-bold">{adminUser?.admin_id || 'ADM-ROOT'}</span>
                  </div>
                </div>
              </div>

              {/* Cryptographic & Platform Authority */}
              <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center space-x-2 text-sm font-semibold text-white pb-3 border-b border-[#1E293B]">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <span>Security & Authority Realm</span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-1 border-b border-[#1E293B]/60 text-[#94A3B8]">
                    <span>Authentication Method:</span>
                    <span className="text-white font-mono font-semibold">PBKDF2-HMAC-SHA256 (120k)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1E293B]/60 text-[#94A3B8]">
                    <span>Station Lease Protocol:</span>
                    <span className="text-emerald-400 font-mono font-semibold">Ed25519 Asymmetric</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1E293B]/60 text-[#94A3B8]">
                    <span>Session Token Expiry:</span>
                    <span className="text-[#38BDF8] font-mono font-semibold">12 Hours Signed</span>
                  </div>
                  <div className="flex justify-between py-1 text-[#94A3B8]">
                    <span>Authority Scope:</span>
                    <span className="text-white font-semibold">Global Company Lifecycle</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Platform Governance Notice */}
            <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-5 text-xs text-[#94A3B8] leading-relaxed">
              <div className="flex items-center space-x-2 text-[#38BDF8] font-semibold mb-1">
                <Shield className="w-4 h-4" />
                <span>Super Administrator Governance</span>
              </div>
              <span>
                As a Master Administrator, this profile possesses root authority to issue client company licenses, extend subscriptions, suspend delinquent accounts, and audit station security operations.
              </span>
            </div>
          </div>
        )}
      </main>

      {/* ==================== MODAL: CREATE COMPANY ==================== */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 select-none">
          <div className="w-full max-w-lg bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-2xl relative">
            <h3 className="text-lg font-bold text-white mb-1">Onboard Customer Company</h3>
            <p className="text-xs text-[#94A3B8] mb-5">Provisions an isolated company account and generates an authorized license key.</p>

            {createResult ? (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-3">
                  <div className="text-emerald-400 font-bold text-sm flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Company Account Successfully Created!</span>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#94A3B8]">Company Name:</div>
                    <div className="text-sm font-semibold text-white">{createResult.name}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#94A3B8]">Assigned Company ID:</div>
                    <div className="text-base font-mono font-bold text-[#38BDF8]">{createResult.company_id}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#94A3B8]">Generated License Key:</div>
                    <div className="flex items-center space-x-2 mt-1">
                      <div className="text-sm font-mono font-bold bg-[#070b14] px-3 py-1.5 rounded border border-[#1E293B] text-emerald-300 select-all">
                        {createResult.license_key}
                      </div>
                      <button
                        onClick={() => copyToClipboard(createResult.license_key, 'modal-key')}
                        className="p-2 bg-[#1E293B] hover:bg-[#334155] rounded text-white"
                        title="Copy Key"
                      >
                        {copiedKey === 'modal-key' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Valid Until: <span className="text-white font-semibold">{createResult.license_expiry?.slice(0, 10)}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreateResult(null);
                    }}
                    className="bg-[#1E293B] hover:bg-[#334155] text-white px-5 py-2.5 rounded-xl text-xs font-semibold"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateCompany} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#94A3B8] mb-1">Company Legal Name *</label>
                  <input
                    type="text"
                    required
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="e.g. Apex Industrial Solutions Ltd."
                    className="w-full bg-[#1E293B] border border-[#334155] rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-[#38BDF8]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#94A3B8] mb-1">Contact Email *</label>
                    <input
                      type="email"
                      required
                      value={newCompanyEmail}
                      onChange={(e) => setNewCompanyEmail(e.target.value)}
                      placeholder="safety@company.com"
                      className="w-full bg-[#1E293B] border border-[#334155] rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-[#38BDF8]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#94A3B8] mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={newCompanyPhone}
                      onChange={(e) => setNewCompanyPhone(e.target.value)}
                      placeholder="+1 (555) 019-2834"
                      className="w-full bg-[#1E293B] border border-[#334155] rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-[#38BDF8]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#94A3B8] mb-1">Plan Tier</label>
                    <select
                      value={newCompanyPlan}
                      onChange={(e) => setNewCompanyPlan(e.target.value)}
                      className="w-full bg-[#1E293B] border border-[#334155] rounded-xl px-3 py-2 text-xs text-white outline-none"
                    >
                      <option value="Standard">Standard</option>
                      <option value="Professional">Professional</option>
                      <option value="Enterprise">Enterprise</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#94A3B8] mb-1">Max Users</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={newCompanyUsers}
                      onChange={(e) => setNewCompanyUsers(Number(e.target.value))}
                      className="w-full bg-[#1E293B] border border-[#334155] rounded-xl px-3 py-2 text-xs text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#94A3B8] mb-1">Validity (Days)</label>
                    <input
                      type="number"
                      min={7}
                      max={3650}
                      value={newCompanyDays}
                      onChange={(e) => setNewCompanyDays(Number(e.target.value))}
                      className="w-full bg-[#1E293B] border border-[#334155] rounded-xl px-3 py-2 text-xs text-white outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 bg-[#1E293B] hover:bg-[#334155] rounded-xl text-xs text-[#94A3B8] hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] text-white rounded-xl text-xs font-bold shadow-[0_0_15px_rgba(14,165,233,0.3)]"
                  >
                    Provision Account
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ==================== MODAL: RENEW LICENSE ==================== */}
      {renewingCompany && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 select-none">
          <div className="w-full max-w-sm bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-1">Renew / Extend License</h3>
            <p className="text-xs text-[#94A3B8] mb-4">
              Extend license validity for <span className="text-white font-semibold">{renewingCompany.name}</span> ({renewingCompany.company_id}).
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] mb-1">Extension Period</label>
                <select
                  value={renewDays}
                  onChange={(e) => setRenewDays(Number(e.target.value))}
                  className="w-full bg-[#1E293B] border border-[#334155] rounded-xl px-3 py-2 text-xs text-white outline-none"
                >
                  <option value={30}>+30 Days (1 Month)</option>
                  <option value={90}>+90 Days (1 Quarter)</option>
                  <option value={180}>+180 Days (Half Year)</option>
                  <option value={365}>+365 Days (1 Full Year)</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenewingCompany(null)}
                  className="px-3.5 py-2 bg-[#1E293B] hover:bg-[#334155] rounded-xl text-xs text-[#94A3B8]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRenewLicense}
                  className="px-4 py-2 bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] text-white rounded-xl text-xs font-bold"
                >
                  Confirm Renewal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
