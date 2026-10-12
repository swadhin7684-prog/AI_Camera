import React from 'react';
import {
  Users,
  Camera,
  Activity,
  AlertOctagon,
  Calendar,
  Percent,
  UserX,
  ShieldCheck,
  ArrowRight,
  Eye,
  CheckCircle2
} from 'lucide-react';
import { AnalyticsData, AlertItem, TelemetryPayload } from '../../services/api';
import { NavTab } from '../Sidebar';

interface DashboardViewProps {
  analytics: AnalyticsData | null;
  telemetry: TelemetryPayload | null;
  alerts: AlertItem[];
  onNavigate: (tab: NavTab) => void;
  onAlertStatusChange: (alertId: number, status: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  analytics,
  telemetry,
  alerts,
  onNavigate,
  onAlertStatusChange
}) => {
  const stats = [
    {
      title: 'TOTAL REGISTERED WORKERS',
      value: analytics?.total_workers ?? 0,
      icon: Users,
      color: 'text-[#00D9FF]',
      borderColor: 'border-[#00D9FF]/30',
      bgColor: 'bg-[#00D9FF]/5',
      sub: 'Persisted in SQLite'
    },
    {
      title: 'ACTIVE CAMERAS',
      value: telemetry?.is_active ? 1 : (analytics?.active_cameras ?? 0),
      icon: Camera,
      color: 'text-[#22C55E]',
      borderColor: 'border-[#22C55E]/30',
      bgColor: 'bg-[#22C55E]/5',
      sub: telemetry?.camera_name || 'CAM-01 Welding'
    },
    {
      title: 'CURRENTLY DETECTED PEOPLE',
      value: telemetry?.people_count ?? 0,
      icon: Activity,
      color: 'text-[#00D9FF]',
      borderColor: 'border-[#00D9FF]/30',
      bgColor: 'bg-[#00D9FF]/5',
      sub: 'Live Runtime Tracking'
    },
    {
      title: 'ACTIVE PPE VIOLATIONS',
      value: telemetry?.violation_count ?? (analytics?.active_violations ?? 0),
      icon: AlertOctagon,
      color: 'text-[#EF4444]',
      borderColor: 'border-[#EF4444]/40',
      bgColor: 'bg-[#EF4444]/10',
      sub: (telemetry?.violation_count ?? 0) > 0 ? 'Action Required' : 'Zone Secure'
    },
    {
      title: "TODAY'S INCIDENTS",
      value: analytics?.today_incidents ?? 0,
      icon: Calendar,
      color: 'text-[#F59E0B]',
      borderColor: 'border-[#F59E0B]/30',
      bgColor: 'bg-[#F59E0B]/5',
      sub: 'De-duplicated events'
    },
    {
      title: 'PPE COMPLIANCE RATE',
      value: `${analytics?.compliance_rate ?? 100}%`,
      icon: Percent,
      color: (analytics?.compliance_rate ?? 100) >= 80 ? 'text-[#22C55E]' : 'text-[#EF4444]',
      borderColor: 'border-[#22C55E]/30',
      bgColor: 'bg-[#22C55E]/5',
      sub: 'Calculated from DB'
    },
    {
      title: 'UNKNOWN PERSONS DETECTED',
      value: analytics?.unknown_incidents_count ?? 0,
      icon: UserX,
      color: 'text-[#F59E0B]',
      borderColor: 'border-[#F59E0B]/30',
      bgColor: 'bg-[#F59E0B]/5',
      sub: 'Strict unlinked events'
    },
    {
      title: 'TOTAL LOGGED INCIDENTS',
      value: analytics?.total_incidents ?? 0,
      icon: ShieldCheck,
      color: 'text-[#94A3B8]',
      borderColor: 'border-[#263449]',
      bgColor: 'bg-[#172033]',
      sub: 'Continuous incident log'
    },
  ];

  const recentAlerts = alerts.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#F8FAFC]">Industrial Safety Command Center</h1>
          <p className="text-xs text-[#94A3B8] mt-1">
            Real-time Edge AI Monitoring • Computer Vision Powered • Zero Mock Data
          </p>
        </div>
        <button
          onClick={() => onNavigate('live')}
          className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-[#00D9FF] to-[#0284c7] hover:brightness-110 text-[#0B1120] font-semibold text-xs rounded-lg transition shadow-lg shadow-[#00D9FF]/20"
        >
          <span>Open Live Monitoring</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* 8 Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className={`p-4 rounded-xl bg-[#172033] border ${item.borderColor} ${item.bgColor} relative overflow-hidden flex flex-col justify-between`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-bold tracking-wider text-[#94A3B8] uppercase">
                  {item.title}
                </span>
                <div className={`p-2 rounded-lg bg-[#0B1120]/60 ${item.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-1">
                <div className={`text-2xl font-extrabold tracking-tight ${item.color}`}>
                  {item.value}
                </div>
                <div className="text-[10px] text-[#94A3B8] mt-1 font-medium">
                  {item.sub}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Middle Section: Active Tracked Personnel & Real-Time Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active People on Camera View (2 cols) */}
        <div className="lg:col-span-2 bg-[#172033] border border-[#263449] rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-[#263449]">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-[#00D9FF]" />
              <h2 className="text-sm font-bold text-[#F8FAFC]">Active Monitored Personnel</h2>
            </div>
            <span className="text-xs text-[#94A3B8]">
              {telemetry?.tracked_people.length ?? 0} Detected on Feed
            </span>
          </div>

          <div className="mt-4 flex-1 overflow-y-auto space-y-3 min-h-[220px]">
            {(!telemetry?.tracked_people || telemetry.tracked_people.length === 0) ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[#94A3B8]">
                <Camera className="w-8 h-8 mb-2 text-[#94A3B8]/40" />
                <p className="text-xs">No personnel currently detected in the monitored camera frame.</p>
                <p className="text-[11px] text-gray-500 mt-1">Start camera feed in Live Monitoring to stream.</p>
              </div>
            ) : (
              telemetry.tracked_people.map((person) => {
                const isIdentified = person.is_identified;
                const isViolation = person.is_violation;
                return (
                  <div
                    key={person.track_id}
                    className={`p-3.5 rounded-lg border flex items-center justify-between transition ${
                      isViolation
                        ? 'bg-[#EF4444]/10 border-[#EF4444]/40'
                        : 'bg-[#0B1120] border-[#263449]'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs ${
                        isIdentified
                          ? 'bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/40'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      }`}>
                        {isIdentified ? 'W' : '?'}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-[#F8FAFC]">
                            {isIdentified ? `${person.worker_id} • ${person.worker_name}` : 'UNKNOWN PERSON'}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#172033] text-[#94A3B8] font-mono border border-[#263449]">
                            Track #{person.track_id}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#94A3B8] mt-0.5">
                          {isIdentified ? (
                            <span>Identity Confidence: <strong className="text-[#00D9FF]">{Math.round(person.identity_confidence * 100)}%</strong></span>
                          ) : (
                            <span className="text-amber-400/90 font-medium">Unregistered or face unverified</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      {isViolation ? (
                        <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-[#EF4444] text-white tracking-wide">
                          {person.violations.join(', ') || 'NON-COMPLIANT'}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/40">
                          ALL PPE COMPLIANT
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Real-time Alerts Panel (1 col) */}
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-[#263449]">
            <div className="flex items-center space-x-2">
              <AlertOctagon className="w-4 h-4 text-[#EF4444]" />
              <h2 className="text-sm font-bold text-[#F8FAFC]">Recent Safety Alerts</h2>
            </div>
            <button
              onClick={() => onNavigate('alerts')}
              className="text-xs text-[#00D9FF] hover:underline"
            >
              View All
            </button>
          </div>

          <div className="mt-4 flex-1 overflow-y-auto space-y-3 min-h-[220px]">
            {recentAlerts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#94A3B8]">
                <CheckCircle2 className="w-8 h-8 mb-2 text-[#22C55E]/40" />
                <p className="text-xs">No active alerts recorded.</p>
              </div>
            ) : (
              recentAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-3 rounded-lg bg-[#0B1120] border border-[#263449] text-xs flex flex-col space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#EF4444] truncate">{alert.violation}</span>
                    <span className="text-[10px] font-mono text-[#94A3B8]">{alert.timestamp.split(' ')[1] || alert.timestamp}</span>
                  </div>
                  <div className="text-[11px] text-[#94A3B8]">
                    Worker: <strong className="text-[#F8FAFC]">{alert.worker_name || 'UNKNOWN PERSON'}</strong>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-gray-500">{alert.zone} • {alert.camera_id}</span>
                    <div className="flex items-center space-x-1">
                      {alert.status === 'ACTIVE' && (
                        <button
                          onClick={() => onAlertStatusChange(alert.id, 'ACKNOWLEDGED')}
                          className="px-2 py-0.5 rounded bg-[#172033] hover:bg-[#263449] text-[10px] text-[#00D9FF] border border-[#00D9FF]/30 transition"
                        >
                          Ack
                        </button>
                      )}
                      <button
                        onClick={() => onNavigate('incidents')}
                        title="View Incident Evidence"
                        className="p-1 text-[#94A3B8] hover:text-[#00D9FF]"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
