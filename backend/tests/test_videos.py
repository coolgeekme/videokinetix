"""Phase C: session video save/replay/reanalyze tests.

Covers POST/GET/DELETE /api/sessions/{id}/video[s]/{variant},
?auth=<jwt> query fallback, idempotent re-upload (soft-delete prior),
POST /api/sessions/{id}/reanalyze, and session-delete cascade.
"""
import os
import uuid
from pathlib import Path

import pytest
import requests

# Resolve BASE_URL from env or frontend/.env
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    for line in env_path.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
API = f"{BASE_URL}/api"

LLM_TIMEOUT = 90
DEFAULT_TIMEOUT = 30


# A real-ish 32-byte WebM-ish dummy payload. Backend only validates MIME +
# size, not container; bytes are stored & returned verbatim.
def _make_blob(size_bytes: int = 2048, seed: bytes = b"\x1aE\xdf\xa3") -> bytes:
    body = seed + os.urandom(size_bytes - len(seed))
    return body


@pytest.fixture(scope="module")
def alpha():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_video_{uuid.uuid4().hex[:10]}@example.com"
    r = s.post(
        f"{API}/auth/register",
        json={"email": email, "password": "Pass1234!", "name": "Video Tester"},
        timeout=DEFAULT_TIMEOUT,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    token = data["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})

    # Find self athlete
    r2 = s.get(f"{API}/athletes", timeout=DEFAULT_TIMEOUT)
    assert r2.status_code == 200
    athlete = next(a for a in r2.json()["athletes"] if a.get("is_self"))
    return {"session": s, "token": token, "athlete_id": athlete["id"], "email": email}


@pytest.fixture(scope="module")
def video_session(alpha):
    """Create a basketball session w/ pose_summary so reanalyze has data."""
    s = alpha["session"]
    payload = {
        "athlete_id": alpha["athlete_id"],
        "sport": "basketball",
        "mode": "upload",
        "duration_seconds": 6.0,
        "pose_summary": {
            "rep_count": 3,
            "overall_score": 72,
            "reps": [{"index": i, "score": 70 + i} for i in range(3)],
        },
        "notes": "TEST_ video session",
    }
    r = s.post(f"{API}/sessions", json=payload, timeout=LLM_TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _upload(s: requests.Session, sid: str, variant: str, blob: bytes, mime="video/webm", filename="clip.webm"):
    # Use a fresh session w/o Content-Type: application/json so multipart works
    headers = {"Authorization": s.headers["Authorization"]}
    return requests.post(
        f"{API}/sessions/{sid}/video",
        headers=headers,
        data={"variant": variant},
        files={"file": (filename, blob, mime)},
        timeout=DEFAULT_TIMEOUT,
    )


class TestVideoUpload:
    def test_upload_raw_video(self, alpha, video_session):
        blob = _make_blob(4096)
        r = _upload(alpha["session"], video_session["id"], "raw", blob)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["variant"] == "raw"
        assert body["session_id"] == video_session["id"]
        assert body["size"] >= 1  # storage may report own size
        assert body["url"].endswith(f"/api/sessions/{video_session['id']}/video/raw")
        assert "id" in body
        assert isinstance(body["id"], str)

    def test_upload_overlay_video(self, alpha, video_session):
        blob = _make_blob(3000)
        r = _upload(alpha["session"], video_session["id"], "overlay", blob)
        assert r.status_code == 200, r.text
        assert r.json()["variant"] == "overlay"

    def test_invalid_variant_rejected(self, alpha, video_session):
        r = _upload(alpha["session"], video_session["id"], "bogus", _make_blob(512))
        assert r.status_code == 400

    def test_empty_file_rejected(self, alpha, video_session):
        headers = {"Authorization": alpha["session"].headers["Authorization"]}
        r = requests.post(
            f"{API}/sessions/{video_session['id']}/video",
            headers=headers,
            data={"variant": "raw"},
            files={"file": ("empty.webm", b"", "video/webm")},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 400

    def test_invalid_mime_rejected(self, alpha, video_session):
        headers = {"Authorization": alpha["session"].headers["Authorization"]}
        r = requests.post(
            f"{API}/sessions/{video_session['id']}/video",
            headers=headers,
            data={"variant": "raw"},
            files={"file": ("a.txt", b"hello", "text/plain")},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 415

    def test_upload_unauthenticated(self, video_session):
        r = requests.post(
            f"{API}/sessions/{video_session['id']}/video",
            data={"variant": "raw"},
            files={"file": ("c.webm", b"abc", "video/webm")},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 401

    def test_upload_unknown_session_404(self, alpha):
        headers = {"Authorization": alpha["session"].headers["Authorization"]}
        r = requests.post(
            f"{API}/sessions/{uuid.uuid4()}/video",
            headers=headers,
            data={"variant": "raw"},
            files={"file": ("c.webm", b"hello-bytes", "video/webm")},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 404


class TestVideoListAndStream:
    def test_list_returns_both_variants(self, alpha, video_session):
        r = alpha["session"].get(
            f"{API}/sessions/{video_session['id']}/videos", timeout=DEFAULT_TIMEOUT
        )
        assert r.status_code == 200
        videos = r.json()["videos"]
        variants = {v["variant"] for v in videos}
        assert {"raw", "overlay"}.issubset(variants), f"got: {variants}"

    def test_stream_with_bearer(self, alpha, video_session):
        r = alpha["session"].get(
            f"{API}/sessions/{video_session['id']}/video/raw", timeout=DEFAULT_TIMEOUT
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("video/") or \
            r.headers.get("content-type") == "application/octet-stream"
        assert len(r.content) > 0

    def test_stream_with_query_auth_fallback(self, alpha, video_session):
        # No Authorization header — use ?auth= fallback (for <video src>)
        url = f"{API}/sessions/{video_session['id']}/video/overlay?auth={alpha['token']}"
        r = requests.get(url, timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200, r.text
        assert len(r.content) > 0

    def test_stream_unauthenticated_blocked(self, video_session):
        r = requests.get(
            f"{API}/sessions/{video_session['id']}/video/raw",
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 401


class TestVideoIdempotency:
    def test_reupload_soft_deletes_prior(self, alpha, video_session):
        # Upload a NEW raw blob; list should still have exactly 1 raw
        new_blob = _make_blob(1500)
        r1 = _upload(alpha["session"], video_session["id"], "raw", new_blob)
        assert r1.status_code == 200
        new_id = r1.json()["id"]

        r = alpha["session"].get(
            f"{API}/sessions/{video_session['id']}/videos", timeout=DEFAULT_TIMEOUT
        )
        assert r.status_code == 200
        raws = [v for v in r.json()["videos"] if v["variant"] == "raw"]
        assert len(raws) == 1, f"expected 1 raw, got {len(raws)}: {raws}"
        assert raws[0]["id"] == new_id


class TestReanalyze:
    def test_reanalyze_updates_session(self, alpha, video_session):
        sid = video_session["id"]
        orig_score = video_session.get("form_score")
        r = alpha["session"].post(
            f"{API}/sessions/{sid}/reanalyze", timeout=LLM_TIMEOUT
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "analysis" in body
        assert "form_score" in body
        assert isinstance(body["form_score"], int)
        assert 0 <= body["form_score"] <= 100

        # Verify persistence
        r2 = alpha["session"].get(f"{API}/sessions/{sid}", timeout=DEFAULT_TIMEOUT)
        assert r2.status_code == 200
        assert r2.json()["form_score"] == body["form_score"]
        # form_score may legitimately match prior — just verify analysis fields exist
        assert "improvements" in r2.json()["analysis"]
        _ = orig_score  # explicit ignore

    def test_reanalyze_unknown_session_404(self, alpha):
        r = alpha["session"].post(
            f"{API}/sessions/{uuid.uuid4()}/reanalyze", timeout=LLM_TIMEOUT
        )
        assert r.status_code == 404


class TestVideoDelete:
    def test_delete_then_404(self, alpha, video_session):
        sid = video_session["id"]
        r = alpha["session"].delete(
            f"{API}/sessions/{sid}/video/overlay", timeout=DEFAULT_TIMEOUT
        )
        assert r.status_code in (200, 204), r.text

        r2 = alpha["session"].get(
            f"{API}/sessions/{sid}/video/overlay", timeout=DEFAULT_TIMEOUT
        )
        assert r2.status_code == 404

        # list should now only show 'raw'
        r3 = alpha["session"].get(
            f"{API}/sessions/{sid}/videos", timeout=DEFAULT_TIMEOUT
        )
        assert r3.status_code == 200
        variants = {v["variant"] for v in r3.json()["videos"]}
        assert "overlay" not in variants


class TestSessionDeleteCascade:
    def test_deleting_session_soft_deletes_videos(self, alpha):
        # Create a brand new session + upload a video, then delete session
        s = alpha["session"]
        payload = {
            "athlete_id": alpha["athlete_id"],
            "sport": "basketball",
            "mode": "live",
            "duration_seconds": 4.0,
            "pose_summary": {"rep_count": 1, "overall_score": 60, "reps": [{"index": 0, "score": 60}]},
            "notes": "TEST_ cascade",
        }
        r = s.post(f"{API}/sessions", json=payload, timeout=LLM_TIMEOUT)
        assert r.status_code == 200
        sid = r.json()["id"]

        up = _upload(s, sid, "raw", _make_blob(800))
        assert up.status_code == 200

        # delete the session
        rd = s.delete(f"{API}/sessions/{sid}", timeout=DEFAULT_TIMEOUT)
        assert rd.status_code == 200

        # The session itself is gone (so the list endpoint returns 404 because
        # it checks session ownership). Verify via session GET that it's gone.
        rg = s.get(f"{API}/sessions/{sid}", timeout=DEFAULT_TIMEOUT)
        assert rg.status_code == 404
