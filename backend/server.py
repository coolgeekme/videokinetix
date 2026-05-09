"""VisionKinetix.ai – AI Motion Capture Athlete Training Platform – FastAPI backend."""
import logging
import os
import uuid
from datetime import date as _date
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from auth import (  # noqa: E402
    create_access_token,
    get_current_user_id,
    hash_password,
    verify_password,
)
from ai_service import analyze_form, generate_training_plan  # noqa: E402

# ---------- DB ----------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------- App ----------
app = FastAPI(title="VisionKinetix.ai API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Sports catalog ----------
SPORTS = [
    {"id": "basketball", "name": "Basketball", "tagline": "Shooting form, jump mechanics, balance", "color": "#FF6B35", "icon": "Dribbble"},
    {"id": "soccer",     "name": "Soccer",     "tagline": "Kicking power, agility, plant-foot stability", "color": "#00FF88", "icon": "Goal"},
    {"id": "swimming",   "name": "Swimming",   "tagline": "Stroke symmetry, hip rotation, kick rhythm", "color": "#007AFF", "icon": "Waves"},
    {"id": "pickleball", "name": "Pickleball", "tagline": "Paddle control, footwork, ready position", "color": "#FFAB00", "icon": "Zap"},
]
VALID_SPORTS = {s["id"] for s in SPORTS}


# ---------- Models ----------
class RegisterReq(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=80)


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class TokenResp(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: str
    name: str
    created_at: str
    primary_sport: Optional[str] = None


class AthleteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    age: Optional[int] = Field(default=None, ge=4, le=120)
    primary_sport: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class AthleteUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    age: Optional[int] = Field(default=None, ge=4, le=120)
    primary_sport: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class SessionCreate(BaseModel):
    athlete_id: str
    sport: str
    mode: str = Field(description="live | upload")
    duration_seconds: float = 0
    pose_summary: dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = None


class GoalCreate(BaseModel):
    athlete_id: str
    sport: str
    title: str = Field(min_length=1, max_length=140)
    target_score: int = Field(ge=0, le=100, default=85)
    target_date: Optional[str] = None


class GoalUpdate(BaseModel):
    completed: Optional[bool] = None
    progress: Optional[int] = None


# ---------- Helpers ----------
async def _get_or_create_self_athlete(user_id: str, user_name: str) -> dict:
    """Ensure each user has a default 'Me' athlete; return it."""
    existing = await db.athletes.find_one(
        {"user_id": user_id, "is_self": True}, {"_id": 0}
    )
    if existing:
        return existing
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": user_name or "Me",
        "age": None,
        "primary_sport": None,
        "notes": None,
        "is_self": True,
        "created_at": now_iso(),
    }
    await db.athletes.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _migrate_legacy_to_self(user_id: str, self_athlete_id: str) -> None:
    """Attach any pre-existing sessions/goals/plans without athlete_id to the Self athlete."""
    await db.sessions.update_many(
        {"user_id": user_id, "athlete_id": {"$exists": False}},
        {"$set": {"athlete_id": self_athlete_id}},
    )
    await db.goals.update_many(
        {"user_id": user_id, "athlete_id": {"$exists": False}},
        {"$set": {"athlete_id": self_athlete_id}},
    )
    await db.training_plans.update_many(
        {"user_id": user_id, "athlete_id": {"$exists": False}},
        {"$set": {"athlete_id": self_athlete_id}},
    )


async def _ensure_athlete_owned(athlete_id: str, user_id: str) -> dict:
    a = await db.athletes.find_one({"id": athlete_id, "user_id": user_id}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Athlete not found")
    return a


async def _compute_streak(query: dict) -> int:
    sessions = await db.sessions.find(query, {"_id": 0, "created_at": 1}).to_list(2000)
    if not sessions:
        return 0
    dates = sorted({s["created_at"][:10] for s in sessions}, reverse=True)
    streak = 0
    today = datetime.now(timezone.utc).date()
    for i, d in enumerate(dates):
        sess_date = _date.fromisoformat(d)
        if (today - sess_date).days == i:
            streak += 1
        else:
            break
    return streak


def _user_resp(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "created_at": user["created_at"],
        "primary_sport": user.get("primary_sport"),
    }


# ---------- Auth ----------
@api.post("/auth/register", response_model=TokenResp)
async def register(req: RegisterReq):
    existing = await db.users.find_one({"email": req.email.lower()})
    if existing:
        raise HTTPException(400, "Email already registered")

    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": req.email.lower(),
        "name": req.name.strip(),
        "password_hash": hash_password(req.password),
        "created_at": now_iso(),
        "primary_sport": None,
    }
    await db.users.insert_one(doc)
    # auto-create "Me" athlete
    await _get_or_create_self_athlete(user_id, doc["name"])
    token = create_access_token(user_id, doc["email"])
    return TokenResp(access_token=token, user=_user_resp(doc))


@api.post("/auth/login", response_model=TokenResp)
async def login(req: LoginReq):
    user = await db.users.find_one({"email": req.email.lower()}, {"_id": 0})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    # Ensure self athlete + migrate legacy data on login
    self_a = await _get_or_create_self_athlete(user["id"], user["name"])
    await _migrate_legacy_to_self(user["id"], self_a["id"])
    token = create_access_token(user["id"], user["email"])
    return TokenResp(access_token=token, user=_user_resp(user))


@api.get("/auth/me", response_model=UserPublic)
async def me(user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(404, "User not found")
    self_a = await _get_or_create_self_athlete(user_id, user["name"])
    await _migrate_legacy_to_self(user_id, self_a["id"])
    return UserPublic(**user)


# ---------- Sports ----------
@api.get("/sports")
async def list_sports():
    return {"sports": SPORTS}


# ---------- Athletes ----------
@api.post("/athletes")
async def create_athlete(req: AthleteCreate, user_id: str = Depends(get_current_user_id)):
    if req.primary_sport and req.primary_sport not in VALID_SPORTS:
        raise HTTPException(400, "Invalid primary_sport")
    athlete_id = str(uuid.uuid4())
    doc = {
        "id": athlete_id,
        "user_id": user_id,
        "name": req.name.strip(),
        "age": req.age,
        "primary_sport": req.primary_sport,
        "notes": req.notes,
        "is_self": False,
        "created_at": now_iso(),
    }
    await db.athletes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/athletes")
async def list_athletes(user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "name": 1})
    if user:
        await _get_or_create_self_athlete(user_id, user["name"])
    items = await db.athletes.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    # is_self first, then name asc
    items.sort(key=lambda a: (not a.get("is_self", False), a["name"].lower()))
    # decorate with quick stats
    decorated = []
    for a in items:
        sessions = await db.sessions.find(
            {"user_id": user_id, "athlete_id": a["id"]}, {"_id": 0, "form_score": 1, "sport": 1}
        ).to_list(1000)
        total = len(sessions)
        avg = round(sum(s.get("form_score", 0) for s in sessions) / total, 1) if total else 0
        best = max((s.get("form_score", 0) for s in sessions), default=0)
        by_sport_count: dict[str, int] = {}
        for s in sessions:
            by_sport_count[s["sport"]] = by_sport_count.get(s["sport"], 0) + 1
        decorated.append({**a, "stats": {"sessions": total, "avg_score": avg, "best_score": best, "by_sport": by_sport_count}})
    return {"athletes": decorated}


@api.get("/athletes/{athlete_id}")
async def get_athlete(athlete_id: str, user_id: str = Depends(get_current_user_id)):
    return await _ensure_athlete_owned(athlete_id, user_id)


@api.patch("/athletes/{athlete_id}")
async def update_athlete(
    athlete_id: str, req: AthleteUpdate, user_id: str = Depends(get_current_user_id)
):
    await _ensure_athlete_owned(athlete_id, user_id)
    update: dict[str, Any] = {}
    if req.name is not None:
        update["name"] = req.name.strip()
    if req.age is not None:
        update["age"] = req.age
    if req.primary_sport is not None:
        if req.primary_sport and req.primary_sport not in VALID_SPORTS:
            raise HTTPException(400, "Invalid primary_sport")
        update["primary_sport"] = req.primary_sport or None
    if req.notes is not None:
        update["notes"] = req.notes
    if not update:
        raise HTTPException(400, "Nothing to update")
    await db.athletes.update_one({"id": athlete_id, "user_id": user_id}, {"$set": update})
    return await db.athletes.find_one({"id": athlete_id}, {"_id": 0})


@api.delete("/athletes/{athlete_id}")
async def delete_athlete(athlete_id: str, user_id: str = Depends(get_current_user_id)):
    a = await _ensure_athlete_owned(athlete_id, user_id)
    if a.get("is_self"):
        raise HTTPException(400, "Cannot delete your own 'Me' athlete profile")
    # cascade: delete athlete-scoped data
    await db.sessions.delete_many({"user_id": user_id, "athlete_id": athlete_id})
    await db.goals.delete_many({"user_id": user_id, "athlete_id": athlete_id})
    await db.training_plans.delete_many({"user_id": user_id, "athlete_id": athlete_id})
    await db.athletes.delete_one({"id": athlete_id, "user_id": user_id})
    return {"deleted": True, "id": athlete_id}


@api.get("/athletes/{athlete_id}/stats")
async def athlete_stats(
    athlete_id: str,
    sport: Optional[str] = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    await _ensure_athlete_owned(athlete_id, user_id)
    q: dict[str, Any] = {"user_id": user_id, "athlete_id": athlete_id}
    if sport:
        if sport not in VALID_SPORTS:
            raise HTTPException(400, "Invalid sport")
        q["sport"] = sport
    sessions = await db.sessions.find(q, {"_id": 0}).sort("created_at", 1).to_list(1000)
    total = len(sessions)
    avg = round(sum(s.get("form_score", 0) for s in sessions) / total, 1) if total else 0
    best = max((s.get("form_score", 0) for s in sessions), default=0)
    by_sport: dict[str, int] = {}
    for s in sessions:
        by_sport[s["sport"]] = by_sport.get(s["sport"], 0) + 1
    timeline = [
        {"date": s["created_at"][:10], "score": s.get("form_score", 0), "sport": s["sport"], "session_id": s["id"]}
        for s in sessions
    ]
    streak = await _compute_streak(q)
    goals_q = {"user_id": user_id, "athlete_id": athlete_id}
    if sport:
        goals_q["sport"] = sport
    goals_total = await db.goals.count_documents(goals_q)
    goals_done = await db.goals.count_documents({**goals_q, "completed": True})
    plans_q = {"user_id": user_id, "athlete_id": athlete_id}
    if sport:
        plans_q["sport"] = sport
    plans_total = await db.training_plans.count_documents(plans_q)
    return {
        "total_sessions": total,
        "average_score": avg,
        "best_score": best,
        "by_sport": by_sport,
        "timeline": timeline,
        "streak_days": streak,
        "goals_total": goals_total,
        "goals_completed": goals_done,
        "plans_total": plans_total,
    }


# ---------- Sessions ----------
@api.post("/sessions")
async def create_session(req: SessionCreate, user_id: str = Depends(get_current_user_id)):
    if req.sport not in VALID_SPORTS:
        raise HTTPException(400, f"Invalid sport. Must be one of {sorted(VALID_SPORTS)}")
    await _ensure_athlete_owned(req.athlete_id, user_id)

    analysis = await analyze_form(req.sport, req.pose_summary or {"note": "minimal pose data"})

    # Pull keyframes (base64 images) out of the raw pose summary so we can store them
    # at the top-level of the session doc, and keep the pose_summary lighter.
    pose_summary_clean = {k: v for k, v in (req.pose_summary or {}).items() if k != "keyframes"}
    keyframes = (req.pose_summary or {}).get("keyframes") or {}
    shot_outcomes = pose_summary_clean.get("shot_outcomes")
    makes_vs_misses = pose_summary_clean.get("makes_vs_misses")

    session_id = str(uuid.uuid4())
    doc = {
        "id": session_id,
        "user_id": user_id,
        "athlete_id": req.athlete_id,
        "sport": req.sport,
        "mode": req.mode,
        "duration_seconds": req.duration_seconds,
        "pose_summary": pose_summary_clean,
        "keyframes": keyframes,
        "rep_count": pose_summary_clean.get("rep_count", 0),
        "reps": pose_summary_clean.get("reps", []),
        "consistency": pose_summary_clean.get("consistency"),
        "shot_outcomes": shot_outcomes,
        "makes_vs_misses": makes_vs_misses,
        "notes": req.notes,
        "analysis": analysis,
        "form_score": int(analysis.get("form_score", 70)),
        "created_at": now_iso(),
        "training_plan": None,
    }
    await db.sessions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/sessions")
async def list_sessions(
    athlete_id: Optional[str] = Query(default=None),
    sport: Optional[str] = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    q: dict[str, Any] = {"user_id": user_id}
    if athlete_id:
        q["athlete_id"] = athlete_id
    if sport:
        if sport not in VALID_SPORTS:
            raise HTTPException(400, "Invalid sport")
        q["sport"] = sport
    cursor = db.sessions.find(q, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(500)
    return {"sessions": items}


@api.get("/sessions/{session_id}")
async def get_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    s = await db.sessions.find_one({"id": session_id, "user_id": user_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Session not found")
    return s


@api.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.sessions.delete_one({"id": session_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Session not found")
    await db.training_plans.delete_many({"session_id": session_id, "user_id": user_id})
    return {"deleted": True, "id": session_id}


@api.post("/sessions/{session_id}/training-plan")
async def make_training_plan(
    session_id: str, user_id: str = Depends(get_current_user_id)
):
    s = await db.sessions.find_one({"id": session_id, "user_id": user_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Session not found")
    plan = await generate_training_plan(s["sport"], s.get("analysis", {}))
    plan["id"] = str(uuid.uuid4())
    plan["sport"] = s["sport"]
    plan["athlete_id"] = s.get("athlete_id")
    plan["created_at"] = now_iso()
    await db.sessions.update_one({"id": session_id}, {"$set": {"training_plan": plan}})
    await db.training_plans.insert_one(
        {**plan, "user_id": user_id, "session_id": session_id}
    )
    plan.pop("_id", None)
    return plan


@api.get("/training-plans")
async def list_training_plans(
    athlete_id: Optional[str] = Query(default=None),
    sport: Optional[str] = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    q: dict[str, Any] = {"user_id": user_id}
    if athlete_id:
        q["athlete_id"] = athlete_id
    if sport:
        if sport not in VALID_SPORTS:
            raise HTTPException(400, "Invalid sport")
        q["sport"] = sport
    cursor = db.training_plans.find(q, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(200)
    return {"plans": items}


@api.delete("/training-plans/{plan_id}")
async def delete_training_plan(plan_id: str, user_id: str = Depends(get_current_user_id)):
    plan = await db.training_plans.find_one({"id": plan_id, "user_id": user_id}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plan not found")
    await db.training_plans.delete_one({"id": plan_id, "user_id": user_id})
    session_id = plan.get("session_id")
    if session_id:
        await db.sessions.update_one(
            {"id": session_id, "user_id": user_id, "training_plan.id": plan_id},
            {"$set": {"training_plan": None}},
        )
    return {"deleted": True, "id": plan_id}


# ---------- Dashboard (cross-athlete overview) ----------
@api.get("/dashboard/overview")
async def dashboard_overview(user_id: str = Depends(get_current_user_id)):
    # ensure self athlete + migration ran
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "name": 1})
    if user:
        self_a = await _get_or_create_self_athlete(user_id, user["name"])
        await _migrate_legacy_to_self(user_id, self_a["id"])

    sessions = await db.sessions.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    athletes = await db.athletes.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    athlete_map = {a["id"]: a for a in athletes}

    total = len(sessions)
    avg = round(sum(s.get("form_score", 0) for s in sessions) / total, 1) if total else 0
    best = max((s.get("form_score", 0) for s in sessions), default=0)
    by_sport: dict[str, int] = {}
    for s in sessions:
        by_sport[s["sport"]] = by_sport.get(s["sport"], 0) + 1
    streak = await _compute_streak({"user_id": user_id})

    # leaderboard: rank athletes by avg score (min 1 session)
    leaderboard = []
    for a in athletes:
        a_sessions = [s for s in sessions if s.get("athlete_id") == a["id"]]
        if not a_sessions:
            leaderboard.append({
                "athlete_id": a["id"],
                "name": a["name"],
                "is_self": a.get("is_self", False),
                "sessions": 0,
                "avg_score": 0,
                "best_score": 0,
                "last_session_date": None,
            })
            continue
        a_avg = round(sum(s["form_score"] for s in a_sessions) / len(a_sessions), 1)
        a_best = max(s["form_score"] for s in a_sessions)
        last_date = max(s["created_at"] for s in a_sessions)
        leaderboard.append({
            "athlete_id": a["id"],
            "name": a["name"],
            "is_self": a.get("is_self", False),
            "sessions": len(a_sessions),
            "avg_score": a_avg,
            "best_score": a_best,
            "last_session_date": last_date,
        })
    leaderboard.sort(key=lambda x: (-x["avg_score"], -x["sessions"]))

    timeline = [
        {
            "date": s["created_at"][:10],
            "score": s.get("form_score", 0),
            "sport": s["sport"],
            "session_id": s["id"],
            "athlete_id": s.get("athlete_id"),
            "athlete_name": athlete_map.get(s.get("athlete_id"), {}).get("name", "—"),
        }
        for s in sessions
    ]
    goals_total = await db.goals.count_documents({"user_id": user_id})
    goals_done = await db.goals.count_documents({"user_id": user_id, "completed": True})

    return {
        "total_athletes": len(athletes),
        "total_sessions": total,
        "average_score": avg,
        "best_score": best,
        "by_sport": by_sport,
        "streak_days": streak,
        "timeline": timeline,
        "leaderboard": leaderboard,
        "goals_total": goals_total,
        "goals_completed": goals_done,
    }


# Back-compat alias for older clients
@api.get("/dashboard/stats")
async def dashboard_stats(user_id: str = Depends(get_current_user_id)):
    return await dashboard_overview(user_id=user_id)  # type: ignore[arg-type]


# ---------- Goals ----------
@api.post("/goals")
async def create_goal(req: GoalCreate, user_id: str = Depends(get_current_user_id)):
    if req.sport not in VALID_SPORTS:
        raise HTTPException(400, "Invalid sport")
    await _ensure_athlete_owned(req.athlete_id, user_id)
    goal_id = str(uuid.uuid4())
    doc = {
        "id": goal_id,
        "user_id": user_id,
        "athlete_id": req.athlete_id,
        "sport": req.sport,
        "title": req.title,
        "target_score": req.target_score,
        "target_date": req.target_date,
        "completed": False,
        "progress": 0,
        "created_at": now_iso(),
    }
    await db.goals.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/goals")
async def list_goals(
    athlete_id: Optional[str] = Query(default=None),
    sport: Optional[str] = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    q: dict[str, Any] = {"user_id": user_id}
    if athlete_id:
        q["athlete_id"] = athlete_id
    if sport:
        if sport not in VALID_SPORTS:
            raise HTTPException(400, "Invalid sport")
        q["sport"] = sport
    items = await db.goals.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"goals": items}


@api.patch("/goals/{goal_id}")
async def update_goal(goal_id: str, req: GoalUpdate, user_id: str = Depends(get_current_user_id)):
    update: dict[str, Any] = {}
    if req.completed is not None:
        update["completed"] = req.completed
    if req.progress is not None:
        update["progress"] = max(0, min(100, req.progress))
    if not update:
        raise HTTPException(400, "Nothing to update")
    res = await db.goals.update_one({"id": goal_id, "user_id": user_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Goal not found")
    g = await db.goals.find_one({"id": goal_id, "user_id": user_id}, {"_id": 0})
    return g


@api.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.goals.delete_one({"id": goal_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Goal not found")
    return {"deleted": True, "id": goal_id}


# ---------- Health ----------
@api.get("/")
async def root():
    return {"service": "VisionKinetix.ai API", "status": "ok"}


# ---------- Mount + CORS ----------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
