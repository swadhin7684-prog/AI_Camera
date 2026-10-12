export interface WorkerItem {
  worker_id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  department: string;
  designation: string;
  shift: string;
  joining_date?: string;
  photo_path?: string;
  qr_identifier: string;
  required_ppe: string[];
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at: string;
  total_violations?: number;
  recent_incidents?: IncidentItem[];
}

export interface CameraItem {
  camera_id: string;
  name: string;
  zone: string;
  input_type: string;
  source_uri: string;
  is_active: number;
  resolution: string;
  created_at: string;
}

export interface IncidentItem {
  id: number;
  worker_id: string | null;
  worker_name: string | null;
  camera_id: string;
  zone: string;
  violation_type: string;
  detected_ppe: string[];
  missing_ppe: string[];
  start_time: string;
  end_time: string;
  duration_seconds: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  identity_confidence: number;
  detection_confidence: number;
  status: 'ACTIVE' | 'RESOLVED';
  snapshot_path: string;
  created_at: string;
  updated_at: string;
  worker_department?: string;
}

export interface AlertItem {
  id: number;
  incident_id: number;
  worker_id: string | null;
  worker_name: string | null;
  violation: string;
  camera_id: string;
  zone: string;
  severity: string;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  timestamp: string;
}

export interface AnalyticsData {
  total_workers: number;
  active_cameras: number;
  total_incidents: number;
  today_incidents: number;
  active_violations: number;
  compliance_rate: number;
  registered_incidents_count: number;
  unknown_incidents_count: number;
  most_common_violation: string;
  dept_violations: { dept: string; count: number }[];
  type_violations: { violation_type: string; count: number }[];
  worker_violations: { worker_id: string; name: string; count: number }[];
}

export interface StorageStats {
  total_incidents: number;
  total_alerts: number;
  snapshot_count: number;
  snapshot_size_bytes: number;
  snapshot_size_mb: number;
  retention_policy: string;
  retention_hours: number;
  max_fifo_records: number;
}

export interface ModelInfo {
  loaded_model: string;
  model_file: string;
  supported_classes: string[];
  unsupported_classes: string[];
  detection_confidence: number;
  identity_threshold: number;
  face_engine_ready: boolean;
}

export interface TrackedWorkerTelemetry {
  track_id: number;
  worker_id: string | null;
  worker_name: string;
  department?: string;
  designation?: string;
  photo_path?: string;
  identity_confidence: number;
  is_identified: boolean;
  box: [number, number, number, number];
  compliance_score: number;
  is_violation: boolean;
  violations: string[];
  ppe_status: Record<string, { detected: boolean; confidence: number; supported: boolean }>;
  trigger_sound: boolean;
}

export interface TelemetryPayload {
  camera_id: string;
  camera_name: string;
  zone: string;
  is_active: boolean;
  timestamp: string;
  model_choice: string;
  supported_classes: string[];
  tracked_people: TrackedWorkerTelemetry[];
  people_count: number;
  violation_count: number;
}

const API_BASE = '/api';

