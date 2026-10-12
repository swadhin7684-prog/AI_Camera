import React from 'react';
import {
  LayoutDashboard,
  Video,
  Users,
  UserPlus,
  QrCode,
  Camera,
  Bell,
  AlertTriangle,
  BarChart3,
  Sliders,
  ShieldCheck,
  Radio,
  Film
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'live'
  | 'video_analysis'
  | 'workers'
  | 'register'
  | 'scan_qr'
  | 'cameras'
  | 'alerts'
  | 'incidents'
  | 'analytics'
  | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeViolationsCount: number;
  cameraActive: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  activeViolationsCount,
  cameraActive
}) => {
  const navItems = [
    { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'live' as NavTab, label: 'Live Monitoring', icon: Video, badge: cameraActive ? 'LIVE' : undefined },
    { id: 'video_analysis' as NavTab, label: 'Video Analysis', icon: Film, badge: 'AI' },
    { id: 'workers' as NavTab, label: 'Worker Registry', icon: Users },
    { id: 'register' as NavTab, label: 'Register Worker', icon: UserPlus },
    { id: 'scan_qr' as NavTab, label: 'Scan Worker QR', icon: QrCode },
    { id: 'cameras' as NavTab, label: 'Camera Hub', icon: Camera },
    {
      id: 'alerts' as NavTab,
      label: 'Safety Alerts',
      icon: Bell,
      count: activeViolationsCount > 0 ? activeViolationsCount : undefined
    },
    { id: 'incidents' as NavTab, label: 'Incident History', icon: AlertTriangle },
    { id: 'analytics' as NavTab, label: 'Safety Analytics', icon: BarChart3 },
    { id: 'settings' as NavTab, label: 'System Settings', icon: Sliders },
  ];

  return (
    <aside className="w-64 bg-[#0B1120] border-r border-[#263449] flex flex-col justify-between shrink-0 select-none h-screen">
      <div>
        {/* Logo Section */}
        <div className="p-5 border-b border-[#263449] flex items-center space-x-3 bg-[#0d1527]">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#00D9FF] to-[#0284c7] flex items-center justify-center shadow-lg shadow-[#00D9FF]/20">
            <ShieldCheck className="w-6 h-6 text-[#0B1120]" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-extrabold text-lg tracking-wider text-[#F8FAFC]">SENTINEL</span>
              <span className="font-extrabold text-lg text-[#00D9FF]">X</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/40">AI</span>
            </div>
            <p className="text-[10px] tracking-widest text-[#94A3B8] uppercase font-semibold">Industrial Safety</p>
          </div>
        </div>

        {/* Live Engine Indicator */}
        <div className="px-5 py-3 border-b border-[#263449]/60 flex items-center justify-between text-xs bg-[#172033]/40">
          <div className="flex items-center space-x-2">
            <Radio className={`w-3.5 h-3.5 ${cameraActive ? 'text-[#22C55E] animate-pulse' : 'text-[#94A3B8]'}`} />
            <span className="text-[#94A3B8] font-medium text-[11px]">Edge Vision Engine</span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
            cameraActive ? 'bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30' : 'bg-gray-800 text-gray-400'
          }`}>
            {cameraActive ? 'Active' : 'Standby'}
          </span>
        </div>

        {/* Navigation Links */}
        <nav className="p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-210px)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-[#172033] text-[#00D9FF] border border-[#00D9FF]/40 shadow-sm shadow-[#00D9FF]/10'
                    : 'text-[#94A3B8] hover:bg-[#172033]/60 hover:text-[#F8FAFC]'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#00D9FF]' : 'text-[#94A3B8]'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#EF4444] text-white animate-pulse">
                    {item.badge}
                  </span>
                )}
                {item.count !== undefined && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EF4444] text-white">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-[#263449] bg-[#0d1527] text-xs text-[#94A3B8]">
        <div className="flex items-center justify-between text-[11px] mb-1 font-mono">
          <span>OS: Windows / macOS</span>
          <span className="text-[#00D9FF]">v1.0.0</span>
        </div>
        <div className="text-[10px] text-gray-500 truncate">
          Hackathon Edition • Local Edge
        </div>
      </div>
    </aside>
  );
};
