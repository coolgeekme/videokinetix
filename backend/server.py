"""KINETIC – AI Motion Capture Athlete Training Platform – FastAPI backend."""
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException
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
app = FastAPI(title="KINETIC API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


class SessionCreate(BaseModel):
    sport: str
    mode: str = Field(description="live | upload")
    duration_seconds: float = 0
    pose_summary: dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = None


class GoalCreate(BaseModel):
    sport: str
    title: str = Field(min_length=1, max_length=140)
    target_score: int = Field(ge=0, le=100, default=85)
    target_date: Optional[str] = None


class GoalUpdate(BaseModel):
    completed: Optional[bool] = None
    progress: Optional[int] = None


# ---------- Sports catalog ----------
SPORTS = [
    {
        "id": "basketball",
        "name": "Basketball",
        "tagline": "Shooting form, jump mechanics, balance",
        "color": "#FF6B35",
        "icon": "Dribbble",
    },
    {
        "id": "soccer",
        "name": "Soccer",
        "tagline": "Kicking power, agility, plant-foot stability",
        "color": "#00FF88",
        "icon": "Goal",
    },
    {
        "id": "swimming",
        "name": "Swimming",
        "tagline": "Stroke symmetry, hip rotation, kick rhythm",
        "color": "#007AFF",
        "icon": "Waves",
    },
    {
        "id": "pickleball",
        "name": "Pickleball",
        "tagline": "Paddle control, footwork, ready position",
        "color": "#FFAB00",
        "icon": "Zap",
    },
]


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
    token = create_access_token(user_id, doc["email"])
    return TokenResp(
        access_token=token,
        user={
            "id": user_id,
            "email": doc["email"],
            "name": doc["name"],
            "created_at": doc["created_at"],
            "primary_sport": None,
        },
    )


@api.post("/auth/login", response_model=TokenResp)
async def login(req: LoginReq):
    user = await db.users.find_one({"email": req.email.lower()}, {"_id": 0})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    token = create_access_token(user["id"], user["email"])
    return TokenResp(
        access_token=token,
        user={
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "created_at": user["created_at"],
            "primary_sport": user.get("primary_sport"),
        },
    )


@api.get("/auth/me", response_model=UserPublic)
async def me(user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(404, "User not found")
    return UserPublic(**user)


# ---------- Sports ----------
@api.get("/sports")
async def list_sports():
    return {"sports": SPORTS}


# ---------- Sessions ----------
@api.post("/sessions")
async def create_session(req: SessionCreate, user_id: str = Depends(get_current_user_id)):
    valid_sports = {s["id"] for s in SPORTS}
    if req.sport not in valid_sports:
        raise HTTPException(400, f"Invalid sport. Must be one of {sorted(valid_sports)}")

    analysis = await analyze_form(req.sport, req.pose_summary or {"note": "minimal pose data"})

    session_id = str(uuid.uuid4())
    doc = {
        "id": session_id,
        "user_id": user_id,
        "sport": req.sport,
        "mode": req.mode,
        "duration_seconds": req.duration_seconds,
        "pose_summary": req.pose_summary,
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
async def list_sessions(user_id: str = Depends(get_current_user_id)):
    cursor = db.sessions.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(200)
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
    # cascade: remove training plans tied to this session
    await db.training_plans.delete_many({"session_id": session_id, "user_id": user_id})
    return {"deleted": True, "id": session_id}


@api.post("/sessions/{session_id}/training-plan")
async def make_training_plan(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    s = await db.sessions.find_one({"id": session_id, "user_id": user_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Session not found")
    plan = await generate_training_plan(s["sport"], s.get("analysis", {}))
    plan["id"] = str(uuid.uuid4())
    plan["sport"] = s["sport"]
    plan["created_at"] = now_iso()
    await db.sessions.update_one({"id": session_id}, {"$set": {"training_plan": plan}})
    await db.training_plans.insert_one({**plan, "user_id": user_id, "session_id": session_id})
    plan.pop("_id", None)
    return plan


@api.get("/training-plans")
async def list_training_plans(user_id: str = Depends(get_current_user_id)):
    cursor = db.training_plans.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(100)
    return {"plans": items}


@api.delete("/training-plans/{plan_id}")
async def delete_training_plan(plan_id: str, user_id: str = Depends(get_current_user_id)):
    plan = await db.training_plans.find_one({"id": plan_id, "user_id": user_id}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plan not found")
    await db.training_plans.delete_one({"id": plan_id, "user_id": user_id})
    # also clear from session's embedded copy if present
    session_id = plan.get("session_id")
    if session_id:
        await db.sessions.update_one(
            {"id": session_id, "user_id": user_id, "training_plan.id": plan_id},
            {"$set": {"training_plan": None}},
        )
    return {"deleted": True, "id": plan_id}


# ---------- Dashboard ----------
@api.get("/dashboard/stats")
async def dashboard_stats(user_id: str = Depends(get_current_user_id)):
    sessions = await db.sessions.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    total = len(sessions)
    avg_score = round(sum(s.get("form_score", 0) for s in sessions) / total, 1) if total else 0
    best_score = max((s.get("form_score", 0) for s in sessions), default=0)
    by_sport: dict[str, int] = {}
    for s in sessions:
        by_sport[s["sport"]] = by_sport.get(s["sport"], 0) + 1
    timeline = [
        {
            "date": s["created_at"][:10],
            "score": s.get("form_score", 0),
            "sport": s["sport"],
            "session_id": s["id"],
        }
        for s in sessions
    ]
    streak = await _compute_streak(user_id)
    goals = await db.goals.count_documents({"user_id": user_id})
    completed_goals = await db.goals.count_documents({"user_id": user_id, "completed": True})
    return {
        "total_sessions": total,
        "average_score": avg_score,
        "best_score": best_score,
        "by_sport": by_sport,
        "timeline": timeline,
        "streak_days": streak,
        "goals_total": goals,
        "goals_completed": completed_goals,
    }


async def _compute_streak(user_id: str) -> int:
    sessions = await db.sessions.find({"user_id": user_id}, {"_id": 0, "created_at": 1}).to_list(1000)
    if not sessions:
        return 0
    dates = sorted({s["created_at"][:10] for s in sessions}, reverse=True)
    streak = 0
    today = datetime.now(timezone.utc).date()
    for i, d in enumerate(dates):
        from datetime import date as _date
        sess_date = _date.fromisoformat(d)
        if (today - sess_date).days == i:
            streak += 1
        else:
            break
    return streak


# ---------- Goals ----------
@api.post("/goals")
async def create_goal(req: GoalCreate, user_id: str = Depends(get_current_user_id)):
    goal_id = str(uuid.uuid4())
    doc = {
        "id": goal_id,
        "user_id": user_id,
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
async def list_goals(user_id: str = Depends(get_current_user_id)):
    items = await db.goals.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
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
    return {"service": "KINETIC API", "status": "ok"}


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
