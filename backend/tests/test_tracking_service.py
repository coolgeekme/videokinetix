from types import SimpleNamespace

import pytest

from tracking_service import (
    BOT_SORT_BATCH_OPTIONS,
    BOT_SORT_OPTIONS,
    MAX_BATCH_FRAMES,
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


def manager(clock=lambda: 100.0, batch_tracker_factory=None):
    return TrackingSessionManager(
        tracker_factory=FakeTracker,
        batch_tracker_factory=batch_tracker_factory,
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


def test_batch_profile_is_stricter_than_the_live_profile():
    class FakeBoTSORT:
        def __init__(self, **options):
            self.options = options

    tracker = create_botsort_tracker(FakeBoTSORT, BOT_SORT_BATCH_OPTIONS)

    assert tracker.options == BOT_SORT_BATCH_OPTIONS
    assert tracker.options["frame_rate"] > BOT_SORT_OPTIONS["frame_rate"]
    assert (
        tracker.options["minimum_iou_threshold_first_assoc"]
        > BOT_SORT_OPTIONS["minimum_iou_threshold_first_assoc"]
    )


def test_run_batch_resolves_a_whole_clip_with_one_fresh_tracker():
    batch_tracker = FakeTracker()
    service = manager(batch_tracker_factory=lambda: batch_tracker)

    results = service.run_batch(
        [
            {
                "timestamp": 0.0,
                "detections": [{"xyxy": [0, 0, 10, 10], "confidence": 0.9}],
            },
            {
                "timestamp": 0.04,
                "detections": [{"xyxy": [1, 1, 11, 11], "confidence": 0.9}],
            },
        ]
    )

    assert len(results) == 2
    assert [track["tracker_id"] for track in results[0]] == [11]
    # Both frames run through the same fresh tracker instance, in order, with
    # each frame's own timestamp -- never a live session's tracker.
    assert [call[2] for call in batch_tracker.calls] == [0.0, 0.04]


def test_run_batch_is_independent_of_live_sessions():
    live_tracker = FakeTracker()
    batch_tracker = FakeTracker()
    service = manager(batch_tracker_factory=lambda: batch_tracker)
    service._tracker_factory = lambda: live_tracker
    session_id = service.create_session("user-a")
    service.update_session(
        "user-a", session_id, [{"xyxy": [0, 0, 10, 10], "confidence": 0.9}]
    )

    service.run_batch(
        [{"timestamp": 0.0, "detections": [{"xyxy": [0, 0, 10, 10], "confidence": 0.9}]}]
    )

    assert len(live_tracker.calls) == 1
    assert len(batch_tracker.calls) == 1


@pytest.mark.parametrize(
    "frames,message",
    [
        ([], "non-empty"),
        ([{"detections": "nope"}], "detections list"),
        ([{"detections": []}, "not-an-object"], "must be an object"),
        ([{"detections": [], "timestamp": "soon"}], "must be a number"),
        ([{"detections": [], "timestamp": float("nan")}], "must be finite"),
    ],
)
def test_run_batch_rejects_malformed_frames(frames, message):
    service = manager()
    with pytest.raises(ValueError, match=message):
        service.run_batch(frames)


def test_run_batch_caps_frame_count():
    service = manager()
    frames = [{"detections": []} for _ in range(MAX_BATCH_FRAMES + 1)]
    with pytest.raises(ValueError, match="At most"):
        service.run_batch(frames)


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
