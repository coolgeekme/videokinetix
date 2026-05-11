"""Emergent-managed object storage helpers.

Used to persist user-uploaded video files (raw + skeleton-overlay variants)
so sessions can be replayed later. All file metadata is stored in MongoDB
(`session_videos` collection) — storage is just the binary blob backend.

The init_storage call returns a session-scoped storage key that must be
kept module-level and reused for every put/get call.
"""
import logging
import os
import uuid
from typing import Optional

import requests

logger = logging.getLogger(__name__)

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "visionkinetix"

_storage_key: Optional[str] = None


def _emergent_key() -> str:
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY is not set")
    return key


def init_storage() -> str:
    """Initialize the storage session once; reuse the returned key globally."""
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": _emergent_key()},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    logger.info("Object storage initialized")
    return _storage_key


def _reset_key() -> None:
    global _storage_key
    _storage_key = None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload bytes to storage. Returns {"path", "size", "etag"}."""
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=180,
    )
    if resp.status_code == 403:
        # Key expired — get a fresh one and retry once.
        _reset_key()
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=180,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    """Download bytes from storage. Returns (content, content_type)."""
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=120,
    )
    if resp.status_code == 403:
        _reset_key()
        key = init_storage()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=120,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def build_video_path(user_id: str, session_id: str, variant: str, ext: str) -> str:
    """Canonical storage path for a session video."""
    safe_ext = (ext or "webm").lower().lstrip(".")
    return (
        f"{APP_NAME}/videos/{user_id}/{session_id}/"
        f"{variant}-{uuid.uuid4().hex}.{safe_ext}"
    )
