"""VisionKinetix.ai backend API tests.

Covers: auth, sports, sessions (with live LLM form analysis),
training plans, dashboard stats, goals, and cross-user isolation.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # Fallback to reading frontend/.env
    from pathlib import Path
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    for line in env_path.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
API = f"{BASE_URL}/api"

# Generous timeouts since the LLM is called live (may take 5-30s)
LLM_TIMEOUT = 90
DEFAULT_TIMEOUT = 30


def _unique_email(prefix: str = "TEST_user") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}@example.com"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user_a(session):
    """Primary registered user used across most tests."""
    email = _unique_email("TEST_alpha")
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": "Pass1234!", "name": "Test Alpha"},
        timeout=DEFAULT_TIMEOUT,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "email": email,
        "password": "Pass1234!",
        "token": data["access_token"],
        "user": data["user"],
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }


@pytest.fixture(scope="module")
def user_b(session):
    """Secondary user for isolation tests."""
    email = _unique_email("TEST_beta")
    r = session.post(
        f"{API}/auth/register",
        json={"email": email, "password": "Pass1234!", "name": "Test Beta"},
        timeout=DEFAULT_TIMEOUT,
    )
    assert r.status_code == 200, f"register beta failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "email": email,
        "password": "Pass1234!",
        "token": data["access_token"],
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
        "user": data["user"],
    }


@pytest.fixture(scope="module")
def alpha_athlete_id(session, user_a):
    """Get the auto-created 'Me' athlete id for user_a."""
    r = session.get(f"{API}/athletes", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT)
    assert r.status_code == 200
    items = r.json()["athletes"]
    self_a = next((a for a in items if a.get("is_self")), None)
    assert self_a is not None, f"no self athlete found: {items}"
    return self_a["id"]


@pytest.fixture(scope="module")
def beta_athlete_id(session, user_b):
    r = session.get(f"{API}/athletes", headers=user_b["headers"], timeout=DEFAULT_TIMEOUT)
    assert r.status_code == 200
    items = r.json()["athletes"]
    self_a = next((a for a in items if a.get("is_self")), None)
    assert self_a is not None
    return self_a["id"]


@pytest.fixture(scope="module")
def alpha_session(session, user_a, alpha_athlete_id):
    """Create one real session for alpha (live GPT call) reused across tests."""
    payload = {
        "athlete_id": alpha_athlete_id,
        "sport": "basketball",
        "mode": "live",
        "duration_seconds": 12.5,
        "pose_summary": {
            "avg_left_knee_angle": 118,
            "avg_right_knee_angle": 121,
            "avg_elbow_angle": 92,
            "frames_processed": 320,
        },
        "notes": "TEST_ session created by pytest",
    }
    r = session.post(
        f"{API}/sessions", json=payload, headers=user_a["headers"], timeout=LLM_TIMEOUT
    )
    assert r.status_code == 200, f"create session failed: {r.status_code} {r.text}"
    return r.json()


# ---------- Health ----------
class TestHealth:
    def test_root(self, session):
        r = session.get(f"{API}/", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"
        assert body.get("service") == "VisionKinetix.ai API"


# ---------- Auth ----------
class TestAuth:
    def test_register_success(self, session):
        email = _unique_email("TEST_reg")
        r = session.post(
            f"{API}/auth/register",
            json={"email": email, "password": "Pass1234!", "name": "Reg User"},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["token_type"] == "bearer"
        assert isinstance(body["access_token"], str) and len(body["access_token"]) > 20
        assert body["user"]["email"] == email.lower()
        assert body["user"]["name"] == "Reg User"
        assert "id" in body["user"]

    def test_register_duplicate(self, session, user_a):
        r = session.post(
            f"{API}/auth/register",
            json={"email": user_a["email"], "password": "Pass1234!", "name": "Dup"},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 400

    def test_register_short_password(self, session):
        r = session.post(
            f"{API}/auth/register",
            json={"email": _unique_email(), "password": "abc", "name": "Short"},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 422

    def test_login_success(self, session, user_a):
        r = session.post(
            f"{API}/auth/login",
            json={"email": user_a["email"], "password": user_a["password"]},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body
        assert body["user"]["email"] == user_a["email"].lower()

    def test_login_wrong_password(self, session, user_a):
        r = session.post(
            f"{API}/auth/login",
            json={"email": user_a["email"], "password": "WrongPass!"},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 401

    def test_me_with_token(self, session, user_a):
        r = session.get(f"{API}/auth/me", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == user_a["email"].lower()
        assert body["id"] == user_a["user"]["id"]
        assert "password_hash" not in body

    def test_me_without_token(self, session):
        r = session.get(f"{API}/auth/me", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 401

    def test_me_with_invalid_token(self, session):
        r = session.get(
            f"{API}/auth/me",
            headers={"Authorization": "Bearer not-a-valid-jwt"},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 401


# ---------- Sports ----------
class TestSports:
    def test_list_sports(self, session):
        r = session.get(f"{API}/sports", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert "sports" in body
        ids = {s["id"] for s in body["sports"]}
        assert ids == {"basketball", "soccer", "swimming", "pickleball"}
        for s in body["sports"]:
            assert {"id", "name", "tagline", "color", "icon"}.issubset(s.keys())


# ---------- Sessions (live LLM) ----------
class TestSessions:
    def test_create_session_runs_form_analysis(self, alpha_session):
        s = alpha_session
        assert "id" in s
        assert s["sport"] == "basketball"
        assert s["mode"] == "live"
        assert "analysis" in s
        a = s["analysis"]
        # Validate AI shape (be tolerant since LLM responses vary slightly)
        assert "form_score" in a
        assert "strengths" in a and isinstance(a["strengths"], list)
        assert "improvements" in a and isinstance(a["improvements"], list)
        assert "elite_comparison" in a
        assert "next_focus" in a
        assert isinstance(s["form_score"], int)
        assert 0 <= s["form_score"] <= 100

    def test_create_session_invalid_sport(self, session, user_a, alpha_athlete_id):
        r = session.post(
            f"{API}/sessions",
            json={"athlete_id": alpha_athlete_id, "sport": "cricket", "mode": "live", "pose_summary": {}},
            headers=user_a["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 400

    def test_create_session_unauthenticated(self, session, alpha_athlete_id):
        r = session.post(
            f"{API}/sessions",
            json={"athlete_id": alpha_athlete_id, "sport": "soccer", "mode": "upload", "pose_summary": {}},
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 401

    def test_get_session_by_id(self, session, user_a, alpha_session):
        sid = alpha_session["id"]
        r = session.get(f"{API}/sessions/{sid}", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == sid
        assert body["sport"] == "basketball"
        assert "analysis" in body

    def test_list_sessions_sorted_desc(self, session, user_a, alpha_session):
        # alpha_session ensures at least 1 session exists
        r = session.get(f"{API}/sessions", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        items = r.json()["sessions"]
        assert len(items) >= 1
        if len(items) >= 2:
            assert items[0]["created_at"] >= items[1]["created_at"]
        # current alpha_session should be first
        assert items[0]["id"] == alpha_session["id"]


class TestSessionIsolation:
    def test_user_b_cannot_get_user_a_session(self, session, user_b, alpha_session):
        sid = alpha_session["id"]
        r = session.get(f"{API}/sessions/{sid}", headers=user_b["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 404

    def test_user_b_sessions_list_empty(self, session, user_b):
        r = session.get(f"{API}/sessions", headers=user_b["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        assert r.json()["sessions"] == []


# ---------- Training plan (live LLM) ----------
class TestTrainingPlan:
    def test_generate_plan(self, session, user_a, alpha_session):
        sid = alpha_session["id"]
        r = session.post(
            f"{API}/sessions/{sid}/training-plan",
            headers=user_a["headers"],
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, f"plan generation failed: {r.text}"
        plan = r.json()
        assert "id" in plan
        assert plan["sport"] == "basketball"
        assert "weekly_schedule" in plan
        assert "focus_areas" in plan and isinstance(plan["focus_areas"], list)
        assert "form_cues" in plan and isinstance(plan["form_cues"], list)
        assert "milestones" in plan

        # Verify persistence on session doc
        r2 = session.get(
            f"{API}/sessions/{sid}", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT
        )
        assert r2.status_code == 200
        assert r2.json().get("training_plan") is not None

    def test_plan_for_other_user_session_404(self, session, user_b, alpha_session):
        r = session.post(
            f"{API}/sessions/{alpha_session['id']}/training-plan",
            headers=user_b["headers"],
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 404

    def test_list_training_plans(self, session, user_a):
        r = session.get(f"{API}/training-plans", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        plans = r.json()["plans"]
        assert isinstance(plans, list)
        assert len(plans) >= 1

    def test_user_b_training_plans_empty(self, session, user_b):
        r = session.get(f"{API}/training-plans", headers=user_b["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        assert r.json()["plans"] == []


# ---------- Dashboard ----------
class TestDashboard:
    def test_stats_for_user_a(self, session, user_a, alpha_session):
        r = session.get(f"{API}/dashboard/stats", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        for key in [
            "total_sessions",
            "average_score",
            "best_score",
            "by_sport",
            "timeline",
            "streak_days",
            "goals_total",
            "goals_completed",
        ]:
            assert key in body, f"missing {key}"
        assert body["total_sessions"] >= 1
        assert body["best_score"] >= 0
        assert "basketball" in body["by_sport"]
        assert isinstance(body["timeline"], list)
        assert body["streak_days"] >= 1  # alpha_session created today

    def test_stats_for_empty_user(self, session, user_b):
        r = session.get(f"{API}/dashboard/stats", headers=user_b["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["total_sessions"] == 0
        assert body["average_score"] == 0
        assert body["best_score"] == 0
        assert body["streak_days"] == 0


# ---------- Goals ----------
class TestGoals:
    def test_create_and_list_goal(self, session, user_a, alpha_athlete_id):
        r = session.post(
            f"{API}/goals",
            json={
                "athlete_id": alpha_athlete_id,
                "sport": "basketball",
                "title": "TEST_ Reach 90 form score",
                "target_score": 90,
            },
            headers=user_a["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 200
        g = r.json()
        assert g["title"] == "TEST_ Reach 90 form score"
        assert g["sport"] == "basketball"
        assert g["target_score"] == 90
        assert g["completed"] is False
        assert g["progress"] == 0
        gid = g["id"]

        r2 = session.get(f"{API}/goals", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT)
        assert r2.status_code == 200
        ids = [x["id"] for x in r2.json()["goals"]]
        assert gid in ids

    def test_update_goal_progress_and_completion(self, session, user_a, alpha_athlete_id):
        # create
        r = session.post(
            f"{API}/goals",
            json={"athlete_id": alpha_athlete_id, "sport": "soccer", "title": "TEST_ Soccer plant foot drill", "target_score": 80},
            headers=user_a["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        gid = r.json()["id"]

        # update progress
        r2 = session.patch(
            f"{API}/goals/{gid}",
            json={"progress": 55},
            headers=user_a["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        assert r2.status_code == 200
        assert r2.json()["progress"] == 55

        # mark complete
        r3 = session.patch(
            f"{API}/goals/{gid}",
            json={"completed": True},
            headers=user_a["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        assert r3.status_code == 200
        assert r3.json()["completed"] is True

        # verify dashboard reflects completed goal
        time.sleep(0.3)
        r4 = session.get(f"{API}/dashboard/stats", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT)
        assert r4.status_code == 200
        body = r4.json()
        assert body["goals_completed"] >= 1
        assert body["goals_total"] >= body["goals_completed"]

    def test_update_goal_empty_payload(self, session, user_a, alpha_athlete_id):
        r = session.post(
            f"{API}/goals",
            json={"athlete_id": alpha_athlete_id, "sport": "swimming", "title": "TEST_ swim", "target_score": 75},
            headers=user_a["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        gid = r.json()["id"]
        r2 = session.patch(
            f"{API}/goals/{gid}", json={}, headers=user_a["headers"], timeout=DEFAULT_TIMEOUT
        )
        assert r2.status_code == 400

    def test_update_nonexistent_goal(self, session, user_a):
        r = session.patch(
            f"{API}/goals/{uuid.uuid4()}",
            json={"progress": 10},
            headers=user_a["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 404

    def test_user_b_cannot_update_user_a_goal(self, session, user_a, user_b, alpha_athlete_id):
        # user_a creates goal
        r = session.post(
            f"{API}/goals",
            json={"athlete_id": alpha_athlete_id, "sport": "pickleball", "title": "TEST_ private goal", "target_score": 70},
            headers=user_a["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        gid = r.json()["id"]
        # user_b tries to update
        r2 = session.patch(
            f"{API}/goals/{gid}",
            json={"completed": True},
            headers=user_b["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        assert r2.status_code == 404

    def test_user_b_goals_list_empty(self, session, user_b):
        r = session.get(f"{API}/goals", headers=user_b["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        assert r.json()["goals"] == []


# ---------- NEW: Basketball shot_outcomes / makes_vs_misses (live LLM) ----------
class TestShotOutcomes:
    """Verifies the new ball-trajectory + hoop-ROI outcome correlation pipeline."""

    SHOT_POSE_SUMMARY = {
        "rep_count": 8,
        "overall_score": 74,
        "consistency": 78,
        "reps": [
            {"index": i, "score": 70 + (i % 5), "elbow_angle": 165 if i < 5 else 148}
            for i in range(8)
        ],
        "shot_outcomes": {
            "makes": 5,
            "attempts": 8,
            "fg_pct": 63,
            "shots": [
                {"t": 1.2, "outcome": "make"},
                {"t": 2.4, "outcome": "make"},
                {"t": 3.7, "outcome": "miss"},
                {"t": 5.1, "outcome": "make"},
                {"t": 6.5, "outcome": "miss"},
                {"t": 7.9, "outcome": "make"},
                {"t": 9.3, "outcome": "miss"},
                {"t": 10.7, "outcome": "make"},
            ],
        },
        "makes_vs_misses": {
            "shooting_elbow_angle": {
                "makes_avg": 165.2,
                "misses_avg": 148.7,
                "delta": 16.5,
                "makes_n": 5,
                "misses_n": 3,
            },
            "knee_bend_depth": {
                "makes_avg": 122.4,
                "misses_avg": 118.9,
                "delta": 3.5,
                "makes_n": 5,
                "misses_n": 3,
            },
        },
    }

    @pytest.fixture(scope="class")
    def shot_session(self, session, user_a, alpha_athlete_id):
        payload = {
            "athlete_id": alpha_athlete_id,
            "sport": "basketball",
            "mode": "upload",
            "duration_seconds": 12.0,
            "pose_summary": self.SHOT_POSE_SUMMARY,
            "notes": "TEST_ shot outcomes session",
        }
        r = session.post(
            f"{API}/sessions", json=payload, headers=user_a["headers"], timeout=LLM_TIMEOUT
        )
        assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
        return r.json()

    def test_session_persists_shot_outcomes_at_top_level(self, shot_session):
        # Top-level fields populated
        assert "shot_outcomes" in shot_session
        assert "makes_vs_misses" in shot_session
        so = shot_session["shot_outcomes"]
        assert so["makes"] == 5
        assert so["attempts"] == 8
        assert so["fg_pct"] == 63
        assert isinstance(so.get("shots"), list)
        assert len(so["shots"]) == 8

        mvm = shot_session["makes_vs_misses"]
        assert "shooting_elbow_angle" in mvm
        assert mvm["shooting_elbow_angle"]["delta"] == 16.5

    def test_get_session_returns_shot_outcomes(self, session, user_a, shot_session):
        sid = shot_session["id"]
        r = session.get(f"{API}/sessions/{sid}", headers=user_a["headers"], timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert body["shot_outcomes"]["makes"] == 5
        assert body["shot_outcomes"]["attempts"] == 8
        assert body["makes_vs_misses"]["shooting_elbow_angle"]["delta"] == 16.5

    def test_analysis_references_makes_attempts(self, shot_session):
        a = shot_session["analysis"]
        # Required AI fields present
        for k in ("form_score", "summary", "improvements", "elite_comparison", "next_focus"):
            assert k in a, f"missing analysis key: {k}"
        # The deterministic copy of shot_outcomes should be re-attached to analysis
        assert a.get("shot_outcomes", {}).get("makes") == 5
        assert a.get("makes_vs_misses", {}).get("shooting_elbow_angle", {}).get("delta") == 16.5
        # The summary should reference makes/attempts/FG numbers — we look for any
        # of "5", "8", "63", or the words make/miss/FG to be tolerant of LLM phrasing.
        text = (
            (a.get("summary") or "")
            + " "
            + " ".join(
                (imp.get("issue", "") + " " + imp.get("fix", ""))
                for imp in a.get("improvements", [])
                if isinstance(imp, dict)
            )
        ).lower()
        markers = ["make", "miss", "fg", "5/8", "63", "attempt"]
        assert any(m in text for m in markers), (
            f"analysis text does not reference shot outcomes. summary={a.get('summary')!r}"
        )

    def test_training_plan_references_outcomes(self, session, user_a, shot_session):
        sid = shot_session["id"]
        r = session.post(
            f"{API}/sessions/{sid}/training-plan",
            headers=user_a["headers"],
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, f"plan failed: {r.text}"
        plan = r.json()
        assert plan["sport"] == "basketball"
        assert isinstance(plan.get("weekly_schedule"), list)
        # Check all drill text for references to elbow / form / shooting cues
        all_text = " ".join(
            [plan.get("title", "")]
            + plan.get("focus_areas", [])
            + plan.get("form_cues", [])
            + [
                (d.get("name", "") + " " + d.get("purpose", "") + " " + d.get("cue", ""))
                for day in plan.get("weekly_schedule", [])
                for d in day.get("drills", [])
            ]
        ).lower()
        # Should mention elbow (largest delta) or shooting-related cues
        assert any(k in all_text for k in ["elbow", "shoot", "release", "follow", "form"]), (
            f"plan does not reference shooting form: {all_text[:500]}"
        )

    # ---------- Regression: basketball without shot_outcomes still works ----------
    def test_basketball_without_shot_outcomes_still_works(self, session, user_a, alpha_athlete_id):
        payload = {
            "athlete_id": alpha_athlete_id,
            "sport": "basketball",
            "mode": "live",
            "duration_seconds": 8.0,
            "pose_summary": {
                "rep_count": 4,
                "overall_score": 70,
                "reps": [{"index": i, "score": 70 + i} for i in range(4)],
            },
        }
        r = session.post(
            f"{API}/sessions", json=payload, headers=user_a["headers"], timeout=LLM_TIMEOUT
        )
        assert r.status_code == 200
        body = r.json()
        assert body["sport"] == "basketball"
        assert body.get("shot_outcomes") is None
        assert body.get("makes_vs_misses") is None
        assert "analysis" in body
        assert "form_score" in body["analysis"]

    # ---------- Regression: non-basketball still works ----------
    def test_soccer_session_unaffected(self, session, user_a, alpha_athlete_id):
        payload = {
            "athlete_id": alpha_athlete_id,
            "sport": "soccer",
            "mode": "upload",
            "duration_seconds": 9.0,
            "pose_summary": {
                "rep_count": 3,
                "overall_score": 72,
                "reps": [{"index": i, "score": 72 + i} for i in range(3)],
            },
        }
        r = session.post(
            f"{API}/sessions", json=payload, headers=user_a["headers"], timeout=LLM_TIMEOUT
        )
        assert r.status_code == 200
        body = r.json()
        assert body["sport"] == "soccer"
        assert body.get("shot_outcomes") is None
        assert body.get("makes_vs_misses") is None
        assert "analysis" in body
