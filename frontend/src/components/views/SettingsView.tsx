import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Volume2,
  Shield,
  Cpu,
  Database,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Info,
  Trash2,
  HardDrive,
  Clock
} from 'lucide-react';
import { api, ModelInfo, StorageStats } from '../../services/api';
import { soundService } from '../../services/sound';

interface SettingsViewProps {
  onRefreshAll: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onRefreshAll }) => {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [detectionConf, setDetectionConf] = useState<number>(0.35);
  const [identityThresh, setIdentityThresh] = useState<number>(0.45);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(soundService.enabled);
  const [alertVolume, setAlertVolume] = useState<number>(soundService.volume);
  const [cooldown, setCooldown] = useState<number>(soundService.cooldownSeconds);
  const [modelChoice, setModelChoice] = useState<string>('yolov8_ppe_hansung.pt');
  const [alarmFileName, setAlarmFileName] = useState<string>('WhatsApp Audio 2026-10-08 at 12.24.09.mpeg');
  const [saving, setSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [seeding, setSeeding] = useState<boolean>(false);
  const [cleaning, setCleaning] = useState<boolean>(false);
  const [purging, setPurging] = useState<boolean>(false);

  useEffect(() => {
    loadSettings();
    loadStorage();
  }, []);

  const loadStorage = async () => {
    try {
      const res = await api.getStorageStats();
      if (res?.storage) setStorageStats(res.storage);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunCleanup = async () => {
    setCleaning(true);
    try {
      const res = await api.runCleanup(24.0, 500);
      alert(`FIFO 24-Hour Retention Cleanup Complete!\n\nDeleted Incidents: ${res?.purged?.deleted_incidents || 0}\nDeleted Alerts: ${res?.purged?.deleted_alerts || 0}\nRemoved Disk Snapshots: ${res?.purged?.deleted_snapshots || 0}`);
      await loadStorage();
      onRefreshAll();
    } catch (e) {
      console.error(e);
      alert('Cleanup failed: ' + String(e));
    } finally {
      setCleaning(false);
    }
  };

  const handlePurgeAll = async () => {
    if (!window.confirm('WARNING: Are you sure you want to delete ALL safety incidents, alerts, and snapshot image files? This action cannot be undone.')) {
      return;
    }
    setPurging(true);
    try {
      await api.clearAllIncidents();
      await api.clearAllAlerts();
      alert('All incidents, alerts, and snapshot files have been completely deleted.');
      await loadStorage();
      onRefreshAll();
    } catch (e) {
      console.error(e);
      alert('Purge failed: ' + String(e));
    } finally {
      setPurging(false);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      if (data.model_info) {
        setModelInfo(data.model_info);
        setDetectionConf(data.model_info.detection_confidence);
        setIdentityThresh(data.model_info.identity_threshold);
      }
      if (data.settings) {
        setSoundEnabled(data.settings.sound_alerts_enabled === 'true');
        setAlertVolume(parseFloat(data.settings.alert_volume || '0.8'));
        setCooldown(parseInt(data.settings.alert_cooldown_seconds || '5', 10));
        setModelChoice(data.settings.active_model || 'yolov8_ppe_hansung.pt');
      }
      api.getAlarmInfo().then((res) => {
        if (res?.filename) setAlarmFileName(res.filename);
      }).catch(() => {});
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedSuccess(false);
    try {
      soundService.enabled = soundEnabled;
      soundService.volume = alertVolume;
      soundService.cooldownSeconds = cooldown;

      await api.saveSettings({
        detection_confidence: detectionConf,
        identity_confidence_threshold: identityThresh,
        sound_alerts_enabled: soundEnabled,
        alert_volume: alertVolume,
        alert_cooldown_seconds: cooldown,
        active_model: modelChoice
      });

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
      await loadSettings();
      onRefreshAll();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      await api.seedDemo();
      onRefreshAll();
      alert('Demo workers W-001 (Rahul), W-002 (Amit), W-003 (Raj) seeded successfully!');
    } catch (e) {
      console.error(e);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#F8FAFC]">System Configuration & AI Model Transparency</h1>
        <p className="text-xs text-[#94A3B8] mt-1">
          Tune computer vision confidence thresholds, audible alarms, and review genuine model capabilities.
        </p>
      </div>

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-[#22C55E]/15 border border-[#22C55E]/40 text-[#22C55E] text-xs flex items-center space-x-2">
          <CheckCircle className="w-5 h-5" />
          <span>Configuration parameters saved and applied to running vision services.</span>
        </div>
      )}

      {/* Model Transparency Card */}
      <div className="bg-[#172033] border border-[#00D9FF]/30 rounded-xl p-5 space-y-4">
        <div className="flex items-center space-x-2 pb-3 border-b border-[#263449]">
          <Cpu className="w-5 h-5 text-[#00D9FF]" />
          <h2 className="text-sm font-bold text-[#F8FAFC]">AI Model Transparency & Genuine Class Support</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
            <span className="text-[#94A3B8] block mb-1">Loaded Model Weights File</span>
            <span className="font-mono text-[#00D9FF] font-semibold break-all">
              {modelInfo?.model_file || 'models/yolov8_ppe_hansung.pt'}
            </span>
          </div>

          <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
            <span className="text-[#94A3B8] block mb-1">Worker Face Identity Engine</span>
            <div className="flex items-center space-x-2 text-[#22C55E] font-semibold">
              <CheckCircle className="w-4 h-4" />
              <span>YuNet (Detection) + SFace 128-d (Embeddings) READY</span>
            </div>
          </div>
        </div>

        <div>
          <span className="text-xs font-bold text-[#22C55E] uppercase tracking-wider block mb-2">
            Genuinely Supported Classes by Active Model (No Faking)
          </span>
          <div className="flex flex-wrap gap-2">
            {modelInfo?.supported_classes.map((cls) => (
              <span
                key={cls}
                className="px-2.5 py-1 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-[#22C55E] text-xs font-semibold"
              >
                ✓ {cls}
              </span>
            ))}
          </div>
        </div>

        {modelInfo?.unsupported_classes && modelInfo.unsupported_classes.length > 0 && (
          <div>
            <span className="text-xs font-bold text-[#94A3B8] uppercase tracking-wider block mb-2">
              Unsupported Classes in Active Model (Explicitly Bypassed)
            </span>
            <div className="flex flex-wrap gap-2">
              {modelInfo.unsupported_classes.map((cls) => (
                <span
                  key={cls}
                  className="px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-xs font-medium"
                >
                  Ø {cls} (Not Simulated)
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CV & Identity Parameters */}
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-[#F8FAFC] pb-2 border-b border-[#263449]">
            Vision & Identification Gate
          </h2>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#94A3B8]">PPE Detection Confidence Threshold</span>
              <strong className="text-[#00D9FF]">{Math.round(detectionConf * 100)}%</strong>
            </div>
            <input
              type="range"
              min="0.15"
              max="0.80"
              step="0.05"
              value={detectionConf}
              onChange={(e) => setDetectionConf(parseFloat(e.target.value))}
              className="w-full accent-[#00D9FF]"
            />
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#94A3B8]">Identity Matching Cosine Threshold</span>
              <strong className="text-[#00D9FF]">{identityThresh.toFixed(2)}</strong>
            </div>
            <input
              type="range"
              min="0.30"
              max="0.75"
              step="0.05"
              value={identityThresh}
              onChange={(e) => setIdentityThresh(parseFloat(e.target.value))}
              className="w-full accent-[#00D9FF]"
            />
            <p className="text-[10px] text-[#94A3B8]">
              Faces with cosine score below this threshold safely remain labeled <strong className="text-amber-400">UNKNOWN PERSON</strong>.
            </p>
          </div>

          <div className="space-y-2 text-xs">
            <label className="text-[#94A3B8] block">Select Active YOLO PPE Weights</label>
            <select
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value)}
              className="w-full bg-[#0B1120] border border-[#263449] px-3 py-2 rounded-lg text-[#F8FAFC] outline-none"
            >
              <option value="yolov8_ppe_hansung.pt">yolov8_ppe_hansung.pt (Industrial Helmet & Vest)</option>
              <option value="yolov8_ppe_6class.pt">yolov8_ppe_6class.pt (6-Class Multi-Gear)</option>
            </select>
          </div>
        </div>

        {/* Audio Alerts & Storage */}
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#263449]">
              <h2 className="text-sm font-bold text-[#F8FAFC]">
                Audible Safety Warnings
              </h2>
              <button
                type="button"
                onClick={() => soundService.testAlarm()}
                className="flex items-center space-x-1.5 px-2.5 py-1 text-xs bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 border border-[#00D9FF]/40 text-[#00D9FF] rounded-lg transition"
                title="Play test alarm"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Test Alarm</span>
              </button>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-[#94A3B8]">Alarm Sound Status</span>
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`px-3 py-1 rounded-lg font-bold border transition ${
                  soundEnabled
                    ? 'bg-[#22C55E]/15 border-[#22C55E]/40 text-[#22C55E]'
                    : 'bg-gray-800 text-gray-400 border-gray-700'
                }`}
              >
                {soundEnabled ? 'ENABLED' : 'MUTED'}
              </button>
            </div>

            <div className="p-2.5 rounded-lg bg-[#0F172A] border border-[#1E293B] text-[11px] text-[#94A3B8] space-y-1.5">
              <div className="text-white font-medium flex items-center justify-between">
                <span>Active Alarm File:</span>
                <span className="text-[#22C55E] text-[10px] font-mono px-1.5 py-0.5 bg-[#22C55E]/10 rounded border border-[#22C55E]/30">ALARM FOLDER</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-gray-200 font-mono text-[11px] font-semibold" title={alarmFileName}>
                  {alarmFileName}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    soundService.reloadAlarmAudio();
                    api.getAlarmInfo().then((res) => {
                      if (res?.filename) setAlarmFileName(res.filename);
                    }).catch(() => {});
                  }}
                  className="text-[10px] text-[#00D9FF] hover:underline shrink-0"
                >
                  Reload
                </button>
              </div>
              <p className="text-[10px] text-gray-500">
                Playing file from <span className="text-gray-300 font-mono">Alarm/</span> folder when camera detects missing helmet or vest.
              </p>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Alarm Volume</span>
                <strong className="text-[#00D9FF]">{Math.round(alertVolume * 100)}%</strong>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={alertVolume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setAlertVolume(val);
                  soundService.setVolume(val);
                }}
                className="w-full accent-[#00D9FF]"
              />
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Alarm Cooldown (Debounce)</span>
                <strong className="text-[#00D9FF]">{cooldown}s</strong>
              </div>
              <input
                type="range"
                min="2"
                max="30"
                step="1"
                value={cooldown}
                onChange={(e) => setCooldown(parseInt(e.target.value, 10))}
                className="w-full accent-[#00D9FF]"
              />
              <p className="text-[10px] text-gray-500">
                Prevents repeated alarm spam for the same ongoing violation event.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-[#263449] flex items-center space-x-3">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] font-bold text-xs rounded-lg transition"
            >
              {saving ? 'Applying...' : 'Save Configuration'}
            </button>
            <button
              type="button"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="px-3 py-2.5 bg-[#0B1120] hover:bg-[#1e2c45] border border-[#263449] text-xs font-semibold text-[#00D9FF] rounded-lg transition flex items-center space-x-1.5"
            >
              <Sparkles className="w-4 h-4" />
              <span>Seed Demo Data</span>
            </button>
          </div>
        </div>
      </form>

      {/* 24-Hour FIFO Auto-Purge & Storage Management */}
      <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#263449]">
          <div className="flex items-center space-x-2">
            <HardDrive className="w-5 h-5 text-[#00D9FF]" />
            <h2 className="text-sm font-bold text-[#F8FAFC]">Data Retention & Storage Lifecycle (24-Hour FIFO Policy)</h2>
          </div>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/30 flex items-center space-x-1">
            <Clock className="w-3 h-3" />
            <span>24H FIFO ACTIVE</span>
          </span>
        </div>

        <p className="text-xs text-[#94A3B8]">
          Incident evidence, violation logs, and snapshot images are automatically maintained under a <strong>24-hour FIFO (First-In, First-Out)</strong> retention policy. Records exceeding 24 hours or the maximum capacity limit are permanently evicted to preserve system storage.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
            <span className="text-[#94A3B8] block text-[11px] mb-1">Total Incidents</span>
            <span className="text-lg font-bold text-[#F8FAFC]">{storageStats?.total_incidents ?? '...'}</span>
          </div>
          <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
            <span className="text-[#94A3B8] block text-[11px] mb-1">Total Alerts</span>
            <span className="text-lg font-bold text-[#F8FAFC]">{storageStats?.total_alerts ?? '...'}</span>
          </div>
          <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
            <span className="text-[#94A3B8] block text-[11px] mb-1">Snapshots On Disk</span>
            <span className="text-lg font-bold text-[#00D9FF]">{storageStats?.snapshot_count ?? '...'}</span>
          </div>
          <div className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg">
            <span className="text-[#94A3B8] block text-[11px] mb-1">Disk Usage</span>
            <span className="text-lg font-bold text-[#22C55E]">{storageStats?.snapshot_size_mb ?? 0} MB</span>
          </div>
        </div>

        <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleRunCleanup}
            disabled={cleaning}
            className="px-4 py-2 bg-[#0B1120] hover:bg-[#1e2c45] border border-[#00D9FF]/40 text-xs font-semibold text-[#00D9FF] rounded-lg transition flex items-center space-x-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${cleaning ? 'animate-spin' : ''}`} />
            <span>{cleaning ? 'Evicting Stale Data...' : 'Run 24h FIFO Cleanup Now'}</span>
          </button>

          <button
            type="button"
            onClick={handlePurgeAll}
            disabled={purging}
            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-xs font-semibold text-red-400 rounded-lg transition flex items-center space-x-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{purging ? 'Purging All Records...' : 'Delete All Incidents & Alerts'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
