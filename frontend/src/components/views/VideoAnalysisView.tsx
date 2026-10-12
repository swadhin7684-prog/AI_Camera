import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  Play,
  Pause,
  Square,
  Film,
  CheckCircle,
  XCircle,
  AlertTriangle,
  UserCheck,
  UserX,
  Clock,
  HardDrive,
  Maximize2,
  Sliders,
  Shield,
  Layers,
  ChevronRight,
  Eye,
  RefreshCw,
  FileVideo,
  X
} from 'lucide-react';
import {
  api,
  VideoMetadata,
  VideoAnalysisStatus,
  VideoAnalysisResults,
  VideoAnalysisTimelineItem
} from '../../services/api';

export const VideoAnalysisView: React.FC = () => {
  // File & Upload state
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);

  // Configuration state
  const [selectedModel, setSelectedModel] = useState<string>('hansung');
  const [confThresh, setConfThresh] = useState<number>(0.35);
  const [frameStep, setFrameStep] = useState<number>(3); // 3 = ~10 FPS inference
  const [requiredPPE, setRequiredPPE] = useState<string[]>(['helmet', 'safety_vest']);

  // Processing state
  const [status, setStatus] = useState<VideoAnalysisStatus | null>(null);
  const [results, setResults] = useState<VideoAnalysisResults | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Snapshot modal
  const [previewSnapshot, setPreviewSnapshot] = useState<string | null>(null);
  const [previewIncident, setPreviewIncident] = useState<VideoAnalysisTimelineItem | null>(null);

  // HTML5 Video element ref for seeking
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pollTimerRef = useRef<any>(null);

  // Available PPE checklist options based on current models
  const availablePPEOptions = [
    { id: 'helmet', label: 'Safety Helmet' },
    { id: 'safety_vest', label: 'High-Visibility Vest' },
    { id: 'gloves', label: 'Protective Gloves' },
    { id: 'safety_shoes', label: 'Safety Footwear' },
    { id: 'eye_protection', label: 'Eye Protection / Goggles' }
  ];

  // Poll processing status while analyzing or paused
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await api.getVideoAnalysisStatus();
        setStatus(res);
        setIsAnalyzing(res.status === 'ANALYZING' || res.status === 'PAUSED');
        setIsPaused(res.status === 'PAUSED');

        if (res.status === 'COMPLETED' || res.status === 'CANCELLED' || res.status === 'ERROR') {
          // Fetch final results summary
          const resSummary = await api.getVideoAnalysisResults();
          setResults(resSummary);
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      } catch (err) {
        console.error('Error fetching video analysis status:', err);
      }
    };

    if (isAnalyzing) {
      pollTimerRef.current = setInterval(fetchStatus, 800);
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isAnalyzing]);

  // Initial status check on component mount
  useEffect(() => {
    api.getVideoAnalysisStatus()
      .then((st) => {
        setStatus(st);
        if (st.status === 'ANALYZING' || st.status === 'PAUSED') {
          setIsAnalyzing(true);
          setIsPaused(st.status === 'PAUSED');
        } else if (st.status === 'COMPLETED') {
          api.getVideoAnalysisResults().then(setResults).catch(console.error);
        }
      })
      .catch(console.error);
  }, []);

  const handleFileSelect = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const res = await api.uploadVideo(file);
      setMetadata(res.metadata);
      setResults(null);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload video');
    } finally {
      setUploading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleStartAnalysis = async () => {
    if (!metadata) return;
    try {
      setUploadError(null);
      await api.startVideoAnalysis({
        file_path: metadata.file_path,
        model_choice: selectedModel,
        conf_thresh: confThresh,
        required_ppe: requiredPPE,
        frame_step: frameStep,
        zone_name: 'Recorded Video Analysis'
      });
      setIsAnalyzing(true);
      setIsPaused(false);
      setResults(null);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to start video analysis');
    }
  };

  const handlePauseAnalysis = async () => {
    try {
      await api.pauseVideoAnalysis();
      setIsPaused(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResumeAnalysis = async () => {
    try {
      await api.resumeVideoAnalysis();
      setIsPaused(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancelAnalysis = async () => {
    try {
      await api.cancelVideoAnalysis();
      setIsAnalyzing(false);
      setIsPaused(false);
      const resSummary = await api.getVideoAnalysisResults();
      setResults(resSummary);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSeekVideo = (timestampSec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timestampSec;
      videoRef.current.play().catch(() => {});
    }
  };

  const togglePPE = (id: string) => {
    setRequiredPPE((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  // Video streaming/preview URL
  const videoFileUrl = metadata
    ? `/api/video-analysis/video-file?path=${encodeURIComponent(metadata.file_path)}`
    : '';

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-[#172033] border border-[#263449] p-5 rounded-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-lg bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/30">
            <Film className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#F8FAFC]">Recorded Video Safety Analysis</h1>
            <p className="text-xs text-[#94A3B8]">
              Automated AI inspection of industrial workplace footage • Worker identification & multi-person PPE compliance
            </p>
          </div>
        </div>

        {/* Status Badge */}
        {status && status.status !== 'IDLE' && (
          <div className="flex items-center space-x-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 ${
                status.status === 'ANALYZING'
                  ? 'bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/40 animate-pulse'
                  : status.status === 'PAUSED'
                  ? 'bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/40'
                  : status.status === 'COMPLETED'
                  ? 'bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/40'
                  : 'bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/40'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-current"></span>
              <span>{status.status}</span>
            </span>
          </div>
        )}
      </div>

      {/* Upload & Setup Section (when no video uploaded or resetting) */}
      {!metadata && (
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200 ${
            dragActive
              ? 'border-[#00D9FF] bg-[#00D9FF]/5'
              : 'border-[#263449] bg-[#0B1120]/60 hover:border-[#00D9FF]/50'
          }`}
        >
          <div className="max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-[#00D9FF]/10 text-[#00D9FF] flex items-center justify-center mx-auto border border-[#00D9FF]/30 shadow-lg shadow-[#00D9FF]/10">
              <Upload className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-[#F8FAFC]">Upload Factory Footage for Safety Inspection</h3>
              <p className="text-xs text-[#94A3B8] mt-1">
                Drag and drop your recorded MP4, AVI, MOV, or MKV file here, or browse from local disk
              </p>
            </div>

            {uploadError && (
              <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg text-xs text-[#EF4444] flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            <div>
              <label className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-[#00D9FF] hover:bg-[#00c4e6] text-[#0B1120] font-bold text-sm cursor-pointer shadow-lg shadow-[#00D9FF]/20 transition-all">
                <FileVideo className="w-4 h-4" />
                <span>{uploading ? 'Validating & Uploading...' : 'Select Video File'}</span>
                <input
                  type="file"
                  accept="video/mp4,video/avi,video/quicktime,video/x-matroska,.mp4,.avi,.mov,.mkv"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />
              </label>
            </div>

            <p className="text-[11px] text-[#94A3B8]/60">
              Supported Formats: MP4 (H.264), AVI, MOV, MKV • Local AI processing with zero cloud transmission
            </p>
          </div>
        </div>
      )}

      {/* Main Workspace (when metadata is loaded) */}
      {metadata && (
        <div className="space-y-6">
          {/* Video Metadata Card */}
          <div className="bg-[#172033] border border-[#263449] p-4 rounded-xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-[#00D9FF]/10 text-[#00D9FF]">
                <FileVideo className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-[#F8FAFC] text-sm">{metadata.filename}</h4>
                <p className="text-xs text-[#94A3B8]">
                  {metadata.resolution} • {metadata.fps} FPS • {metadata.file_size_formatted} • Duration: {metadata.formatted_duration}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {!isAnalyzing && (
                <button
                  onClick={() => {
                    setMetadata(null);
                    setResults(null);
                    setStatus(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#263449] hover:bg-[#324560] text-xs font-semibold text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
                >
                  Change Video
                </button>
              )}
            </div>
          </div>

          {/* Configuration & Controls Panel */}
          <div className="bg-[#172033] border border-[#263449] p-5 rounded-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#263449] pb-3">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-[#00D9FF]" />
                <span className="font-bold text-sm text-[#F8FAFC]">AI Safety Inspection Parameters</span>
              </div>
              <span className="text-xs text-[#94A3B8]">Fine-tune model and policy rules prior to inspection</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* PPE Model Choice */}
              <div>
                <label className="text-xs font-semibold text-[#94A3B8] block mb-1.5">Vision Model Architecture</label>
                <select
                  disabled={isAnalyzing}
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-[#0B1120] border border-[#263449] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#00D9FF]"
                >
                  <option value="hansung">YOLOv8 Dual PPE + Person (Hansung)</option>
                  <option value="6class">YOLOv8 6-Class Full PPE Model</option>
                </select>
              </div>

              {/* Frame Sampling Rate */}
              <div>
                <label className="text-xs font-semibold text-[#94A3B8] block mb-1.5">Inference Sampling Speed</label>
                <select
                  disabled={isAnalyzing}
                  value={frameStep}
                  onChange={(e) => setFrameStep(Number(e.target.value))}
                  className="w-full bg-[#0B1120] border border-[#263449] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#00D9FF]"
                >
                  <option value={1}>Full Coverage (Every frame • 30 FPS)</option>
                  <option value={3}>Standard Balanced (10 FPS Sampling - Stride 3)</option>
                  <option value={6}>High Speed (5 FPS Sampling - Stride 6)</option>
                </select>
              </div>

              {/* Confidence Threshold */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-[#94A3B8] mb-1.5">
                  <span>Detection Confidence</span>
                  <span className="text-[#00D9FF] font-bold">{Math.round(confThresh * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.20"
                  max="0.80"
                  step="0.05"
                  disabled={isAnalyzing}
                  value={confThresh}
                  onChange={(e) => setConfThresh(parseFloat(e.target.value))}
                  className="w-full accent-[#00D9FF] cursor-pointer"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-end space-x-2">
                {!isAnalyzing ? (
                  <button
                    onClick={handleStartAnalysis}
                    className="w-full py-2.5 px-4 rounded-lg bg-[#00D9FF] hover:bg-[#00c4e6] text-[#0B1120] font-bold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-[#00D9FF]/20 transition-all"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Start Safety Analysis</span>
                  </button>
                ) : (
                  <div className="w-full flex items-center space-x-2">
                    {isPaused ? (
                      <button
                        onClick={handleResumeAnalysis}
                        className="flex-1 py-2 px-3 rounded-lg bg-[#22C55E] hover:bg-[#1eb054] text-white font-bold text-xs flex items-center justify-center space-x-1"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Resume</span>
                      </button>
                    ) : (
                      <button
                        onClick={handlePauseAnalysis}
                        className="flex-1 py-2 px-3 rounded-lg bg-[#F59E0B] hover:bg-[#e09009] text-[#0B1120] font-bold text-xs flex items-center justify-center space-x-1"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        <span>Pause</span>
                      </button>
                    )}
                    <button
                      onClick={handleCancelAnalysis}
                      className="py-2 px-3 rounded-lg bg-[#EF4444] hover:bg-[#dc2626] text-white font-bold text-xs flex items-center justify-center space-x-1"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Required PPE Policy Checkboxes */}
            <div className="pt-2 border-t border-[#263449]/60">
              <label className="text-xs font-semibold text-[#94A3B8] block mb-2">
                Mandatory PPE Safety Policy for Uploaded Video (Unknown Persons fallback)
              </label>
              <div className="flex flex-wrap gap-2.5">
                {availablePPEOptions.map((opt) => {
                  const active = requiredPPE.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => togglePPE(opt.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center space-x-1.5 ${
                        active
                          ? 'bg-[#00D9FF]/10 text-[#00D9FF] border-[#00D9FF]/40 font-semibold'
                          : 'bg-[#0B1120] text-[#94A3B8] border-[#263449] hover:border-[#94A3B8]/40'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${active ? 'bg-[#00D9FF]' : 'bg-gray-600'}`}></span>
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Progress Bar (Visible while analyzing or paused) */}
          {status && (isAnalyzing || status.status === 'COMPLETED') && (
            <div className="bg-[#172033] border border-[#263449] p-4 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-[#F8FAFC]">
                    {status.status === 'COMPLETED' ? 'Analysis Complete' : 'Processing Video Frames...'}
                  </span>
                  <span className="text-[#00D9FF] font-semibold">({status.progress_percent}%)</span>
                </div>
                <div className="flex items-center space-x-4 text-[#94A3B8]">
                  <span>
                    Timestamp: <strong className="text-[#F8FAFC]">{status.current_video_timestamp}</strong> / {status.formatted_duration}
                  </span>
                  <span>
                    Frames: {status.processed_frames} / {status.total_frames}
                  </span>
                  <span>Speed: {status.processing_fps} FPS</span>
                </div>
              </div>

              {/* Animated Progress Bar */}
              <div className="w-full h-2.5 bg-[#0B1120] rounded-full overflow-hidden border border-[#263449]">
                <div
                  className={`h-full transition-all duration-300 ${
                    status.status === 'COMPLETED'
                      ? 'bg-[#22C55E]'
                      : 'bg-gradient-to-r from-[#0284c7] to-[#00D9FF]'
                  }`}
                  style={{ width: `${status.progress_percent}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Interactive Workspace Split View */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 Columns: Video Inspection View */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-[#0B1120] border border-[#263449] rounded-xl overflow-hidden relative shadow-2xl min-h-[380px] flex items-center justify-center">
                {isAnalyzing ? (
                  // Active Processing Stream
                  <div className="relative w-full h-full flex items-center justify-center bg-black">
                    <img
                      src="/api/video-analysis/preview-stream"
                      alt="AI Video Analysis Preview"
                      className="w-full max-h-[460px] object-contain"
                    />
                    <div className="absolute top-3 right-3 bg-[#0B1120]/80 backdrop-blur-md px-2.5 py-1 rounded text-[11px] font-bold text-[#00D9FF] border border-[#00D9FF]/40 flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#00D9FF] animate-ping"></span>
                      <span>LIVE AI INFERENCE</span>
                    </div>
                  </div>
                ) : (
                  // Native HTML5 Video Player for inspection & seeking
                  <video
                    ref={videoRef}
                    src={videoFileUrl}
                    controls
                    className="w-full max-h-[460px] object-contain"
                  />
                )}
              </div>

              <p className="text-xs text-[#94A3B8] italic">
                * Note: Video timeline incidents can be clicked below to immediately seek the video player to that timestamp.
              </p>
            </div>

            {/* Right 5 Columns: Summary Metrics & Breakdown */}
            <div className="lg:col-span-5 space-y-4">
              {/* Metric Cards Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#172033] border border-[#263449] p-3.5 rounded-xl">
                  <div className="flex items-center space-x-2 text-[#94A3B8] text-xs">
                    <UserCheck className="w-4 h-4 text-[#00D9FF]" />
                    <span>Unique People</span>
                  </div>
                  <div className="text-2xl font-black text-[#F8FAFC] mt-1">
                    {status?.unique_people_count ?? results?.unique_people_count ?? 0}
                  </div>
                  <div className="text-[11px] text-[#94A3B8] mt-0.5">
                    {status?.identified_workers_count ?? results?.identified_workers_count ?? 0} identified •{' '}
                    {status?.unknown_persons_count ?? results?.unknown_persons_count ?? 0} unknown
                  </div>
                </div>

                <div className="bg-[#172033] border border-[#263449] p-3.5 rounded-xl">
                  <div className="flex items-center space-x-2 text-[#94A3B8] text-xs">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                    <span>PPE Violations</span>
                  </div>
                  <div className="text-2xl font-black text-[#EF4444] mt-1">
                    {status?.confirmed_violations_count ?? results?.confirmed_violations_count ?? 0}
                  </div>
                  <div className="text-[11px] text-[#94A3B8] mt-0.5">Confirmed events</div>
                </div>

                <div className="bg-[#172033] border border-[#263449] p-3.5 rounded-xl">
                  <div className="flex items-center space-x-2 text-[#94A3B8] text-xs">
                    <UserX className="w-4 h-4 text-[#F59E0B]" />
                    <span>Unknown People</span>
                  </div>
                  <div className="text-2xl font-black text-[#F59E0B] mt-1">
                    {status?.unknown_persons_count ?? results?.unknown_persons_count ?? 0}
                  </div>
                  <div className="text-[11px] text-[#94A3B8] mt-0.5">Monitored via policy</div>
                </div>

                <div className="bg-[#172033] border border-[#263449] p-3.5 rounded-xl">
                  <div className="flex items-center space-x-2 text-[#94A3B8] text-xs">
                    <Eye className="w-4 h-4 text-[#94A3B8]" />
                    <span>Uncertain Items</span>
                  </div>
                  <div className="text-2xl font-black text-[#94A3B8] mt-1">
                    {status?.uncertain_count ?? results?.uncertain_count ?? 0}
                  </div>
                  <div className="text-[11px] text-[#94A3B8] mt-0.5">Insufficient visual clarity</div>
                </div>
              </div>

              {/* Identified Workers Card */}
              <div className="bg-[#172033] border border-[#263449] p-4 rounded-xl space-y-2">
                <span className="text-xs font-bold text-[#F8FAFC] uppercase tracking-wider block">
                  Identified Registered Personnel
                </span>
                {results?.identified_workers && results.identified_workers.length > 0 ? (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {results.identified_workers.map((w, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-[#0B1120] border border-[#263449] text-xs"
                      >
                        <span className="font-semibold text-[#F8FAFC]">{w.name}</span>
                        <span className="text-[11px] text-[#00D9FF] font-mono">{w.worker_id}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#94A3B8] italic">
                    No registered workers detected yet. All observed persons marked as UNKNOWN PERSON.
                  </p>
                )}
              </div>

              {/* Violation Types Breakdown */}
              <div className="bg-[#172033] border border-[#263449] p-4 rounded-xl space-y-2">
                <span className="text-xs font-bold text-[#F8FAFC] uppercase tracking-wider block">
                  Violations by Category
                </span>
                {status?.violations_by_type && Object.keys(status.violations_by_type).length > 0 ? (
                  <div className="space-y-1.5">
                    {Object.entries(status.violations_by_type).map(([k, count], idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-[#0B1120] border border-[#263449] text-xs"
                      >
                        <span className="text-[#EF4444] font-medium">{k}</span>
                        <span className="px-2 py-0.5 rounded bg-[#EF4444]/20 text-[#EF4444] font-bold">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#94A3B8] italic">No confirmed violations recorded.</p>
                )}
              </div>
            </div>
          </div>

          {/* Chronological Incident Timeline */}
          <div className="bg-[#172033] border border-[#263449] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#263449] pb-3">
              <div className="flex items-center space-x-2">
                <Clock className="w-5 h-5 text-[#00D9FF]" />
                <h3 className="font-bold text-base text-[#F8FAFC]">Video Safety Incident Timeline</h3>
              </div>
              <span className="text-xs text-[#94A3B8]">
                {results?.timeline?.length || 0} debounced violation events
              </span>
            </div>

            {results?.timeline && results.timeline.length > 0 ? (
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-2">
                {results.timeline.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[#0B1120] border border-[#263449] hover:border-[#00D9FF]/50 transition-all cursor-pointer group"
                    onClick={() => {
                      setPreviewSnapshot(item.snapshot_path);
                      setPreviewIncident(item);
                      handleSeekVideo(item.video_time_sec);
                    }}
                  >
                    {/* Timestamp & Identity */}
                    <div className="flex items-center space-x-3">
                      <div className="px-2.5 py-1 rounded bg-[#00D9FF]/10 text-[#00D9FF] font-mono font-bold text-xs border border-[#00D9FF]/30">
                        {item.video_timestamp}
                      </div>

                      <div>
                        <div className="flex items-center space-x-2">
                          <span
                            className={`font-bold text-sm ${
                              item.actor_type === 'REGISTERED_WORKER' ? 'text-[#00D9FF]' : 'text-[#F59E0B]'
                            }`}
                          >
                            {item.worker_name}
                          </span>
                          {item.worker_id && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-mono">
                              {item.worker_id}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#EF4444] font-medium mt-0.5">
                          {item.violation_type}
                        </p>
                      </div>
                    </div>

                    {/* PPE Badges & Snapshot preview */}
                    <div className="flex items-center space-x-3">
                      <div className="hidden sm:flex items-center space-x-1.5">
                        {item.missing_ppe.map((m, mIdx) => (
                          <span
                            key={mIdx}
                            className="text-[10px] px-2 py-0.5 rounded bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/40 font-semibold"
                          >
                            Missing {m.replace('_', ' ')}
                          </span>
                        ))}
                      </div>

                      {item.snapshot_path && (
                        <div className="w-12 h-12 rounded-lg overflow-hidden border border-[#263449] bg-black shrink-0 relative group-hover:border-[#00D9FF]">
                          <img
                            src={`/${item.snapshot_path}`}
                            alt="Incident Snapshot"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}

                      <ChevronRight className="w-4 h-4 text-[#94A3B8] group-hover:text-[#00D9FF] transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-[#94A3B8] border border-dashed border-[#263449] rounded-xl">
                {isAnalyzing
                  ? 'Analyzing video frames... Detected incidents will appear here in chronological sequence.'
                  : 'No confirmed PPE violations detected in this recorded video.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* High-Resolution Snapshot Inspection Modal */}
      {previewSnapshot && previewIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#172033] border border-[#263449] rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between border-b border-[#263449] pb-3">
              <div>
                <h3 className="font-bold text-base text-[#F8FAFC]">Recorded Incident Snapshot</h3>
                <p className="text-xs text-[#94A3B8]">
                  Video Timestamp: {previewIncident.video_timestamp} • {previewIncident.worker_name}
                </p>
              </div>
              <button
                onClick={() => {
                  setPreviewSnapshot(null);
                  setPreviewIncident(null);
                }}
                className="p-1 rounded-lg hover:bg-[#263449] text-[#94A3B8] hover:text-[#F8FAFC]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl overflow-hidden border border-[#263449] bg-black">
              <img
                src={`/${previewSnapshot}`}
                alt="Enlarged Violation Snapshot"
                className="w-full max-h-[400px] object-contain"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-xs">
                <span className="text-[#94A3B8]">Violation: </span>
                <strong className="text-[#EF4444]">{previewIncident.violation_type}</strong>
              </div>

              <button
                onClick={() => {
                  handleSeekVideo(previewIncident.video_time_sec);
                  setPreviewSnapshot(null);
                  setPreviewIncident(null);
                }}
                className="px-4 py-2 rounded-lg bg-[#00D9FF] hover:bg-[#00c4e6] text-[#0B1120] font-bold text-xs flex items-center space-x-1.5 shadow-md shadow-[#00D9FF]/20"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Seek Video to {previewIncident.video_timestamp}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
