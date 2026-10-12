import React, { useState, useRef, useEffect } from 'react';
import {
  UserPlus,
  Camera,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  QrCode,
  Download,
  Eye,
  Shield,
  Upload
} from 'lucide-react';
import { api, WorkerItem } from '../../services/api';

interface RegisterWorkerViewProps {
  onSuccess: () => void;
  onViewWorker: (worker: WorkerItem) => void;
}

export const RegisterWorkerView: React.FC<RegisterWorkerViewProps> = ({
  onSuccess,
  onViewWorker
}) => {
  const [formData, setFormData] = useState({
    worker_id: '',
    name: '',
    department: 'Welding',
    designation: 'Machine Operator',
    shift: 'Morning',
    joining_date: new Date().toISOString().split('T')[0],
    address: '',
    phone: '',
    email: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    required_ppe: ['helmet', 'safety_vest'] as string[],
  });

  // Photo & Camera State
  const [capturing, setCapturing] = useState<boolean>(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [validatingFace, setValidatingFace] = useState<boolean>(false);
  const [faceQuality, setFaceQuality] = useState<{
    valid: boolean;
    score?: number;
    reasons?: string[];
    error?: string;
  } | null>(null);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [registeredWorker, setRegisteredWorker] = useState<WorkerItem | null>(null);
  const [overwriteExisting, setOverwriteExisting] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const availablePPE = [
    { id: 'helmet', label: 'Safety Helmet' },
    { id: 'safety_vest', label: 'High-Visibility Vest' },
    { id: 'gloves', label: 'Protective Gloves' },
    { id: 'safety_shoes', label: 'Safety Shoes' },
    { id: 'mask', label: 'Protective Mask' },
    { id: 'goggles', label: 'Eye Protection Goggles' },
  ];

  const startCamera = async () => {
    setCapturing(true);
    setCapturedPhoto(null);
    setFaceQuality(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (e) {
      console.error('Camera access error:', e);
      setErrorMessage('Unable to access browser webcam. Please grant camera permission or upload a photo.');
      setCapturing(false);
    }
  };

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setCapturing(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const takeSnapshot = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    stopCamera();
    setCapturedPhoto(dataUrl);

    // Validate face quality via backend
    await runFaceValidation(dataUrl);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target?.result as string;
      setCapturedPhoto(dataUrl);
      await runFaceValidation(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const runFaceValidation = async (b64: string) => {
    setValidatingFace(true);
    setFaceQuality(null);
    try {
      const res = await api.validateFace(b64);
      if (res.valid) {
        setFaceQuality({
          valid: true,
          score: res.quality_info?.score,
          reasons: []
        });
      } else {
        setFaceQuality({
          valid: false,
          score: res.quality_info?.score,
          reasons: res.quality_info?.reasons || [res.error || 'Face quality insufficient']
        });
      }
    } catch (e) {
      console.error(e);
      setFaceQuality({
        valid: false,
        reasons: ['Error connecting to Face Identity engine']
      });
    } finally {
      setValidatingFace(false);
    }
  };

  const togglePPE = (item: string) => {
    setFormData((prev) => {
      const exists = prev.required_ppe.includes(item);
      return {
        ...prev,
        required_ppe: exists
          ? prev.required_ppe.filter((i) => i !== item)
          : [...prev.required_ppe, item]
      };
    });
  };

  const handleForceUpdate = async () => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await api.createWorker({
        ...formData,
        photo_base64: capturedPhoto || undefined,
        overwrite: true
      });
      setRegisteredWorker(res.worker);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update error';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!formData.worker_id.trim()) {
      setErrorMessage('Worker ID is mandatory (e.g., W-001).');
      return;
    }
    if (!formData.name.trim()) {
      setErrorMessage('Worker Full Name is mandatory.');
      return;
    }
    if (formData.required_ppe.length === 0) {
      setErrorMessage('At least one required PPE item must be selected.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createWorker({
        ...formData,
        photo_base64: capturedPhoto || undefined,
        overwrite: overwriteExisting
      });
      setRegisteredWorker(res.worker);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration error';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (registeredWorker) {
    return (
      <div className="max-w-2xl mx-auto bg-[#172033] border border-[#263449] rounded-2xl p-8 space-y-6 text-center animate-fadeIn">
        <div className="w-16 h-16 rounded-full bg-[#22C55E]/20 border border-[#22C55E]/40 text-[#22C55E] flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[#F8FAFC]">Worker Registered Successfully</h2>
          <p className="text-xs text-[#94A3B8] mt-1">
            Worker profile and secure QR code have been created and saved in the SQLite database.
          </p>
        </div>

        <div className="bg-[#0B1120] border border-[#263449] rounded-xl p-5 text-left flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-xl overflow-hidden bg-[#172033] border border-[#263449] flex items-center justify-center">
              {registeredWorker.photo_path ? (
                <img src={`/${registeredWorker.photo_path}`} alt="Worker" className="w-full h-full object-cover" />
              ) : (
                <Shield className="w-8 h-8 text-[#00D9FF]" />
              )}
            </div>
            <div>
              <div className="text-sm font-bold text-[#F8FAFC]">{registeredWorker.name}</div>
              <div className="text-xs font-mono text-[#00D9FF]">{registeredWorker.worker_id}</div>
              <div className="text-[11px] text-[#94A3B8]">
                {registeredWorker.department} • {registeredWorker.designation}
              </div>
            </div>
          </div>

          <div className="text-center pl-4 border-l border-[#263449]">
            <img
              src={`/data/qrcodes/${registeredWorker.worker_id}_qr.png`}
              alt="Worker QR"
              className="w-20 h-20 bg-white p-1 rounded-lg border border-[#263449] mx-auto"
            />
            <span className="text-[10px] text-[#94A3B8] block mt-1 font-mono">
              {registeredWorker.qr_identifier}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-center space-x-3 pt-2">
          <a
            href={`/api/workers/${registeredWorker.worker_id}/qr`}
            download
            className="flex items-center space-x-2 px-4 py-2 bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] text-xs font-bold rounded-lg transition"
          >
            <Download className="w-4 h-4" />
            <span>Download QR Code (PNG)</span>
          </a>
          <button
            onClick={() => onViewWorker(registeredWorker)}
            className="flex items-center space-x-2 px-4 py-2 bg-[#172033] hover:bg-[#1e2c45] border border-[#263449] text-xs font-semibold text-[#F8FAFC] rounded-lg transition"
          >
            <Eye className="w-4 h-4" />
            <span>View Worker Profile</span>
          </button>
          <button
            onClick={() => {
              setRegisteredWorker(null);
              setCapturedPhoto(null);
              setFaceQuality(null);
              setFormData({
                worker_id: '',
                name: '',
                department: 'Welding',
                designation: 'Machine Operator',
                shift: 'Morning',
                joining_date: new Date().toISOString().split('T')[0],
                address: '',
                phone: '',
                email: '',
                status: 'ACTIVE',
                required_ppe: ['helmet', 'safety_vest'],
              });
            }}
            className="px-4 py-2 bg-[#172033] hover:bg-[#1e2c45] border border-[#263449] text-xs font-semibold text-[#94A3B8] rounded-lg transition"
          >
            Register Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC]">Worker Registration</h1>
          <p className="text-xs text-[#94A3B8] mt-1">
            Enrolls worker identity into SQLite, captures face embedding for recognition, and generates unique QR.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
          {errorMessage.toLowerCase().includes('already registered') && (
            <div className="flex items-center space-x-2 shrink-0">
              <button
                type="button"
                onClick={handleForceUpdate}
                disabled={submitting}
                className="px-3 py-1.5 bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] font-bold rounded-lg text-xs transition shadow-sm"
              >
                {submitting ? 'Updating...' : 'Update / Overwrite Profile'}
              </button>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form Details (2 cols) */}
        <div className="lg:col-span-2 bg-[#172033] border border-[#263449] rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-bold text-[#F8FAFC] border-b border-[#263449] pb-2">
            1. Personnel Information
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-[#94A3B8] font-medium mb-1">Worker ID / Reg. No. *</label>
              <input
                type="text"
                required
                placeholder="e.g. W-001"
                value={formData.worker_id}
                onChange={(e) => setFormData({ ...formData, worker_id: e.target.value.toUpperCase() })}
                className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-[#F8FAFC] outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-[#94A3B8] font-medium mb-1">Full Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Rahul Kumar"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-[#F8FAFC] outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-[#94A3B8] font-medium mb-1">Department</label>
              <select
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-[#F8FAFC] outline-none"
              >
                <option value="Welding">Welding</option>
                <option value="Assembly">Assembly</option>
                <option value="Machining">Machining</option>
                <option value="Storage">Warehouse / Storage</option>
                <option value="Electrical">Electrical</option>
                <option value="Chemical">Chemical Plant</option>
              </select>
            </div>
            <div>
              <label className="block text-[#94A3B8] font-medium mb-1">Designation</label>
              <input
                type="text"
                placeholder="e.g. Machine Operator"
                value={formData.designation}
                onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-[#F8FAFC] outline-none"
              />
            </div>
            <div>
              <label className="block text-[#94A3B8] font-medium mb-1">Shift</label>
              <select
                value={formData.shift}
                onChange={(e) => setFormData({ ...formData, shift: e.target.value })}
                className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-[#F8FAFC] outline-none"
              >
                <option value="Morning">Morning (06:00 - 14:00)</option>
                <option value="Evening">Evening (14:00 - 22:00)</option>
                <option value="Night">Night (22:00 - 06:00)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-[#94A3B8] font-medium mb-1">Phone Number</label>
              <input
                type="tel"
                placeholder="+91 98765 43210"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-[#F8FAFC] outline-none"
              />
            </div>
            <div>
              <label className="block text-[#94A3B8] font-medium mb-1">Email (Optional)</label>
              <input
                type="email"
                placeholder="worker@sentinelx.local"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-[#F8FAFC] outline-none"
              />
            </div>
          </div>

          <div className="text-xs">
            <label className="block text-[#94A3B8] font-medium mb-1">Residential Address</label>
            <input
              type="text"
              placeholder="e.g. Sector 4, Rourkela"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-[#F8FAFC] outline-none"
            />
          </div>

          {/* Required PPE Checklist */}
          <div className="pt-2">
            <label className="block text-xs font-bold text-[#F8FAFC] mb-2">
              2. Mandatory Safety Gear (PPE) for Worker *
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {availablePPE.map((ppe) => {
                const checked = formData.required_ppe.includes(ppe.id);
                return (
                  <button
                    type="button"
                    key={ppe.id}
                    onClick={() => togglePPE(ppe.id)}
                    className={`flex items-center space-x-2 p-2.5 rounded-lg border text-xs font-medium transition text-left ${
                      checked
                        ? 'bg-[#00D9FF]/10 border-[#00D9FF] text-[#00D9FF]'
                        : 'bg-[#0B1120] border-[#263449] text-[#94A3B8] hover:border-gray-600'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      checked ? 'bg-[#00D9FF] border-[#00D9FF]' : 'border-[#94A3B8]'
                    }`}>
                      {checked && <CheckCircle className="w-3.5 h-3.5 text-[#0B1120]" />}
                    </div>
                    <span className="truncate">{ppe.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Photo & Face Capture (1 col) */}
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <h2 className="text-sm font-bold text-[#F8FAFC] border-b border-[#263449] pb-2">
              3. Worker Photo & Face ID
            </h2>

            {/* Photo Capture Canvas/Area */}
            <div className="mt-4 relative aspect-square bg-[#0B1120] border border-[#263449] rounded-xl overflow-hidden flex items-center justify-center">
              {capturing ? (
                <div className="w-full h-full relative">
                  <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline />
                  {/* Face Guide Reticle */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-44 h-56 border-2 border-dashed border-[#00D9FF]/80 rounded-full flex items-center justify-center animate-pulse">
                      <span className="text-[10px] text-[#00D9FF] bg-[#0B1120]/80 px-2 py-0.5 rounded">
                        Position Face Here
                      </span>
                    </div>
                  </div>
                </div>
              ) : capturedPhoto ? (
                <div className="w-full h-full relative">
                  <img src={capturedPhoto} alt="Captured Worker" className="w-full h-full object-cover" />
                  {validatingFace && (
                    <div className="absolute inset-0 bg-[#0B1120]/70 flex items-center justify-center text-xs text-[#00D9FF] space-x-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Validating face quality...</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center p-6 text-[#94A3B8]">
                  <Camera className="w-10 h-10 mx-auto mb-2 text-[#94A3B8]/40" />
                  <p className="text-xs">No worker photo captured</p>
                  <p className="text-[10px] text-gray-500 mt-1">Use camera or upload a clear frontal face image.</p>
                </div>
              )}
            </div>

            {/* Quality Feedback */}
            {faceQuality && (
              <div className={`mt-3 p-3 rounded-lg border text-xs ${
                faceQuality.valid
                  ? 'bg-[#22C55E]/10 border-[#22C55E]/30 text-[#22C55E]'
                  : 'bg-[#EF4444]/10 border-[#EF4444]/30 text-[#EF4444]'
              }`}>
                <div className="flex items-center space-x-2 font-bold">
                  {faceQuality.valid ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  <span>{faceQuality.valid ? 'Face Passed Quality Checks' : 'Face Quality Insufficient'}</span>
                </div>
                {faceQuality.reasons && faceQuality.reasons.length > 0 && (
                  <ul className="text-[11px] mt-1 list-disc list-inside space-y-0.5 opacity-90">
                    {faceQuality.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Camera Controls */}
            <div className="mt-3 flex items-center space-x-2">
              {capturing ? (
                <>
                  <button
                    type="button"
                    onClick={takeSnapshot}
                    className="flex-1 py-2 bg-[#22C55E] hover:bg-[#16a34a] text-white text-xs font-bold rounded-lg transition"
                  >
                    Capture Photo
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-3 py-2 bg-[#172033] border border-[#263449] text-xs text-[#94A3B8] rounded-lg"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={startCamera}
                    className="flex-1 py-2 bg-[#172033] hover:bg-[#1e2c45] border border-[#00D9FF]/40 text-[#00D9FF] text-xs font-bold rounded-lg transition flex items-center justify-center space-x-1.5"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{capturedPhoto ? 'Retake Photo' : 'Capture with Camera'}</span>
                  </button>
                  <label className="p-2 bg-[#172033] hover:bg-[#1e2c45] border border-[#263449] text-[#94A3B8] rounded-lg cursor-pointer">
                    <Upload className="w-4 h-4" />
                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </>
              )}
            </div>
          </div>

          {/* Update/Overwrite Checkbox & Submit Button */}
          <div className="space-y-2 pt-1">
            <label className="flex items-center space-x-2 text-[11px] text-[#94A3B8] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(e) => setOverwriteExisting(e.target.checked)}
                className="rounded border-[#263449] bg-[#0B1120] text-[#00D9FF] focus:ring-0"
              />
              <span>Update profile if Worker ID is already registered</span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-gradient-to-r from-[#00D9FF] to-[#0284c7] hover:brightness-110 text-[#0B1120] text-xs font-bold rounded-xl transition shadow-lg shadow-[#00D9FF]/20 flex items-center justify-center space-x-2"
            >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Registering & Embedding...</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Register Worker & Generate QR</span>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  </div>
);
};
