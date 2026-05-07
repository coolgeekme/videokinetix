"""KINETIC backend API tests.

Covers: auth, sports, sessions (with live GPT-5.2 form analysis),
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

# Generous timeouts since GPT-5.2 is called live (may take 5-30s)
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
def alpha_session(session, user_a):
    """Create one real session for alpha (live GPT call) reused across tests."""
    payload = {
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
        assert body.get("service") == "KINETIC API"


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


# ---------- Sessions (live GPT-5.2) ----------
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

    def test_create_session_invalid_sport(self, session, user_a):
        r = session.post(
            f"{API}/sessions",
            json={"sport": "cricket", "mode": "live", "pose_summary": {}},
            headers=user_a["headers"],
            timeout=DEFAULT_TIMEOUT,
        )
        assert r.status_code == 400

    def test_create_session_unauthenticated(self, session):
        r = session.post(
            f"{API}/sessions",
            json={"sport": "soccer", "mode": "upload", "pose_summary": {}},
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


# ---------- Training plan (live GPT-5.2) ----------
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
    def test_create_and_list_goal(self, session, user_a):
        r = session.post(
            f"{API}/goals",
            json={
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

    def test_update_goal_progress_and_completion(self, session, user_a):
        # create
        r = session.post(
            f"{API}/goals",
            json={"sport": "soccer", "title": "TEST_ Soccer plant foot drill", "target_score": 80},
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

    def test_update_goal_empty_payload(self, session, user_a):
        r = session.post(
            f"{API}/goals",
            json={"sport": "swimming", "title": "TEST_ swim", "target_score": 75},
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

    def test_user_b_cannot_update_user_a_goal(self, session, user_a, user_b):
        # user_a creates goal
        r = session.post(
            f"{API}/goals",
            json={"sport": "pickleball", "title": "TEST_ private goal", "target_score": 70},
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
