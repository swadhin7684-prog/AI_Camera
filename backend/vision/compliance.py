from typing import List, Dict, Any, Tuple, Optional
import copy

def box_overlap(boxA: List[float], boxB: List[float]) -> float:
    """Calculates intersection over boxB area (containment of boxB within boxA)."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    inter = max(0.0, xB - xA) * max(0.0, yB - yA)
    areaB = max(1e-5, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))
    return inter / areaB

def get_anatomical_zones(person_box: List[float]) -> Dict[str, List[float]]:
    """Calculates spatial anatomical sub-regions for a person bounding box [x1, y1, x2, y2]."""
    wx1, wy1, wx2, wy2 = person_box
    w_w = max(1.0, wx2 - wx1)
    w_h = max(1.0, wy2 - wy1)

    return {
        "head": [wx1 - 0.15 * w_w, wy1 - 0.20 * w_h, wx2 + 0.15 * w_w, wy1 + 0.40 * w_h],
        "torso": [wx1 - 0.15 * w_w, wy1 + 0.18 * w_h, wx2 + 0.15 * w_w, wy1 + 0.85 * w_h],
        "hands": [wx1 - 0.30 * w_w, wy1 + 0.30 * w_h, wx2 + 0.30 * w_w, wy1 + 0.90 * w_h],
        "feet": [wx1 - 0.25 * w_w, wy2 - 0.35 * w_h, wx2 + 0.25 * w_w, wy2 + 0.20 * w_h]
    }

class ComplianceEngine:
    """
    Deterministic Industrial Safety & PPE Compliance Engine.
    Provides:
    - Exclusive spatial association (prevents 1 PPE item from satisfying multiple persons).
    - Multi-class compliance status: PRESENT, MISSING, UNCERTAIN, NOT SUPPORTED, NOT CONFIGURED.
    - Worker-specific requirement comparison with zone default fallback for UNKNOWN PERSON.
    """

    ALL_PPE_CLASSES = ["helmet", "safety_vest", "gloves", "safety_shoes", "mask", "goggles"]

    VIOLATION_NAMES = {
        "helmet": "Safety Helmet Missing",
        "safety_vest": "High-Visibility Vest Missing",
        "gloves": "Protective Gloves Missing",
        "safety_shoes": "Safety Footwear Missing",
        "mask": "Protective Mask Missing",
        "goggles": "Eye Protection Missing"
    }

    def __init__(self, default_required_items: List[str] = None):
        self.default_required_items = default_required_items or ["helmet", "safety_vest"]

    def associate_ppe_to_people(
        self,
        person_boxes: List[List[float]],
        ppe_items: List[Dict[str, Any]]
    ) -> List[List[Dict[str, Any]]]:
        """
        Exclusively associates detected PPE items to the closest matching person based on anatomical affinity.
        Returns a list of PPE detection lists, one per person.
        """
        num_people = len(person_boxes)
        assignments: List[List[Dict[str, Any]]] = [[] for _ in range(num_people)]
        if num_people == 0 or not ppe_items:
            return assignments

        person_zones = [get_anatomical_zones(box) for box in person_boxes]

        # Sort PPE detections descending by confidence
        sorted_ppe = sorted(ppe_items, key=lambda d: d.get("confidence", 0.0), reverse=True)

        for item in sorted_ppe:
            c_class = item["canonical_class"]
            i_box = item["box"]

            # Determine relevant anatomical zone for this PPE item
            if c_class in ("helmet", "no_helmet", "mask", "no_mask", "goggles"):
                target_zone = "head"
            elif c_class in ("safety_vest", "no_safety_vest"):
                target_zone = "torso"
            elif c_class == "gloves":
                target_zone = "hands"
            elif c_class == "safety_shoes":
                target_zone = "feet"
            else:
                target_zone = "torso"

            best_p_idx = -1
            best_score = 0.15  # Minimum overlap threshold

            for p_idx, zones in enumerate(person_zones):
                overlap = box_overlap(zones[target_zone], i_box)
                if overlap > best_score:
                    best_score = overlap
                    best_p_idx = p_idx

            if best_p_idx >= 0:
                # Exclusively assign this physical PPE detection to the best matching person
                assignments[best_p_idx].append(item)

        return assignments

    def evaluate_person(
        self,
        person_box: List[float],
        ppe_items: List[Dict[str, Any]],
        required_items: List[str],
        supported_classes: List[str],
        track_total_frames: int = 5,
        frame_shape: Optional[Tuple[int, int]] = None
    ) -> Tuple[Dict[str, Any], float, List[str]]:
        """
        Evaluates one person against their assigned PPE items.
        Returns: (ppe_status_dict, compliance_percentage, list_of_violations)
        """
        # Initialize status for all possible PPE items
        ppe_status: Dict[str, Any] = {}

        for item_key in self.ALL_PPE_CLASSES:
            is_supported = item_key in supported_classes
            is_required = item_key in required_items

            if not is_supported:
                init_status = "NOT SUPPORTED"
            elif not is_required:
                init_status = "NOT CONFIGURED"
            else:
                init_status = "MISSING"

            ppe_status[item_key] = {
                "status": init_status,
                "detected": False,
                "confidence": 0.0,
                "supported": is_supported,
                "required": is_required,
                "box": None
            }

        zones = get_anatomical_zones(person_box)
        head_zone = zones["head"]
        torso_zone = zones["torso"]
        hand_zone = zones["hands"]
        foot_zone = zones["feet"]

        negative_helmet = False
        negative_vest = False

        for item in ppe_items:
            c_class = item["canonical_class"]
            i_box = item["box"]
            conf = item["confidence"]

            if c_class == "no_helmet" and box_overlap(head_zone, i_box) > 0.25:
                negative_helmet = True
            elif c_class == "no_safety_vest" and box_overlap(torso_zone, i_box) > 0.25:
                negative_vest = True
            elif c_class == "helmet" and box_overlap(head_zone, i_box) > 0.20:
                ppe_status["helmet"]["detected"] = True
                ppe_status["helmet"]["confidence"] = max(ppe_status["helmet"]["confidence"], conf)
                ppe_status["helmet"]["box"] = i_box
                if ppe_status["helmet"]["required"]:
                    ppe_status["helmet"]["status"] = "PRESENT"
            elif c_class == "safety_vest" and box_overlap(torso_zone, i_box) > 0.20:
                ppe_status["safety_vest"]["detected"] = True
                ppe_status["safety_vest"]["confidence"] = max(ppe_status["safety_vest"]["confidence"], conf)
                ppe_status["safety_vest"]["box"] = i_box
                if ppe_status["safety_vest"]["required"]:
                    ppe_status["safety_vest"]["status"] = "PRESENT"
            elif c_class == "gloves" and box_overlap(hand_zone, i_box) > 0.15:
                ppe_status["gloves"]["detected"] = True
                ppe_status["gloves"]["confidence"] = max(ppe_status["gloves"]["confidence"], conf)
                ppe_status["gloves"]["box"] = i_box
                if ppe_status["gloves"]["required"]:
                    ppe_status["gloves"]["status"] = "PRESENT"
            elif c_class == "safety_shoes" and box_overlap(foot_zone, i_box) > 0.15:
                ppe_status["safety_shoes"]["detected"] = True
                ppe_status["safety_shoes"]["confidence"] = max(ppe_status["safety_shoes"]["confidence"], conf)
                ppe_status["safety_shoes"]["box"] = i_box
                if ppe_status["safety_shoes"]["required"]:
                    ppe_status["safety_shoes"]["status"] = "PRESENT"
            elif c_class == "mask" and box_overlap(head_zone, i_box) > 0.15:
                ppe_status["mask"]["detected"] = True
                ppe_status["mask"]["confidence"] = max(ppe_status["mask"]["confidence"], conf)
                ppe_status["mask"]["box"] = i_box
                if ppe_status["mask"]["required"]:
                    ppe_status["mask"]["status"] = "PRESENT"
            elif c_class == "goggles" and box_overlap(head_zone, i_box) > 0.15:
                ppe_status["goggles"]["detected"] = True
                ppe_status["goggles"]["confidence"] = max(ppe_status["goggles"]["confidence"], conf)
                ppe_status["goggles"]["box"] = i_box
                if ppe_status["goggles"]["required"]:
                    ppe_status["goggles"]["status"] = "PRESENT"

        if negative_helmet and ppe_status["helmet"]["required"]:
            ppe_status["helmet"]["detected"] = False
            ppe_status["helmet"]["status"] = "MISSING"

        if negative_vest and ppe_status["safety_vest"]["required"]:
            ppe_status["safety_vest"]["detected"] = False
            ppe_status["safety_vest"]["status"] = "MISSING"

        # Check for UNCERTAIN condition: if track just entered scene (< 3 frames) and positive item not detected
        is_transient = (track_total_frames < 3)

        violations = []
        compliant_count = 0
        applicable_count = 0

        for req in required_items:
            item_info = ppe_status.get(req)
            if not item_info or not item_info["supported"]:
                continue

            applicable_count += 1
            if item_info["detected"]:
                compliant_count += 1
                item_info["status"] = "PRESENT"
            else:
                if is_transient and not negative_helmet and not negative_vest:
                    # In transient frames before stabilization, mark as UNCERTAIN rather than false violation
                    item_info["status"] = "UNCERTAIN"
                else:
                    item_info["status"] = "MISSING"
                    v_name = self.VIOLATION_NAMES.get(req, f"{req.capitalize()} Missing")
                    violations.append(v_name)

        if applicable_count > 0:
            compliance_pct = round((compliant_count / applicable_count) * 100.0, 1)
        else:
            compliance_pct = 100.0

        return ppe_status, compliance_pct, violations
