import cv2
import numpy as np
import os
import logging
import threading
from typing import Optional, Tuple, Dict, Any, List

logger = logging.getLogger("sentinelx.face_id")

from backend.paths import resolve_model_path, get_models_dir

MODELS_DIR = get_models_dir()
YUNET_PATH = resolve_model_path("face_detection_yunet.onnx")
SFACE_PATH = resolve_model_path("face_recognition_sface.onnx")

class FaceIdentityEngine:
    """
    Local Face Detection & Recognition Engine using OpenCV YuNet + SFace.
    Extracts 128-dimensional normalized facial feature embeddings.
    Thread-safe implementation with locked graph operations to prevent buffer shape collisions.
    """

    def __init__(self, score_threshold: float = 0.40, cosine_threshold: float = 0.36):
        self.score_threshold = score_threshold
        self.cosine_threshold = cosine_threshold
        self.detector: Optional[cv2.FaceDetectorYN] = None
        self.recognizer: Optional[cv2.FaceRecognizerSF] = None
        self.is_ready = False
        self._lock = threading.Lock()
        self._current_input_size = None
        self._init_models()

    def _init_models(self):
        try:
            if not os.path.exists(YUNET_PATH) or not os.path.exists(SFACE_PATH):
                logger.warning(f"Face models not found at {YUNET_PATH} or {SFACE_PATH}")
                return

            self.detector = cv2.FaceDetectorYN.create(
                model=YUNET_PATH,
                config="",
                input_size=(640, 480),
                score_threshold=self.score_threshold,
                nms_threshold=0.3,
                top_k=5000
            )

            self.recognizer = cv2.FaceRecognizerSF.create(
                model=SFACE_PATH,
                config=""
            )
            self._current_input_size = (640, 480)
            self.is_ready = True
            logger.info("FaceIdentityEngine initialized with YuNet and SFace successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize FaceIdentityEngine: {e}")
            self.is_ready = False

    def detect_all_faces(self, image: np.ndarray) -> List[np.ndarray]:
        """
        Detects all faces in the image safely with thread lock.
        Returns list of face rows with size & quality filter.
        """
        if not self.is_ready or self.detector is None or image is None or image.size == 0:
            return []

        with self._lock:
            try:
                h, w = image.shape[:2]
                if self._current_input_size != (w, h):
                    self.detector.setInputSize((w, h))
                    self._current_input_size = (w, h)

                _, faces = self.detector.detect(image)
                if faces is None or len(faces) == 0:
                    return []

                valid_faces = []
                for f in faces:
                    score = float(f[-1])
                    fw, fh = float(f[2]), float(f[3])
                    # Face must have sufficient resolution (>=32px) and confidence >= score_threshold
                    if score >= self.score_threshold and fw >= 32 and fh >= 32:
                        valid_faces.append(f)
                return valid_faces
            except Exception as e:
                logger.error(f"Error during detect_all_faces: {e}")
                return []

    def detect_face(self, image: np.ndarray) -> Tuple[bool, Optional[np.ndarray], Dict[str, Any]]:
        """
        Detects primary face in image (used for validation & single image crops).
        Evaluates size, confidence, blur (Laplacian variance), and illumination.
        Returns: (success, face_detection_row, quality_info)
        """
        if not self.is_ready or self.detector is None or image is None or image.size == 0:
            return False, None, {"error": "Engine not ready or invalid image"}

        with self._lock:
            try:
                h, w = image.shape[:2]
                if self._current_input_size != (w, h):
                    self.detector.setInputSize((w, h))
                    self._current_input_size = (w, h)

                _, faces = self.detector.detect(image)
                if faces is None or len(faces) == 0:
                    return False, None, {"error": "No face detected in image. Please ensure face is visible and well-lit."}

                best_face = faces[0]
                for f in faces[1:]:
                    if f[-1] > best_face[-1]:
                        best_face = f

                fx, fy, fw, fh = best_face[0:4]
                score = float(best_face[-1])

                quality_pass = True
                quality_reasons = []

                if fw < 40 or fh < 40:
                    quality_pass = False
                    quality_reasons.append("Face too small (minimum 40x40 pixels required)")

                if score < self.score_threshold:
                    quality_pass = False
                    quality_reasons.append(f"Face confidence too low ({score:.2f} < {self.score_threshold:.2f})")

                # Illumination & Sharpness assessment on face crop
                crop_x1 = max(0, int(fx))
                crop_y1 = max(0, int(fy))
                crop_x2 = min(w, int(fx + fw))
                crop_y2 = min(h, int(fy + fh))

                if (crop_x2 - crop_x1) > 10 and (crop_y2 - crop_y1) > 10:
                    face_crop = image[crop_y1:crop_y2, crop_x1:crop_x2]
                    gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
                    lap_var = float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())
                    mean_brightness = float(np.mean(gray_crop))

                    if lap_var < 30.0:
                        quality_pass = False
                        quality_reasons.append("Face image appears blurry or out of focus")

                    if mean_brightness < 35.0:
                        quality_pass = False
                        quality_reasons.append("Image is too dark (poor illumination)")
                    elif mean_brightness > 235.0:
                        quality_pass = False
                        quality_reasons.append("Image is overexposed / too bright")
                else:
                    lap_var = 0.0
                    mean_brightness = 128.0

                quality_info = {
                    "bbox": [float(fx), float(fy), float(fw), float(fh)],
                    "score": round(score, 3),
                    "sharpness": round(lap_var, 1),
                    "brightness": round(mean_brightness, 1),
                    "quality_pass": quality_pass,
                    "reasons": quality_reasons
                }

                return quality_pass, best_face, quality_info
            except Exception as e:
                logger.error(f"Error during face detection: {e}")
                return False, None, {"error": str(e)}

    def extract_embedding(self, image: np.ndarray, face_row: np.ndarray) -> Optional[np.ndarray]:
        """Aligns face and computes 128-d L2 normalized SFace feature vector."""
        if not self.is_ready or self.recognizer is None or image is None or face_row is None:
            return None

        with self._lock:
            try:
                aligned_face = self.recognizer.alignCrop(image, face_row)
                feature = self.recognizer.feature(aligned_face)
                return feature
            except Exception as e:
                logger.error(f"Error extracting face embedding: {e}")
                return None

    def match_against_gallery(
        self,
        query_embedding: np.ndarray,
        gallery: List[Dict[str, Any]],
        threshold: Optional[float] = None
    ) -> Tuple[Optional[str], Optional[str], float, Optional[Dict[str, Any]]]:
        """
        Compares query embedding with registered worker embeddings using cosine similarity.
        Returns: (worker_id, worker_name, confidence, full_worker_dict)
        If not matched or below threshold: returns (None, None, best_score, None).
        """
        if query_embedding is None or not gallery or self.recognizer is None:
            return None, None, 0.0, None

        active_thresh = threshold if threshold is not None else self.cosine_threshold

        with self._lock:
            best_score = -1.0
            matched_worker_id = None
            matched_name = None
            matched_record = None

            for item in gallery:
                emb_blob = item.get("face_embedding")
                if not emb_blob:
                    continue

                try:
                    reg_emb = np.frombuffer(emb_blob, dtype=np.float32).reshape(1, 128)
                    score = float(self.recognizer.match(query_embedding, reg_emb, cv2.FaceRecognizerSF_FR_COSINE))

                    if score > best_score:
                        best_score = score
                        if score >= active_thresh:
                            matched_worker_id = item["worker_id"]
                            matched_name = item.get("name", "Unknown Worker")
                            matched_record = item
                except Exception as e:
                    logger.debug(f"Matching error for {item.get('worker_id')}: {e}")

            if matched_worker_id and matched_record:
                # Normalize cosine score (range roughly 0.36..0.85) to confidence percentage (50%..99%)
                norm_conf = min(0.99, max(0.50, (best_score - 0.20) / 0.60))
                return matched_worker_id, matched_name, round(norm_conf, 2), matched_record
            else:
                return None, None, round(max(0.0, best_score), 2), None
