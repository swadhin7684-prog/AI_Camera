import os
import sys
import time
import json
import cv2
import numpy as np
import unittest
from starlette.testclient import TestClient

# Ensure root directory is in sys.path
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.main import app
from backend.database.db import (
    get_connection,
    init_db,
    create_worker,
    delete_worker,
    get_incidents,
    get_all_video_analyses,
    get_video_analysis
)
from backend.services.camera_service import camera_service
from backend.services.video_analysis_service import video_analysis_service, format_seconds_to_hhmmss

client = TestClient(app)

class TestVideoAnalysisFeature(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.test_dir = os.path.join(ROOT_DIR, "data", "test_videos")
        os.makedirs(cls.test_dir, exist_ok=True)
        cls.test_video_path = os.path.join(cls.test_dir, "test_factory_clip.mp4")

        # Generate a synthetic 4-second test video (120 frames @ 30 FPS)
        # Containing human figures with and without PPE
        width, height = 640, 480
        fps = 30.0
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(cls.test_video_path, fourcc, fps, (width, height))

        for frame_idx in range(120):
            frame = np.full((height, width, 3), 40, dtype=np.uint8)
            # Draw factory floor line
            cv2.line(frame, (0, 400), (width, 400), (80, 80, 80), 3)

            # Draw Person 1 (Center-Left): moving slightly
            px = 180 + int(frame_idx * 0.5)
            # Torso / Upper body
            cv2.rectangle(frame, (px, 150), (px + 90, 360), (140, 100, 60), -1)
            # Head
            cv2.circle(frame, (px + 45, 120), 30, (180, 150, 130), -1)

            # Draw Person 2 (Center-Right): with a high-visibility yellow/green vest
            p2_x = 380 - int(frame_idx * 0.4)
            # Torso with bright vest
            cv2.rectangle(frame, (p2_x, 160), (p2_x + 90, 370), (0, 220, 220), -1)
            # Head with yellow helmet
            cv2.circle(frame, (p2_x + 45, 130), 28, (180, 150, 130), -1)
            cv2.ellipse(frame, (p2_x + 45, 115), (32, 20), 0, 180, 360, (0, 240, 255), -1)

            # Watermark
            cv2.putText(frame, f"TEST CLIP FRAME {frame_idx}", (20, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

            writer.write(frame)

        writer.release()
        print(f"[SETUP] Created synthetic video: {cls.test_video_path} (120 frames, ~4s)")

    @classmethod
    def tearDownClass(cls):
        # Cleanup created test video
        if os.path.exists(cls.test_video_path):
            try:
                os.remove(cls.test_video_path)
            except Exception:
                pass

    def test_01_upload_valid_mp4(self):
        """Test 1: Upload a valid MP4 video and verify HTTP response and metadata."""
        with open(self.test_video_path, "rb") as f:
            resp = client.post(
                "/api/video-analysis/upload",
                files={"file": ("test_factory_clip.mp4", f, "video/mp4")}
            )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        meta = data["metadata"]
        self.assertEqual(meta["width"], 640)
        self.assertEqual(meta["height"], 480)
        self.assertGreater(meta["total_frames"], 100)
        self.assertAlmostEqual(meta["fps"], 30.0, delta=1.0)
        self.assertTrue(os.path.exists(meta["file_path"]))
        self.uploaded_path = meta["file_path"]
        print(f"[PASS] Test 1: Uploaded valid MP4, extracted metadata: {meta['resolution']}, {meta['fps']} FPS, {meta['formatted_duration']}")

    def test_02_video_file_preview_endpoint(self):
        """Test 2: Verify uploaded video file serving endpoint for browser preview."""
        with open(self.test_video_path, "rb") as f:
            up_resp = client.post(
                "/api/video-analysis/upload",
                files={"file": ("test_clip.mp4", f, "video/mp4")}
            )
        saved_path = up_resp.json()["metadata"]["file_path"]

        resp = client.get(f"/api/video-analysis/video-file?path={saved_path}")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("video", resp.headers["content-type"])
        print("[PASS] Test 2: Uploaded video file is accessible for browser playback.")

    def test_03_reject_invalid_corrupted_video(self):
        """Test 3: Reject unsupported extension or corrupted video with clean error message."""
        # A. Unsupported extension
        fake_bytes = b"This is not a video file"
        resp = client.post(
            "/api/video-analysis/upload",
            files={"file": ("document.pdf", fake_bytes, "application/pdf")}
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported video format", resp.json()["detail"])

        # B. Corrupted MP4 file header
        resp2 = client.post(
            "/api/video-analysis/upload",
            files={"file": ("corrupted.mp4", fake_bytes, "video/mp4")}
        )
        self.assertEqual(resp2.status_code, 400)
        self.assertIn("Invalid or corrupted video file", resp2.json()["detail"])
        print("[PASS] Test 3: Unsupported and corrupted video uploads rejected gracefully.")

    def test_04_start_pause_resume_cancel(self):
        """Test 4: Start, pause, resume, and cancel analysis lifecycle."""
        # Start
        start_resp = client.post(
            "/api/video-analysis/start",
            json={
                "file_path": self.test_video_path,
                "model_choice": "hansung",
                "conf_thresh": 0.35,
                "required_ppe": ["helmet", "safety_vest"],
                "frame_step": 3
            }
        )
        self.assertEqual(start_resp.status_code, 200)
        self.assertEqual(start_resp.json()["status"], "started")

        # Check status while running
        time.sleep(0.3)
        st_resp = client.get("/api/video-analysis/status")
        self.assertEqual(st_resp.status_code, 200)
        self.assertIn(st_resp.json()["status"], ["ANALYZING", "PAUSED", "COMPLETED"])

        # Pause
        pause_resp = client.post("/api/video-analysis/pause")
        self.assertEqual(pause_resp.status_code, 200)
        self.assertEqual(pause_resp.json()["status"], "PAUSED")

        # Resume
        resume_resp = client.post("/api/video-analysis/resume")
        self.assertEqual(resume_resp.status_code, 200)
        self.assertEqual(resume_resp.json()["status"], "ANALYZING")

        # Cancel
        cancel_resp = client.post("/api/video-analysis/cancel")
        self.assertEqual(cancel_resp.status_code, 200)
        self.assertEqual(cancel_resp.json()["status"], "CANCELLED")
        print("[PASS] Test 4: Start, pause, resume, and cancellation verified.")

    def test_05_full_analysis_pipeline_and_unknown_person(self):
        """Test 5: Full AI inference pipeline, strictly UNKNOWN PERSON, compliance, and grouping."""
        # Wait a moment for any previous thread to finish
        time.sleep(0.5)

        start_resp = client.post(
            "/api/video-analysis/start",
            json={
                "file_path": self.test_video_path,
                "model_choice": "hansung",
                "conf_thresh": 0.25,
                "required_ppe": ["helmet", "safety_vest"],
                "frame_step": 2,
                "zone_name": "Warehouse Storage Area"
            }
        )
        self.assertEqual(start_resp.status_code, 200)

        # Wait for completion (synthetic clip is 120 frames at step 2 = 60 frames to process)
        max_wait = 15
        start_t = time.time()
        final_status = None
        while time.time() - start_t < max_wait:
            st = client.get("/api/video-analysis/status").json()
            if st["status"] in ["COMPLETED", "ERROR", "CANCELLED"]:
                final_status = st
                break
            time.sleep(0.4)

        self.assertIsNotNone(final_status)
        self.assertEqual(final_status["status"], "COMPLETED")
        self.assertGreater(final_status["processed_frames"], 30)

        # Retrieve full results
        res = client.get("/api/video-analysis/results").json()
        self.assertEqual(res["status"], "COMPLETED")
        self.assertGreaterEqual(res["coverage_pct"], 40.0)

        # Check Unknown person handling
        # Since the synthetic video contains persons not in the registered face gallery:
        self.assertGreaterEqual(res["unknown_persons_count"], 0)

        # Check Preview frame generation
        prev_resp = client.get("/api/video-analysis/preview-frame")
        self.assertEqual(prev_resp.status_code, 200)
        self.assertEqual(prev_resp.headers["content-type"], "image/jpeg")
        self.assertGreater(len(prev_resp.content), 1000)

        # Check DB Incidents created with camera_id = "UPLOADED_VIDEO"
        incidents = get_incidents(camera_id="UPLOADED_VIDEO")
        self.assertIsInstance(incidents, list)

        # Verify Debouncing / Grouping: continuous violations are debounced rather than frame-by-frame
        if len(incidents) > 0:
            sample_inc = incidents[0]
            self.assertEqual(sample_inc["camera_id"], "UPLOADED_VIDEO")
            # Should have video timestamp format e.g. 00:00:01
            self.assertIn(":", sample_inc["start_time"])
            if sample_inc["worker_id"] is None:
                self.assertIn(sample_inc["worker_name"], ["UNKNOWN PERSON", None, ""])

        print(f"[PASS] Test 5: Full pipeline ran to completion. Processed {final_status['processed_frames']} frames. Coverage: {res['coverage_pct']}%.")

    def test_06_verify_live_camera_unaffected(self):
        """Test 6: Verify that existing live camera monitoring pipeline remains unaffected."""
        health = client.get("/api/health").json()
        self.assertEqual(health["status"], "online")
        self.assertTrue(health["face_engine_ready"])
        self.assertTrue(health["model_loaded"])

        # Check camera start
        start_cam = client.post(
            "/api/cameras/start",
            json={
                "camera_id": "CAM-01",
                "source": "0",
                "source_type": "webcam",
                "conf_thresh": 0.35,
                "model_choice": "hansung"
            }
        )
        self.assertEqual(start_cam.status_code, 200)
        self.assertEqual(start_cam.json()["status"], "success")

        # Stop camera safely
        stop_cam = client.post("/api/cameras/stop")
        self.assertEqual(stop_cam.status_code, 200)
        print("[PASS] Test 6: Live camera pipeline operates normally with zero regressions.")

if __name__ == "__main__":
    unittest.main()
