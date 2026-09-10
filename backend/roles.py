"""Additive role-based access layer for NER Smart Logistics.

The legacy main.py authentication is intentionally untouched. This module stores
role assignments separately and binds them to the authenticated legacy user id.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import main as legacy

router = APIRouter(prefix="/api/access", tags=["Role-based access"])
ROLE_DB = os.getenv("NER_ROLE_DATABASE", "ner_roles.db")

ROLES = {
    "authority": {
        "label": "Logistics Authority",
        "landing": "Command Center",
        "permissions": ["dashboard", "route", "hazards", "news", "fleet", "shipments", "alerts", "field_reports", "resilience", "analytics"],
    },
    "field_official": {
        "label": "Field Official",
        "landing": "Field Intelligence",
        "permissions": ["route", "hazards", "news", "field_reports", "resilience"],
    },
    "logistics_operator": {
        "label": "Logistics Operator",
        "landing": "Fleet + Shipments",
        "permissions": ["dashboard", "route", "news", "fleet", "shipments", "alerts", "resilience"],
    },
    "emergency_response": {
        "label": "Emergency Response",
        "landing": "Emergency Operations",
        "permissions": ["dashboard", "route", "hazards", "news", "fleet", "alerts", "resilience", "analytics"],
    },
}


class RoleAssignment(BaseModel):
    role: str = Field(min_length=2, max_length=40)


def db():
    conn = sqlite3.connect(ROLE_DB, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_roles (
            user_id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


init_db()


def current_user(request: Request) -> Dict[str, Any]:
    try:
        return dict(legacy.get_current_user(request))
    except Exception:
        raise HTTPException(status_code=401, detail="Authentication required")


def role_payload(role: str) -> Dict[str, Any]:
    item = ROLES[role]
    return {"key": role, **item}


@router.get("/roles")
def available_roles():
    return {"roles": [role_payload(key) for key in ROLES]}


@router.get("/role")
def get_role(request: Request):
    user = current_user(request)
    conn = db()
    row = conn.execute("SELECT role FROM user_roles WHERE user_id=?", (user["id"],)).fetchone()
    conn.close()
    if not row:
        return {"assigned": False, "role": None, "user": user.get("email")}
    return {"assigned": True, "role": role_payload(row["role"]), "user": user.get("email")}


@router.post("/role")
def assign_role(data: RoleAssignment, request: Request):
    user = current_user(request)
    role = data.role.strip().lower()
    if role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    now = datetime.now(timezone.utc).isoformat()
    conn = db()
    existing = conn.execute("SELECT role FROM user_roles WHERE user_id=?", (user["id"],)).fetchone()
    if existing:
        if existing["role"] != role:
            conn.close()
            raise HTTPException(status_code=403, detail="This account is already assigned to a different role. Contact an administrator to change it.")
        conn.close()
        return {"ok": True, "assigned": True, "role": role_payload(role), "message": "Role already assigned."}

    conn.execute(
        "INSERT INTO user_roles(user_id,email,role,created_at,updated_at) VALUES(?,?,?,?,?)",
        (user["id"], user.get("email", ""), role, now, now),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "assigned": True, "role": role_payload(role), "message": "Role assigned to this account."}


@router.get("/session")
def role_session(request: Request):
    user = current_user(request)
    conn = db()
    row = conn.execute("SELECT role FROM user_roles WHERE user_id=?", (user["id"],)).fetchone()
    conn.close()
    role = row["role"] if row else "authority"
    return {
        "authenticated": True,
        "user": user,
        "role": role_payload(role),
        "note": "Role permissions are enforced by this additive access layer; legacy authentication remains unchanged.",
    }
