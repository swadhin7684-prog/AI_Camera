import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, ShieldAlert, Sparkles, RefreshCw, Play, Shield, Building2 } from 'lucide-react';
import { soundService } from '../services/sound';
import { api } from '../services/api';

interface AppHeaderProps {
  activeZone: string;
  activeViolationsCount: number;
  onRefresh?: () => void;
  onOpenSuperAdmin?: () => void;
  licenseInfo?: any;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeZone,
  activeViolationsCount,
  onRefresh,
  onOpenSuperAdmin,
  licenseInfo
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

        {/* Company License Chip */}
        {licenseInfo?.company?.name && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#172033] border border-[#263449] rounded-lg text-xs text-[#E2E8F0]">
            <Building2 className="w-3.5 h-3.5 text-[#00D9FF]" />
            <span className="font-semibold">{licenseInfo.company.name}</span>
            <span className="text-[10px] bg-[#00D9FF]/15 text-[#00D9FF] px-1.5 py-0.5 rounded font-mono font-bold">
              {licenseInfo.company.plan_type || 'Enterprise'}
            </span>
          </div>
        )}

        {/* Super Admin Switch Button */}
        {onOpenSuperAdmin && (
          <button
            onClick={onOpenSuperAdmin}
            title="Access SentinelX Super Admin Control Plane"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#0EA5E9]/10 hover:bg-[#0EA5E9]/20 border border-[#0EA5E9]/30 rounded-lg text-xs font-semibold text-[#38BDF8] transition"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Super Admin</span>
          </button>
        )}

        {/* Live Clock */}
        <div className="font-mono text-xs px-3 py-1.5 bg-[#172033] border border-[#263449] rounded-lg text-[#94A3B8]">
          {timeStr}
        </div>
      </div>
    </header>
  );
};
