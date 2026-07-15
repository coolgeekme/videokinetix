from types import SimpleNamespace

import pytest

from tracking_service import (
    BOT_SORT_OPTIONS,
    TrackingSessionManager,
    TrackingSessionNotFoundError,
    create_botsort_tracker,
    validate_detections,
)


class FakeTracker:
    def __init__(self):
        self.calls = []

    def update(self, detections, frame=None, timestamp=None):
        self.calls.append((detections, frame, timestamp))
        return SimpleNamespace(
            xyxy=detections["boxes"],
            confidence=detections["confidence"],
            tracker_id=[11 + index for index in range(len(detections["boxes"]))],
        )


def manager(clock=lambda: 100.0):
    return TrackingSessionManager(
        tracker_factory=FakeTracker,
        detections_factory=lambda boxes, confidence: {
            "boxes": boxes,
            "confidence": confidence,
        },
        frame_decoder=lambda data: f"decoded:{len(data)}",
        clock=clock,
    )


def test_uses_low_fps_fast_motion_botsort_profile():
    class FakeBoTSORT:
        def __init__(self, **options):
            self.options = options

    tracker = create_botsort_tracker(FakeBoTSORT)

    assert tracker.options == BOT_SORT_OPTIONS
    assert tracker.options["frame_rate"] == 7.0
    assert tracker.options["minimum_iou_threshold_first_assoc"] < 0.1
    assert tracker.options["minimum_consecutive_frames"] == 1


def test_validates_and_clamps_browser_detections():
    detections = validate_detections(
        [{"xyxy": [10, 20, 30, 50], "confidence": 1.4}]
    )
    assert detections == [{"xyxy": [10.0, 20.0, 30.0, 50.0], "confidence": 1.0}]


@pytest.mark.parametrize(
    "detection",
    [
        {"xyxy": [0, 0, 0, 10]},
        {"xyxy": [0, 0, 10]},
        {"xyxy": [0, 0, float("nan"), 10]},
    ],
)
def test_rejects_invalid_boxes(detection):
    with pytest.raises(ValueError):
        validate_detections([detection])


def test_tracks_boxes_with_a_user_scoped_session():
    service = manager()
    session_id = service.create_session("user-a")
    tracks = service.update_session(
        "user-a",
        session_id,
        [
            {"xyxy": [10, 20, 30, 50], "confidence": 0.8},
            {"xyxy": [50, 20, 80, 60], "confidence": 0.7},
        ],
        frame="frame",
        timestamp=3.25,
    )

    assert [track["tracker_id"] for track in tracks] == [11, 12]
    assert all(track["confirmed"] for track in tracks)
    tracker = service._sessions[session_id].tracker
    assert tracker.calls[0][1:] == ("frame", 3.25)


def test_does_not_expose_sessions_across_users():
    service = manager()
    session_id = service.create_session("user-a")
    with pytest.raises(TrackingSessionNotFoundError):
        service.update_session("user-b", session_id, [])


def test_expires_inactive_sessions():
    now = [0.0]
    service = TrackingSessionManager(
        tracker_factory=FakeTracker,
        detections_factory=lambda boxes, confidence: {
            "boxes": boxes,
            "confidence": confidence,
        },
        ttl_seconds=10,
        clock=lambda: now[0],
    )
    session_id = service.create_session("user-a")
    now[0] = 11.0
    with pytest.raises(TrackingSessionNotFoundError):
        service.update_session("user-a", session_id, [])
