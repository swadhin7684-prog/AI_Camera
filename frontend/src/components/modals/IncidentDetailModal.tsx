import React from 'react';
import { X, AlertTriangle, Camera, User, CheckCircle, Clock, Shield, Trash2 } from 'lucide-react';
import { IncidentItem } from '../../services/api';

interface IncidentDetailModalProps {
  incident: IncidentItem | null;
  onClose: () => void;
  onDelete?: (incidentId: number) => void;
}

export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({ incident, onClose, onDelete }) => {
  if (!incident) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#172033] border border-[#263449] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#263449] flex items-center justify-between bg-[#0d1527]">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-[#EF4444]" />
            <h2 className="text-sm font-bold text-[#F8FAFC]">
              Incident #{incident.id} Evidence & Forensic Record
            </h2>
          </div>
          <div className="flex items-center space-x-3">
            {onDelete && (
              <button
                onClick={() => {
                  if (window.confirm(`Delete Incident #${incident.id} and its image evidence?`)) {
                    onDelete(incident.id);
                    onClose();
                  }
                }}
                className="px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-semibold flex items-center space-x-1 transition"
                title="Delete this incident"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            )}
            <button onClick={onClose} className="text-[#94A3B8] hover:text-[#F8FAFC]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Snapshot Evidence Image */}
          <div className="bg-[#0B1120] border border-[#263449] rounded-xl overflow-hidden aspect-video flex items-center justify-center relative">
            {incident.snapshot_path ? (
              <img
                src={`/${incident.snapshot_path}`}
                alt="Incident Snapshot"
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="text-center p-6 text-[#94A3B8]">
                <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs">No visual snapshot attached</p>
              </div>
            )}
            <div className="absolute top-3 left-3 bg-[#0B1120]/80 backdrop-blur-md px-3 py-1 rounded text-[11px] font-mono text-[#00D9FF] border border-[#00D9FF]/40">
              {incident.camera_id} • {incident.zone}
            </div>
            <div className="absolute top-3 right-3 bg-[#EF4444] text-white px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
              {incident.severity}
            </div>
          </div>

          {/* Incident Meta Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-[#0B1120] border border-[#263449] rounded-xl space-y-2">
              <span className="text-[#94A3B8] font-bold uppercase tracking-wider block">Subject Identity</span>
              <div className="text-sm font-bold text-[#F8FAFC]">
                {incident.worker_id ? `${incident.worker_id} • ${incident.worker_name}` : 'UNKNOWN PERSON'}
              </div>
              <div className="text-[11px] text-[#94A3B8]">
                {incident.worker_id ? (
                  <span>Identity Confidence: <strong className="text-[#00D9FF]">{Math.round((incident.identity_confidence || 0) * 100)}%</strong></span>
                ) : (
                  <span className="text-amber-400">Worker ID = NULL (Unregistered or unverified)</span>
                )}
              </div>
            </div>

            <div className="p-4 bg-[#0B1120] border border-[#263449] rounded-xl space-y-2">
              <span className="text-[#94A3B8] font-bold uppercase tracking-wider block">Duration & Timing</span>
              <div className="text-sm font-bold text-[#F8FAFC]">
                {incident.start_time} - {incident.end_time}
              </div>
              <div className="text-[11px] text-[#94A3B8]">
                Duration: <strong className="text-[#F8FAFC]">{incident.duration_seconds} seconds</strong> • Status: <span className="text-[#22C55E]">{incident.status}</span>
              </div>
            </div>
          </div>

          {/* Missing vs Detected Gear Breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl space-y-2">
              <span className="text-[#EF4444] font-bold uppercase tracking-wider block flex items-center space-x-1.5">
                <AlertTriangle className="w-4 h-4" />
                <span>Missing Safety Gear (Violations)</span>
              </span>
              <div className="space-y-1">
                {incident.missing_ppe.length > 0 ? (
                  incident.missing_ppe.map((item) => (
                    <div key={item} className="text-xs text-[#EF4444] font-semibold">
                      ✗ {item.replace('_', ' ').toUpperCase()} MISSING
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-[#EF4444] font-semibold">{incident.violation_type}</div>
                )}
              </div>
            </div>

            <div className="p-4 bg-[#22C55E]/10 border border-[#22C55E]/30 rounded-xl space-y-2">
              <span className="text-[#22C55E] font-bold uppercase tracking-wider block flex items-center space-x-1.5">
                <CheckCircle className="w-4 h-4" />
                <span>Detected Safety Gear</span>
              </span>
              <div className="space-y-1">
                {incident.detected_ppe.length > 0 ? (
                  incident.detected_ppe.map((item) => (
                    <div key={item} className="text-xs text-[#22C55E]">
                      ✓ {item.replace('_', ' ').toUpperCase()} DETECTED
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-gray-500">None detected</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
