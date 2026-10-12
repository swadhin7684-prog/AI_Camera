import React, { useState } from 'react';
import { Bell, AlertTriangle, CheckCircle, Eye, ShieldAlert, Filter, Trash2 } from 'lucide-react';
import { AlertItem, api } from '../../services/api';

interface AlertsViewProps {
  alerts: AlertItem[];
  onAlertStatusChange: (alertId: number, status: string) => void;
  onViewIncident: (incidentId: number) => void;
  onDeleteAlert?: (alertId: number) => void;
  onClearAllAlerts?: () => void;
}

export const AlertsView: React.FC<AlertsViewProps> = ({
  alerts,
  onAlertStatusChange,
  onViewIncident,
  onDeleteAlert,
  onClearAllAlerts
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const filteredAlerts = alerts.filter((a) => {
    if (filterStatus === 'ALL') return true;
    return a.status === filterStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC]">Safety Alert Center</h1>
          <p className="text-xs text-[#94A3B8] mt-1">
            Real-time notifications for PPE compliance infringements and zone security violations.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Filter buttons */}
          <div className="flex items-center space-x-2 bg-[#172033] border border-[#263449] p-1 rounded-xl text-xs">
            {['ALL', 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  filterStatus === st
                    ? 'bg-[#00D9FF] text-[#0B1120] font-bold shadow-sm'
                    : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {alerts.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to delete ALL alerts?')) {
                  onClearAllAlerts?.();
                }
              }}
              className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
              title="Delete all alerts"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-12 text-center text-[#94A3B8]">
          <CheckCircle className="w-10 h-10 mx-auto mb-3 text-[#22C55E]/40" />
          <h2 className="text-sm font-bold text-[#F8FAFC]">No Alerts in this category</h2>
          <p className="text-xs text-gray-500 mt-1">
            Safety compliance is optimal or all alerts have been resolved.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAlerts.map((alert) => {
            const isUnknown = !alert.worker_id;
            return (
              <div
                key={alert.id}
                className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 transition ${
                  alert.status === 'ACTIVE'
                    ? 'bg-[#EF4444]/10 border-[#EF4444]/40 shadow-sm shadow-[#EF4444]/5'
                    : 'bg-[#172033] border-[#263449]'
                }`}
              >
                <div className="flex items-center space-x-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    alert.status === 'ACTIVE'
                      ? 'bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/40'
                      : 'bg-[#0B1120] text-[#94A3B8] border border-[#263449]'
                  }`}>
                    <ShieldAlert className="w-5 h-5" />
                  </div>

                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-[#EF4444]">{alert.violation}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        alert.severity === 'CRITICAL' || alert.severity === 'HIGH'
                          ? 'bg-[#EF4444]/20 text-[#EF4444]'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {alert.severity}
                      </span>
                    </div>

                    <div className="text-xs text-[#F8FAFC] mt-0.5 font-semibold">
                      Subject: {isUnknown ? (
                        <span className="text-amber-400 font-bold">UNKNOWN PERSON (Unregistered)</span>
                      ) : (
                        <span>{alert.worker_id} • {alert.worker_name}</span>
                      )}
                    </div>

                    <div className="text-[11px] text-[#94A3B8] mt-0.5">
                      Camera: {alert.camera_id} • Zone: {alert.zone} • {alert.timestamp}
                    </div>
                  </div>
                </div>

                {/* Status & Actions */}
                <div className="flex items-center space-x-2">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-md tracking-wider uppercase ${
                    alert.status === 'ACTIVE'
                      ? 'bg-[#EF4444] text-white animate-pulse'
                      : alert.status === 'ACKNOWLEDGED'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/30'
                  }`}>
                    {alert.status}
                  </span>

                  {alert.status === 'ACTIVE' && (
                    <button
                      onClick={() => onAlertStatusChange(alert.id, 'ACKNOWLEDGED')}
                      className="px-3 py-1.5 bg-[#172033] hover:bg-[#263449] border border-[#00D9FF]/30 text-xs font-semibold text-[#00D9FF] rounded-lg transition"
                    >
                      Acknowledge
                    </button>
                  )}

                  {alert.status !== 'RESOLVED' && (
                    <button
                      onClick={() => onAlertStatusChange(alert.id, 'RESOLVED')}
                      className="px-3 py-1.5 bg-[#22C55E]/20 hover:bg-[#22C55E]/30 border border-[#22C55E]/40 text-xs font-semibold text-[#22C55E] rounded-lg transition"
                    >
                      Resolve
                    </button>
                  )}

                  <button
                    onClick={() => onViewIncident(alert.incident_id)}
                    className="p-2 bg-[#0B1120] hover:bg-[#1e2c45] border border-[#263449] text-[#94A3B8] hover:text-[#00D9FF] rounded-lg transition"
                    title="View Incident Evidence"
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => {
                      if (window.confirm('Delete this alert record?')) {
                        onDeleteAlert?.(alert.id);
                      }
                    }}
                    className="p-2 bg-[#0B1120] hover:bg-red-500/20 border border-[#263449] hover:border-red-500/40 text-[#94A3B8] hover:text-red-400 rounded-lg transition"
                    title="Delete Alert"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
