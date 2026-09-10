
"""Additive advanced intelligence layer for NER Smart Logistics.

This module deliberately does not modify the legacy main.py or live_alerts.py.
It uses existing authenticated route/weather/hazard/fleet/shipment services and
adds explainable decision-support capabilities.
"""
from datetime import datetime, timezone
import math
import sqlite3
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import main as legacy

router = APIRouter(prefix="/api/intelligence", tags=["advanced-intelligence"])

NER_STATES = [
    "Assam", "Arunachal Pradesh", "Meghalaya", "Manipur",
    "Mizoram", "Nagaland", "Tripura", "Sikkim",
]

def _auth(request: Request):
    return legacy.get_current_user(request)

def _db():
    return legacy.get_db()

def _now():
    return datetime.now(timezone.utc).isoformat()

def _haversine_km(a, b):
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371.0088 * 2 * math.asin(math.sqrt(h))

def _point_to_segment_km(point, a, b):
    # Local planar approximation is sufficient for a small route corridor.
    lat_scale = 111.32
    lon_scale = 111.32 * math.cos(math.radians(point[0]))
    px, py = point[1] * lon_scale, point[0] * lat_scale
    ax, ay = a[1] * lon_scale, a[0] * lat_scale
    bx, by = b[1] * lon_scale, b[0] * lat_scale
    dx, dy = bx - ax, by - ay
    denom = dx*dx + dy*dy
    if denom == 0:
        return math.hypot(px-ax, py-ay)
    t = max(0.0, min(1.0, ((px-ax)*dx + (py-ay)*dy) / denom))
    return math.hypot(px-(ax+t*dx), py-(ay+t*dy))

