# SENTINELX AI
### Industrial Worker Safety & PPE Monitoring System

> **Cross-Platform Edge AI Desktop Application for Real-Time PPE Compliance, Person Tracking, and Facial Worker Identity Verification**

---

## 1. System Architecture Overview

SENTINELX AI is an industrial-grade computer vision safety platform designed to monitor personnel in manufacturing, construction, and hazardous plant environments.

```
                    SENTINELX AI DESKTOP APP (Electron)
                                    │
             ┌──────────────────────┴──────────────────────┐
             │                                             │
      React UI (Tailwind)                           Local Python AI
   • Dark Industrial Theme                     FastAPI (127.0.0.1:8000)
   • Real-Time Telemetry WS                                │
   • WebAudio Synthesizer                     ┌────────────┴────────────┐
   • Live Canvas Bounding Boxes               │                         │
             │                           SQLite DB                  OpenCV + YOLO
             │                         (sentinelx.db)                   │
             │                                              ┌───────────┴───────────┐
             │                                              │                       │
             └────────────── REST / WebSocket ──────────────┤  • YOLOv8 PPE / Person│
                                                            │  • IoU Multi-Tracker  │
                                                            │  • YuNet Face Detect  │
                                                            │  • SFace Embedding    │
                                                            │  • Spatial Association│
                                                            └───────────────────────┘
```

The system strictly decouples and enforces three distinct runtime concepts:
1. **Person Detection**: Human presence bounded by YOLO.
2. **Person Tracking**: Temporal continuity via IoU + Centroid spatial tracker yielding temporary runtime IDs (`Track #17`).
3. **Worker Identification**: Facial region localization $\rightarrow$ YuNet detection $\rightarrow$ 128-dimensional SFace embedding extraction $\rightarrow$ Cosine similarity matching against registered workers in SQLite.

> **Crucial Rule**: Track IDs are **never** assumed to be Worker IDs. When face quality is degraded (small, distant, occluded, or similarity score $< 0.45$), the subject is strictly classified as **UNKNOWN PERSON** (`worker_id = NULL`). PPE compliance checking continues independently.

---

## 2. Technology Stack

| Layer | Technologies |
|---|---|
| **Desktop Shell** | Electron 44, Node.js 24 |
| **Frontend UI** | React 18, TypeScript, Tailwind CSS v4, Lucide Icons |
| **Local AI Engine** | Python 3.14, FastAPI, Uvicorn, PyTorch, Ultralytics YOLOv8 |
| **Vision & Face ID** | OpenCV 5.0 (`FaceDetectorYN` YuNet + `FaceRecognizerSF` SFace) |
| **QR Code Engine** | Python `qrcode` (Generation) + OpenCV `QRCodeDetector` (Live Hardware Scanning) |
| **Local Database** | SQLite 3 (`sentinelx.db`) with WAL mode, JSON serialization, and Foreign Key constraints |
| **Audio Warning** | Web Audio API dual-tone industrial siren + SpeechSynthesis |

---

## 3. Database Schema (`sentinelx.db`)

- **`workers`**: `worker_id` (PK, Unique), `name`, `address`, `phone`, `email`, `department`, `designation`, `shift`, `joining_date`, `photo_path`, `qr_identifier` (Unique), `required_ppe` (JSON array), `status` (ACTIVE/INACTIVE), `created_at`, `updated_at`.
- **`worker_identity`**: `id` (PK), `worker_id` (FK $\rightarrow$ workers, UNIQUE), `face_embedding` (BLOB, 128-float SFace vector), `embedding_dim`, `quality_score`, `created_at`.
- **`cameras`**: `camera_id` (PK), `name`, `zone`, `input_type`, `source_uri`, `is_active`, `resolution`, `created_at`.
- **`zones`**: `zone_id` (PK), `name`, `default_required_ppe` (JSON array), `severity_level`.
- **`incidents`**: `id` (PK), `worker_id` (Nullable FK $\rightarrow$ workers; strictly `NULL` for unregistered/unknown persons), `worker_name` (Nullable), `camera_id`, `zone`, `violation_type`, `detected_ppe`, `missing_ppe`, `start_time`, `end_time`, `duration_seconds`, `severity`, `identity_confidence`, `detection_confidence`, `status` (`ACTIVE`/`RESOLVED`), `snapshot_path`, `created_at`, `updated_at`.
- **`alerts`**: `id` (PK), `incident_id` (FK $\rightarrow$ incidents), `worker_id`, `worker_name`, `violation`, `camera_id`, `zone`, `severity`, `status` (`ACTIVE`/`ACKNOWLEDGED`/`RESOLVED`), `timestamp`.
- **`application_settings`**: Key-value table for detection confidence, identity thresholds, audio cooldown, and model selections.