export const api = {
  // Workers
  getWorkers: async (search?: string, department?: string, status?: string) => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (department && department !== 'ALL') params.append('department', department);
    if (status && status !== 'ALL') params.append('status', status);
    const res = await fetch(`${API_BASE}/workers?${params.toString()}`);
    return res.json() as Promise<{ workers: WorkerItem[] }>;
  },

  getWorker: async (id: string) => {
    const res = await fetch(`${API_BASE}/workers/${id}`);
    return res.json() as Promise<{ worker: WorkerItem }>;
  },

  createWorker: async (data: Record<string, unknown>) => {
    const res = await fetch(`${API_BASE}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Registration failed');
    }
    return res.json() as Promise<{ status: string; worker: WorkerItem }>;
  },

  updateWorker: async (id: string, data: Record<string, unknown>) => {
    const res = await fetch(`${API_BASE}/workers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json() as Promise<{ status: string; worker: WorkerItem }>;
  },

  deleteWorker: async (id: string) => {
    const res = await fetch(`${API_BASE}/workers/${id}`, { method: 'DELETE' });
    return res.json();
  },

  validateFace: async (imageBase64: string) => {
    const res = await fetch(`${API_BASE}/workers/validate-face`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageBase64 })
    });
    return res.json();
  },

  // QR Code
  scanQr: async (imageBase64?: string, qrText?: string) => {
    const res = await fetch(`${API_BASE}/qr/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageBase64, qr_text: qrText })
    });
    return res.json();
  },

  // Cameras
  getCameras: async () => {
    const res = await fetch(`${API_BASE}/cameras`);
    return res.json() as Promise<{ cameras: CameraItem[] }>;
  },

  getAvailableHardware: async () => {
    const res = await fetch(`${API_BASE}/cameras/available`);
    return res.json() as Promise<{ available: { index: string; name: string; resolution: string }[] }>;
  },

  startCamera: async (params: { camera_id?: string; source: string; source_type?: string; conf_thresh?: number; model_choice?: string }) => {
    const res = await fetch(`${API_BASE}/cameras/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return res.json();
  },

  stopCamera: async () => {
    const res = await fetch(`${API_BASE}/cameras/stop`, { method: 'POST' });
    return res.json();
  },

  // Incidents & Alerts
  getIncidents: async (filters?: { worker_id?: string; department?: string; camera_id?: string; severity?: string; status?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters) {
      if (filters.worker_id) params.append('worker_id', filters.worker_id);
      if (filters.department) params.append('department', filters.department);
      if (filters.camera_id) params.append('camera_id', filters.camera_id);
      if (filters.severity) params.append('severity', filters.severity);
      if (filters.status) params.append('status', filters.status);
      if (filters.limit) params.append('limit', filters.limit.toString());
    }
    const res = await fetch(`${API_BASE}/incidents?${params.toString()}`);
    return res.json() as Promise<{ incidents: IncidentItem[] }>;
  },

  getIncident: async (id: number) => {
    const res = await fetch(`${API_BASE}/incidents/${id}`);
    return res.json() as Promise<{ incident: IncidentItem }>;
  },

  getAlerts: async (status?: string) => {
    const params = new URLSearchParams();
    if (status && status !== 'ALL') params.append('status', status);
    const res = await fetch(`${API_BASE}/alerts?${params.toString()}`);
    return res.json() as Promise<{ alerts: AlertItem[] }>;
  },

  updateAlertStatus: async (id: number, status: string) => {
    const res = await fetch(`${API_BASE}/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    return res.json();
  },

  deleteIncident: async (id: number) => {
    const res = await fetch(`${API_BASE}/incidents/${id}`, { method: 'DELETE' });
    return res.json();
  },

  clearAllIncidents: async () => {
    const res = await fetch(`${API_BASE}/incidents`, { method: 'DELETE' });
    return res.json();
  },

  deleteAlert: async (id: number) => {
    const res = await fetch(`${API_BASE}/alerts/${id}`, { method: 'DELETE' });
    return res.json();
  },

  clearAllAlerts: async () => {
    const res = await fetch(`${API_BASE}/alerts`, { method: 'DELETE' });
    return res.json();
  },

  getStorageStats: async () => {
    const res = await fetch(`${API_BASE}/storage-stats`);
    return res.json() as Promise<{ storage: StorageStats }>;
  },

  runCleanup: async (retentionHours: number = 24.0, maxRecords: number = 500) => {
    const res = await fetch(`${API_BASE}/cleanup?retention_hours=${retentionHours}&max_fifo_records=${maxRecords}`, {
      method: 'POST'
    });
    return res.json();
  },

  // Analytics & Settings
  getAnalytics: async () => {
    const res = await fetch(`${API_BASE}/analytics`);
    return res.json() as Promise<{ analytics: AnalyticsData }>;
  },

  getSettings: async () => {
    const res = await fetch(`${API_BASE}/settings`);
    return res.json() as Promise<{ settings: Record<string, string>; model_info: ModelInfo }>;
  },

  saveSettings: async (settings: Record<string, unknown>) => {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    return res.json();
  },

  seedDemo: async () => {
    const res = await fetch(`${API_BASE}/demo/seed`, { method: 'POST' });
    return res.json();
  },

  getAlarmInfo: async () => {
    const res = await fetch(`${API_BASE}/alarm-info`);
    return res.json() as Promise<{ filename: string | null; size: number; exists: boolean }>;
  },

  // Recorded Video Safety Analysis
  uploadVideo: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/video-analysis/upload`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail || 'Failed to upload video');
    }
    return res.json() as Promise<{ status: string; metadata: VideoMetadata }>;
  },

  startVideoAnalysis: async (params: {
    file_path: string;
    model_choice?: string;
    conf_thresh?: number;
    identity_thresh?: number;
    required_ppe?: string[];
    frame_step?: number;
    zone_name?: string;
  }) => {
    const res = await fetch(`${API_BASE}/video-analysis/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to start analysis' }));
      throw new Error(err.detail || 'Failed to start video analysis');
    }
    return res.json();
  },

  pauseVideoAnalysis: async () => {
    const res = await fetch(`${API_BASE}/video-analysis/pause`, { method: 'POST' });
    return res.json();
  },

  resumeVideoAnalysis: async () => {
    const res = await fetch(`${API_BASE}/video-analysis/resume`, { method: 'POST' });
    return res.json();
  },

  cancelVideoAnalysis: async () => {
    const res = await fetch(`${API_BASE}/video-analysis/cancel`, { method: 'POST' });
    return res.json();
  },

  getVideoAnalysisStatus: async () => {
    const res = await fetch(`${API_BASE}/video-analysis/status`);
    return res.json() as Promise<VideoAnalysisStatus>;
  },

  getVideoAnalysisResults: async () => {
    const res = await fetch(`${API_BASE}/video-analysis/results`);
    return res.json() as Promise<VideoAnalysisResults>;
  },

  getVideoAnalysisHistory: async () => {
    const res = await fetch(`${API_BASE}/video-analysis/history`);
    return res.json() as Promise<{ history: any[] }>;
  },

  deleteVideoAnalysisHistory: async (id: number) => {
    const res = await fetch(`${API_BASE}/video-analysis/history/${id}`, { method: 'DELETE' });
    return res.json();
  }
};

export interface VideoMetadata {
  filename: string;
  file_path: string;
  file_size_bytes: number;
  file_size_formatted: string;
  width: number;
  height: number;
  resolution: string;
  fps: number;
  total_frames: number;
  duration_seconds: number;
  formatted_duration: string;
  relative_path?: string;
  is_readable: boolean;
}

export interface VideoAnalysisStatus {
  status: 'IDLE' | 'ANALYZING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'ERROR';
  analysis_id: number | null;
  filename: string | null;
  current_frame: number;
  total_frames: number;
  processed_frames: number;
  progress_percent: number;
  current_video_timestamp: string;
  duration_seconds: number;
  formatted_duration: string;
  processing_fps: number;
  unique_people_count: number;
  identified_workers_count: number;
  unknown_persons_count: number;
  confirmed_violations_count: number;
  violations_by_type: Record<string, number>;
  uncertain_count: number;
  is_paused: boolean;
  error_message: string | null;
}

export interface VideoAnalysisTimelineItem {
  incident_id: number;
  video_timestamp: string;
  end_timestamp: string;
  video_time_sec: number;
  duration_seconds: number;
  actor_type: 'REGISTERED_WORKER' | 'UNKNOWN_PERSON';
  worker_id: string | null;
  worker_name: string;
  violation_type: string;
  missing_ppe: string[];
  detected_ppe: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  snapshot_path: string;
  created_at: string;
}

export interface VideoAnalysisResults {
  analysis_id: number | null;
  filename: string | null;
  file_path: string | null;
  status: string;
  total_duration_seconds: number;
  formatted_duration: string;
  total_frames: number;
  processed_frames: number;
  coverage_pct: number;
  unique_people_count: number;
  identified_workers: { worker_id: string; name: string }[];
  identified_workers_count: number;
  unknown_persons_count: number;
  confirmed_violations_count: number;
  violations_by_type: Record<string, number>;
  uncertain_count: number;
  timeline: VideoAnalysisTimelineItem[];
  error_message: string | null;
}

