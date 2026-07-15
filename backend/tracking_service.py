"""Stateful multi-object tracking for the capture experience.

The browser performs lightweight person detection and sends bounding boxes to
this service.  Supervision supplies the common ``Detections`` representation;
Roboflow Trackers' BoT-SORT implementation assigns persistent IDs and uses the
submitted frame for camera-motion compensation.

Imports are deliberately optional so the rest of the API can still start when
the tracking extras have not been installed.  Callers can inspect ``status``
and receive an explicit 503 instead of silently falling back to a weaker
identity tracker while claiming that Supervision is active.
"""

from __future__ import annotations

import math
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Iterable


class TrackingUnavailableError(RuntimeError):
    """Raised when the optional Roboflow tracking stack is unavailable."""


class TrackingSessionNotFoundError(KeyError):
    """Raised when a session is missing, expired, or owned by another user."""


@dataclass
class _Session:
    user_id: str
    tracker: Any
    touched_at: float


def validate_detections(raw: Iterable[dict[str, Any]], limit: int = 30) -> list[dict[str, Any]]:
    """Validate browser detections and return a normalized, bounded list."""

    items = list(raw)
    if len(items) > limit:
        raise ValueError(f"At most {limit} person detections are allowed per frame")

    validated: list[dict[str, Any]] = []
    for item in items:
        xyxy = item.get("xyxy")
        if not isinstance(xyxy, (list, tuple)) or len(xyxy) != 4:
            raise ValueError("Each detection must include xyxy with four numbers")
        try:
            x1, y1, x2, y2 = (float(value) for value in xyxy)
            confidence = float(item.get("confidence", 1.0))
        except (TypeError, ValueError) as exc:
            raise ValueError("Detection coordinates and confidence must be numbers") from exc
        if not all(math.isfinite(value) for value in (x1, y1, x2, y2, confidence)):
            raise ValueError("Detection values must be finite")
        if x2 <= x1 or y2 <= y1:
            raise ValueError("Detection boxes must have positive width and height")
        validated.append(
            {
                "xyxy": [x1, y1, x2, y2],
                "confidence": max(0.0, min(1.0, confidence)),
            }
        )
    return validated


class TrackingSessionManager:
    """Own per-user BoT-SORT instances and serialize their tracked boxes."""

    def __init__(
        self,
        *,
        tracker_factory: Callable[[], Any] | None = None,
        detections_factory: Callable[[list[list[float]], list[float]], Any] | None = None,
        frame_decoder: Callable[[bytes], Any] | None = None,
        ttl_seconds: float = 20 * 60,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._sessions: dict[str, _Session] = {}
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._load_error: str | None = None

        if tracker_factory and detections_factory:
            self._tracker_factory = tracker_factory
            self._detections_factory = detections_factory
            self._frame_decoder = frame_decoder
            return

        try:
            import cv2  # type: ignore
            import numpy as np  # type: ignore
            import supervision as sv  # type: ignore
            from trackers import BoTSORTTracker  # type: ignore

            self._tracker_factory = lambda: BoTSORTTracker()

            def build_detections(boxes: list[list[float]], confidence: list[float]) -> Any:
                xyxy = np.asarray(boxes, dtype=np.float32).reshape((-1, 4))
                scores = np.asarray(confidence, dtype=np.float32)
                return sv.Detections(xyxy=xyxy, confidence=scores)

            def decode_frame(data: bytes) -> Any:
                encoded = np.frombuffer(data, dtype=np.uint8)
                frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
                if frame is None:
                    raise ValueError("Frame is not a valid JPEG or PNG image")
                return frame

            self._detections_factory = build_detections
            self._frame_decoder = decode_frame
        except Exception as exc:  # optional dependency boundary
            self._tracker_factory = None
            self._detections_factory = None
            self._frame_decoder = None
            self._load_error = f"{type(exc).__name__}: {exc}"

    @property
    def ready(self) -> bool:
        return self._tracker_factory is not None and self._detections_factory is not None

    def status(self) -> dict[str, Any]:
        return {
            "ready": self.ready,
            "engine": "roboflow-botsort" if self.ready else None,
            "camera_motion_compensation": self.ready,
            "reason": None if self.ready else self._load_error,
        }

    def _require_ready(self) -> None:
        if not self.ready:
            raise TrackingUnavailableError(
                "Enhanced tracking is unavailable. Install backend tracking requirements."
            )

    def _cleanup(self) -> None:
        cutoff = self._clock() - self._ttl_seconds
        stale = [
            session_id
            for session_id, session in self._sessions.items()
            if session.touched_at < cutoff
        ]
        for session_id in stale:
            self._sessions.pop(session_id, None)

    def create_session(self, user_id: str) -> str:
        self._require_ready()
        self._cleanup()
        session_id = str(uuid.uuid4())
        self._sessions[session_id] = _Session(
            user_id=user_id,
            tracker=self._tracker_factory(),
            touched_at=self._clock(),
        )
        return session_id

    def delete_session(self, user_id: str, session_id: str) -> bool:
        session = self._sessions.get(session_id)
        if not session or session.user_id != user_id:
            return False
        self._sessions.pop(session_id, None)
        return True

    def _get_session(self, user_id: str, session_id: str) -> _Session:
        self._cleanup()
        session = self._sessions.get(session_id)
        if not session or session.user_id != user_id:
            raise TrackingSessionNotFoundError(session_id)
        session.touched_at = self._clock()
        return session

    def decode_frame(self, data: bytes | None) -> Any:
        if not data:
            return None
        self._require_ready()
        if not self._frame_decoder:
            return None
        return self._frame_decoder(data)

    def update_session(
        self,
        user_id: str,
        session_id: str,
        raw_detections: Iterable[dict[str, Any]],
        *,
        frame: Any = None,
        timestamp: float | None = None,
    ) -> list[dict[str, Any]]:
        self._require_ready()
        session = self._get_session(user_id, session_id)
        detections = validate_detections(raw_detections)
        boxes = [item["xyxy"] for item in detections]
        confidence = [item["confidence"] for item in detections]
        sv_detections = self._detections_factory(boxes, confidence)

        try:
            tracked = session.tracker.update(
                sv_detections,
                frame=frame,
                timestamp=timestamp,
            )
        except TypeError:
            # Compatibility with trackers 2.x releases before timestamp support.
            tracked = session.tracker.update(sv_detections, frame=frame)

        tracked_boxes = getattr(tracked, "xyxy", [])
        tracked_scores = getattr(tracked, "confidence", None)
        tracked_ids = getattr(tracked, "tracker_id", None)
        output: list[dict[str, Any]] = []
        for index, xyxy in enumerate(tracked_boxes):
            tracker_id = -1 if tracked_ids is None else int(tracked_ids[index])
            score = confidence[index] if index < len(confidence) else 1.0
            if tracked_scores is not None and tracked_scores[index] is not None:
                score = float(tracked_scores[index])
            output.append(
                {
                    "tracker_id": tracker_id,
                    "xyxy": [float(value) for value in xyxy],
                    "confidence": score,
                    "confirmed": tracker_id >= 0,
                }
            )
        return output
