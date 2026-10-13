import React, { useState } from 'react';
import { Shield, Key, Building2, CheckCircle2, AlertTriangle, AlertCircle, ArrowRight } from 'lucide-react';
import { adminApi, LicenseStatusResult } from '../../services/adminApi';
import { cloudLicenseService } from '../../services/firebase';

interface LicenseActivationModalProps {
  licenseStatus: LicenseStatusResult | null;
  onActivated: () => void;
  onClose?: () => void;
}

export const LicenseActivationModal: React.FC<LicenseActivationModalProps> = ({
  licenseStatus,
  onActivated,
  onClose
}) => {
  const [companyId, setCompanyId] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const cId = companyId.trim().toUpperCase();
      const lKey = licenseKey.trim();

      // 1. Check SentinelX Cloud Registry in Firebase Firestore
      const cloudRes = await cloudLicenseService.verifyLicenseOnline(cId, lKey);
      if (cloudRes.valid && cloudRes.company) {
        await adminApi.activateCloudLicense(cloudRes.company);
        setSuccessMsg('Station activated successfully via SentinelX Cloud!');
        setTimeout(() => {
          onActivated();
        }, 1200);
        return;
      }

      // 2. If online check failed or offline development, fallback to local database
      const res = await adminApi.activateLicense(cId, lKey);
      setSuccessMsg(res.message || 'License activated successfully!');
      setTimeout(() => {
        onActivated();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err.message || 'License activation failed. Please check credentials or network.');
    } finally {
      setLoading(false);
    }
  };

  const isExpired = licenseStatus?.status === 'EXPIRED' || licenseStatus?.status === 'GRACE_EXPIRED';
  const isSuspended = licenseStatus?.status === 'SUSPENDED';

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 z-50 select-none">
      <div className="w-full max-w-md bg-[#0F172A] border border-[#1E293B] rounded-2xl p-8 shadow-2xl relative">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 bg-gradient-to-br from-[#0EA5E9]/20 to-[#6366F1]/10 border border-[#38BDF8]/40 rounded-2xl flex items-center justify-center mb-4 shadow-[0_0_25px_rgba(14,165,233,0.3)]">
            <Shield className="w-7 h-7 text-[#38BDF8]" />
          </div>
          <h2 className="text-xl font-bold text-white tracking-wide uppercase">
            Sentinel<span className="text-[#38BDF8]">X</span> AI
          </h2>
          <p className="text-xs text-[#94A3B8] mt-1">
            Industrial Worker Safety &amp; PPE Monitoring System
          </p>
        </div>

        {/* Status Notification */}
        {isSuspended && (
          <div className="mb-5 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start space-x-2.5 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <div className="font-bold">Company Account Suspended</div>
              <div className="text-[11px] text-amber-200/80 mt-0.5">
                Your company license has been suspended by the SentinelX Administrator. Please contact support.
              </div>
            </div>
          </div>
        )}

        {isExpired && (
          <div className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start space-x-2.5 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <div>
              <div className="font-bold">License Expired</div>
              <div className="text-[11px] text-rose-200/80 mt-0.5">
                Your subscription period has ended. Enter a renewed License Key to resume real-time AI safety monitoring.
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mb-5 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="mb-5 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-400 flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleActivate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
              <Building2 className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Company ID *</span>
            </label>
            <input
              type="text"
              required
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="e.g. CMP-8492-X"
              className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white font-mono uppercase outline-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
              <Key className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Commercial License Key *</span>
            </label>
            <input
              type="text"
              required
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="e.g. SNX-CMP8-4F12-89B2"
              className="w-full bg-[#1E293B] border border-[#334155] focus:border-[#38BDF8] rounded-xl px-4 py-2.5 text-sm text-white font-mono uppercase outline-none transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] hover:from-[#0369A1] hover:to-[#0284C7] text-white font-bold py-3 rounded-xl text-sm transition shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            <span>{loading ? 'Validating Token...' : 'Activate & Enter SentinelX'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-[#1E293B] flex items-center justify-between text-xs text-[#64748B]">
          <span>Protected Local Edge AI</span>
          <span className="text-[11px] text-[#64748B]">Contact your Administrator for Key</span>
        </div>
      </div>
    </div>
  );
};
