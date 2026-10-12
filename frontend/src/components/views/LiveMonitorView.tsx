import React, { useState } from 'react';
import {
  Play,
  Square,
  Camera,
  CheckCircle,
  XCircle,
  AlertTriangle,
  UserCheck,
  UserX,
  Volume2,
  Sliders,
  Shield,
  Radio
} from 'lucide-react';
import { TelemetryPayload, CameraItem } from '../../services/api';
import { soundService } from '../../services/sound';

interface LiveMonitorViewProps {
  telemetry: TelemetryPayload | null;
  cameras: CameraItem[];
  availableHardware: { index: string; name: string; resolution: string }[];
  onStartCamera: (params: { camera_id: string; source: string; source_type: string; conf_thresh: number; model_choice: string }) => Promise<void>;
  onStopCamera: () => Promise<void>;
}

export const LiveMonitorView: React.FC<LiveMonitorViewProps> = ({
  telemetry,
  cameras,
  availableHardware,
  onStartCamera,
  onStopCamera,
}) => {
  const [selectedSource, setSelectedSource] = useState<string>('0');
  const [selectedModel, setSelectedModel] = useState<string>('hansung');
  const [confThresh, setConfThresh] = useState<number>(0.35);
  const [loading, setLoading] = useState<boolean>(false);

  const isActive = telemetry?.is_active ?? false;

  const [streamKey, setStreamKey] = useState<number>(Date.now());

  const handleToggleCamera = async () => {
    setLoading(true);
    try {
      if (isActive) {
        soundService.stopAlarm();
        await onStopCamera();
      } else {
        setStreamKey(Date.now());
        await onStartCamera({
          camera_id: 'CAM-01',
          source: selectedSource,
          source_type: selectedSource.includes('.mp4') ? 'video' : 'webcam',
          conf_thresh: confThresh,
          model_choice: selectedModel
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#172033] border border-[#263449] p-4 rounded-xl">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/30">
            <Radio className={`w-5 h-5 ${isActive ? 'animate-pulse text-[#22C55E]' : ''}`} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#F8FAFC]">Live PPE & Identity Surveillance</h1>
            <p className="text-xs text-[#94A3B8]">
              {isActive
                ? `Streaming from Source ${selectedSource} • ${telemetry?.zone || 'Welding Area'}`
                : 'Camera feed currently offline'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-3">
          {/* Hardware Source Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-[#94A3B8]">Source:</span>
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              disabled={isActive}
              className="bg-[#0B1120] border border-[#263449] text-xs text-[#F8FAFC] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#00D9FF] disabled:opacity-60"
            >
              {availableHardware.map((cam) => (
                <option key={cam.index} value={cam.index}>
                  {cam.name}
                </option>
              ))}
              <option value="data/demo_videos/warehouse.mp4">Demo Video (Warehouse Loop)</option>
            </select>
          </div>

          {/* Model Choice */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-[#94A3B8]">Model:</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isActive}
              className="bg-[#0B1120] border border-[#263449] text-xs text-[#F8FAFC] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#00D9FF] disabled:opacity-60"
            >
              <option value="hansung">YOLOv8 PPE Hansung (Helmet/Vest/Mask)</option>
              <option value="6class">YOLOv8 PPE 6-Class (Gloves/Shoes/Vest/Helmet)</option>
            </select>
          </div>

          {/* Start/Stop Button */}
          <button
            onClick={handleToggleCamera}
            disabled={loading}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition shadow-md ${
              isActive
                ? 'bg-[#EF4444] hover:bg-[#dc2626] text-white shadow-[#EF4444]/20'
                : 'bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] shadow-[#00D9FF]/20'
            }`}
          >
            {isActive ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{loading ? 'Processing...' : isActive ? 'Stop Stream' : 'Start Camera'}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Stream & Telemetry Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stream Canvas (2 Cols) */}
        <div className="lg:col-span-2 bg-[#0B1120] border border-[#263449] rounded-xl overflow-hidden flex flex-col relative aspect-video shadow-2xl">
          {isActive ? (
            <div className="w-full h-full relative flex items-center justify-center bg-black">
              {/* MJPEG Stream Endpoint */}
              <img
                key={streamKey}
                src={`/api/video-feed?t=${streamKey}`}
                alt="Live AI Video Stream"
                className="w-full h-full object-contain"
                onError={() => {
                  setTimeout(() => setStreamKey(Date.now()), 2000);
                }}
              />

              {/* Live Overlay HUD watermark */}
              <div className="absolute top-3 left-3 bg-[#0B1120]/80 backdrop-blur-md border border-[#00D9FF]/40 px-3 py-1.5 rounded-lg text-[11px] text-[#F8FAFC] flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-[#22C55E] animate-ping" />
                <span className="font-mono font-bold text-[#00D9FF]">AI INFERENCE 60 FPS</span>
                <span className="text-[#94A3B8]">| YuNet + SFace Face ID</span>
              </div>

              <div className="absolute top-3 right-3 bg-[#0B1120]/80 backdrop-blur-md border border-[#263449] px-3 py-1.5 rounded-lg text-[11px] text-[#94A3B8] font-mono">
                {telemetry?.people_count ?? 0} PEOPLE DETECTED
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-[#172033]/40">
              <div className="w-16 h-16 rounded-full bg-[#172033] border border-[#263449] flex items-center justify-center mb-4 text-[#94A3B8]">
                <Camera className="w-8 h-8 text-[#00D9FF]/60" />
              </div>
              <h2 className="text-base font-bold text-[#F8FAFC]">Camera Feed Standby</h2>
              <p className="text-xs text-[#94A3B8] max-w-sm mt-1">
                Click "Start Camera" above to initiate real-time person tracking, face identification, and PPE compliance monitoring.
              </p>
              <button
                onClick={handleToggleCamera}
                disabled={loading}
                className="mt-4 px-4 py-2 bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] text-xs font-bold rounded-lg transition"
              >
                Launch Monitoring
              </button>
            </div>
          )}
        </div>

        {/* Live Detected Personnel Inspector (1 Col) */}
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-[#263449]">
            <div className="flex items-center space-x-2">
              <Shield className="w-4 h-4 text-[#00D9FF]" />
              <h2 className="text-sm font-bold text-[#F8FAFC]">Tracked Subjects Breakdown</h2>
            </div>
            <span className="text-[11px] font-mono text-[#00D9FF] bg-[#00D9FF]/10 px-2 py-0.5 rounded border border-[#00D9FF]/30">
              {telemetry?.tracked_people.length ?? 0} Active
            </span>
          </div>

          <div className="mt-4 flex-1 overflow-y-auto space-y-4 max-h-[500px]">
            {(!telemetry?.tracked_people || telemetry.tracked_people.length === 0) ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[#94A3B8]">
                <p className="text-xs">No active subjects tracked in frame.</p>
                <p className="text-[10px] text-gray-500 mt-1">Persons appearing on stream will display detailed PPE breakdown here.</p>
              </div>
            ) : (
              telemetry.tracked_people.map((person) => {
                const isIdentified = person.is_identified;
                const isViolation = person.is_violation;

                return (
                  <div
                    key={person.track_id}
                    className={`p-4 rounded-xl border flex flex-col space-y-3 transition ${
                      isViolation
                        ? 'bg-[#EF4444]/10 border-[#EF4444]/40'
                        : 'bg-[#0B1120] border-[#263449]'
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        {isIdentified && person.photo_path ? (
                          <img
                            src={`/${person.photo_path}`}
                            alt={person.worker_name}
                            className="w-8 h-8 rounded-lg object-cover border border-[#00D9FF]/40 bg-[#172033]"
                            onError={(e) => {
                              // Fallback on image load error
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : isIdentified ? (
                          <div className="w-8 h-8 rounded-lg bg-[#00D9FF]/10 border border-[#00D9FF]/30 flex items-center justify-center text-[#00D9FF]">
                            <UserCheck className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                            <UserX className="w-4 h-4" />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center space-x-1.5">
                            <span className="font-bold text-xs text-[#F8FAFC]">
                              {isIdentified ? person.worker_name : 'UNKNOWN PERSON'}
                            </span>
                          </div>
                          <div className="text-[10px] text-[#94A3B8]">
                            {isIdentified && person.department
                              ? `${person.department} • ${person.designation || 'Staff'}`
                              : 'Unregistered / Unverified Face'}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#172033] border border-[#263449] text-[#94A3B8]">
                        Track #{person.track_id}
                      </span>
                    </div>

                    {/* ID Details */}
                    <div className="text-[11px] text-[#94A3B8] space-y-0.5 bg-[#172033]/40 p-2 rounded-lg border border-[#263449]/50">
                      <div className="flex justify-between">
                        <span>Worker ID:</span>
                        <strong className={isIdentified ? 'text-[#00D9FF] font-mono' : 'text-amber-400 font-mono'}>
                          {isIdentified ? person.worker_id : 'UNREGISTERED'}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Identity Match:</span>
                        <strong className={isIdentified ? 'text-[#22C55E]' : 'text-amber-400'}>
                          {isIdentified ? `${Math.round(person.identity_confidence * 100)}% (Verified)` : 'None / Below Threshold'}
                        </strong>
                      </div>
                    </div>

                    {/* PPE Checklist */}
                    <div className="border-t border-[#263449]/80 pt-2.5">
                      <span className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider block mb-2">
                        PPE Verification
                      </span>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {Object.entries(person.ppe_status || {}).map(([key, item]) => {
                          const isDetected = item.detected;
                          const isSupported = item.supported;
                          const label = key.replace('_', ' ').toUpperCase();

                          if (!isSupported) {
                            return (
                              <div key={key} className="flex items-center space-x-1.5 text-gray-500 text-[10px]">
                                <span className="w-2 h-2 rounded-full bg-gray-600" />
                                <span>{label}: N/A</span>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={key}
                              className={`flex items-center space-x-1.5 p-1.5 rounded-lg border text-[11px] ${
                                isDetected
                                  ? 'bg-[#22C55E]/10 border-[#22C55E]/30 text-[#22C55E]'
                                  : 'bg-[#EF4444]/15 border-[#EF4444]/40 text-[#EF4444]'
                              }`}
                            >
                              {isDetected ? (
                                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span className="font-medium truncate">{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="pt-1">
                      {isViolation ? (
                        <div className="flex items-center space-x-2 text-[#EF4444] bg-[#EF4444]/20 border border-[#EF4444]/40 px-3 py-1.5 rounded-lg text-xs font-bold">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span className="truncate">{person.violations.join(', ')}</span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2 text-[#22C55E] bg-[#22C55E]/20 border border-[#22C55E]/40 px-3 py-1.5 rounded-lg text-xs font-bold">
                          <CheckCircle className="w-4 h-4 shrink-0" />
                          <span>All Mandatory Gear Verified</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