def _near_reports(geometry, radius_km=3.0):
    if not geometry:
        return []
    conn = _db()
    try:
        rows = conn.execute(
            "SELECT id,user_id,incident_type,severity,description,lat,lon,created_at "
            "FROM field_reports WHERE lat IS NOT NULL AND lon IS NOT NULL "
            "ORDER BY created_at DESC"
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()

    result = []
    for row in rows:
        try:
            p = (float(row["lat"]), float(row["lon"]))
        except (TypeError, ValueError):
            continue
        best = min(
            _point_to_segment_km(p, geometry[i-1], geometry[i])
            for i in range(1, len(geometry))
        ) if len(geometry) > 1 else _haversine_km(p, geometry[0])
        if best <= radius_km:
            item = dict(row)
            item["distance_to_route_km"] = round(best, 2)
            result.append(item)
    return result

def _severity_points(reports):
    return sum(
        {"low": 2, "medium": 6, "high": 12, "critical": 18}.get(
            str(x.get("severity", "")).lower(), 1
        )
        for x in reports
    )

class WhatIfRequest(BaseModel):
    base_risk_score: float = 0
    rainfall_mm: Optional[float] = None
    wind_kmh: Optional[float] = None
    extra_delay_minutes: float = 0
    additional_hazard_count: int = 0

class SafeWindowRequest(BaseModel):
    base_risk_score: float = 0
    rainfall_mm: Optional[float] = None
    wind_kmh: Optional[float] = None

class ImpactRequest(BaseModel):
    route_distance_km: float = 0
    route_duration_minutes: float = 0
    risk_score: float = 0
    vehicle_count: int = 0
    shipment_count: int = 0

class ResourceRequest(BaseModel):
    lat: float
    lon: float
    radius_km: float = 50

class PropagationRequest(BaseModel):
    risk_score: float = 0
    hazard_count: int = 0
    field_report_count: int = 0
    vehicle_count: int = 0
    shipment_count: int = 0

class VerificationRequest(BaseModel):
    government_alerts: int = 0
    field_reports: int = 0
    weather_risk_score: float = 0

@router.get("/digital-twin")
def digital_twin(request: Request):
    _auth(request)
    conn = _db()
    try:
        vehicles = [dict(x) for x in conn.execute("SELECT * FROM vehicles").fetchall()]
        shipments = [dict(x) for x in conn.execute("SELECT * FROM shipments").fetchall()]
        alerts = [dict(x) for x in conn.execute("SELECT * FROM alerts ORDER BY id DESC LIMIT 50").fetchall()]
        try:
            reports = [dict(x) for x in conn.execute("SELECT * FROM field_reports ORDER BY id DESC LIMIT 200").fetchall()]
        except sqlite3.Error:
            reports = []
    finally:
        conn.close()

    status_counts = {}
    for v in vehicles:
        key = str(v.get("status") or "Unknown")
        status_counts[key] = status_counts.get(key, 0) + 1

    return {
        "live": True,
        "generated_at": _now(),
        "states": NER_STATES,
        "digital_twin": {
            "vehicles": len(vehicles),
            "shipments": len(shipments),
            "application_alerts": len(alerts),
            "field_reports": len(reports),
            "vehicle_status": status_counts,
        },
        "sources": [
            "Existing authenticated NER fleet database",
            "Existing shipment database",
            "Existing application alerts",
            "Authenticated field reports",
            "NDMA SACHET through existing hazard service",
            "Live weather through existing weather service",
            "OpenStreetMap/OSRM through existing routing service",
        ],
        "semantics": "Operational digital-twin view built from connected live services; not a physical simulation.",
    }

@router.post("/what-if")
def what_if(data: WhatIfRequest, request: Request):
    _auth(request)
    score = max(0.0, min(100.0, float(data.base_risk_score)))
    reasons = []
    rain = data.rainfall_mm
    wind = data.wind_kmh

    if rain is not None:
        if rain >= 10:
            score += 20
            reasons.append("Heavy-rain scenario adds elevated route risk.")
        elif rain > 0:
            score += 10
            reasons.append("Rain scenario adds route risk.")
    if wind is not None:
        if wind >= 45:
            score += 25
            reasons.append("Strong-wind scenario adds elevated route risk.")
        elif wind >= 30:
            score += 10
            reasons.append("Elevated-wind scenario adds route risk.")
    if data.additional_hazard_count:
        score += min(30, data.additional_hazard_count * 10)
        reasons.append(f"{data.additional_hazard_count} additional hazard scenario(s) added.")
    delay = max(0, float(data.extra_delay_minutes))
    if delay:
        reasons.append(f"Scenario adds {round(delay)} minutes of operational delay.")

    score = min(100, score)
    level = "CRITICAL" if score >= 75 else "HIGH" if score >= 50 else "MODERATE" if score >= 25 else "LOW"
    return {
        "live": True,
        "scenario": {
            "risk_score": round(score, 1),
            "risk_level": level,
            "additional_delay_minutes": round(delay),
            "reasons": reasons,
        },
        "model_type": "interpretable scenario analysis; not a trained forecast model",
    }

@router.post("/safe-window")
def safe_window(data: SafeWindowRequest, request: Request):
    _auth(request)
    base = max(0.0, min(100.0, float(data.base_risk_score)))
    candidates = []
    # These are scenario bands, not forecasts: each window reuses the same
    # supplied weather assumptions with progressively lower exposure.
    for minutes in [0, 30, 60, 90, 120]:
        decay = min(25, minutes / 8)
        rain_penalty = 20 if (data.rainfall_mm or 0) >= 10 else 10 if (data.rainfall_mm or 0) > 0 else 0
        wind_penalty = 25 if (data.wind_kmh or 0) >= 45 else 10 if (data.wind_kmh or 0) >= 30 else 0
        score = max(0, min(100, base + rain_penalty + wind_penalty - decay))
        candidates.append({
            "departure_offset_minutes": minutes,
            "scenario_risk_score": round(score, 1),
            "risk_level": "CRITICAL" if score >= 75 else "HIGH" if score >= 50 else "MODERATE" if score >= 25 else "LOW",
        })
    recommended = min(candidates, key=lambda x: (x["scenario_risk_score"], x["departure_offset_minutes"]))
    return {
        "live": True,
        "recommended_window": recommended,
        "windows": candidates,
        "semantics": "Scenario comparison only; not a weather forecast.",
    }

@router.post("/impact")
def impact(data: ImpactRequest, request: Request):
    _auth(request)
    risk = max(0, min(100, data.risk_score))
    risk_factor = risk / 100
    estimated_delay = data.route_duration_minutes * (0.05 + 0.45 * risk_factor)
    affected_shipments = round(data.shipment_count * (0.1 + 0.8 * risk_factor))
    affected_vehicles = round(data.vehicle_count * (0.1 + 0.7 * risk_factor))
    return {
        "live": True,
        "impact": {
            "estimated_delay_minutes": round(estimated_delay),
            "potentially_affected_shipments": affected_shipments,
            "potentially_affected_vehicles": affected_vehicles,
            "distance_exposure_km": round(data.route_distance_km * risk_factor, 1),
        },
        "model_type": "transparent impact scenario; not a financial forecast",
    }

@router.post("/propagation")
def propagation(data: PropagationRequest, request: Request):
    _auth(request)
    nodes = [
        ("Hazard", max(0, min(100, data.risk_score + data.hazard_count * 8))),
        ("Road risk", max(0, min(100, data.risk_score + data.hazard_count * 10))),
        ("Fleet exposure", max(0, min(100, data.risk_score + data.vehicle_count * 2))),
        ("Shipment exposure", max(0, min(100, data.risk_score + data.shipment_count * 2))),
        ("Field evidence", max(0, min(100, data.risk_score + data.field_report_count * 5))),
    ]
    return {
        "live": True,
        "chain": [{"stage": name, "score": round(score, 1)} for name, score in nodes],
        "explanation": "Each stage shows how the supplied evidence could propagate operational exposure; it is not a causal ML model.",
    }

@router.post("/verify")
def verify(data: VerificationRequest, request: Request):
    _auth(request)
    signals = int(data.government_alerts > 0) + int(data.field_reports > 0) + int(data.weather_risk_score >= 25)
    if signals >= 3:
        status = "CORROBORATED"
    elif signals == 2:
        status = "SUPPORTED"
    elif signals == 1:
        status = "SINGLE-SOURCE"
    else:
        status = "UNVERIFIED"
    return {
        "live": True,
        "verification_status": status,
        "signals": {
            "government_alerts": data.government_alerts,
            "field_reports": data.field_reports,
            "weather_risk_score": data.weather_risk_score,
        },
        "semantics": "Evidence corroboration indicator, not proof that a road is closed.",
    }

@router.post("/resource-positioning")
def resource_positioning(data: ResourceRequest, request: Request):
    _auth(request)
    conn = _db()
    try:
        try:
            vehicles = [dict(x) for x in conn.execute(
                "SELECT id,vehicle_number,driver_name,lat,lon,status,updated_at FROM vehicles "
                "WHERE lat IS NOT NULL AND lon IS NOT NULL"
            ).fetchall()]
        except sqlite3.Error:
            vehicles = []
        try:
            reports = [dict(x) for x in conn.execute(
                "SELECT id,incident_type,severity,lat,lon,created_at FROM field_reports "
                "WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY created_at DESC LIMIT 500"
            ).fetchall()]
        except sqlite3.Error:
            reports = []
    finally:
        conn.close()

    nearby_vehicles = []
    for v in vehicles:
        d = _haversine_km((data.lat, data.lon), (float(v["lat"]), float(v["lon"])))
        if d <= data.radius_km:
            v["distance_km"] = round(d, 1)
            nearby_vehicles.append(v)
    nearby_reports = []
    for r in reports:
        d = _haversine_km((data.lat, data.lon), (float(r["lat"]), float(r["lon"])))
        if d <= data.radius_km:
            r["distance_km"] = round(d, 1)
            nearby_reports.append(r)

    return {
        "live": True,
        "center": {"lat": data.lat, "lon": data.lon},
        "nearby_fleet": nearby_vehicles,
        "nearby_field_reports": nearby_reports,
        "recommendation": (
            "Consider staging emergency support closer to this corridor."
            if len(nearby_reports) >= 2 else
            "No strong local staging signal from connected field evidence."
        ),
        "semantics": "Positioning recommendation from connected evidence; final deployment remains an operational decision.",
    }

@router.get("/disruption-memory")
def disruption_memory(request: Request):
    _auth(request)
    conn = _db()
    try:
        try:
            rows = conn.execute(
                "SELECT incident_type,severity,lat,lon,created_at FROM field_reports "
                "ORDER BY created_at DESC LIMIT 1000"
            ).fetchall()
        except sqlite3.Error:
            rows = []
    finally:
        conn.close()

    by_type = {}
    by_severity = {}
    for r in rows:
        t = str(r["incident_type"] or "Unknown")
        s = str(r["severity"] or "Unknown")
        by_type[t] = by_type.get(t, 0) + 1
        by_severity[s] = by_severity.get(s, 0) + 1

    return {
        "live": True,
        "historical_evidence": {
            "field_report_count": len(rows),
            "incident_types": by_type,
            "severity_counts": by_severity,
            "recent": [dict(r) for r in rows[:20]],
        },
        "semantics": "Memory is derived from reports actually stored by authenticated field users; absence of reports does not mean absence of incidents.",
    }

@router.get("/resilience-score")
def resilience_score(request: Request, risk_score: float = 0, hazard_count: int = 0,
                     field_report_count: int = 0, alternate_route_count: int = 0):
    _auth(request)
    deductions = min(70, risk_score * 0.6 + hazard_count * 8 + field_report_count * 4)
    support = min(25, alternate_route_count * 8)
    score = max(0, min(100, 100 - deductions + support))
    return {
        "live": True,
        "resilience_score": round(score, 1),
        "components": {
            "risk_deduction": round(risk_score * 0.6, 1),
            "hazard_deduction": min(50, hazard_count * 8),
            "field_evidence_deduction": min(30, field_report_count * 4),
            "alternate_route_support": support,
        },
        "semantics": "Explainable corridor resilience indicator, not an official infrastructure rating.",
    }

@router.post("/corridor")
def corridor_intelligence(request: Request, start_lat: float, start_lon: float,
                          end_lat: float, end_lon: float):
    _auth(request)
    try:
        routes = legacy.get_route(start_lat, start_lon, end_lat, end_lon)
        hazards = legacy.sachet_feed.get_alerts()
        weather = legacy.get_weather(end_lat, end_lon)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Live corridor services unavailable: {exc}")

    results = []
    for idx, raw in enumerate(routes):
        evaluated = legacy.build_route_result(raw, "start", "destination", weather, hazards)
        reports = _near_reports(evaluated.get("geometry") or [])
        predicted = min(100, float(evaluated.get("risk_score") or 0) + min(20, _severity_points(reports)))
        results.append({
            "rank": idx + 1,
            "route": evaluated,
            "nearby_field_reports": reports,
            "predicted_disruption_score": round(predicted, 1),
            "predicted_disruption_level": "CRITICAL" if predicted >= 75 else "HIGH" if predicted >= 50 else "MODERATE" if predicted >= 25 else "LOW",
        })
    return {
        "live": True,
        "routes": results,
        "weather": weather,
        "sources": {
            "routing": "OpenStreetMap via OSRM",
            "government_hazards": "NDMA SACHET",
            "weather": weather.get("source", "Live weather providers"),
            "field_evidence": "Authenticated geo-tagged field reports",
        },
        "warning": "No road is declared closed by this endpoint. Predictions are decision-support only.",
    }
