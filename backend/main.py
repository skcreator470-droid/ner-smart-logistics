import asyncio
import hashlib
import hmac
import json
import math
import os
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from dotenv import load_dotenv
from fastapi import (
    Cookie,
    FastAPI,
    HTTPException,
    Request,
    WebSocket,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from hazards import (
    SACHET_URL,
    sachet_feed,
    score_route_hazards,
)

# IMPORTANT:
# Satellite NDVI function ab satellite.py se aayega.
from satellite import get_satellite_ndvi

load_dotenv()


APP_TITLE = (
    "NER Smart Logistics "
    "Accessibility Intelligence Platform"
)

DATABASE = "ner_logistics.db"

OSRM_URL = (
    "https://router.project-osrm.org"
)

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
)


app = FastAPI(
    title=APP_TITLE,
    version="1.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://skcreator470-droid.github.io",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# DATABASE
# =========================================================

def get_db():
    conn = sqlite3.connect(
        DATABASE,
        check_same_thread=False,
    )

    conn.row_factory = sqlite3.Row

    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_number TEXT UNIQUE NOT NULL,
            driver_name TEXT,
            lat REAL,
            lon REAL,
            status TEXT DEFAULT 'Idle',
            updated_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS shipments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tracking_id TEXT UNIQUE NOT NULL,
            origin TEXT,
            destination TEXT,
            status TEXT DEFAULT 'Pending',
            eta_minutes INTEGER,
            risk_level TEXT,
            created_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            message TEXT,
            severity TEXT,
            created_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )

    # Real initial fleet record.
    # This is not fake shipment/alert data.
    cur.execute(
        """
        INSERT OR IGNORE INTO vehicles
        (
            vehicle_number,
            driver_name,
            lat,
            lon,
            status,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            "NER-TRUCK-01",
            "Driver 01",
            26.1445,
            91.7362,
            "Idle",
            datetime.now(
                timezone.utc
            ).isoformat(),
        ),
    )

    conn.commit()
    conn.close()


init_db()


# =========================================================
# AUTH
# =========================================================

COOKIE_NAME = "ner_session"

PBKDF2_ITERATIONS = 310000


def hash_password(password):
    salt = secrets.token_bytes(16)

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )

    return (
        f"pbkdf2_sha256$"
        f"{PBKDF2_ITERATIONS}$"
        f"{salt.hex()}$"
        f"{digest.hex()}"
    )


def verify_password(
    password,
    stored,
):
    try:
        scheme, iterations, salt_hex, hash_hex = (
            stored.split("$")
        )

        if scheme != "pbkdf2_sha256":
            return False

        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations),
        )

        return hmac.compare_digest(
            digest.hex(),
            hash_hex,
        )

    except Exception:
        return False


def hash_session_token(token):
    return hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()


def create_session(user_id):
    token = secrets.token_urlsafe(48)

    token_hash = hash_session_token(
        token
    )

    created = datetime.now(
        timezone.utc
    )

    expires = created + timedelta(
        days=7
    )

    conn = get_db()

    conn.execute(
        """
        INSERT INTO sessions
        (
            user_id,
            token_hash,
            expires_at,
            created_at
        )
        VALUES (?, ?, ?, ?)
        """,
        (
            user_id,
            token_hash,
            expires.isoformat(),
            created.isoformat(),
        ),
    )

    conn.commit()
    conn.close()

    return token


def get_user_from_token(token):
    if not token:
        return None

    token_hash = hash_session_token(
        token
    )

    conn = get_db()

    row = conn.execute(
        """
        SELECT
            users.id,
            users.name,
            users.email,
            sessions.expires_at
        FROM sessions
        JOIN users
          ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
        """,
        (token_hash,),
    ).fetchone()

    if not row:
        conn.close()
        return None

    try:
        expires = datetime.fromisoformat(
            row["expires_at"]
        )

        if expires < datetime.now(
            timezone.utc
        ):
            conn.execute(
                """
                DELETE FROM sessions
                WHERE token_hash = ?
                """,
                (token_hash,),
            )

            conn.commit()
            conn.close()

            return None

    except Exception:
        conn.close()
        return None

    conn.close()

    return dict(row)


def get_current_user(
    request: Request,
):
    token = request.cookies.get(
        COOKIE_NAME
    )

    user = get_user_from_token(
        token
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
        )

    return user


class SignupRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/signup")
def signup(data: SignupRequest):
    name = data.name.strip()
    email = data.email.strip().lower()
    password = data.password

    if len(name) < 2:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid name",
        )

    if "@" not in email:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid email",
        )

    if len(password) < 6:
        raise HTTPException(
            status_code=400,
            detail=(
                "Password must contain "
                "at least 6 characters"
            ),
        )

    conn = get_db()

    existing = conn.execute(
        """
        SELECT id FROM users
        WHERE email = ?
        """,
        (email,),
    ).fetchone()

    if existing:
        conn.close()

        raise HTTPException(
            status_code=409,
            detail="Account already exists",
        )

    now = datetime.now(
        timezone.utc
    ).isoformat()

    password_hash = hash_password(
        password
    )

    cur = conn.execute(
        """
        INSERT INTO users
        (
            name,
            email,
            password_hash,
            created_at
        )
        VALUES (?, ?, ?, ?)
        """,
        (
            name,
            email,
            password_hash,
            now,
        ),
    )

    user_id = cur.lastrowid

    conn.commit()
    conn.close()

    token = create_session(
        user_id
    )

    response = {
        "success": True,
        "user": {
            "id": user_id,
            "name": name,
            "email": email,
        },
    }

    from fastapi.responses import JSONResponse

    result = JSONResponse(
        response
    )

    result.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=7 * 24 * 60 * 60,
    )

    return result


@app.post("/api/auth/login")
def login(data: LoginRequest):
    email = data.email.strip().lower()

    conn = get_db()

    row = conn.execute(
        """
        SELECT *
        FROM users
        WHERE email = ?
        """,
        (email,),
    ).fetchone()

    conn.close()

    if not row or not verify_password(
        data.password,
        row["password_hash"],
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    token = create_session(
        row["id"]
    )

    from fastapi.responses import JSONResponse

    result = JSONResponse(
        {
            "success": True,
            "user": {
                "id": row["id"],
                "name": row["name"],
                "email": row["email"],
            },
        }
    )

    result.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=7 * 24 * 60 * 60,
    )

    return result


@app.get("/api/auth/me")
def auth_me(request: Request):
    user = get_current_user(request)

    return {
        "success": True,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
        },
    }


@app.post("/api/auth/logout")
def logout(request: Request):
    token = request.cookies.get(
        COOKIE_NAME
    )

    if token:
        token_hash = hash_session_token(
            token
        )

        conn = get_db()

        conn.execute(
            """
            DELETE FROM sessions
            WHERE token_hash = ?
            """,
            (token_hash,),
        )

        conn.commit()
        conn.close()

    from fastapi.responses import JSONResponse

    result = JSONResponse(
        {"success": True}
    )

    result.delete_cookie(
        COOKIE_NAME
    )

    return result


# =========================================================
# GEOCODING
# =========================================================

@app.get("/api/geocode")
def geocode(q: str):
    query = q.strip()

    if not query:
        return {"results": []}

    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": query,
                "format": "jsonv2",
                "limit": 5,
                "addressdetails": 1,
                "countrycodes": "in",
            },
            headers={
                "User-Agent": (
                    "NER-Smart-Logistics/1.0 "
                    "(contact: your-skcreator470@gmail.com)"
                ),
                "Accept-Language": "en",
            },
            timeout=15,
        )

        response.raise_for_status()

        places = response.json()

        results = []

        for place in places:
            try:
                results.append(
                    {
                        "name": place.get(
                            "display_name",
                            "",
                        ),
                        "lat": float(
                            place["lat"]
                        ),
                        "lon": float(
                            place["lon"]
                        ),
                    }
                )
            except (
                KeyError,
                TypeError,
                ValueError,
            ):
                continue

        return {
            "results": results
        }

    except requests.RequestException as e:
        print(
            "Geocoding request failed:",
            e,
        )

        return {
            "results": [],
            "error": (
                "Location search service "
                "unavailable"
            ),
        }

    except Exception as e:
        print(
            "Geocoding error:",
            e,
        )

        return {
            "results": [],
            "error": (
                "Location search failed"
            ),
        }


# =========================================================
# ROUTING
# =========================================================

def get_route(
    start_lat,
    start_lon,
    destination_lat,
    destination_lon,
):
    url = (
        f"{OSRM_URL}/route/v1/driving/"
        f"{start_lon},{start_lat};"
        f"{destination_lon},{destination_lat}"
    )

    response = requests.get(
        url,
        params={
            "overview": "full",
            "geometries": "geojson",
            "steps": "false",
            "alternatives": "true",
        },
        timeout=30,
    )

    response.raise_for_status()

    data = response.json()

    if data.get("code") != "Ok":
        raise HTTPException(
            status_code=400,
            detail="Road route unavailable",
        )

    routes = data.get(
        "routes",
        [],
    )

    if not routes:
        raise HTTPException(
            status_code=400,
            detail="No road route found",
        )

    output = []

    for route in routes:
        geometry = []

        for lon, lat in route[
            "geometry"
        ]["coordinates"]:
            geometry.append(
                [lat, lon]
            )

        output.append(
            {
                "geometry": geometry,
                "distance_km":
                    route["distance"]
                    / 1000,
                "duration_minutes":
                    route["duration"]
                    / 60,
            }
        )

    return output


# =========================================================
# WEATHER
# =========================================================

def get_weather(
    lat,
    lon,
):
    response = requests.get(
        OPEN_METEO_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "current": (
                "temperature_2m,"
                "relative_humidity_2m,"
                "precipitation,"
                "rain,"
                "wind_speed_10m"
            ),
            "timezone": "auto",
        },
        timeout=20,
    )

    response.raise_for_status()

    current = response.json().get(
        "current",
        {},
    )

    return {
        "temperature_c":
            current.get(
                "temperature_2m"
            ),
        "humidity":
            current.get(
                "relative_humidity_2m"
            ),
        "precipitation_mm":
            current.get(
                "precipitation"
            ),
        "rain_mm":
            current.get(
                "rain"
            ),
        "wind_kmh":
            current.get(
                "wind_speed_10m"
            ),
        "source":
            "Open-Meteo",
    }


# =========================================================
# RISK ENGINE
# =========================================================

def risk_engine(
    weather,
):
    score = 0
    reasons = []

    rain = (
        weather.get(
            "rain_mm"
        )
        or 0
    )

    wind = (
        weather.get(
            "wind_kmh"
        )
        or 0
    )

    if rain >= 10:
        score += 20
        reasons.append(
            "Heavy rainfall detected"
        )

    elif rain > 0:
        score += 10
        reasons.append(
            "Rain detected"
        )

    if wind >= 45:
        score += 25
        reasons.append(
            "Strong wind detected"
        )

    elif wind >= 30:
        score += 10
        reasons.append(
            "Elevated wind speed"
        )

    if score >= 70:
        level = "High"

    elif score >= 40:
        level = "Medium"

    else:
        level = "Low"

    return {
        "score": score,
        "level": level,
        "reasons": reasons,
    }


# =========================================================
# ROUTE ANALYSIS
# =========================================================

class RouteRequest(BaseModel):
    start: str
    destination: str
    start_lat: float
    start_lon: float
    destination_lat: float
    destination_lon: float


def build_route_result(
    route,
    start,
    destination,
    weather,
    hazards,
):
    risk = risk_engine(
        weather
    )

    hazard_result = score_route_hazards(
        route["geometry"],
        hazards,
    )

    final_score = min(
        100,
        risk["score"]
        + hazard_result["penalty"],
    )

    reasons = list(
        risk["reasons"]
    )

    for alert in hazard_result[
        "matched_alerts"
    ]:
        reasons.append(
            (
                f"{alert.get('hazard_type', 'Hazard')} "
                f"alert affecting route: "
                f"{alert.get('title', 'NDMA alert')}"
            )
        )

    if final_score >= 70:
        level = "High"

    elif final_score >= 40:
        level = "Medium"

    else:
        level = "Low"

    return {
        "start": start,
        "destination": destination,
        "geometry":
            route["geometry"],
        "distance_km":
            round(
                route["distance_km"],
                2,
            ),
        "duration_hours":
            round(
                route[
                    "duration_minutes"
                ]
                / 60,
                2,
            ),
        "duration_minutes":
            round(
                route[
                    "duration_minutes"
                ]
            ),
        "risk_score":
            final_score,
        "risk_level":
            level,
        "reasons":
            reasons,
        "hazard_alerts":
            hazard_result[
                "matched_alerts"
            ],
        "regional_hazard_alerts":
            hazard_result[
                "regional_alerts"
            ],
        "route_hazard_affected":
            hazard_result[
                "route_affected"
            ],
    }


@app.post("/api/analyze-route")
def analyze_route(
    data: RouteRequest,
    request: Request,
):
    get_current_user(request)

    routes = get_route(
        data.start_lat,
        data.start_lon,
        data.destination_lat,
        data.destination_lon,
    )

    hazards = sachet_feed.get_alerts()

    weather = get_weather(
        data.destination_lat,
        data.destination_lon,
    )

    candidates = []

    for route in routes:
        candidates.append(
            build_route_result(
                route,
                data.start,
                data.destination,
                weather,
                hazards,
            )
        )

    # Prefer route without a verified
    # spatial hazard intersection.
    safe_candidates = [
        x
        for x in candidates
        if not x[
            "route_hazard_affected"
        ]
    ]

    if safe_candidates:
        selected = min(
            safe_candidates,
            key=lambda x:
                x["duration_minutes"],
        )

        route_selection = (
            "Safest available OSRM route"
        )

    else:
        selected = min(
            candidates,
            key=lambda x:
                x["risk_score"],
        )

        route_selection = (
            "No hazard-free OSRM alternative "
            "was returned; lowest-risk candidate selected"
        )

    geometry = selected[
        "geometry"
    ]

    midpoint = geometry[
        len(geometry) // 2
    ]

    # =====================================================
    # REAL SATELLITE NDVI
    # =====================================================
    # Function imported from satellite.py
    satellite = get_satellite_ndvi(
        midpoint[0],
        midpoint[1],
    )

    return {
        "success": True,

        "route": selected,

        "route_candidates": candidates,

        "route_selection":
            route_selection,

        "weather": weather,

        "satellite": satellite,

        "midpoint": {
            "lat": midpoint[0],
            "lon": midpoint[1],
        },

        "data_sources": [
            "OpenStreetMap",
            "OSRM",
            "Open-Meteo",
            "Copernicus Sentinel-2 L2A",
            "NDMA SACHET",
        ],

        "warning":
            (
                "Decision-support system. "
                "Hazard avoidance is based only on "
                "verified geographic information "
                "available from integrated feeds."
            ),
    }


# =========================================================
# HAZARDS
# =========================================================

@app.get("/api/hazards")
def get_hazards(
    request: Request,
):
    get_current_user(request)

    alerts = sachet_feed.get_alerts()

    return {
        "success": True,
        "source":
            "NDMA SACHET",
        "source_url":
            SACHET_URL,
        "live":
            sachet_feed.last_error is None,
        "last_updated":
            sachet_feed.last_success,
        "last_refresh":
            sachet_feed.last_refresh,
        "error":
            sachet_feed.last_error,
        "count":
            len(alerts),
        "alerts":
            alerts,
    }


# =========================================================
# VEHICLES
# =========================================================

@app.get("/api/vehicles")
def get_vehicles(
    request: Request,
):
    get_current_user(request)

    conn = get_db()

    rows = conn.execute(
        """
        SELECT *
        FROM vehicles
        ORDER BY id
        """
    ).fetchall()

    conn.close()

    return {
        "success": True,
        "vehicles": [
            dict(row)
            for row in rows
        ],
    }


class VehicleCreate(BaseModel):
    vehicle_number: str
    driver_name: str = ""


@app.post("/api/vehicles")
def create_vehicle(
    data: VehicleCreate,
    request: Request,
):
    get_current_user(request)

    conn = get_db()

    try:
        cur = conn.execute(
            """
            INSERT INTO vehicles
            (
                vehicle_number,
                driver_name,
                status,
                updated_at
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                data.vehicle_number,
                data.driver_name,
                "Idle",
                datetime.now(
                    timezone.utc
                ).isoformat(),
            ),
        )

        conn.commit()

        vehicle_id = cur.lastrowid

    except sqlite3.IntegrityError:
        conn.close()

        raise HTTPException(
            status_code=409,
            detail="Vehicle already exists",
        )

    conn.close()

    return {
        "success": True,
        "id": vehicle_id,
    }


