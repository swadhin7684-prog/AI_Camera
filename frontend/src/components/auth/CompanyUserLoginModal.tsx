import React, { useState } from 'react';
import { Shield, Lock, Mail, User, Building2, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { firebaseAuthService, cloudLicenseService } from '../../services/firebase';

interface CompanyUserLoginModalProps {
  companyInfo?: {
    company_id: string;
    company_name?: string;
    plan_type?: string;
  } | null;
  onAuthenticated: () => void;
}

export const CompanyUserLoginModal: React.FC<CompanyUserLoginModalProps> = ({
  companyInfo,
  onAuthenticated
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const companyId = companyInfo?.company_id || 'COMPANY';
  const companyName = companyInfo?.company_name || 'Station';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      await firebaseAuthService.login(email, password);
      setSuccessMsg('Authenticated successfully! Loading safety station...');
      setTimeout(() => {
        onAuthenticated();
      }, 800);
    } catch (err: any) {
      console.error('Firebase Login Error:', err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setErrorMsg('Invalid email or password. Please verify your credentials.');
      } else if (err.code === 'auth/user-not-found') {
        setErrorMsg('No user account found with this email. Please register below.');
      } else if (err.code === 'auth/too-many-requests') {
        setErrorMsg('Too many failed login attempts. Please wait a few moments.');
      } else {
        setErrorMsg(err.message || 'Authentication failed. Please check your internet connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      await cloudLicenseService.registerCompanyUser(email, password, companyId, name);
      setSuccessMsg('Operator registered successfully! Launching dashboard...');
      setTimeout(() => {
        onAuthenticated();
      }, 1000);
    } catch (err: any) {
      console.error('Firebase Register Error:', err);
      if (err.code === 'auth/email-already-in-use') {
        setErrorMsg('This email is already registered. Please switch to the Sign In tab.');
      } else if (err.code === 'auth/weak-password') {
        setErrorMsg('Password should be at least 6 characters long.');
      } else {
        setErrorMsg(err.message || 'Registration failed. Check company quota or connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#070B14]/90 backdrop-blur-md flex items-center justify-center p-6 z-50 select-none">
      <div className="w-full max-w-md bg-[#0F172A] border border-[#1E293B] rounded-2xl p-8 shadow-2xl relative">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 bg-gradient-to-br from-[#0EA5E9]/20 to-[#6366F1]/10 border border-[#38BDF8]/40 rounded-2xl flex items-center justify-center mb-4 shadow-[0_0_25px_rgba(14,165,233,0.3)]">
            <Shield className="w-7 h-7 text-[#38BDF8]" />
          </div>
          <h2 className="text-xl font-bold text-white tracking-wide uppercase">
            Sentinel<span className="text-[#38BDF8]">X</span> AI
          </h2>
          <div className="flex items-center space-x-1.5 mt-1 text-xs text-[#94A3B8]">
            <Building2 className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span className="font-semibold text-white">{companyName}</span>
            <span className="text-[10px] bg-[#38BDF8]/15 text-[#38BDF8] px-1.5 py-0.5 rounded font-mono">
              {companyId}
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            Operator Access Control &amp; Shift Authentication
          </p>
        </div>

        {/* Mode Switch Tabs */}
        <div className="flex bg-[#1E293B] p-1 rounded-xl mb-6">
          <button
            type="button"
            onClick={() => { setMode('login'); setErrorMsg(''); setSuccessMsg(''); }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
              mode === 'login'
                ? 'bg-[#0284C7] text-white shadow-md'
                : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setErrorMsg(''); setSuccessMsg(''); }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
              mode === 'register'
                ? 'bg-[#0284C7] text-white shadow-md'
                : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            Register Operator
          </button>
        </div>

        {/* Status Alerts */}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start space-x-2 text-xs text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start space-x-2 text-xs text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Forms */}
        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                <Mail className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Operator Email</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@company.com"
                className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                <Lock className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Password</span>
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] hover:from-[#0369A1] hover:to-[#0284C7] text-white font-bold py-3 rounded-xl text-sm transition shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In & Access Safety Station'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                <User className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Full Name</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                <Mail className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Work Email</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@company.com"
                className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                <Lock className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Password (min 6 characters)</span>
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] hover:from-[#0369A1] hover:to-[#0284C7] text-white font-bold py-3 rounded-xl text-sm transition shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              <span>{loading ? 'Creating Operator Account...' : 'Register Operator'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        <div className="mt-6 pt-5 border-t border-[#1E293B] flex items-center justify-between text-xs text-[#64748B]">
          <span>Offline Edge AI Active</span>
          <span className="text-[11px] text-[#38BDF8]">Cloud Auth Protected</span>
        </div>
      </div>
    </div>
  );
};
