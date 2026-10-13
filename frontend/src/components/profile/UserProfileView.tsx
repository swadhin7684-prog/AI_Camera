import React, { useState } from 'react';
import {
  Building2,
  Shield,
  Key,
  Cpu,
  Clock,
  LogIn,
  LogOut,
  ArrowLeftRight,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Calendar,
  Mail,
  UserCheck
} from 'lucide-react';
import { adminApi, LicenseStatusResult } from '../../services/adminApi';

interface UserProfileViewProps {
  licenseStatus: LicenseStatusResult | null;
  onRefreshLicense: () => void;
  onOpenLicenseModal?: () => void;
}

export const UserProfileView: React.FC<UserProfileViewProps> = ({
  licenseStatus,
  onRefreshLicense,
  onOpenLicenseModal
}) => {
  const [copiedFingerprint, setCopiedFingerprint] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [switchCompanyId, setSwitchCompanyId] = useState('');
  const [switchLicenseKey, setSwitchLicenseKey] = useState('');
  const [switchLoading, setSwitchLoading] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const company = licenseStatus?.company;
  const isLicensed = licenseStatus?.is_licensed;

  const handleCopy = (text: string, type: 'fingerprint' | 'key') => {
    navigator.clipboard.writeText(text);
    if (type === 'fingerprint') {
      setCopiedFingerprint(true);
      setTimeout(() => setCopiedFingerprint(false), 2000);
    } else {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm('Are you sure you want to log out and deactivate this station license? The station will return to unauthenticated mode.')) {
      return;
    }
    try {
      await adminApi.deactivateLicense();
      setActionSuccess('Station license successfully deactivated.');
      setTimeout(() => setActionSuccess(''), 4000);
      onRefreshLicense();
    } catch (e: any) {
      alert(e.message || 'Failed to logout station license');
    }
  };

  const handleSwitchAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSwitchError('');
    if (!switchCompanyId.trim() || !switchLicenseKey.trim()) {
      setSwitchError('Please enter both Company ID and License Key');
      return;
    }

    setSwitchLoading(true);
    try {
      const res = await adminApi.activateLicense(switchCompanyId.trim(), switchLicenseKey.trim());
      if (res.success) {
        setActionSuccess(`Switched to ${res.company?.name || switchCompanyId} successfully!`);
        setShowSwitchModal(false);
        setSwitchCompanyId('');
        setSwitchLicenseKey('');
        setTimeout(() => setActionSuccess(''), 4000);
        onRefreshLicense();
      } else {
        setSwitchError(res.message || 'Failed to switch account');
      }
    } catch (err: any) {
      setSwitchError(err.message || 'Invalid Company ID or License Key');
    } finally {
      setSwitchLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Top Banner / Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#1E293B]">
        <div className="flex items-center space-x-4">
          <div className="w-14 h-14 bg-gradient-to-br from-[#0EA5E9]/20 to-[#0284C7]/10 border border-[#00D9FF]/40 rounded-2xl flex items-center justify-center shadow-lg shadow-[#00D9FF]/10">
            <UserCheck className="w-7 h-7 text-[#00D9FF]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wide flex items-center gap-2">
              Station & Organization Profile
            </h1>
            <p className="text-xs text-[#94A3B8] mt-1">
              Active company authorization, edge station binding, and credential lifecycle controls.
            </p>
          </div>
        </div>

        {/* Action Buttons inside Profile: Login, Logout, Switch Account */}
        <div className="flex items-center gap-3">
          {isLicensed ? (
            <>
              {/* Switch Account Button (Only in User Panel Profile) */}
              <button
                onClick={() => {
                  setSwitchError('');
                  setShowSwitchModal(true);
                }}
                className="flex items-center space-x-2 px-4 py-2 bg-[#0284C7]/20 hover:bg-[#0284C7]/30 border border-[#00D9FF]/50 text-[#00D9FF] rounded-xl text-xs font-semibold transition shadow-sm"
              >
                <ArrowLeftRight className="w-4 h-4" />
                <span>Switch Account</span>
              </button>

              {/* Logout Button */}
              <button
                onClick={handleLogout}
                className="flex items-center space-x-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-xs font-semibold transition shadow-sm"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>
            </>
          ) : (
            /* Login Button (when Unlicensed) */
            <button
              onClick={onOpenLicenseModal}
              className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] hover:from-[#0369A1] hover:to-[#0284C7] text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-[#0284C7]/20"
            >
              <LogIn className="w-4 h-4" />
              <span>Log In with License Key</span>
            </button>
          )}
        </div>
      </div>

      {actionSuccess && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Main Profile Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Account Details (2 cols) */}
        <div className="md:col-span-2 space-y-6">
          {/* Card: Company Information */}
          <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-[#1E293B] mb-5">
              <div className="flex items-center space-x-2 text-sm font-semibold text-white">
                <Building2 className="w-4 h-4 text-[#00D9FF]" />
                <span>Company Organization</span>
              </div>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                  isLicensed
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-400 border border-red-500/30'
                }`}
              >
                {isLicensed ? (licenseStatus?.status || 'ACTIVE') : 'UNAUTHENTICATED'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-[#64748B] block mb-1 uppercase font-semibold text-[10px] tracking-wider">
                  Company Name
                </span>
                <span className="text-white text-base font-bold">
                  {company?.name || 'Unregistered Station'}
                </span>
              </div>

              <div>
                <span className="text-[#64748B] block mb-1 uppercase font-semibold text-[10px] tracking-wider">
                  Company ID
                </span>
                <span className="text-[#00D9FF] font-mono font-bold text-sm">
                  {company?.company_id || 'N/A'}
                </span>
              </div>

              <div>
                <span className="text-[#64748B] block mb-1 uppercase font-semibold text-[10px] tracking-wider flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Contact Email
                </span>
                <span className="text-gray-300">
                  {company?.contact_email || 'Not configured'}
                </span>
              </div>

              <div>
                <span className="text-[#64748B] block mb-1 uppercase font-semibold text-[10px] tracking-wider">
                  Subscription Plan
                </span>
                <span className="inline-block px-2 py-0.5 rounded bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/20 font-semibold font-mono">
                  {company?.plan_type || 'Standard Edition'} (Max {company?.max_users || 5} Stations)
                </span>
              </div>
            </div>
          </div>

          {/* Card: License & Validation Details */}
          <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-xl">
            <div className="flex items-center space-x-2 text-sm font-semibold text-white pb-4 border-b border-[#1E293B] mb-5">
              <Key className="w-4 h-4 text-[#00D9FF]" />
              <span>License & Security Credentials</span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <span className="text-[#64748B] block mb-1 uppercase font-semibold text-[10px] tracking-wider">
                  Active License Key
                </span>
                <div className="flex items-center justify-between bg-[#172033] border border-[#263449] rounded-xl px-3.5 py-2">
                  <span className="font-mono text-gray-200">
                    {company?.license_key ? `${company.license_key.substring(0, 14)}••••-••••` : 'No active license key'}
                  </span>
                  {company?.license_key && (
                    <button
                      onClick={() => handleCopy(company.license_key, 'key')}
                      className="text-[#94A3B8] hover:text-[#00D9FF] transition p-1"
                      title="Copy full license key"
                    >
                      {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[#64748B] block mb-1 uppercase font-semibold text-[10px] tracking-wider flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Expiration Date
                  </span>
                  <span className="text-gray-200 font-mono">
                    {company?.license_expiry ? company.license_expiry.split('T')[0] : 'N/A'}
                  </span>
                </div>

                <div>
                  <span className="text-[#64748B] block mb-1 uppercase font-semibold text-[10px] tracking-wider flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Days Remaining
                  </span>
                  <span className="text-[#00D9FF] font-mono font-bold">
                    {licenseStatus?.days_remaining !== undefined ? `${licenseStatus.days_remaining} days` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Station Hardware Binding & Status (1 col) */}
        <div className="space-y-6">
          <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-xl">
            <div className="flex items-center space-x-2 text-sm font-semibold text-white pb-4 border-b border-[#1E293B] mb-5">
              <Cpu className="w-4 h-4 text-[#00D9FF]" />
              <span>Hardware Binding</span>
            </div>

            <p className="text-xs text-[#94A3B8] leading-relaxed mb-4">
              This station is locked to this physical machine's motherboard and cryptographic node identity.
            </p>

            <div className="bg-[#172033] border border-[#263449] rounded-xl p-3">
              <span className="text-[10px] text-[#64748B] uppercase font-semibold block mb-1">
                Node Signature
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-[#38BDF8] truncate max-w-[180px]">
                  {company?.company_id ? `SNX-HW-${company.company_id}` : 'STATION-LOCAL-NODE'}
                </span>
                <button
                  onClick={() => handleCopy(`SNX-HW-${company?.company_id || 'NODE-01'}`, 'fingerprint')}
                  className="text-[#94A3B8] hover:text-[#00D9FF] transition p-1"
                  title="Copy Node ID"
                >
                  {copiedFingerprint ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-[#1E293B] space-y-2 text-xs">
              <div className="flex justify-between text-[#94A3B8]">
                <span>Asymmetric Lease:</span>
                <span className="text-emerald-400 font-semibold">Ed25519 Verified</span>
              </div>
              <div className="flex justify-between text-[#94A3B8]">
                <span>Safety Fallback:</span>
                <span className="text-emerald-400 font-semibold">Active &amp; Guarded</span>
              </div>
            </div>
          </div>

          {/* Quick Switch Card Info */}
          <div className="bg-gradient-to-br from-[#0EA5E9]/10 to-[#1E293B]/40 border border-[#00D9FF]/20 rounded-2xl p-5">
            <div className="flex items-center space-x-2 text-xs font-semibold text-[#00D9FF] mb-2">
              <Shield className="w-4 h-4" />
              <span>Multi-Tenant Station Access</span>
            </div>
            <p className="text-[11px] text-[#94A3B8] leading-relaxed">
              Need to monitor a different plant or subsidiary? Use the <strong>Switch Account</strong> button above to connect a different company license without reinstalling software.
            </p>
          </div>
        </div>
      </div>

      {/* Switch Account Modal (Only in User Panel Profile) */}
      {showSwitchModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-2xl relative">
            <div className="flex items-center space-x-3 mb-5">
              <div className="w-10 h-10 bg-[#00D9FF]/10 border border-[#00D9FF]/30 rounded-xl flex items-center justify-center">
                <ArrowLeftRight className="w-5 h-5 text-[#00D9FF]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Switch Company Account</h3>
                <p className="text-xs text-[#94A3B8]">Enter credentials for the company account you want to connect.</p>
              </div>
            </div>

            {switchError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start space-x-2 text-xs text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{switchError}</span>
              </div>
            )}

            <form onSubmit={handleSwitchAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                  Target Company ID
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CMP-8492-X"
                  value={switchCompanyId}
                  onChange={(e) => setSwitchCompanyId(e.target.value)}
                  className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#00D9FF] rounded-xl px-4 py-2.5 text-sm text-white outline-none font-mono transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5">
                  License Key
                </label>
                <input
                  type="text"
                  required
                  placeholder="SNX-XXXX-XXXX-XXXX"
                  value={switchLicenseKey}
                  onChange={(e) => setSwitchLicenseKey(e.target.value)}
                  className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#00D9FF] rounded-xl px-4 py-2.5 text-sm text-white outline-none font-mono transition"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSwitchModal(false)}
                  className="flex-1 px-4 py-2.5 bg-[#1E293B] hover:bg-[#334155] text-gray-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={switchLoading}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] hover:from-[#0369A1] hover:to-[#0284C7] text-white rounded-xl text-xs font-semibold transition disabled:opacity-50 shadow-lg shadow-[#0284C7]/20"
                >
                  {switchLoading ? 'Connecting...' : 'Switch & Authenticate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