class LocationUpdate(BaseModel):
    vehicle_id: int
    lat: float
    lon: float


@app.post("/api/location")
def update_location(
    data: LocationUpdate,
    request: Request,
):
    get_current_user(request)

    conn = get_db()

    cur = conn.execute(
        """
        UPDATE vehicles
        SET
            lat = ?,
            lon = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            data.lat,
            data.lon,
            "Moving",
            datetime.now(
                timezone.utc
            ).isoformat(),
            data.vehicle_id,
        ),
    )

    conn.commit()
    conn.close()

    if cur.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="Vehicle not found",
        )

    return {
        "success": True,
        "message":
            "Vehicle location updated",
    }


# =========================================================
# SHIPMENTS
# =========================================================

@app.get("/api/shipments")
def get_shipments(
    request: Request,
):
    get_current_user(request)

    conn = get_db()

    rows = conn.execute(
        """
        SELECT *
        FROM shipments
        ORDER BY id DESC
        """
    ).fetchall()

    conn.close()

    return {
        "success": True,
        "shipments": [
            dict(row)
            for row in rows
        ],
    }


class ShipmentCreate(BaseModel):
    tracking_id: str
    origin: str
    destination: str
    eta_minutes: Optional[int] = None
    risk_level: str = "Low"


@app.post("/api/shipments")
def create_shipment(
    data: ShipmentCreate,
    request: Request,
):
    get_current_user(request)

    conn = get_db()

    try:
        cur = conn.execute(
            """
            INSERT INTO shipments
            (
                tracking_id,
                origin,
                destination,
                status,
                eta_minutes,
                risk_level,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.tracking_id,
                data.origin,
                data.destination,
                "Pending",
                data.eta_minutes,
                data.risk_level,
                datetime.now(
                    timezone.utc
                ).isoformat(),
            ),
        )

        conn.commit()

        shipment_id = cur.lastrowid

    except sqlite3.IntegrityError:
        conn.close()

        raise HTTPException(
            status_code=409,
            detail="Tracking ID already exists",
        )

    conn.close()

    return {
        "success": True,
        "id": shipment_id,
    }


