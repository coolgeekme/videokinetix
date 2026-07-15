"""Credential-free local API for exercising athlete identity tracking only."""

import json
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.middleware.cors import CORSMiddleware

from tracking_service import (
    TrackingSessionManager,
    TrackingSessionNotFoundError,
    TrackingUnavailableError,
)


app = FastAPI(title="Vision Kinetix Local Tracking API")
manager = TrackingSessionManager()
LOCAL_USER_ID = "local-tracking-test"

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "Vision Kinetix local tracking API",
        **manager.status(),
    }


@app.get("/api/tracking/status")
async def tracking_status():
    return manager.status()


@app.post("/api/tracking/sessions")
async def create_tracking_session():
    try:
        session_id = manager.create_session(LOCAL_USER_ID)
    except TrackingUnavailableError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {
        "session_id": session_id,
        "engine": "roboflow-botsort",
        "camera_motion_compensation": True,
    }


@app.post("/api/tracking/sessions/{session_id}/frame")
async def update_tracking_session(
    session_id: str,
    detections: str = Form(...),
    timestamp: Optional[float] = Form(default=None),
    frame: Optional[UploadFile] = File(default=None),
):
    try:
        payload = json.loads(detections)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "detections must be valid JSON") from exc
    raw_detections = payload.get("detections") if isinstance(payload, dict) else None
    if not isinstance(raw_detections, list):
        raise HTTPException(400, "detections must contain a list")

    try:
        frame_bytes = await frame.read(2_000_001) if frame is not None else None
        if frame_bytes and len(frame_bytes) > 2_000_000:
            raise HTTPException(413, "Tracking frame must be 2 MB or smaller")
        frame_image = manager.decode_frame(frame_bytes)
        tracks = manager.update_session(
            LOCAL_USER_ID,
            session_id,
            raw_detections,
            frame=frame_image,
            timestamp=timestamp,
        )
    except TrackingUnavailableError as exc:
        raise HTTPException(503, str(exc)) from exc
    except TrackingSessionNotFoundError as exc:
        raise HTTPException(404, "Tracking session not found or expired") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"tracks": tracks, "timestamp": timestamp}


@app.delete("/api/tracking/sessions/{session_id}")
async def delete_tracking_session(session_id: str):
    if not manager.delete_session(LOCAL_USER_ID, session_id):
        raise HTTPException(404, "Tracking session not found")
    return {"deleted": True, "session_id": session_id}

