import React, { useState } from 'react';
import { Camera, Plus, Trash2, CheckCircle, Video, Settings, Play } from 'lucide-react';
import { CameraItem, api } from '../../services/api';

interface CamerasViewProps {
  cameras: CameraItem[];
  availableHardware: { index: string; name: string; resolution: string }[];
  onRefresh: () => void;
  onSelectCamera: (cameraId: string) => void;
}

export const CamerasView: React.FC<CamerasViewProps> = ({
  cameras,
  availableHardware,
  onRefresh,
  onSelectCamera
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCam, setNewCam] = useState({
    camera_id: '',
    name: '',
    zone: 'Welding Area',
    input_type: 'webcam',
    source_uri: '0',
    resolution: '1280x720'
  });

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCam.camera_id.trim() || !newCam.name.trim()) return;
    try {
      await fetch('/api/cameras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCam)
      });
      setShowAddModal(false);
      setNewCam({
        camera_id: '',
        name: '',
        zone: 'Welding Area',
        input_type: 'webcam',
        source_uri: '0',
        resolution: '1280x720'
      });
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (camId: string) => {
    if (!confirm(`Delete camera ${camId}?`)) return;
    try {
      await fetch(`/api/cameras/${camId}`, { method: 'DELETE' });
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC]">Camera & Sensor Hub</h1>
          <p className="text-xs text-[#94A3B8] mt-1">
            Manage factory floor optical feeds, hardware device bindings, and zone assignments.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] text-xs font-bold rounded-lg transition"
        >
          <Plus className="w-4 h-4" />
          <span>Register New Camera</span>
        </button>
      </div>

      {/* Available Hardware Devices Notice */}
      <div className="bg-[#172033] border border-[#263449] p-4 rounded-xl">
        <h2 className="text-xs font-bold text-[#94A3B8] uppercase tracking-wider mb-2">
          Connected Hardware Devices Detected
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {availableHardware.map((hw) => (
            <div key={hw.index} className="p-3 bg-[#0B1120] border border-[#263449] rounded-lg text-xs">
              <div className="font-semibold text-[#F8FAFC]">{hw.name}</div>
              <div className="text-[11px] text-[#00D9FF] font-mono mt-0.5">Index: {hw.index} • {hw.resolution}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Registered Cameras Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cameras.map((cam) => (
          <div
            key={cam.camera_id}
            className="bg-[#172033] border border-[#263449] rounded-xl p-5 flex flex-col justify-between space-y-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-3 rounded-xl bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/30">
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#F8FAFC]">{cam.name}</h3>
                  <div className="text-xs font-mono text-[#00D9FF]">{cam.camera_id}</div>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                cam.is_active
                  ? 'bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/40'
                  : 'bg-gray-800 text-gray-400'
              }`}>
                {cam.is_active ? 'ACTIVE' : 'STANDBY'}
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-[#94A3B8] bg-[#0B1120] p-3 rounded-lg border border-[#263449]">
              <div>Zone: <strong className="text-[#F8FAFC]">{cam.zone}</strong></div>
              <div>Source: <code className="text-[#00D9FF]">{cam.source_uri}</code></div>
              <div>Resolution: {cam.resolution}</div>
            </div>

            <div className="pt-2 flex items-center justify-between text-xs border-t border-[#263449]">
              <button
                onClick={() => onSelectCamera(cam.camera_id)}
                className="flex items-center space-x-1.5 text-[#00D9FF] hover:underline font-semibold"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Switch to this Feed</span>
              </button>

              <button
                onClick={() => handleDelete(cam.camera_id)}
                className="text-gray-500 hover:text-[#EF4444]"
                title="Remove Camera"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Camera Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#172033] border border-[#263449] rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-sm font-bold text-[#F8FAFC]">Register New Optical Camera</h2>
            <form onSubmit={handleAddCamera} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#94A3B8] mb-1">Camera ID (e.g. CAM-04)</label>
                <input
                  type="text"
                  required
                  value={newCam.camera_id}
                  onChange={(e) => setNewCam({ ...newCam, camera_id: e.target.value.toUpperCase() })}
                  className="w-full bg-[#0B1120] border border-[#263449] px-3 py-2 rounded-lg text-[#F8FAFC] outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-[#94A3B8] mb-1">Camera Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Packaging Area Cam"
                  value={newCam.name}
                  onChange={(e) => setNewCam({ ...newCam, name: e.target.value })}
                  className="w-full bg-[#0B1120] border border-[#263449] px-3 py-2 rounded-lg text-[#F8FAFC] outline-none"
                />
              </div>

              <div>
                <label className="block text-[#94A3B8] mb-1">Assigned Zone</label>
                <input
                  type="text"
                  value={newCam.zone}
                  onChange={(e) => setNewCam({ ...newCam, zone: e.target.value })}
                  className="w-full bg-[#0B1120] border border-[#263449] px-3 py-2 rounded-lg text-[#F8FAFC] outline-none"
                />
              </div>

              <div>
                <label className="block text-[#94A3B8] mb-1">Source Index / URI (0, 1, or video path)</label>
                <input
                  type="text"
                  value={newCam.source_uri}
                  onChange={(e) => setNewCam({ ...newCam, source_uri: e.target.value })}
                  className="w-full bg-[#0B1120] border border-[#263449] px-3 py-2 rounded-lg text-[#F8FAFC] outline-none font-mono"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 bg-[#0B1120] text-[#94A3B8] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#00D9FF] hover:bg-[#00c2e6] text-[#0B1120] font-bold rounded-lg"
                >
                  Save Camera
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