class ShipmentStatusUpdate(BaseModel):
    status: str


@app.patch(
    "/api/shipments/{shipment_id}/status"
)
def update_shipment_status(
    shipment_id: int,
    data: ShipmentStatusUpdate,
    request: Request,
):
    get_current_user(request)

    conn = get_db()

    cur = conn.execute(
        """
        UPDATE shipments
        SET status = ?
        WHERE id = ?
        """,
        (
            data.status,
            shipment_id,
        ),
    )

    conn.commit()
    conn.close()

    if cur.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="Shipment not found",
        )

    return {
        "success": True,
    }


# =========================================================
# ALERTS
# =========================================================

@app.get("/api/alerts")
def get_alerts(
    request: Request,
):
    get_current_user(request)

    conn = get_db()

    rows = conn.execute(
        """
        SELECT *
        FROM alerts
        ORDER BY id DESC
        """
    ).fetchall()

    conn.close()

    return {
        "success": True,
        "alerts": [
            dict(row)
            for row in rows
        ],
    }


class AlertCreate(BaseModel):
    title: str
    message: str
    severity: str = "Medium"


@app.post("/api/alerts")
def create_alert(
    data: AlertCreate,
    request: Request,
):
    get_current_user(request)

    conn = get_db()

    cur = conn.execute(
        """
        INSERT INTO alerts
        (
            title,
            message,
            severity,
            created_at
        )
        VALUES (?, ?, ?, ?)
        """,
        (
            data.title,
            data.message,
            data.severity,
            datetime.now(
                timezone.utc
            ).isoformat(),
        ),
    )

    conn.commit()

    alert_id = cur.lastrowid

    conn.close()

    return {
        "success": True,
        "id": alert_id,
    }


