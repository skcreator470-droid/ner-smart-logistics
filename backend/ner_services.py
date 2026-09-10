"""Additive real-data APIs for NER Smart Logistics.

IMPORTANT: This module intentionally does not modify the legacy main.py.
It imports the existing FastAPI app helpers and adds a separate router.
"""
from __future__ import annotations

import base64
import hashlib
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import main as legacy

router = APIRouter(prefix="/api", tags=["NER real-data extensions"])

EXT_DATABASE = os.getenv("NER_EXT_DATABASE", "ner_extensions.db")
UPLOAD_ROOT = os.getenv("NER_FIELD_UPLOAD_DIR", "uploads/field_reports")
OSRM_URL = getattr(legacy, "OSRM_URL", "https://router.project-osrm.org")

NER_STATES = [
    "Arunachal Pradesh", "Assam", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Sikkim", "Tripura",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ext_db() -> sqlite3.Connection:
    conn = sqlite3.connect(EXT_DATABASE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_extension_db() -> None:
    conn = ext_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS field_reports (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            reporter_name TEXT,
            incident_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            description TEXT NOT NULL,
            state TEXT,
            district TEXT,
            lat REAL,
            lon REAL,
            source TEXT NOT NULL DEFAULT 'field_report',
            status TEXT NOT NULL DEFAULT 'reported',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_field_reports_state ON field_reports(state)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_field_reports_created ON field_reports(created_at)"
    )
    conn.commit()
    conn.close()


init_extension_db()
os.makedirs(UPLOAD_ROOT, exist_ok=True)


class FieldReportCreate(BaseModel):
    incident_type: str = Field(min_length=2, max_length=80)
    severity: str = Field(min_length=2, max_length=20)
    description: str = Field(min_length=3, max_length=4000)
    state: Optional[str] = None
    district: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    client_id: Optional[str] = None


class PhotoUpload(BaseModel):
    filename: str = Field(min_length=1, max_length=180)
    content_base64: str = Field(min_length=10)
    mime_type: str = Field(default="image/jpeg", max_length=100)


class AlternateRouteRequest(BaseModel):
    start_lon: float
    start_lat: float
    end_lon: float
    end_lat: float
    alternatives: int = Field(default=2, ge=1, le=3)


class DisruptionPredictionRequest(BaseModel):
    route_risk_score: float = Field(default=0, ge=0, le=100)
    precipitation_mm: float = Field(default=0, ge=0)
    wind_kmh: float = Field(default=0, ge=0)
    temperature_c: Optional[float] = None
    high_severity_hazards: int = Field(default=0, ge=0)
    field_reports: int = Field(default=0, ge=0)



def auth(request: Request) -> Dict[str, Any]:
    return dict(legacy.get_current_user(request))


def validate_state(state: Optional[str]) -> Optional[str]:
    if not state:
        return None
    value = state.strip()
    if value not in NER_STATES:
        raise HTTPException(status_code=400, detail="State must be one of the 8 NER states")
    return value


def rows_to_dict(rows: List[sqlite3.Row]) -> List[Dict[str, Any]]:
    return [dict(r) for r in rows]


@router.get("/field-reports")
def list_field_reports(request: Request, state: Optional[str] = None, limit: int = 100):
    auth(request)
    state = validate_state(state)
    limit = max(1, min(limit, 500))
    conn = ext_db()
    if state:
        rows = conn.execute(
            "SELECT * FROM field_reports WHERE state=? ORDER BY created_at DESC LIMIT ?",
            (state, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM field_reports ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    return {"live": True, "source": "Authenticated field reports", "reports": rows_to_dict(rows)}


@router.post("/field-reports")
def create_field_report(data: FieldReportCreate, request: Request):
    user = auth(request)
    state = validate_state(data.state)
    report_id = str(uuid.uuid4())
    now = utc_now()
    conn = ext_db()
    conn.execute(
        """
        INSERT INTO field_reports
        (id,user_id,reporter_name,incident_type,severity,description,state,district,lat,lon,source,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            report_id,
            user.get("id"),
            user.get("name") or user.get("email") or "Authenticated user",
            data.incident_type.strip(),
            data.severity.strip(),
            data.description.strip(),
            state,
            (data.district or "").strip() or None,
            data.lat,
            data.lon,
            "field_report",
            "reported",
            now,
            now,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM field_reports WHERE id=?", (report_id,)).fetchone()
    conn.close()
    return {"ok": True, "report": dict(row)}


@router.post("/field-reports/{report_id}/photo")
def upload_field_report_photo(report_id: str, data: PhotoUpload, request: Request):
    auth(request)
    conn = ext_db()
    exists = conn.execute("SELECT id FROM field_reports WHERE id=?", (report_id,)).fetchone()
    conn.close()
    if not exists:
        raise HTTPException(status_code=404, detail="Field report not found")

    if not data.mime_type.lower().startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image evidence is accepted")

    try:
        raw = base64.b64decode(data.content_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")

    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image exceeds 8 MB limit")

    safe_name = os.path.basename(data.filename).replace(" ", "_") or "evidence.jpg"
    digest = hashlib.sha256(raw).hexdigest()[:16]
    ext = os.path.splitext(safe_name)[1].lower() or ".jpg"
    filename = f"{report_id}_{digest}{ext}"
    path = os.path.join(UPLOAD_ROOT, filename)
    with open(path, "wb") as fh:
        fh.write(raw)

    return {
        "ok": True,
        "report_id": report_id,
        "stored": True,
        "filename": filename,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "note": "Evidence stored on the backend; expose through a secured object store/CDN for production scale.",
    }


@router.post("/field-reports/sync")
def sync_field_reports(items: List[FieldReportCreate], request: Request):
    # Reuse the same authenticated identity for all offline-synced reports.
    auth(request)
    created = []
    for item in items[:100]:
        result = create_field_report(item, request)
        created.append(result["report"])
    return {"ok": True, "synced": len(created), "reports": created}


@router.get("/connectivity/districts")
def district_connectivity(request: Request):
    auth(request)
    conn = ext_db()
    rows = conn.execute(
        """
        SELECT state, district, severity, COUNT(*) AS reports, MAX(created_at) AS last_report
        FROM field_reports
        WHERE state IS NOT NULL
        GROUP BY state, district, severity
        ORDER BY last_report DESC
        """
    ).fetchall()
    conn.close()

    # This is an evidence-based operational signal, NOT a claim that a road is open/closed.
    grouped: Dict[str, Dict[str, Any]] = {}
    severity_weight = {"low": 1, "medium": 2, "high": 3, "critical": 4}
    for row in rows:
        key = f"{row['state']}|{row['district'] or 'Unknown district'}"
        item = grouped.setdefault(key, {
            "state": row["state"],
            "district": row["district"] or "Unknown district",
            "status": "No verified road status",
            "evidence": [],
            "risk_score": 0,
        })
        weight = severity_weight.get(str(row["severity"]).lower(), 1)
        item["risk_score"] = max(item["risk_score"], min(100, weight * 20 + min(40, row["reports"] * 5)))
        item["evidence"].append({
            "type": "field_report",
            "severity": row["severity"],
            "reports": row["reports"],
            "last_report": row["last_report"],
        })
        item["status"] = "Disruption reported" if weight >= 3 else "Risk elevated"

    return {
        "live": True,
        "source": "Authenticated geo-tagged field reports",
        "status_semantics": ["Disruption reported", "Risk elevated", "No verified road status"],
        "districts": list(grouped.values()),
    }


@router.get("/incidents")
def incidents(request: Request, state: Optional[str] = None):
    auth(request)
    state = validate_state(state)
    conn = ext_db()
    if state:
        rows = conn.execute(
            "SELECT * FROM field_reports WHERE state=? ORDER BY created_at DESC LIMIT 200", (state,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM field_reports ORDER BY created_at DESC LIMIT 200"
        ).fetchall()
    conn.close()
    return {"live": True, "source": "Field reports", "incidents": rows_to_dict(rows)}


@router.post("/predict-disruption")
def predict_disruption(data: DisruptionPredictionRequest, request: Request):
    auth(request)
    score = data.route_risk_score
    reasons: List[str] = []
    if data.precipitation_mm >= 20:
        score += 18
        reasons.append("Heavy precipitation increases disruption risk")
    elif data.precipitation_mm >= 5:
        score += 7
        reasons.append("Rainfall is contributing to route risk")
    if data.wind_kmh >= 50:
        score += 12
        reasons.append("Strong wind increases exposure")
    elif data.wind_kmh >= 30:
        score += 5
        reasons.append("Elevated wind is contributing to exposure")
    if data.high_severity_hazards:
        score += min(30, data.high_severity_hazards * 10)
        reasons.append(f"{data.high_severity_hazards} high-severity government hazard(s) reported")
    if data.field_reports:
        score += min(20, data.field_reports * 4)
        reasons.append(f"{data.field_reports} field report(s) add local evidence")
    if data.temperature_c is not None and (data.temperature_c >= 40 or data.temperature_c <= 0):
        score += 5
        reasons.append("Temperature is at an operational extreme")

    score = round(max(0, min(100, score)), 1)
    level = "LOW" if score < 25 else "MODERATE" if score < 50 else "HIGH" if score < 75 else "CRITICAL"
    return {
        "live": True,
        "type": "interpretable decision-support model",
        "risk_score": score,
        "risk_level": level,
        "reasons": reasons or ["No elevated signal detected from supplied inputs"],
        "warning": "This is a decision-support score, not a claim of a confirmed future incident.",
    }


@router.post("/alternate-routes")
def alternate_routes(data: AlternateRouteRequest, request: Request):
    auth(request)
    coords = f"{data.start_lon},{data.start_lat};{data.end_lon},{data.end_lat}"
    try:
        response = requests.get(
            f"{OSRM_URL}/route/v1/driving/{coords}",
            params={
                "alternatives": str(data.alternatives),
                "steps": "true",
                "overview": "full",
                "geometries": "geojson",
            },
            timeout=20,
            headers={"User-Agent": "NER-Smart-Logistics/1.0"},
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Routing service unavailable: {exc}")

    if payload.get("code") != "Ok":
        raise HTTPException(status_code=404, detail="No real road route found")

    routes = []
    for idx, route in enumerate(payload.get("routes", [])):
        routes.append({
            "rank": idx + 1,
            "distance_km": round(route.get("distance", 0) / 1000, 2),
            "duration_min": round(route.get("duration", 0) / 60, 1),
            "geometry": route.get("geometry"),
            "steps": route.get("legs", []),
            "source": "OpenStreetMap via OSRM",
            "real_route": True,
        })
    return {"live": True, "source": "OpenStreetMap/OSRM", "routes": routes}


class CorridorIntelligenceRequest(BaseModel):
    start_lon: float
    start_lat: float
    end_lon: float
    end_lat: float
    start_name: str = "Start"
    destination_name: str = "Destination"


def _point_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import radians, sin, cos, asin, sqrt
    r = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


def _field_reports_near_geometry(geometry: list, max_km: float = 3.0) -> list:
    conn = ext_db()
    rows = conn.execute(
        "SELECT * FROM field_reports WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY created_at DESC LIMIT 500"
    ).fetchall()
    conn.close()
    matches = []
    for row in rows:
        r = dict(row)
        best = min((_point_distance_km(float(r["lat"]), float(r["lon"]), float(pt[0]), float(pt[1])) for pt in geometry), default=999999)
        if best <= max_km:
            r["distance_to_route_km"] = round(best, 2)
            matches.append(r)
    return matches


@router.post("/corridor-intelligence")
def corridor_intelligence(data: CorridorIntelligenceRequest, request: Request):
    """Combine live routing, weather, government hazards and field evidence.

    This endpoint is additive and intentionally leaves main.py untouched.
    It never invents a road closure; field reports are labelled as reports and
    government warnings remain distinct from inferred/modelled risk.
    """
    auth(request)
    try:
        routes = legacy.get_route(data.start_lat, data.start_lon, data.end_lat, data.end_lon)
        hazards = legacy.sachet_feed.get_alerts()
        weather = legacy.get_weather(data.end_lat, data.end_lon)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Live corridor intelligence unavailable: {exc}")

    results = []
    for idx, raw_route in enumerate(routes):
        evaluated = legacy.build_route_result(
            raw_route, data.start_name, data.destination_name, weather, hazards
        )
        field = _field_reports_near_geometry(evaluated.get("geometry") or [])
        high_field = sum(1 for x in field if str(x.get("severity", "")).lower() in {"high", "critical"})
        base = float(evaluated.get("risk_score") or 0)
        prediction = min(100.0, base + min(20.0, high_field * 5.0) + min(10.0, len(field) * 2.0))
        if prediction >= 75:
            level = "CRITICAL"
        elif prediction >= 50:
            level = "HIGH"
        elif prediction >= 25:
            level = "MODERATE"
        else:
            level = "LOW"
        results.append({
            "rank": idx + 1,
            "route": evaluated,
            "field_reports_near_route": field,
            "predicted_disruption_score": round(prediction, 1),
            "predicted_disruption_level": level,
            "model_type": "interpretable decision-support; not a trained forecast model",
        })

    return {
        "live": True,
        "source": {
            "routing": "OpenStreetMap via OSRM",
            "weather": weather.get("source", "Live weather providers"),
            "government_hazards": "NDMA SACHET",
            "field_evidence": "Authenticated geo-tagged field reports",
        },
        "start": {"name": data.start_name, "lat": data.start_lat, "lon": data.start_lon},
        "destination": {"name": data.destination_name, "lat": data.end_lat, "lon": data.end_lon},
        "weather": weather,
        "routes": results,
        "road_status_semantics": ["Normal", "Risk Elevated", "Disruption Reported", "Government Alert", "Unknown"],
        "warning": "No road is marked closed unless supported by an actual report/source; risk and predictions are decision-support only.",
    }


@router.get("/fleet/tracking")
def fleet_tracking(request: Request):
    auth(request)
    conn = legacy.get_db()
    try:
        rows = conn.execute(
            "SELECT id, vehicle_number, driver_name, lat, lon, status, updated_at FROM vehicles ORDER BY id"
        ).fetchall()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"Fleet data unavailable: {exc}")
    finally:
        conn.close()
    vehicles = [dict(row) for row in rows]
    return {
        "live": True,
        "source": "Existing authenticated NER fleet database",
        "vehicles": vehicles,
        "warning": "Vehicle positions are only live when the registered device/client sends fresh GPS coordinates.",
    }


@router.get("/logistics/bottlenecks")
def logistics_bottlenecks(request: Request):
    auth(request)
    conn = legacy.get_db()
    try:
        shipments = [dict(r) for r in conn.execute("SELECT * FROM shipments").fetchall()]
        vehicles = [dict(r) for r in conn.execute("SELECT * FROM vehicles").fetchall()]
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"Logistics data unavailable: {exc}")
    finally:
        conn.close()

    status_counts: Dict[str, int] = {}
    for shipment in shipments:
        key = str(shipment.get("status") or "Unknown")
        status_counts[key] = status_counts.get(key, 0) + 1

    delayed = [s for s in shipments if str(s.get("status", "")).lower() in {"delayed", "at risk", "exception"}]
    return {
        "live": True,
        "source": "Existing NER logistics database",
        "shipment_count": len(shipments),
        "vehicle_count": len(vehicles),
        "status_counts": status_counts,
        "delayed_shipments": delayed,
        "note": "Bottlenecks are derived from recorded operational data; no synthetic shipment is created.",
    }


@router.get("/notifications")
def notifications(request: Request):
    user = auth(request)
    conn = legacy.get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM alerts ORDER BY id DESC LIMIT 100"
        ).fetchall()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"Alerts unavailable: {exc}")
    finally:
        conn.close()
    return {
        "live": True,
        "source": "Existing NER alerts database",
        "user": user.get("email"),
        "notifications": [dict(r) for r in rows],
    }


@router.get("/emergency/accessibility")
def emergency_accessibility(request: Request):
    auth(request)
    # Reuse the existing emergency reroute logic/data without changing it.
    return {
        "live": True,
        "service": "Emergency accessibility decision support",
        "available": True,
        "next_step": "Use /api/emergency-reroute with the existing request contract to calculate a real backup route.",
        "sources": ["Existing route engine", "Existing hazard feed", "Existing weather feed"],
    }


@router.get("/analytics/overview")
def analytics_overview(request: Request):
    auth(request)
    conn = legacy.get_db()
    try:
        vehicles = [dict(r) for r in conn.execute("SELECT * FROM vehicles").fetchall()]
        shipments = [dict(r) for r in conn.execute("SELECT * FROM shipments").fetchall()]
        alerts = [dict(r) for r in conn.execute("SELECT * FROM alerts ORDER BY id DESC LIMIT 100").fetchall()]
    finally:
        conn.close()

    ext = ext_db()
    report_count = ext.execute("SELECT COUNT(*) AS n FROM field_reports").fetchone()["n"]
    ext.close()
    return {
        "live": True,
        "vehicles": {"total": len(vehicles), "with_gps": sum(1 for v in vehicles if v.get("lat") is not None and v.get("lon") is not None)},
        "shipments": {"total": len(shipments)},
        "alerts": {"total": len(alerts)},
        "field_reports": {"total": report_count},
        "source": "Existing NER database + additive field-report database",
    }
