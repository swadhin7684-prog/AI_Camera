import React, { useState } from 'react';
import {
  Users,
  Search,
  Filter,
  Download,
  Trash2,
  Eye,
  Shield,
  UserCheck,
  AlertOctagon,
  Plus,
  Edit3
} from 'lucide-react';
import { WorkerItem, api } from '../../services/api';

interface WorkersViewProps {
  workers: WorkerItem[];
  onViewProfile: (worker: WorkerItem) => void;
  onEditProfile?: (worker: WorkerItem) => void;
  onNavigateRegister: () => void;
  onRefresh: () => void;
}

export const WorkersView: React.FC<WorkersViewProps> = ({
  workers,
  onViewProfile,
  onEditProfile,
  onNavigateRegister,
  onRefresh
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  const filteredWorkers = workers.filter((w) => {
    const matchesSearch =
      w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.worker_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.department.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesDept = selectedDept === 'ALL' || w.department === selectedDept;
    const matchesStatus = selectedStatus === 'ALL' || w.status === selectedStatus;

    return matchesSearch && matchesDept && matchesStatus;
  });

  const handleDelete = async (workerId: string) => {
    if (!confirm(`Are you sure you want to remove worker ${workerId}?`)) return;
    try {
      await api.deleteWorker(workerId);
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC]">Worker Registry</h1>
          <p className="text-xs text-[#94A3B8] mt-1">
            Registered personnel database with face embeddings and required safety gear profiles.
          </p>
        </div>
        <button
          onClick={onNavigateRegister}
          className="flex items-center space-x-2 px-4 py-2 bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] text-xs font-bold rounded-lg transition shadow-md shadow-[#00D9FF]/20"
        >
          <Plus className="w-4 h-4" />
          <span>Register New Worker</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-[#172033] border border-[#263449] p-3 rounded-xl">
        <div className="sm:col-span-2 relative flex items-center">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3" />
          <input
            type="text"
            placeholder="Search by Worker ID, Name, or Department..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg pl-9 pr-3 py-2 text-xs text-[#F8FAFC] outline-none"
          />
        </div>

        <div>
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
          >
            <option value="ALL">All Departments</option>
            <option value="Welding">Welding</option>
            <option value="Assembly">Assembly</option>
            <option value="Machining">Machining</option>
            <option value="Storage">Warehouse / Storage</option>
            <option value="Electrical">Electrical</option>
          </select>
        </div>

        <div>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full bg-[#0B1120] border border-[#263449] focus:border-[#00D9FF] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
        </div>
      </div>

      {/* Worker List Grid */}
      {filteredWorkers.length === 0 ? (
        <div className="bg-[#172033] border border-[#263449] rounded-xl p-12 text-center text-[#94A3B8]">
          <Users className="w-10 h-10 mx-auto mb-3 text-[#94A3B8]/40" />
          <h2 className="text-sm font-bold text-[#F8FAFC]">No Workers Found</h2>
          <p className="text-xs text-gray-500 mt-1">
            Register a worker or click "Demo Data" in the header to seed demo workers.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkers.map((worker) => (
            <div
              key={worker.worker_id}
              className="bg-[#172033] border border-[#263449] hover:border-[#00D9FF]/40 rounded-xl p-5 flex flex-col justify-between transition group space-y-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-[#0B1120] border border-[#263449] flex items-center justify-center shrink-0">
                    {worker.photo_path ? (
                      <img src={`/${worker.photo_path}`} alt={worker.name} className="w-full h-full object-cover" />
                    ) : (
                      <Users className="w-6 h-6 text-[#00D9FF]" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-sm font-bold text-[#F8FAFC] group-hover:text-[#00D9FF] transition">
                        {worker.name}
                      </h3>
                      {worker.name.includes('Rahul') || worker.name.includes('Amit') || worker.name.includes('Raj') ? (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-400 font-bold border border-amber-500/40">
                          DEMO
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs font-mono text-[#00D9FF]">{worker.worker_id}</div>
                    <div className="text-[11px] text-[#94A3B8]">{worker.department} • {worker.designation}</div>
                  </div>
                </div>

                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  worker.status === 'ACTIVE'
                    ? 'bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30'
                    : 'bg-gray-800 text-gray-400'
                }`}>
                  {worker.status}
                </span>
              </div>

              {/* Required PPE Pills */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-[#94A3B8] uppercase font-bold tracking-wider">
                  Required PPE
                </span>
                <div className="flex flex-wrap gap-1">
                  {worker.required_ppe.map((item) => (
                    <span
                      key={item}
                      className="text-[10px] px-2 py-0.5 rounded bg-[#0B1120] text-[#94A3B8] border border-[#263449]"
                    >
                      {item.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-[#263449] flex items-center justify-between text-xs">
                <button
                  onClick={() => onViewProfile(worker)}
                  className="flex items-center space-x-1.5 text-[#00D9FF] hover:underline font-semibold"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>View Profile</span>
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => (onEditProfile ? onEditProfile(worker) : onViewProfile(worker))}
                    title="Edit Worker Profile"
                    className="p-1.5 bg-[#0B1120] hover:bg-[#00D9FF]/20 border border-[#263449] hover:border-[#00D9FF]/40 rounded-lg text-[#94A3B8] hover:text-[#00D9FF] transition"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={`/api/workers/${worker.worker_id}/qr`}
                    download
                    title="Download Worker QR"
                    className="p-1.5 bg-[#0B1120] hover:bg-[#263449] border border-[#263449] rounded-lg text-[#94A3B8] hover:text-[#00D9FF] transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={() => handleDelete(worker.worker_id)}
                    title="Delete Worker"
                    className="p-1.5 bg-[#0B1120] hover:bg-[#EF4444]/20 border border-[#263449] hover:border-[#EF4444]/40 rounded-lg text-[#94A3B8] hover:text-[#EF4444] transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