# =========================================================
# EMERGENCY REROUTE
# =========================================================

class EmergencyRerouteRequest(BaseModel):
    vehicle_id: int
    destination_lat: float
    destination_lon: float
    destination_name: str = (
        "Emergency Destination"
    )


@app.post("/api/emergency-reroute")
def emergency_reroute(
    data: EmergencyRerouteRequest,
    request: Request,
):
    get_current_user(request)

    conn = get_db()

    vehicle = conn.execute(
        """
        SELECT *
        FROM vehicles
        WHERE id = ?
        """,
        (data.vehicle_id,),
    ).fetchone()

    conn.close()

    if not vehicle:
        raise HTTPException(
            status_code=404,
            detail="Vehicle not found",
        )

    if (
        vehicle["lat"] is None
        or vehicle["lon"] is None
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Vehicle has no GPS position. "
                "Start GPS tracking first."
            ),
        )

    routes = get_route(
        vehicle["lat"],
        vehicle["lon"],
        data.destination_lat,
        data.destination_lon,
    )

    hazards = sachet_feed.get_alerts()

    weather = get_weather(
        data.destination_lat,
        data.destination_lon,
    )

    candidates = []

    for route in routes:
        candidates.append(
            build_route_result(
                route,
                (
                    f"Vehicle "
                    f"{vehicle['vehicle_number']}"
                ),
                data.destination_name,
                weather,
                hazards,
            )
        )

    safe_candidates = [
        x
        for x in candidates
        if not x[
            "route_hazard_affected"
        ]
    ]

    if safe_candidates:
        selected = min(
            safe_candidates,
            key=lambda x:
                x["duration_minutes"],
        )

        selection = (
            "Hazard-free alternative selected"
        )

    else:
        selected = min(
            candidates,
            key=lambda x:
                x["risk_score"],
        )

        selection = (
            "No verified hazard-free alternative "
            "was returned"
        )

    return {
        "success": True,
        "vehicle": dict(vehicle),
        "route": selected,
        "route_candidates": candidates,
        "selection":
            selection,
        "weather": weather,
        "warning":
            (
                "Emergency reroute uses the vehicle's "
                "latest GPS position, live NDMA hazard "
                "geometry where available, and real "
                "OSRM road routes."
            ),
    }


