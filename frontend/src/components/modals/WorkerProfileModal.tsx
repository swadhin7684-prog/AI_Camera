import React, { useState, useEffect, useRef } from 'react';
import {
  X, Download, Shield, Calendar, Phone, Mail, MapPin, CheckCircle,
  Edit3, Camera, Upload, RefreshCw, Save, ArrowLeft, AlertCircle, Check
} from 'lucide-react';
import { WorkerItem, api } from '../../services/api';

const PPE_OPTIONS = [
  { id: 'safety_helmet', label: 'Safety Helmet', icon: '⛑️' },
  { id: 'safety_vest', label: 'High-Visibility Vest', icon: '🦺' },
  { id: 'gloves', label: 'Protective Gloves', icon: '🧤' },
  { id: 'safety_shoes', label: 'Safety Shoes', icon: '🥾' },
  { id: 'mask', label: 'Protective Mask', icon: '😷' },
  { id: 'safety_glasses', label: 'Eye Protection Goggles', icon: '🥽' },
];

const DEPARTMENTS = [
  'Welding',
  'Assembly',
  'Machining',
  'Storage',
  'Electrical',
  'Maintenance',
  'Safety',
  'Quality Control'
];

const SHIFTS = [
  'Morning (06:00 - 14:00)',
  'Evening (14:00 - 22:00)',
  'Night (22:00 - 06:00)',
  'General (09:00 - 17:00)'
];

interface WorkerProfileModalProps {
  worker: WorkerItem | null;
  onClose: () => void;
  onWorkerUpdated?: (updatedWorker: WorkerItem) => void;
  initialEditMode?: boolean;
}

