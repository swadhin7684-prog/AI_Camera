import React, { useState } from 'react';
import { AlertTriangle, Search, Filter, Camera, Eye, Calendar, Clock, CheckCircle, Trash2 } from 'lucide-react';
import { IncidentItem } from '../../services/api';

interface IncidentsViewProps {
  incidents: IncidentItem[];
  onViewDetail: (incident: IncidentItem) => void;
  onDeleteIncident?: (incidentId: number) => void;
  onClearAllIncidents?: () => void;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({
  incidents,
  onViewDetail,
  onDeleteIncident,
  onClearAllIncidents
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState('ALL');
  const [selectedActor, setSelectedActor] = useState('ALL'); // ALL, REGISTERED, UNKNOWN

  const filtered = incidents.filter((inc) => {
    const matchesSearch =
      (inc.worker_name || 'UNKNOWN PERSON').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inc.worker_id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.violation_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.camera_id.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesSeverity = selectedSeverity === 'ALL' || inc.severity === selectedSeverity;

    const matchesActor =
      selectedActor === 'ALL' ||
      (selectedActor === 'REGISTERED' && inc.worker_id !== null) ||
      (selectedActor === 'UNKNOWN' && inc.worker_id === null);

    return matchesSearch && matchesSeverity && matchesActor;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC]">Incident Forensic History</h1>
          <p className="text-xs text-[#94A3B8] mt-1">
            Complete de-duplicated incident log with visual snapshot evidence from SQLite.
          </p>
        </div>

        {incidents.length > 0 && (
          <button
            onClick={() => {
              if (window.confirm('Are you sure you want to delete ALL forensic incident records and snapshot images?')) {
                onClearAllIncidents?.();
              }
            }}
            className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
            title="Delete all incidents and images"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear All Incidents</span>
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-[#172033] border border-[#263449] p-3 rounded-xl">
        <div className="sm:col-span-2 relative flex items-center">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3" />
          <input
            type="text"
            placeholder="Search by Worker, Violation, or Camera ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg pl-9 pr-3 py-2 text-xs text-[#F8FAFC] outline-none"
          />
        </div>

        <div>
          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
          >
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
        </div>

        <div>
          <select
            value={selectedActor}
            onChange={(e) => setSelectedActor(e.target.value)}
            className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
          >
            <option value="ALL">All Personnel</option>
            <option value="REGISTERED">Registered Workers Only</option>
            <option value="UNKNOWN">Unknown Persons Only</option>
          </select>
        </div>
      </div>

      {/* Incidents Table / Cards */}
      {filtered.length === 0 ? (
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-12 text-center text-[#94A3B8]">
          <CheckCircle className="w-10 h-10 mx-auto mb-3 text-[#22C55E]/40" />
          <h2 className="text-sm font-bold text-[#F8FAFC]">No Incidents Found</h2>
          <p className="text-xs text-gray-500 mt-1">
            No safety violation records match the specified query filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((inc) => {
            const isUnknown = !inc.worker_id;
            return (
              <div
                key={inc.id}
                onClick={() => onViewDetail(inc)}
                className="bg-[#172033] border border-[#263449] hover:border-[#00D9FF]/40 rounded-xl overflow-hidden cursor-pointer transition group flex flex-col justify-between"
              >
                {/* Snapshot Thumbnail */}
                <div className="relative aspect-video bg-[#0B1120] border-b border-[#263449] overflow-hidden flex items-center justify-center">
                  {inc.snapshot_path ? (
                    <img
                      src={`/${inc.snapshot_path}`}
                      alt="Snapshot"
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                  ) : (
                    <Camera className="w-8 h-8 text-[#94A3B8]/40" />
                  )}
                  <div className="absolute top-2 left-2 bg-[#0B1120]/80 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-[#00D9FF]">
                    #{inc.id} • {inc.camera_id}
                  </div>
                  <div className={`absolute top-2 right-2 px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                    inc.severity === 'CRITICAL' || inc.severity === 'HIGH'
                      ? 'bg-[#EF4444] text-white'
                      : 'bg-amber-500 text-black'
                  }`}>
                    {inc.severity}
                  </div>
                </div>

                {/* Details */}
                <div className="p-4 space-y-2.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-[#EF4444] line-clamp-1">
                      {inc.violation_type}
                    </h3>
                    <div className="text-xs font-semibold text-[#F8FAFC] mt-1">
                      {isUnknown ? (
                        <span className="text-amber-400">UNKNOWN PERSON</span>
                      ) : (
                        <span>{inc.worker_id} • {inc.worker_name}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#94A3B8] mt-0.5">
                      Zone: {inc.zone} • Duration: {inc.duration_seconds}s
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#263449] flex items-center justify-between text-[11px] text-[#94A3B8]">
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3 text-[#00D9FF]" />
                      <span>{inc.start_time}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete Incident #${inc.id} and its snapshot image?`)) {
                            onDeleteIncident?.(inc.id);
                          }
                        }}
                        className="p-1 text-[#94A3B8] hover:text-red-400 hover:bg-red-500/10 rounded transition"
                        title="Delete incident"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[#00D9FF] flex items-center space-x-1 group-hover:underline">
                        <Eye className="w-3.5 h-3.5" />
                        <span>Review</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
