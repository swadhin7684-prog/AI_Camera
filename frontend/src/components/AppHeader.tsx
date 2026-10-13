import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, ShieldAlert, Sparkles, RefreshCw, Play, Shield, Building2, User } from 'lucide-react';
import { soundService } from '../services/sound';
import { api } from '../services/api';

interface AppHeaderProps {
  activeZone: string;
  activeViolationsCount: number;
  onRefresh?: () => void;
  onOpenProfile?: () => void;
  licenseInfo?: any;
  currentUserEmail?: string | null;
  onLogout?: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeZone,
  activeViolationsCount,
  onRefresh,
  onOpenProfile,
  licenseInfo,
  currentUserEmail,
  onLogout
}) => {
  const [timeStr, setTimeStr] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(soundService.enabled);
  const [seeding, setSeeding] = useState(false);
  const [testingAudio, setTestingAudio] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('en-US', { hour12: false }) + ' UTC');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleSound = () => {
    const nextState = !soundEnabled;
    soundService.enabled = nextState;
    setSoundEnabled(nextState);
    api.saveSettings({ sound_alerts_enabled: nextState });
  };

  const handleTestAudio = () => {
    setTestingAudio(true);
    soundService.startAlarm();
    setTimeout(() => {
      soundService.stopAlarm();
      setTestingAudio(false);
    }, 4000);
  };

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      await api.seedDemo();
      if (onRefresh) onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <header className="h-16 bg-[#0B1120] border-b border-[#263449] px-6 flex items-center justify-between shrink-0 select-none">
      {/* Left: Zone & Status */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2 bg-[#172033] border border-[#263449] px-3 py-1.5 rounded-lg text-xs">
          <span className="text-[#94A3B8]">Zone:</span>
          <span className="font-semibold text-[#00D9FF]">{activeZone || 'Welding Area'}</span>
        </div>

        {activeViolationsCount > 0 ? (
          <div className="flex items-center space-x-2 bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] px-3 py-1.5 rounded-lg text-xs font-semibold animate-pulse">
            <ShieldAlert className="w-4 h-4" />
            <span>{activeViolationsCount} Active PPE Violation{activeViolationsCount > 1 ? 's' : ''}</span>
          </div>
        ) : (
          <div className="flex items-center space-x-2 bg-[#22C55E]/15 border border-[#22C55E]/40 text-[#22C55E] px-3 py-1.5 rounded-lg text-xs font-semibold">
            <span>All Personnel Compliant</span>
          </div>
        )}
      </div>

      {/* Right: Controls & Clock */}
      <div className="flex items-center space-x-3">
        {/* Test Audio Button */}
        <button
          onClick={handleTestAudio}
          disabled={testingAudio}
          title="Play 4-second safety alarm audio test"
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            testingAudio
              ? 'bg-[#22C55E]/15 border-[#22C55E]/40 text-[#22C55E] animate-pulse'
              : 'bg-[#172033] hover:bg-[#1e2c45] border border-[#263449] hover:border-[#00D9FF]/40 text-[#94A3B8] hover:text-[#00D9FF]'
          }`}
        >
          <Play className="w-3.5 h-3.5" />
          <span>{testingAudio ? 'Playing Alarm...' : 'Test Audio'}</span>
        </button>

        {/* Seed Demo Data Button */}
        <button
          onClick={handleSeedDemo}
          disabled={seeding}
          title="Seed Synthetic Demo Workers (W-001, W-002, W-003)"
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#172033] hover:bg-[#1e2c45] border border-[#263449] hover:border-[#00D9FF]/40 rounded-lg text-xs text-[#94A3B8] hover:text-[#00D9FF] transition font-medium"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#00D9FF]" />
          <span>{seeding ? 'Seeding...' : 'Demo Data'}</span>
        </button>

        {/* Audible Alert Sound Toggle */}
        <button
          onClick={toggleSound}
          title={soundEnabled ? 'Audible Safety Alarm ON' : 'Audible Safety Alarm MUTED'}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            soundEnabled
              ? 'bg-[#00D9FF]/10 border-[#00D9FF]/40 text-[#00D9FF]'
              : 'bg-[#172033] border-[#263449] text-gray-500 hover:text-gray-400'
          }`}
        >
          {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>{soundEnabled ? 'Alarm ON' : 'Alarm Muted'}</span>
        </button>

        {/* Refresh button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Refresh Data"
            className="p-1.5 bg-[#172033] hover:bg-[#1e2c45] border border-[#263449] rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        {/* Company License Chip (Clickable to open Profile) */}
        {licenseInfo?.company?.name && (
          <button
            onClick={onOpenProfile}
            title="Click to view Company & Station Profile"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#172033] hover:bg-[#1e2c45] border border-[#263449] hover:border-[#00D9FF]/40 rounded-lg text-xs text-[#E2E8F0] transition cursor-pointer"
          >
            <Building2 className="w-3.5 h-3.5 text-[#00D9FF]" />
            <span className="font-semibold">{licenseInfo.company.name}</span>
            <span className="text-[10px] bg-[#00D9FF]/15 text-[#00D9FF] px-1.5 py-0.5 rounded font-mono font-bold">
              {licenseInfo.company.plan_type || 'Enterprise'}
            </span>
          </button>
        )}

        {/* Profile Button */}
        {onOpenProfile && (
          <button
            onClick={onOpenProfile}
            title="Station & Organization Profile"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#172033] hover:bg-[#1e2c45] border border-[#263449] hover:border-[#00D9FF]/40 rounded-lg text-xs text-[#94A3B8] hover:text-[#00D9FF] transition font-medium"
          >
            <User className="w-3.5 h-3.5 text-[#00D9FF]" />
            <span>Profile</span>
          </button>
        )}



        {/* Operator User Chip & Sign Out */}
        {currentUserEmail && (
          <div className="flex items-center space-x-2 pl-2 border-l border-[#263449]">
            <span className="text-xs text-[#94A3B8] max-w-[140px] truncate" title={currentUserEmail}>
              {currentUserEmail}
            </span>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign Out Operator"
                className="text-[11px] px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-md transition"
              >
                Sign Out
              </button>
            )}
          </div>
        )}

        {/* Live Clock */}
        <div className="font-mono text-xs px-3 py-1.5 bg-[#172033] border border-[#263449] rounded-lg text-[#94A3B8]">
          {timeStr}
        </div>
      </div>
    </header>
  );
};
