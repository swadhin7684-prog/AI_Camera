import os
import logging
from typing import List, Dict, Any, Tuple
from ultralytics import YOLO

logger = logging.getLogger("sentinelx.detector")

class PPEDetector:
    """
    YOLOv8-based Object and PPE Detector.
    Supports honest class mapping, configurable confidence thresholds,
    and runtime model inspection.
    """

    CANONICAL_MAPPING = {
        "person": "person",
        "hardhat": "helmet",
        "helmet": "helmet",
        "safety vest": "safety_vest",
        "vest": "safety_vest",
        "gloves": "gloves",
        "glove": "gloves",
        "safety_shoe": "safety_shoes",
        "shoes": "safety_shoes",
        "no-hardhat": "no_helmet",
        "no_helmet": "no_helmet",
        "no-safety vest": "no_safety_vest",
        "mask": "mask",
        "no-mask": "no_mask",
        "goggles": "goggles",
    }

    # All known safety classes
    ALL_POTENTIAL_CLASSES = ["helmet", "safety_vest", "gloves", "safety_shoes", "mask", "goggles"]

    def __init__(self, model_path: str = "models/yolov8_ppe_hansung.pt", conf_thresh: float = 0.35, imgsz: int = 480):
        self.model_path = model_path
        self.conf_thresh = conf_thresh
        self.imgsz = imgsz
        self.model = None
        self.person_model = None
        self.raw_classes: Dict[int, str] = {}
        self.supported_canonical: List[str] = []
        self.unsupported_canonical: List[str] = []
        self.load_model()

    def load_model(self) -> Tuple[bool, str]:
        from backend.paths import resolve_model_path
        self.model_path = resolve_model_path(self.model_path)

        try:
            logger.info(f"Loading YOLO model from: {self.model_path}")
            self.model = YOLO(self.model_path)
            self.raw_classes = self.model.names if hasattr(self.model, "names") else {}

            found_canonical = set()
            has_person_class = False
            for raw_name in self.raw_classes.values():
                canon = self.CANONICAL_MAPPING.get(raw_name.strip().lower(), raw_name.strip().lower())
                if canon == "person":
                    has_person_class = True
                elif canon in self.ALL_POTENTIAL_CLASSES:
                    found_canonical.add(canon)

            # Attach YOLOv8n companion person detector to guarantee reliable person detection across all ranges
            person_model_path = resolve_model_path("yolov8n.pt")
            if os.path.exists(person_model_path):
                logger.info(f"Attached YOLOv8n companion person detector from {person_model_path} for robust person localization.")
                self.person_model = YOLO(person_model_path)
            else:
                self.person_model = None

            self.supported_canonical = sorted(list(found_canonical))
            self.unsupported_canonical = [c for c in self.ALL_POTENTIAL_CLASSES if c not in self.supported_canonical]

            logger.info(f"Model loaded: {os.path.basename(self.model_path)}. Supported PPE classes: {self.supported_canonical}. Has person detector: {has_person_class or self.person_model is not None}")
            return True, f"Loaded {os.path.basename(self.model_path)}"
        except Exception as e:
            logger.error(f"Failed to load model {self.model_path}: {e}")
            return False, str(e)

    def detect(self, frame) -> List[Dict[str, Any]]:
        """
        Runs YOLO inference on a single frame.
        Merges companion person detections if applicable.
        Returns a list of standardized detections:
        [
            {
                "box": [x1, y1, x2, y2],
                "confidence": float,
                "raw_class": str,
                "canonical_class": str
            }
        ]
        """
        if self.model is None or frame is None or frame.size == 0:
            return []

        try:
            detections = []

            # 1. Primary PPE model inference
            results = self.model(frame, conf=self.conf_thresh, iou=0.45, imgsz=self.imgsz, verbose=False)
            for result in results:
                boxes = result.boxes
                if boxes is None or len(boxes) == 0:
                    continue

                coords = boxes.xyxy.cpu().numpy()
                confs = boxes.conf.cpu().numpy()
                cls_indices = boxes.cls.cpu().numpy()

                for box, conf, cls_idx in zip(coords, confs, cls_indices):
                    cls_id = int(cls_idx)
                    raw_name = self.raw_classes.get(cls_id, f"class_{cls_id}")
                    canon_name = self.CANONICAL_MAPPING.get(raw_name.strip().lower(), raw_name.strip().lower())

                    detections.append({
                        "box": [float(box[0]), float(box[1]), float(box[2]), float(box[3])],
                        "confidence": float(round(float(conf), 3)),
                        "raw_class": raw_name,
                        "canonical_class": canon_name
                    })

            # 2. Companion person detector if primary model lacks person class
            if self.person_model is not None:
                p_results = self.person_model(frame, classes=[0], conf=self.conf_thresh, iou=0.45, imgsz=self.imgsz, verbose=False)
                for res in p_results:
                    boxes = res.boxes
                    if boxes is None or len(boxes) == 0:
                        continue
                    coords = boxes.xyxy.cpu().numpy()
                    confs = boxes.conf.cpu().numpy()
                    for box, conf in zip(coords, confs):
                        detections.append({
                            "box": [float(box[0]), float(box[1]), float(box[2]), float(box[3])],
                            "confidence": float(round(float(conf), 3)),
                            "raw_class": "person",
                            "canonical_class": "person"
                        })

            return detections
        except Exception as e:
            logger.error(f"Inference error: {e}")
            return []


def compute_box_iou(boxA: List[float], boxB: List[float]) -> float:
    """Intersection over Union."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    inter = max(0.0, xB - xA) * max(0.0, yB - yA)
    areaA = max(1e-5, (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]))
    areaB = max(1e-5, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))
    return inter / float(areaA + areaB - inter)


def compute_box_containment(boxA: List[float], boxB: List[float]) -> float:
    """Intersection over minimum box area (containment ratio)."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    inter = max(0.0, xB - xA) * max(0.0, yB - yA)
    min_area = min((boxA[2] - boxA[0]) * (boxA[3] - boxA[1]), (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))
    return inter / float(max(1e-5, min_area))


def filter_person_detections(
    person_dets: List[Dict[str, Any]],
    frame_shape: Tuple[int, int] = None,
    iou_thresh: float = 0.35,
    containment_thresh: float = 0.60,
    min_person_conf: float = 0.40
) -> List[Dict[str, Any]]:
    """
    Suppresses redundant overlapping person boxes, extreme aspect ratios,
    and low-confidence person false positives.
    """
    if not person_dets:
        return []

    # Sort descending by confidence
    sorted_dets = sorted(person_dets, key=lambda d: d.get("confidence", 0.0), reverse=True)
    kept: List[Dict[str, Any]] = []

    for det in sorted_dets:
        conf = det.get("confidence", 0.0)
        if conf < min_person_conf:
            continue

        box = det["box"]
        bw = box[2] - box[0]
        bh = box[3] - box[1]

        # Basic size filter: a person must be at least 40px wide and 60px high
        if bw < 40 or bh < 60:
            continue

        # Aspect ratio filter (width / height): humans are not extreme vertical slivers or flat horizontal strips
        aspect = bw / float(bh)
        if aspect < 0.20 or aspect > 2.2:
            continue

        # Check suppression against already accepted higher-confidence persons
        suppressed = False
        for k in kept:
            k_box = k["box"]
            iou = compute_box_iou(box, k_box)
            containment = compute_box_containment(box, k_box)
            if iou > iou_thresh or containment > containment_thresh:
                suppressed = True
                break

        if not suppressed:
            kept.append(det)

    return kept