# =========================================================
# WEBSOCKET
# =========================================================

@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
):
    await websocket.accept()

    try:
        while True:
            await websocket.send_json(
                {
                    "type":
                        "heartbeat",
                    "timestamp":
                        datetime.now(
                            timezone.utc
                        ).isoformat(),
                }
            )

            await asyncio.sleep(10)

    except Exception:
        pass


# =========================================================
# BACKGROUND SACHET REFRESH
# =========================================================

async def hazard_refresh_loop():
    while True:
        try:
            await asyncio.to_thread(
                sachet_feed.refresh
            )
        except Exception:
            pass

        await asyncio.sleep(
            5 * 60
        )


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(
        hazard_refresh_loop()
    )


# =========================================================
# ROOT
# =========================================================

@app.get("/")
def root():
    return {
        "name":
            APP_TITLE,
        "status":
            "running",
        "version":
            "1.0.0",
    }


# =========================================================
# REAL NER NEWS FEED
# =========================================================

import xml.etree.ElementTree as ET
from urllib.parse import quote
from email.utils import parsedate_to_datetime


NER_STATES = [
    "Assam",
    "Arunachal Pradesh",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Sikkim",
    "Tripura",
]


NER_HAZARD_KEYWORDS = [
    "flood",
    "flash flood",
    "landslide",
    "mudslide",
    "road blocked",
    "road closure",
    "road closed",
    "heavy rain",
    "very heavy rain",
    "thunderstorm",
    "lightning",
    "storm",
    "earthquake",
    "bridge damaged",
    "railway disruption",
    "road disruption",
]