---

## 4. AI Models & Supported Classes

### 1. Object & PPE Detection Models
- **`yolov8_ppe_hansung.pt`** (Default):
  - **Supported canonical classes**: `helmet` (Hardhat), `safety_vest` (Safety Vest), `mask` (Mask), `person` (Person).
  - Also detects explicit negative classes: `no_helmet`, `no_safety_vest`, `no_mask`.
- **`yolov8_ppe_6class.pt`**:
  - **Supported canonical classes**: `helmet`, `safety_vest`, `gloves`, `safety_shoes`, `mask`, `goggles`.
- **`yolov8n.pt`**: Base COCO fallback (`person`).

### 2. Facial Identity Models (100% Local ONNX Execution)
- **`face_detection_yunet.onnx`**: OpenCV Zoo YuNet face detector with landmark estimation.
- **`face_recognition_sface.onnx`**: OpenCV Zoo SFace face recognizer generating 128-d normalized embeddings.

---

## 5. Development & Execution Instructions

### Prerequisites
1. **Python 3.10+** (Tested on Python 3.14)
2. **Node.js 18+** (Tested on Node.js v24.19)
3. **Conda or Pip** with packages installed:
   ```bash
   pip install fastapi uvicorn opencv-python ultralytics torch torchvision pillow qrcode
   ```

### Running in Development Mode
You can run both backend and frontend concurrently:
```bash
# Option A: Run Full App in Electron Window (Recommended)
npm run electron:dev

# Option B: Run Web + AI Backend for browser development
npm run dev
# Backend starts at: http://127.0.0.1:8000
# Frontend dev server starts at: http://localhost:5173
```

---

## 6. Build Instructions

### Building for Windows
To compile the frontend and package the standalone Windows executable (`.exe`):
```bash
# 1. Build the production React bundle
npm run build:frontend

# 2. Package unpacked directory for instant testing
npx electron-builder --dir

# 3. Create standalone NSIS Setup Installer & Portable EXE
npm run dist:win
```
The output executable will be generated under:
`dist-desktop/win-unpacked/SentinelX AI.exe` and `dist-desktop/SentinelX AI-Setup-1.0.0.exe`.

### Building for macOS
To build for macOS (Intel or Apple Silicon):
```bash
# 1. Build the production React bundle
npm run build:frontend

# 2. Package DMG and ZIP for macOS
npm run dist:mac
```
*Note for macOS*: macOS builds requiring `.dmg` with native code signing must be executed on macOS or in a CI environment with macOS runners.

---

## 7. Verified Demo Walkthrough

1. **Launch App**: Open SentinelX AI.
2. **Click "Demo Data"**: In the top header or Settings, click **Demo Data** to seed synthetic workers:
   - `W-001` (Rahul Kumar - Welding)
   - `W-002` (Amit Das - Assembly)
   - `W-003` (Raj Patel - Storage)
3. **Register Worker**:
   - Navigate to **Register Worker**.
   - Fill in Worker ID `W-004`, Name, Department, and Required PPE.
   - Click **Capture with Camera** or upload a photo.
   - YuNet validates face centering and quality.
   - Click **Register Worker & Generate QR**.
   - Profile is created in SQLite and the secure QR code is available for download as PNG.
4. **Scan QR**:
   - Navigate to **Scan Worker QR**.
   - Point camera at the QR or enter `W-001`.
   - The worker's compliance dossier opens instantly.
5. **Live Monitoring**:
   - Open **Live Monitoring**.
   - Click **Start Camera**.
   - YOLO detects people and PPE.
   - Track IDs (`Track #1`, `Track #2`) are assigned.
   - The Face Engine matches registered embeddings.
   - If a helmet or vest is missing, **🚨 PPE VIOLATION** is generated with audible siren and voice warning.
   - An incident snapshot is saved to `data/snapshots/`.
6. **Unknown Person Handling**:
   - When an unregistered subject is viewed, the system displays **UNKNOWN PERSON**.
   - Violation events log `worker_id = NULL` without attributing false infractions to registered workers.
7. **Incident History & Analytics**:
   - Open **Incident History** to view clickable incident records and snapshot images.
   - Open **Safety Analytics** to review metrics computed in real-time from SQLite.

---

## 8. Known Limitations & Technical Constraints

1. **Face Recognition Distance**: Face recognition requires at least $50\times50$ pixel resolution for reliable SFace embedding extraction. Beyond ~3.5 meters on standard webcams, subjects remain safely labeled `UNKNOWN PERSON`.
2. **Class Ground Truth**: Only classes present in the loaded YOLO weights (`yolov8_ppe_hansung.pt` or `yolov8_ppe_6class.pt`) can be detected. Unsupported classes are never simulated.
