import cv2
import threading
import time
import logging
import numpy as np
from typing import Optional, Tuple

logger = logging.getLogger("sentinelx.camera")

class VideoSource:
    """
    Robust threaded video capture with auto-reconnection and low-latency buffer flushing.
    Supports local webcams, video files, and synthetic test frames.
    """

    def __init__(self, source: str = "0", is_webcam: bool = True):
        self.source = source
        self.is_webcam = is_webcam
        self.cap: Optional[cv2.VideoCapture] = None
        self.running = False
        self.lock = threading.Lock()
        self.latest_frame: Optional[np.ndarray] = None
        self.frame_width = 1280
        self.frame_height = 720
        self.fps = 30.0
        self.thread: Optional[threading.Thread] = None
        self.error_count = 0
        self._open_capture()

    def _open_capture(self):
        try:
            if self.is_webcam:
                idx = int(self.source)
                # Try DirectShow on Windows for fastest device lock
                self.cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
                if not self.cap.isOpened():
                    self.cap = cv2.VideoCapture(idx)
                if self.cap.isOpened():
                    self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
                    self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                    self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                    self.cap.set(cv2.CAP_PROP_FPS, 60.0)
                    self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            else:
                self.cap = cv2.VideoCapture(self.source)

            if self.cap.isOpened():
                w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                if w > 0 and h > 0:
                    self.frame_width = w
                    self.frame_height = h
                logger.info(f"Opened video source {self.source} ({self.frame_width}x{self.frame_height})")
            else:
                logger.warning(f"Failed to open video source {self.source}")
        except Exception as e:
            logger.error(f"Error opening capture for {self.source}: {e}")

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _generate_synthetic_test_frame(self) -> np.ndarray:
        """Synthetic frame generated when physical webcam is locked or disconnected."""
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        frame[:] = (20, 24, 33)  # Dark industrial background
        
        # Grid lines
        for y in range(0, 720, 60):
            cv2.line(frame, (0, y), (1280, y), (30, 40, 55), 1)
        for x in range(0, 1280, 60):
            cv2.line(frame, (x, 0), (x, 720), (30, 40, 55), 1)

        t_str = time.strftime("%Y-%m-%d %H:%M:%S")
        cv2.putText(frame, "SENTINELX AI — CAM STREAM ACTIVE", (40, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 217, 255), 2)
        cv2.putText(frame, f"Time: {t_str} | Source: {self.source}", (40, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (148, 163, 184), 1)
        cv2.putText(frame, "Waiting for subject or camera device...", (40, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (34, 197, 94), 1)
        return frame

    def _capture_loop(self):
        while self.running:
            if self.cap is not None and self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret and frame is not None:
                    self.error_count = 0
                    with self.lock:
                        self.latest_frame = frame
                else:
                    self.error_count += 1
                    # If reading from video file, loop back to start
                    if not self.is_webcam:
                        self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        time.sleep(0.03)
                        continue

                    # If webcam failed 10 frames consecutively, attempt reconnection
                    if self.error_count > 10:
                        logger.warning("Camera read failure limit reached, attempting reconnect...")
                        time.sleep(1.0)
                        self._open_capture()
                        self.error_count = 0
            else:
                # If capture device could not be opened, produce test frame
                with self.lock:
                    self.latest_frame = self._generate_synthetic_test_frame()
                time.sleep(0.04)

            time.sleep(0.002)

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        with self.lock:
            if self.latest_frame is not None:
                return True, self.latest_frame.copy()
            return False, None

    def stop(self):
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.0)
        if self.cap:
            self.cap.release()
            self.cap = None
        logger.info("Video capture stopped.")
