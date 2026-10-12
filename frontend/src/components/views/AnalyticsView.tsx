import React from 'react';
import {
  BarChart3,
  TrendingDown,
  ShieldCheck,
  Percent,
  Users,
  AlertTriangle,
  Building,
  UserCheck,
  UserX
} from 'lucide-react';
import { AnalyticsData } from '../../services/api';

interface AnalyticsViewProps {
  analytics: AnalyticsData | null;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ analytics }) => {
  if (!analytics) {
    return (
      <div className="p-8 text-center text-[#94A3B8]">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 animate-spin text-[#00D9FF]" />
        <span>Loading safety analytics from SQLite database...</span>
      </div>
    );
  }

  const maxDeptCount = Math.max(1, ...analytics.dept_violations.map((d) => d.count));
  const maxTypeCount = Math.max(1, ...analytics.type_violations.map((t) => t.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#F8FAFC]">Industrial Safety Analytics</h1>
        <p className="text-xs text-[#94A3B8] mt-1">
          Forensic safety indicators computed deterministically from stored SQLite incidents.
        </p>
      </div>

      {/* Top 4 KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#172033] border border-[#22C55E]/30 p-5 rounded-xl">
          <div className="flex items-center justify-between text-xs text-[#94A3B8] mb-2 font-bold uppercase">
            <span>Overall Compliance</span>
            <Percent className="w-4 h-4 text-[#22C55E]" />
          </div>
          <div className="text-3xl font-extrabold text-[#22C55E]">{analytics.compliance_rate}%</div>
          <span className="text-[10px] text-gray-500 mt-1 block">Live compliance metric</span>
        </div>

        <div className="bg-[#172033] border border-[#EF4444]/30 p-5 rounded-xl">
          <div className="flex items-center justify-between text-xs text-[#94A3B8] mb-2 font-bold uppercase">
            <span>Violations Today</span>
            <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
          </div>
          <div className="text-3xl font-extrabold text-[#EF4444]">{analytics.today_incidents}</div>
          <span className="text-[10px] text-gray-500 mt-1 block">Total events since 00:00</span>
        </div>

        <div className="bg-[#172033] border border-[#00D9FF]/30 p-5 rounded-xl">
          <div className="flex items-center justify-between text-xs text-[#94A3B8] mb-2 font-bold uppercase">
            <span>Total Enrolled Staff</span>
            <Users className="w-4 h-4 text-[#00D9FF]" />
          </div>
          <div className="text-3xl font-extrabold text-[#00D9FF]">{analytics.total_workers}</div>
          <span className="text-[10px] text-gray-500 mt-1 block">Workers with face profiles</span>
        </div>

        <div className="bg-[#172033] border border-amber-500/30 p-5 rounded-xl">
          <div className="flex items-center justify-between text-xs text-[#94A3B8] mb-2 font-bold uppercase">
            <span>Most Frequent Missing</span>
            <ShieldCheck className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-base font-bold text-amber-400 truncate">{analytics.most_common_violation}</div>
          <span className="text-[10px] text-gray-500 mt-1 block">Top safety infringement</span>
        </div>
      </div>

      {/* Breakdown Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Violations by Department */}
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 space-y-4">
          <div className="flex items-center space-x-2 pb-3 border-b border-[#263449]">
            <Building className="w-4 h-4 text-[#00D9FF]" />
            <h2 className="text-sm font-bold text-[#F8FAFC]">Violations by Department</h2>
          </div>

          <div className="space-y-3">
            {analytics.dept_violations.length === 0 ? (
              <p className="text-xs text-gray-500 py-4 text-center">No departmental violations recorded yet.</p>
            ) : (
              analytics.dept_violations.map((d) => {
                const pct = Math.round((d.count / maxDeptCount) * 100);
                return (
                  <div key={d.dept} className="space-y-1 text-xs">
                    <div className="flex justify-between text-[#F8FAFC] font-semibold">
                      <span>{d.dept}</span>
                      <span className="text-[#00D9FF]">{d.count} events</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#0B1120] overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#00D9FF] to-[#0284c7] rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Violations by Type */}
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 space-y-4">
          <div className="flex items-center space-x-2 pb-3 border-b border-[#263449]">
            <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
            <h2 className="text-sm font-bold text-[#F8FAFC]">Violations by Gear Category</h2>
          </div>

          <div className="space-y-3">
            {analytics.type_violations.length === 0 ? (
              <p className="text-xs text-gray-500 py-4 text-center">No category violations recorded yet.</p>
            ) : (
              analytics.type_violations.map((t) => {
                const pct = Math.round((t.count / maxTypeCount) * 100);
                return (
                  <div key={t.violation_type} className="space-y-1 text-xs">
                    <div className="flex justify-between text-[#F8FAFC] font-semibold">
                      <span className="truncate max-w-[260px]">{t.violation_type}</span>
                      <span className="text-[#EF4444]">{t.count} events</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#0B1120] overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#EF4444] to-[#f97316] rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Identity Distribution: Registered vs Unknown */}
      <div className="bg-[#172033] border border-[#263449] rounded-xl p-5">
        <h2 className="text-sm font-bold text-[#F8FAFC] pb-3 border-b border-[#263449] mb-4">
          Personnel Identity Association Distribution
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-[#0B1120] border border-[#00D9FF]/30 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-[#00D9FF]/20 text-[#00D9FF] flex items-center justify-center">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-[#94A3B8] font-bold uppercase">Registered Workers Incidents</span>
                <div className="text-xl font-extrabold text-[#F8FAFC]">{analytics.registered_incidents_count}</div>
              </div>
            </div>
            <span className="text-xs text-[#00D9FF] font-semibold">Worker ID Linked</span>
          </div>

          <div className="p-4 bg-[#0B1120] border border-amber-500/30 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <UserX className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-[#94A3B8] font-bold uppercase">Unknown / Unregistered Persons</span>
                <div className="text-xl font-extrabold text-[#F8FAFC]">{analytics.unknown_incidents_count}</div>
              </div>
            </div>
            <span className="text-xs text-amber-400 font-semibold">worker_id = NULL</span>
          </div>
        </div>
      </div>
    </div>
  );
};
