import React, { useState, useRef, useEffect } from 'react';
import {
  QrCode,
  Camera,
  Upload,
  CheckCircle,
  AlertTriangle,
  Download,
  Shield,
  User,
  Clock,
  Briefcase
} from 'lucide-react';
import { api, WorkerItem } from '../../services/api';

export const ScanQRView: React.FC = () => {
  const [scanning, setScanning] = useState<boolean>(false);
  const [scannedWorker, setScannedWorker] = useState<WorkerItem | null>(null);
  const [manualInput, setManualInput] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<any>(null);

  const startScanner = async () => {
    setScanning(true);
    setScannedWorker(null);
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      // Frame polling loop for QR detection
      scanIntervalRef.current = setInterval(captureAndDecodeFrame, 750);
    } catch (e) {
      console.error('Camera scanner error:', e);
      setErrorMessage('Could not open camera for QR scanning. Grant camera permissions or upload a QR image.');
      setScanning(false);
    }
  };

  const stopScanner = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  const captureAndDecodeFrame = async () => {
    if (!videoRef.current || processing) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

      setProcessing(true);
      const res = await api.scanQr(dataUrl);
      if (res.status === 'success' && res.worker) {
        stopScanner();
        setScannedWorker(res.worker);
      }
    } catch (e) {
      console.debug('QR frame scan:', e);
    } finally {
      setProcessing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target?.result as string;
      setProcessing(true);
      setErrorMessage(null);
      try {
        const res = await api.scanQr(dataUrl);
        if (res.status === 'success' && res.worker) {
          setScannedWorker(res.worker);
        } else {
          setErrorMessage(res.message || 'No registered worker QR detected in the uploaded image.');
        }
      } catch (err) {
        setErrorMessage('Failed to decode QR code from file.');
      } finally {
        setProcessing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleManualLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    setProcessing(true);
    setErrorMessage(null);
    try {
      const res = await api.scanQr(undefined, manualInput.trim());
      if (res.status === 'success' && res.worker) {
        setScannedWorker(res.worker);
      } else {
        setErrorMessage(res.message || `No worker found with identifier '${manualInput.trim()}'.`);
      }
    } catch (e) {
      setErrorMessage('Lookup error.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#F8FAFC]">Scan Worker QR Code</h1>
        <p className="text-xs text-[#94A3B8] mt-1">
          Scan a worker ID card QR code using the connected camera or lookup by internal token.
        </p>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] text-xs flex items-center space-x-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Scanner & Manual Lookup Panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Camera Scanner */}
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#F8FAFC] border-b border-[#263449] pb-2 mb-3">
              1. Camera QR Scanner
            </h2>

            <div className="relative aspect-video bg-[#0B1120] border border-[#263449] rounded-xl overflow-hidden flex items-center justify-center">
              {scanning ? (
                <div className="w-full h-full relative">
                  <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline />
                  {/* Laser scan line overlay */}
                  <div className="absolute inset-x-8 top-1/2 h-0.5 bg-[#00D9FF] shadow-lg shadow-[#00D9FF] animate-bounce" />
                  <div className="absolute inset-8 border-2 border-[#00D9FF]/60 rounded-lg pointer-events-none" />
                </div>
              ) : (
                <div className="text-center p-6 text-[#94A3B8]">
                  <QrCode className="w-12 h-12 mx-auto mb-2 text-[#00D9FF]/60" />
                  <p className="text-xs">Camera QR scanner is inactive.</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center space-x-2">
            {scanning ? (
              <button
                onClick={stopScanner}
                className="w-full py-2 bg-[#EF4444] hover:bg-[#dc2626] text-white text-xs font-bold rounded-lg transition"
              >
                Stop Scanner
              </button>
            ) : (
              <>
                <button
                  onClick={startScanner}
                  className="flex-1 py-2 bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] text-xs font-bold rounded-lg transition flex items-center justify-center space-x-1.5"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Start Camera Scanner</span>
                </button>
                <label className="p-2 bg-[#0B1120] hover:bg-[#1e2c45] border border-[#263449] text-[#94A3B8] rounded-lg cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
              </>
            )}
          </div>
        </div>

        {/* Right: Manual Token Lookup */}
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#F8FAFC] border-b border-[#263449] pb-2 mb-3">
              2. Manual ID / Token Lookup
            </h2>
            <p className="text-xs text-[#94A3B8] mb-4">
              Enter worker registration ID (e.g., <code className="text-[#00D9FF]">W-001</code>) or QR token string (<code className="text-[#00D9FF]">SENTINELX-ID-W-001</code>).
            </p>

            <form onSubmit={handleManualLookup} className="space-y-3">
              <input
                type="text"
                placeholder="Enter Worker ID or QR Identifier"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none font-mono"
              />
              <button
                type="submit"
                disabled={processing}
                className="w-full py-2 bg-[#172033] hover:bg-[#1e2c45] border border-[#00D9FF]/40 text-[#00D9FF] text-xs font-bold rounded-lg transition"
              >
                {processing ? 'Searching...' : 'Lookup Worker Profile'}
              </button>
            </form>
          </div>

          <div className="text-[11px] text-[#94A3B8] p-3 rounded-lg bg-[#0B1120] border border-[#263449] mt-4">
            <Shield className="w-3.5 h-3.5 text-[#00D9FF] inline mr-1" />
            <span>QR codes embed zero personal data; only internal tokens referencing the SQLite database.</span>
          </div>
        </div>
      </div>

      {/* Display Scanned Worker Profile Card */}
      {scannedWorker && (
        <div className="bg-[#172033] border border-[#00D9FF]/40 rounded-2xl p-6 space-y-6 shadow-xl animate-fadeIn">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#263449] pb-4">
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 rounded-xl overflow-hidden bg-[#0B1120] border border-[#263449] flex items-center justify-center">
                {scannedWorker.photo_path ? (
                  <img src={`/${scannedWorker.photo_path}`} alt="Worker" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-8 h-8 text-[#00D9FF]" />
                )}
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-bold text-[#F8FAFC]">{scannedWorker.name}</h2>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    scannedWorker.status === 'ACTIVE'
                      ? 'bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/40'
                      : 'bg-gray-700 text-gray-400'
                  }`}>
                    {scannedWorker.status}
                  </span>
                </div>
                <div className="text-xs font-mono text-[#00D9FF]">{scannedWorker.worker_id}</div>
                <div className="text-xs text-[#94A3B8]">{scannedWorker.department} • {scannedWorker.designation}</div>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <a
                href={`/api/workers/${scannedWorker.worker_id}/qr`}
                download
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] text-xs font-bold rounded-lg transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download QR</span>
              </a>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
              <span className="text-[#94A3B8] block mb-1">Shift & Schedule</span>
              <span className="font-semibold text-[#F8FAFC]">{scannedWorker.shift} Shift</span>
            </div>
            <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
              <span className="text-[#94A3B8] block mb-1">Total Recorded Violations</span>
              <span className="font-semibold text-[#EF4444]">{scannedWorker.total_violations ?? 0} Incidents</span>
            </div>
            <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
              <span className="text-[#94A3B8] block mb-1">Enrolled On</span>
              <span className="font-semibold text-[#F8FAFC]">{scannedWorker.created_at.split(' ')[0]}</span>
            </div>
          </div>

          {/* Required PPE */}
          <div>
            <h3 className="text-xs font-bold text-[#F8FAFC] uppercase tracking-wider mb-2">
              Mandatory Safety Gear Profile
            </h3>
            <div className="flex flex-wrap gap-2">
              {scannedWorker.required_ppe.map((item) => (
                <span
                  key={item}
                  className="px-2.5 py-1 rounded-lg bg-[#00D9FF]/10 border border-[#00D9FF]/30 text-[#00D9FF] text-xs font-medium"
                >
                  {item.replace('_', ' ').toUpperCase()}
                </span>
              ))}
            </div>
          </div>

          {/* Recent Violations / Incidents List */}
          {scannedWorker.recent_incidents && scannedWorker.recent_incidents.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-[#F8FAFC] uppercase tracking-wider mb-2">
                Recent Incident History
              </h3>
              <div className="space-y-2">
                {scannedWorker.recent_incidents.slice(0, 3).map((inc) => (
                  <div
                    key={inc.id}
                    className="p-3 rounded-lg bg-[#0B1120] border border-[#263449] text-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-[#EF4444]">{inc.violation_type}</div>
                      <div className="text-[11px] text-[#94A3B8]">{inc.camera_id} • {inc.zone}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[#94A3B8]">{inc.start_time}</div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#172033] text-gray-400">
                        {inc.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
