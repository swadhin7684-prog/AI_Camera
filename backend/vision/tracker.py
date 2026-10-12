import numpy as np
import time
from typing import List, Dict, Any, Optional

def compute_iou(boxA: List[float], boxB: List[float]) -> float:
    """Compute Intersection over Union between two bounding boxes [x1, y1, x2, y2]."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    interArea = max(0.0, xB - xA) * max(0.0, yB - yA)
    boxAArea = max(1e-5, (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]))
    boxBArea = max(1e-5, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))

    return interArea / float(boxAArea + boxBArea - interArea)

def compute_similarity(boxA: List[float], boxB: List[float]) -> float:
    iou = compute_iou(boxA, boxB)
    if iou >= 0.20:
        return iou

    # Centroid distance fallback
    cAx, cAy = (boxA[0] + boxA[2]) / 2.0, (boxA[1] + boxA[3]) / 2.0
    cBx, cBy = (boxB[0] + boxB[2]) / 2.0, (boxB[1] + boxB[3]) / 2.0
    w = max(boxA[2] - boxA[0], boxB[2] - boxB[0], 1.0)
    h = max(boxA[3] - boxA[1], boxB[3] - boxB[1], 1.0)
    dist = float(np.sqrt(((cAx - cBx) / w) ** 2 + ((cAy - cBy) / h) ** 2))

    if dist < 0.40:
        return max(0.20, 0.50 - dist)
    return iou

class TrackedPerson:
    def __init__(self, track_id: int, box: List[float], confidence: float):
        self.track_id = track_id
        self.box = box
        self.confidence = confidence
        self.worker_id: Optional[str] = None
        self.worker_name: Optional[str] = None
        self.department: Optional[str] = None
        self.designation: Optional[str] = None
        self.photo_path: Optional[str] = None
        self.identity_confidence: float = 0.0
        self.identity_history: List[str] = []
        self.consecutive_misses = 0
        self.total_frames = 1
        self.last_update = time.time()
        self.ppe_status: Dict[str, Any] = {}
        self.compliance_score: float = 100.0
        self.violations: List[str] = []

    def update(self, box: List[float], confidence: float):
        # Alpha-beta smoothing to reduce jitter
        alpha = 0.7
        self.box = [
            alpha * box[0] + (1 - alpha) * self.box[0],
            alpha * box[1] + (1 - alpha) * self.box[1],
            alpha * box[2] + (1 - alpha) * self.box[2],
            alpha * box[3] + (1 - alpha) * self.box[3],
        ]
        self.confidence = confidence
        self.consecutive_misses = 0
        self.total_frames += 1
        self.last_update = time.time()

class PersonTracker:
    """
    Person Tracker maintaining temporal continuity across consecutive frames.
    Maintains temporary runtime Track IDs (e.g. Track 1, Track 2).
    Keeps Track ID strictly distinct from Worker ID.
    """

    def __init__(self, max_missed: int = 10, similarity_thresh: float = 0.25):
        self.next_track_id = 1
        self.tracks: Dict[int, TrackedPerson] = {}
        self.max_missed = max_missed
        self.similarity_thresh = similarity_thresh

    def reset(self):
        """Reset all tracked subjects and counters."""
        self.tracks.clear()
        self.next_track_id = 1

    def update(self, person_detections: List[Dict[str, Any]]) -> List[TrackedPerson]:
        det_boxes = [d["box"] for d in person_detections]
        det_confs = [d["confidence"] for d in person_detections]

        matched_tracks = set()
        matched_dets = set()

        # Match existing tracks with detections based on IoU / spatial similarity
        if self.tracks and det_boxes:
            track_ids = list(self.tracks.keys())
            cost_matrix = []

            for tid in track_ids:
                row = []
                for d_box in det_boxes:
                    sim = compute_similarity(self.tracks[tid].box, d_box)
                    row.append(sim)
                cost_matrix.append(row)

            cost_matrix = np.array(cost_matrix)

            # Greedy matching
            for _ in range(min(len(track_ids), len(det_boxes))):
                max_idx = np.unravel_index(np.argmax(cost_matrix), cost_matrix.shape)
                sim_val = cost_matrix[max_idx]

                if sim_val < self.similarity_thresh:
                    break

                t_idx, d_idx = max_idx
                tid = track_ids[t_idx]

                if tid not in matched_tracks and d_idx not in matched_dets:
                    self.tracks[tid].update(det_boxes[d_idx], det_confs[d_idx])
                    matched_tracks.add(tid)
                    matched_dets.add(d_idx)

                cost_matrix[t_idx, :] = -1
                cost_matrix[:, d_idx] = -1

        # Register new tracks for unmatched detections
        new_track_ids = set()
        for i, (box, conf) in enumerate(zip(det_boxes, det_confs)):
            if i not in matched_dets:
                new_track = TrackedPerson(self.next_track_id, box, conf)
                self.tracks[self.next_track_id] = new_track
                new_track_ids.add(self.next_track_id)
                self.next_track_id += 1

        # Increment misses for unmatched active tracks and remove dead tracks
        dead_tracks = []
        for tid, track in self.tracks.items():
            if tid not in matched_tracks and tid not in new_track_ids:
                track.consecutive_misses += 1
                # Transient detections that only appeared 1 or 2 frames expire quickly
                max_allowed = self.max_missed if track.total_frames >= 4 else 2
                if track.consecutive_misses > max_allowed:
                    dead_tracks.append(tid)

        for tid in dead_tracks:
            del self.tracks[tid]

        # Only return tracks actively visible and verified in the current frame!
        active_tracks = [
            track for tid, track in self.tracks.items()
            if (tid in matched_tracks or tid in new_track_ids) and track.consecutive_misses == 0
        ]
        return active_tracks