def get_real_ner_news():
    all_news = []

    for state in NER_STATES:

        query = quote(
            f'"{state}" '
            f'(flood OR landslide OR "heavy rain" OR '
            f"road OR weather OR earthquake OR disruption)"
        )

        url = (
            "https://news.google.com/rss/search"
            f"?q={query}&hl=en-IN&gl=IN&ceid=IN:en"
        )

        try:
            response = requests.get(
                url,
                headers={
                    "User-Agent":
                        "NER-Smart-Logistics/1.0"
                },
                timeout=10,
            )

            response.raise_for_status()

            root = ET.fromstring(
                response.content
            )

            for item in root.findall(
                "./channel/item"
            ):

                title = item.findtext(
                    "title",
                    "",
                ).strip()

                link = item.findtext(
                    "link",
                    "",
                ).strip()

                pub_date = item.findtext(
                    "pubDate",
                    "",
                ).strip()

                description = item.findtext(
                    "description",
                    "",
                ).strip()

                text = (
                    f"{title} {description}"
                ).lower()

                # -----------------------------------------
                # STRICT NER STATE FILTER
                # -----------------------------------------

                matched_state = None

                for ner_state in NER_STATES:
                    if (
                        ner_state.lower()
                        in title.lower()
                    ):
                        matched_state = ner_state
                        break

                if not matched_state:
                    continue

                # -----------------------------------------
                # HAZARD CLASSIFICATION
                # -----------------------------------------

                matched_hazard = (
                    "General NER News"
                )

                for keyword in NER_HAZARD_KEYWORDS:
                    if keyword in text:
                        matched_hazard = (
                            keyword.title()
                        )
                        break

                published_iso = None

                if pub_date:
                    try:
                        published_iso = (
                            parsedate_to_datetime(
                                pub_date
                            ).isoformat()
                        )

                    except Exception:
                        published_iso = pub_date

                all_news.append(
                    {
                        "state":
                            matched_state,

                        "title":
                            title,

                        "description":
                            description,

                        "source":
                            "Google News RSS",

                        "published_at":
                            published_iso,

                        "link":
                            link,

                        "category":
                            matched_hazard,

                        "live":
                            True,
                    }
                )

        except Exception as e:
            print(
                f"NER news fetch failed for {state}:",
                e,
            )

    # ---------------------------------------------
    # REMOVE DUPLICATES
    # ---------------------------------------------

    unique_news = {}

    for article in all_news:

        key = (
            article[
                "title"
            ].lower().strip(),

            article[
                "link"
            ],
        )

        unique_news[key] = article

    news = list(
        unique_news.values()
    )

    # ---------------------------------------------
    # LATEST FIRST
    # ---------------------------------------------

    news.sort(
        key=lambda x:
            x.get(
                "published_at"
            )
            or "",
        reverse=True,
    )

    return news[:100]


@app.get("/api/ner-news")
def ner_news():

    news = get_real_ner_news()

    NON_NER_STATES = [
        "Andhra Pradesh",
        "Bihar",
        "Chhattisgarh",
        "Goa",
        "Gujarat",
        "Haryana",
        "Himachal Pradesh",
        "Jharkhand",
        "Karnataka",
        "Kerala",
        "Madhya Pradesh",
        "Maharashtra",
        "Odisha",
        "Punjab",
        "Rajasthan",
        "Tamil Nadu",
        "Telangana",
        "Uttar Pradesh",
        "Uttarakhand",
        "West Bengal",
        "Delhi",
    ]

    news = [
        article
        for article in news
        if not any(
            state.lower()
            in article.get(
                "title",
                "",
            ).lower()
            for state in NON_NER_STATES
        )
    ]

    return {
        "live":
            True,

        "region":
            "North Eastern Region of India",

        "states":
            NER_STATES,

        "count":
            len(news),

        "source":
            "Google News RSS",

        "news":
            news,
    }


from live_alerts import router as live_alert_router
app.include_router(live_alert_router)