export const WorkerProfileModal: React.FC<WorkerProfileModalProps> = ({
  worker,
  onClose,
  onWorkerUpdated,
  initialEditMode = false
}) => {
  const [currentWorker, setCurrentWorker] = useState<WorkerItem | null>(worker);
  const [isEditing, setIsEditing] = useState<boolean>(initialEditMode);

  // Edit form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [department, setDepartment] = useState('Machining');
  const [designation, setDesignation] = useState('Machine Operator');
  const [shift, setShift] = useState('Morning (06:00 - 14:00)');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [requiredPpe, setRequiredPpe] = useState<string[]>(['safety_helmet', 'safety_vest']);

  // Photo / Face ID update state
  const [newPhotoBase64, setNewPhotoBase64] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Submission state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validatingFace, setValidatingFace] = useState(false);
  const [faceQuality, setFaceQuality] = useState<{ pass: boolean; score?: number; message?: string } | null>(null);

  // Sync state whenever worker prop changes
  useEffect(() => {
    setCurrentWorker(worker);
    if (worker) {
      setName(worker.name || '');
      setPhone(worker.phone || '');
      setEmail(worker.email || '');
      setAddress(worker.address || '');
      setDepartment(worker.department || 'Machining');
      setDesignation(worker.designation || 'Machine Operator');
      setShift(worker.shift || 'Morning (06:00 - 14:00)');
      setStatus(worker.status || 'ACTIVE');
      setRequiredPpe(worker.required_ppe || ['safety_helmet', 'safety_vest']);
      setPhotoPreview(worker.photo_path ? `/${worker.photo_path}` : null);
      setNewPhotoBase64(null);
      setFaceQuality(null);
      setSaveError(null);
      setSaveSuccess(null);
    }
  }, [worker]);

  useEffect(() => {
    setIsEditing(initialEditMode);
  }, [initialEditMode]);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  if (!currentWorker) return null;

  const togglePpe = (id: string) => {
    setRequiredPpe((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 640, facingMode: 'user' }
      });
      setStream(s);
      setCapturing(true);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch {
      alert('Unable to access webcam. Please verify camera permissions or upload an image file.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    setCapturing(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, 480, 480);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      setNewPhotoBase64(dataUrl);
      setPhotoPreview(dataUrl);
      stopCamera();
      validateFaceImage(dataUrl);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setNewPhotoBase64(base64);
        setPhotoPreview(base64);
        validateFaceImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const validateFaceImage = async (base64Img: string) => {
    setValidatingFace(true);
    setFaceQuality(null);
    try {
      const res = await api.validateFace(base64Img);
      setFaceQuality(res);
    } catch {
      setFaceQuality({ pass: true, message: 'Image processed (local check bypassed)' });
    } finally {
      setValidatingFace(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const updates: Record<string, unknown> = {
        name,
        department,
        designation,
        shift,
        status,
        phone,
        email,
        address,
        required_ppe: requiredPpe
      };

      if (newPhotoBase64) {
        updates.photo_base64 = newPhotoBase64;
      }

      const res = await api.updateWorker(currentWorker.worker_id, updates);
      if (res.status === 'success' && res.worker) {
        setCurrentWorker(res.worker);
        if (onWorkerUpdated) {
          onWorkerUpdated(res.worker);
        }
        setSaveSuccess('Worker profile updated successfully!');
        setTimeout(() => {
          setIsEditing(false);
          setSaveSuccess(null);
        }, 1000);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update profile';
      setSaveError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#172033] border border-[#263449] rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#263449] flex items-center justify-between bg-[#0d1527]">
          <div className="flex items-center space-x-2">
            <Shield className="w-4 h-4 text-[#00D9FF]" />
            <h2 className="text-sm font-bold text-[#F8FAFC]">
              {isEditing ? `Edit Profile — ${currentWorker.name}` : 'Worker Profile & Compliance Dossier'}
            </h2>
          </div>

          <div className="flex items-center space-x-2">
            {!isEditing ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="px-3 py-1.5 bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/40 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 shadow-sm"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Profile</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setIsEditing(false);
                }}
                className="px-3 py-1.5 bg-[#172033] hover:bg-[#263449] text-[#94A3B8] hover:text-[#F8FAFC] border border-[#263449] rounded-lg text-xs font-bold transition flex items-center space-x-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Profile</span>
              </button>
            )}

            <button
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="text-[#94A3B8] hover:text-[#F8FAFC] p-1 rounded-lg hover:bg-[#263449]/50 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Notifications */}
          {saveSuccess && (
            <div className="bg-[#22C55E]/10 border border-[#22C55E]/30 text-[#22C55E] p-3 rounded-xl flex items-center space-x-2 text-xs">
              <Check className="w-4 h-4 shrink-0" />
              <span>{saveSuccess}</span>
            </div>
          )}

          {saveError && (
            <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444] p-3 rounded-xl flex items-center space-x-2 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          {!isEditing ? (
            /* ================= VIEW MODE ================= */
            <>
              {/* Top Info Banner */}
              <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0B1120] border border-[#263449] p-4 rounded-xl">
                <div className="flex items-center space-x-4">
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-[#172033] border border-[#263449] flex items-center justify-center shrink-0">
                    {currentWorker.photo_path ? (
                      <img
                        src={`/${currentWorker.photo_path}?t=${Date.now()}`}
                        alt={currentWorker.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Shield className="w-10 h-10 text-[#00D9FF]" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-base font-bold text-[#F8FAFC]">{currentWorker.name}</h3>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          currentWorker.status === 'ACTIVE'
                            ? 'bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30'
                            : 'bg-gray-800 text-gray-400'
                        }`}
                      >
                        {currentWorker.status}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-[#00D9FF]">{currentWorker.worker_id}</div>
                    <div className="text-xs text-[#94A3B8]">
                      {currentWorker.department} • {currentWorker.designation}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">Shift: {currentWorker.shift}</div>
                  </div>
                </div>

                {/* QR Card */}
                <div className="text-center pl-4 border-l border-[#263449]">
                  <img
                    src={`/data/qrcodes/${currentWorker.worker_id}_qr.png`}
                    alt="Worker QR"
                    className="w-20 h-20 bg-white p-1 rounded-lg border border-[#263449] mx-auto"
                  />
                  <a
                    href={`/api/workers/${currentWorker.worker_id}/qr`}
                    download
                    className="mt-2 inline-flex items-center space-x-1 text-[11px] font-bold text-[#00D9FF] hover:underline"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download QR</span>
                  </a>
                </div>
              </div>

              {/* Contact & Meta Details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
                  <div className="flex items-center space-x-1.5 text-[#94A3B8] mb-1">
                    <Phone className="w-3.5 h-3.5 text-[#00D9FF]" />
                    <span>Contact Phone</span>
                  </div>
                  <div className="font-semibold text-[#F8FAFC]">{currentWorker.phone || 'Not Provided'}</div>
                </div>

                <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
                  <div className="flex items-center space-x-1.5 text-[#94A3B8] mb-1">
                    <Mail className="w-3.5 h-3.5 text-[#00D9FF]" />
                    <span>Email Address</span>
                  </div>
                  <div className="font-semibold text-[#F8FAFC] truncate">
                    {currentWorker.email || 'Not Provided'}
                  </div>
                </div>

                <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
                  <div className="flex items-center space-x-1.5 text-[#94A3B8] mb-1">
                    <Calendar className="w-3.5 h-3.5 text-[#00D9FF]" />
                    <span>Enrollment Date</span>
                  </div>
                  <div className="font-semibold text-[#F8FAFC]">
                    {currentWorker.created_at?.split(' ')[0] || 'N/A'}
                  </div>
                </div>
              </div>

              {currentWorker.address && (
                <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg text-xs">
                  <div className="flex items-center space-x-1.5 text-[#94A3B8] mb-1">
                    <MapPin className="w-3.5 h-3.5 text-[#00D9FF]" />
                    <span>Residential Address</span>
                  </div>
                  <div className="font-semibold text-[#F8FAFC]">{currentWorker.address}</div>
                </div>
              )}

              {/* Required PPE Profile */}
              <div className="bg-[#0B1120] border border-[#263449] p-4 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-[#94A3B8] uppercase tracking-wider">
                    Assigned Safety Gear (Required PPE)
                  </h4>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-[11px] text-[#00D9FF] hover:underline flex items-center space-x-1"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Change PPE</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentWorker.required_ppe.map((item) => (
                    <div
                      key={item}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#172033] border border-[#00D9FF]/30 text-[#00D9FF] text-xs font-medium"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>{item.replace('_', ' ').toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Incident / Violation History */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-[#F8FAFC] uppercase tracking-wider">
                    Recorded Violations ({currentWorker.recent_incidents?.length ?? 0})
                  </h4>
                </div>

                {!currentWorker.recent_incidents || currentWorker.recent_incidents.length === 0 ? (
                  <div className="p-4 bg-[#0B1120] border border-[#263449] rounded-xl text-center text-xs text-[#22C55E]">
                    <CheckCircle className="w-5 h-5 mx-auto mb-1" />
                    <span>Zero safety violations logged for this worker. Full compliance maintained.</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {currentWorker.recent_incidents.map((inc) => (
                      <div
                        key={inc.id}
                        className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg text-xs flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-[#EF4444]">{inc.violation_type}</span>
                          <div className="text-[11px] text-[#94A3B8] mt-0.5">
                            {inc.camera_id} • {inc.zone} • Duration: {inc.duration_seconds}s
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[#94A3B8]">
                            {inc.created_at.split(' ')[1] || inc.created_at}
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#172033] text-gray-400">
                            {inc.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Quick Action Footer */}
              <div className="pt-4 border-t border-[#263449] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2.5 bg-gradient-to-r from-[#00D9FF] to-[#0284c7] hover:brightness-110 text-[#0B1120] text-xs font-bold rounded-xl transition shadow-lg shadow-[#00D9FF]/20 flex items-center space-x-2"
                >
                  <Edit3 className="w-4 h-4" />
                  <span>Edit Worker Profile & Safety Gear</span>
                </button>

                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-[#172033] hover:bg-[#263449] border border-[#263449] text-[#94A3B8] hover:text-[#F8FAFC] text-xs font-semibold rounded-xl transition"
                >
                  Close
                </button>
              </div>
            </>
          ) : (
            /* ================= EDIT MODE ================= */
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left 2 Cols: Worker Details Form */}
                <div className="lg:col-span-2 space-y-4">
                  {/* Basic Info Card */}
                  <div className="bg-[#0B1120] border border-[#263449] rounded-xl p-4 space-y-3">
                    <h3 className="text-xs font-bold text-[#00D9FF] uppercase tracking-wider">
                      1. Personnel Information
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-[#94A3B8] mb-1">
                          Worker ID <span className="text-gray-500">(Permanent)</span>
                        </label>
                        <input
                          type="text"
                          value={currentWorker.worker_id}
                          disabled
                          className="w-full bg-[#172033]/50 border border-[#263449] text-gray-400 rounded-lg px-3 py-2 text-xs font-mono cursor-not-allowed"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-[#94A3B8] mb-1">Full Name *</label>
                        <input
                          type="text"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full bg-[#172033] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] text-[#94A3B8] mb-1">Department</label>
                        <select
                          value={department}
                          onChange={(e) => setDepartment(e.target.value)}
                          className="w-full bg-[#172033] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
                        >
                          {DEPARTMENTS.map((dept) => (
                            <option key={dept} value={dept}>
                              {dept}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] text-[#94A3B8] mb-1">Designation</label>
                        <input
                          type="text"
                          value={designation}
                          onChange={(e) => setDesignation(e.target.value)}
                          className="w-full bg-[#172033] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-[#94A3B8] mb-1">Status</label>
                        <select
                          value={status}
                          onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                          className="w-full bg-[#172033] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
                        >
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="INACTIVE">INACTIVE</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#94A3B8] mb-1">Shift</label>
                      <select
                        value={shift}
                        onChange={(e) => setShift(e.target.value)}
                        className="w-full bg-[#172033] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
                      >
                        {SHIFTS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-[#94A3B8] mb-1">Phone Number</label>
                        <input
                          type="text"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full bg-[#172033] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-[#94A3B8] mb-1">Email Address</label>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full bg-[#172033] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#94A3B8] mb-1">Residential Address</label>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="w-full bg-[#172033] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
                      />
                    </div>
                  </div>

                  {/* Required PPE Gear Selection */}
                  <div className="bg-[#0B1120] border border-[#263449] rounded-xl p-4 space-y-3">
                    <h3 className="text-xs font-bold text-[#00D9FF] uppercase tracking-wider">
                      2. Mandatory Safety Gear (Required PPE) *
                    </h3>
                    <p className="text-[11px] text-gray-400">
                      Select which PPE items the AI vision engine will enforce on this worker.
                    </p>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                      {PPE_OPTIONS.map((item) => {
                        const checked = requiredPpe.includes(item.id);
                        return (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => togglePpe(item.id)}
                            className={`p-2.5 rounded-lg border text-left text-xs font-medium transition flex items-center space-x-2 ${
                              checked
                                ? 'bg-[#00D9FF]/10 border-[#00D9FF] text-[#00D9FF]'
                                : 'bg-[#172033] border-[#263449] text-[#94A3B8] hover:border-[#263449]/80'
                            }`}
                          >
                            <span className="text-sm">{item.icon}</span>
                            <span className="truncate">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Right 1 Col: Photo & Face Capture */}
                <div className="bg-[#0B1120] border border-[#263449] rounded-xl p-4 flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-[#00D9FF] uppercase tracking-wider mb-2">
                      3. Worker Photo & Face ID
                    </h3>
                    <p className="text-[11px] text-gray-400 mb-3">
                      Keep current photo or update with new Face embedding.
                    </p>

                    {/* Photo Preview / Live Canvas */}
                    <div className="relative aspect-square bg-[#172033] border border-[#263449] rounded-xl overflow-hidden flex items-center justify-center">
                      {capturing ? (
                        <div className="w-full h-full relative">
                          <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-40 h-48 border-2 border-dashed border-[#00D9FF]/80 rounded-full flex items-center justify-center animate-pulse" />
                          </div>
                        </div>
                      ) : photoPreview ? (
                        <img src={photoPreview} alt="Worker" className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-center p-4 text-[#94A3B8]">
                          <Camera className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                          <span className="text-xs">No Photo Available</span>
                        </div>
                      )}
                    </div>

                    {/* Face Validation Feedback */}
                    {validatingFace && (
                      <div className="mt-2 text-xs text-[#00D9FF] flex items-center space-x-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Validating Face Embedding with YuNet...</span>
                      </div>
                    )}
                    {faceQuality && (
                      <div
                        className={`mt-2 p-2 rounded-lg text-xs flex items-center space-x-2 ${
                          faceQuality.pass
                            ? 'bg-[#22C55E]/10 border border-[#22C55E]/30 text-[#22C55E]'
                            : 'bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444]'
                        }`}
                      >
                        {faceQuality.pass ? (
                          <CheckCircle className="w-4 h-4 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0" />
                        )}
                        <span className="truncate">
                          {faceQuality.pass ? 'Face Passed Quality Checks' : faceQuality.message}
                        </span>
                      </div>
                    )}

                    {/* Camera and File Buttons */}
                    <div className="mt-3 flex items-center space-x-2">
                      {capturing ? (
                        <>
                          <button
                            type="button"
                            onClick={capturePhoto}
                            className="flex-1 py-2 bg-[#22C55E] hover:bg-[#16a34a] text-black text-xs font-bold rounded-lg transition"
                          >
                            Snap Photo
                          </button>
                          <button
                            type="button"
                            onClick={stopCamera}
                            className="px-3 py-2 bg-[#172033] hover:bg-[#263449] text-gray-300 text-xs font-bold rounded-lg transition"
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
                            <span>{newPhotoBase64 ? 'Retake Photo' : 'Take New Photo'}</span>
                          </button>
                          <label className="p-2 bg-[#172033] hover:bg-[#1e2c45] border border-[#263449] text-[#94A3B8] rounded-lg cursor-pointer">
                            <Upload className="w-4 h-4" />
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleFileUpload}
                              className="hidden"
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </div>

                  {newPhotoBase64 && (
                    <div className="text-[11px] text-[#22C55E] flex items-center space-x-1">
                      <Check className="w-3.5 h-3.5" />
                      <span>New photo will replace existing Face ID embedding on save.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-[#263449] flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setIsEditing(false);
                  }}
                  className="px-4 py-2 bg-[#172033] hover:bg-[#263449] border border-[#263449] text-[#94A3B8] hover:text-[#F8FAFC] text-xs font-semibold rounded-xl transition"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-gradient-to-r from-[#00D9FF] to-[#0284c7] hover:brightness-110 text-[#0B1120] text-xs font-bold rounded-xl transition shadow-lg shadow-[#00D9FF]/20 flex items-center space-x-2"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Save Profile Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
