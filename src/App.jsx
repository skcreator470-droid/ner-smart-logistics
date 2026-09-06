import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";

import L from "leaflet";

import "leaflet/dist/leaflet.css";
import "./App.css";
import DriverTracker from "./DriverTracker";

// =====================================================
// PRODUCTION BACKEND
// =====================================================

const API_URL =
  "https://ner-smart-logistics-1.onrender.com";

// =====================================================
// LEAFLET ICON FIX
// =====================================================

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",

  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",

  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// =====================================================
// MAP CONTROLLER
// =====================================================

function MapController({ route }) {
  const map = useMap();

  useEffect(() => {
    if (!route?.geometry?.length) {
      return;
    }

    const bounds = L.latLngBounds(
      route.geometry
    );

    map.fitBounds(bounds, {
      padding: [40, 40],
    });
  }, [route, map]);

  return null;
}

// =====================================================
// APP
// =====================================================

function App() {
  // =====================================================
  // AUTH
  // =====================================================

  const [authMode, setAuthMode] =
    useState("login");

  const [user, setUser] =
    useState(null);

  const [authLoading, setAuthLoading] =
    useState(true);

  const [authError, setAuthError] =
    useState("");

  const [authForm, setAuthForm] =
    useState({
      name: "",
      email: "",
      password: "",
    });

  // =====================================================
  // ROUTE
  // =====================================================

  const [start, setStart] =
    useState("");

  const [destination, setDestination] =
    useState("");

  const [startCoords, setStartCoords] =
    useState(null);

  const [destinationCoords, setDestinationCoords] =
    useState(null);

  const [startSuggestions, setStartSuggestions] =
    useState([]);

  const [destinationSuggestions, setDestinationSuggestions] =
    useState([]);

  const [route, setRoute] =
    useState(null);

  const [routeCandidates, setRouteCandidates] =
    useState([]);

  const [routeSelection, setRouteSelection] =
    useState("");

  const [weather, setWeather] =
    useState(null);

  const [satellite, setSatellite] =
    useState(null);

  // =====================================================
  // REAL NER NEWS
  // =====================================================

  const [nerNews, setNerNews] =
    useState([]);

  const [routeLoading, setRouteLoading] =
    useState(false);

  const [routeError, setRouteError] =
    useState("");

  // =====================================================
  // HAZARDS
  // =====================================================

  const [hazards, setHazards] =
    useState([]);

  const [hazardStatus, setHazardStatus] =
    useState("Loading...");

  const [hazardUpdated, setHazardUpdated] =
    useState(null);

  const [hazardError, setHazardError] =
    useState("");

  // =====================================================
  // FLEET
  // =====================================================

  const [vehicles, setVehicles] =
    useState([]);

  const [selectedVehicleId, setSelectedVehicleId] =
    useState(null);

  const [gpsTracking, setGpsTracking] =
    useState(false);

  const [gpsError, setGpsError] =
    useState("");

  const watchIdRef =
    useRef(null);

  // =====================================================
  // LOGISTICS
  // =====================================================

  const [shipments, setShipments] =
    useState([]);

  const [alerts, setAlerts] =
    useState([]);

  const [rerouteLoading, setRerouteLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  // =====================================================
  // AUTH CHECK
  // =====================================================

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const response =
        await fetch(
          `${API_URL}/api/auth/me`,
          {
            credentials: "include",
          }
        );

      if (response.ok) {
        const data =
          await response.json();

        setUser(data.user);
      }
    } catch {
      // Backend may be sleeping/unavailable.
    } finally {
      setAuthLoading(false);
    }
  }

  // =====================================================
  // LOGIN / SIGNUP
  // =====================================================

  async function submitAuth(event) {
    event.preventDefault();

    setAuthError("");

    const endpoint =
      authMode === "login"
        ? "/api/auth/login"
        : "/api/auth/signup";

    const body =
      authMode === "login"
        ? {
            email: authForm.email,
            password: authForm.password,
          }
        : authForm;

    try {
      const response =
        await fetch(
          `${API_URL}${endpoint}`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            credentials: "include",

            body:
              JSON.stringify(body),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Authentication failed"
        );
      }

      setUser(data.user);

      setAuthForm({
        name: "",
        email: "",
        password: "",
      });
    } catch (error) {
      setAuthError(
        error.message
      );
    }
  }

  // =====================================================
  // LOGOUT
  // =====================================================

  async function logout() {
    try {
      await fetch(
        `${API_URL}/api/auth/logout`,
        {
          method: "POST",
          credentials: "include",
        }
      );
    } catch {}

    stopGpsTracking();

    setUser(null);
    setRoute(null);
  }

  // =====================================================
  // API HELPER
  // =====================================================

  async function apiFetch(
    path,
    options = {}
  ) {
    const response =
      await fetch(
        `${API_URL}${path}`,
        {
          ...options,
          credentials: "include",
        }
      );

    if (response.status === 401) {
      setUser(null);

      throw new Error(
        "Session expired. Please login again."
      );
    }

    let data = {};

    try {
      data =
        await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(
        data.detail ||
          "Request failed"
      );
    }

    return data;
  }

  // =====================================================
  // LOAD DASHBOARD DATA
  // =====================================================

  useEffect(() => {
    if (!user) {
      return;
    }

    loadDashboard();

    const interval =
      setInterval(
        loadDashboard,
        15000
      );

    return () =>
      clearInterval(
        interval
      );
  }, [user]);

  async function loadDashboard() {
    try {
      await Promise.all([
        loadVehicles(),
        loadShipments(),
        loadAlerts(),
        loadHazards(),

        loadNerNews(),
      ]);
    } catch (error) {
      console.error(
        "Dashboard refresh failed:",
        error
      );
    }
  }

  // =====================================================
  // REAL NER NEWS
  // =====================================================

  async function loadNerNews() {
    try {
      const data =
        await apiFetch(
          "/api/live-alerts"
        );
      const liveNews = Array.isArray(data.alerts)
        ? data.alerts.map((alert) => ({
            title: alert.title || alert.event || "NDMA SACHET Alert",
            description: alert.description || "",
            category: alert.event || "Disaster Alert",
            published_at: alert.effective || "",
            link: "",
            source: alert.source || "NDMA SACHET",
            severity: alert.severity || "LOW",
            state: alert.state || alert.area || ""
          }))
        : [];

      setNerNews(liveNews);
    } catch (error) {
      console.error(
        "NER news fetch failed:",
        error
      );

      setNerNews([]);
    }
  }

  // =====================================================
  // VEHICLES
  // =====================================================

  async function loadVehicles() {
    const data =
      await apiFetch(
        "/api/vehicles"
      );

    const loadedVehicles =
      data.vehicles || [];

    setVehicles(
      loadedVehicles
    );

    if (
      !selectedVehicleId &&
      loadedVehicles.length
    ) {
      setSelectedVehicleId(
        loadedVehicles[0].id
      );
    }
  }

  // =====================================================
  // SHIPMENTS
  // =====================================================

  async function loadShipments() {
    const data =
      await apiFetch(
        "/api/shipments"
      );

    setShipments(
      data.shipments || []
    );
  }

  // =====================================================
  // SYSTEM ALERTS
  // =====================================================

  async function loadAlerts() {
    const data =
      await apiFetch(
        "/api/alerts"
      );

    setAlerts(
      data.alerts || []
    );
  }

  // =====================================================
  // HAZARDS
  // =====================================================

  async function loadHazards() {
    setHazardStatus(
      "Refreshing..."
    );

    try {
      const data =
        await apiFetch(
          "/api/hazards"
        );

      setHazards(
        data.alerts || []
      );

      setHazardUpdated(
        data.last_updated
      );

      if (data.live) {
        setHazardStatus(
          "LIVE"
        );

        setHazardError("");
      } else {
        setHazardStatus(
          "Feed unavailable"
        );

        setHazardError(
          data.error ||
            "SACHET feed unavailable"
        );
      }
    } catch (error) {
      setHazardStatus(
        "Unavailable"
      );

      setHazardError(
        error.message
      );
    }
  }

  // =====================================================
  // LOCATION SEARCH
  // =====================================================

  async function searchLocation(
    value,
    type
  ) {
    if (!value.trim()) {
      if (type === "start") {
        setStartSuggestions([]);
      } else {
        setDestinationSuggestions([]);
      }

      return;
    }

    try {
      const data =
        await apiFetch(
          `/api/geocode?q=${encodeURIComponent(
            value
          )}`
        );

      const results =
        data.results || [];

      if (type === "start") {
        setStartSuggestions(
          results
        );
      } else {
        setDestinationSuggestions(
          results
        );
      }
    } catch (error) {
      console.error(
        "Location search failed:",
        error
      );
    }
  }

  // =====================================================
  // SELECT LOCATION
  // =====================================================

  function selectLocation(
    item,
    type
  ) {
    const coords = {
      lat: Number(item.lat),
      lon: Number(item.lon),
    };

    const locationName =
      item.name ||
      item.display_name ||
      "";

    if (type === "start") {
      setStart(locationName);

      setStartCoords(coords);

      setStartSuggestions([]);
    } else {
      setDestination(
        locationName
      );

      setDestinationCoords(
        coords
      );

      setDestinationSuggestions([]);
    }
  }

  // =====================================================
  // ENSURE COORDINATES
  // =====================================================

  async function ensureCoordinates(
    text,
    existing
  ) {
    if (existing) {
      return existing;
    }

    const data =
      await apiFetch(
        `/api/geocode?q=${encodeURIComponent(
          text
        )}`
      );

    const first =
      data.results?.[0];

    if (!first) {
      throw new Error(
        `Could not locate "${text}"`
      );
    }

    return {
      lat: Number(first.lat),
      lon: Number(first.lon),
    };
  }

  // =====================================================
  // ROUTE ANALYSIS
  // =====================================================

  async function analyzeRoute() {
    setRouteError("");
    setMessage("");

    if (
      !start.trim() ||
      !destination.trim()
    ) {
      setRouteError(
        "Enter both start and destination."
      );

      return;
    }

    setRouteLoading(true);

    try {
      const s =
        await ensureCoordinates(
          start,
          startCoords
        );

      const d =
        await ensureCoordinates(
          destination,
          destinationCoords
        );

      setStartCoords(s);
      setDestinationCoords(d);

      const data =
        await apiFetch(
          "/api/analyze-route",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                start,
                destination,

                start_lat:
                  s.lat,

                start_lon:
                  s.lon,

                destination_lat:
                  d.lat,

                destination_lon:
                  d.lon,
              }),
          }
        );

      setRoute(
        data.route
      );

      setRouteCandidates(
        data.route_candidates ||
          []
      );

      setRouteSelection(
        data.route_selection ||
          ""
      );

      setWeather(
        data.weather
      );

      setSatellite(
        data.satellite
      );
    } catch (error) {
      setRouteError(
        error.message
      );
    } finally {
      setRouteLoading(false);
    }
  }

  // =====================================================
  // GPS TRACKING
  // =====================================================

  function startGpsTracking() {
    setGpsError("");

    if (
      !navigator.geolocation
    ) {
      setGpsError(
        "Browser GPS is not supported."
      );

      return;
    }

    if (!selectedVehicleId) {
      setGpsError(
        "Select a vehicle first."
      );

      return;
    }

    if (
      watchIdRef.current !== null
    ) {
      return;
    }

    const id =
      navigator.geolocation.watchPosition(
        async (position) => {
          const lat =
            position.coords.latitude;

          const lon =
            position.coords.longitude;

          try {
            await apiFetch(
              "/api/location",
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify({
                    vehicle_id:
                      Number(
                        selectedVehicleId
                      ),

                    lat,
                    lon,
                  }),
              }
            );

            await loadVehicles();
          } catch (error) {
            setGpsError(
              error.message
            );
          }
        },

        (error) => {
          setGpsError(
            error.message
          );
        },

        {
          enableHighAccuracy:
            true,

          maximumAge:
            5000,

          timeout:
            15000,
        }
      );

    watchIdRef.current =
      id;

    setGpsTracking(true);
  }

  // =====================================================
  // STOP GPS
  // =====================================================

  function stopGpsTracking() {
    if (
      watchIdRef.current !==
      null
    ) {
      navigator.geolocation.clearWatch(
        watchIdRef.current
      );

      watchIdRef.current =
        null;
    }

    setGpsTracking(false);
  }

  // =====================================================
  // EMERGENCY REROUTE
  // =====================================================

  async function emergencyReroute() {
    setMessage("");
    setRouteError("");

    if (!selectedVehicleId) {
      setRouteError(
        "Select a vehicle first."
      );

      return;
    }

    if (!destinationCoords) {
      setRouteError(
        "Analyze a destination first."
      );

      return;
    }

    const vehicle =
      vehicles.find(
        (v) =>
          Number(v.id) ===
          Number(
            selectedVehicleId
          )
      );

    if (
      vehicle?.lat === null ||
      vehicle?.lat === undefined ||
      vehicle?.lon === null ||
      vehicle?.lon === undefined
    ) {
      setRouteError(
        "Vehicle has no GPS position. Start GPS tracking first."
      );

      return;
    }

    setRerouteLoading(true);

    try {
      const data =
        await apiFetch(
          "/api/emergency-reroute",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                vehicle_id:
                  Number(
                    selectedVehicleId
                  ),

                destination_lat:
                  destinationCoords.lat,

                destination_lon:
                  destinationCoords.lon,

                destination_name:
                  destination,
              }),
          }
        );

      setRoute(
        data.route
      );

      setRouteCandidates(
        data.route_candidates ||
          []
      );

      setWeather(
        data.weather
      );

      setMessage(
        data.selection ||
          "Emergency route recalculated."
      );
    } catch (error) {
      setRouteError(
        error.message
      );
    } finally {
      setRerouteLoading(false);
    }
  }

  // =====================================================
  // FLEET MARKERS
  // =====================================================

  const fleetMarkers =
    useMemo(
      () =>
        vehicles.filter(
          (vehicle) =>
            vehicle.lat !== null &&
            vehicle.lat !== undefined &&
            vehicle.lon !== null &&
            vehicle.lon !== undefined
        ),
      [vehicles]
    );

  // =====================================================
  // AUTH LOADING
  // =====================================================

  if (authLoading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>
            NER Smart Logistics
          </h1>

          <p>
            Loading secure session...
          </p>
        </div>
      </div>
    );
  }

  // =====================================================
  // LOGIN / SIGNUP PAGE
  // =====================================================

  if (!user) {
    return (
      <div className="auth-page">

        <div className="auth-card">

          <div className="brand-block">

            <span className="brand-badge">
              NER
            </span>

            <h1>
              Smart Logistics
            </h1>

            <p>
              AI-Based Logistics &
              Accessibility Intelligence
              Platform
            </p>

          </div>

          <div className="auth-tabs">

            <button
              className={
                authMode === "login"
                  ? "active"
                  : ""
              }
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
            >
              Login
            </button>

            <button
              className={
                authMode === "signup"
                  ? "active"
                  : ""
              }
              onClick={() => {
                setAuthMode("signup");
                setAuthError("");
              }}
            >
              Create Account
            </button>

          </div>

          <form
            className="auth-form"
            onSubmit={
              submitAuth
            }
          >

            {authMode ===
              "signup" && (
              <label>
                Full Name

                <input
                  value={
                    authForm.name
                  }
                  onChange={(e) =>
                    setAuthForm({
                      ...authForm,

                      name:
                        e.target.value,
                    })
                  }
                  placeholder="Your name"
                  required
                />
              </label>
            )}

            <label>
              Email

              <input
                type="email"
                value={
                  authForm.email
                }
                onChange={(e) =>
                  setAuthForm({
                    ...authForm,

                    email:
                      e.target.value,
                  })
                }
                placeholder="you@example.com"
                required
              />
            </label>

            <label>
              Password

              <input
                type="password"
                value={
                  authForm.password
                }
                onChange={(e) =>
                  setAuthForm({
                    ...authForm,

                    password:
                      e.target.value,
                  })
                }
                placeholder="Minimum 6 characters"
                required
              />
            </label>

            {authError && (
              <div className="error-box">
                {authError}
              </div>
            )}

            <button
              className="primary-btn"
              type="submit"
            >
              {authMode ===
              "login"
                ? "Login"
                : "Create Account"}
            </button>

          </form>

        </div>

      </div>
    );
  }

  // =====================================================
  // DASHBOARD
  // =====================================================

  return (
    <div className="app-shell">

      {/* =================================================
          TOP BAR
      ================================================= */}

      <header className="topbar">

        <div>
          <h1>
            NER Smart Logistics
          </h1>

          <span>
            North Eastern Region
            Intelligence Platform
          </span>
        </div>

        <div className="user-area">

          <div className="user-info">

            <strong>
              {user.name}
            </strong>

            <small>
              {user.email}
            </small>

          </div>

          <button
            className="logout-btn"
            onClick={logout}
          >
            Logout
          </button>

        </div>

      </header>

      <main className="dashboard">

        {/* =================================================
            ROUTE PLANNER
        ================================================= */}

        <section className="panel route-panel">

          <div className="panel-title">

            <div>
              <h2>
                Smart Route Planner
              </h2>

              <p>
                Road route + weather +
                satellite + live hazards
              </p>
            </div>

          </div>

          <div className="search-grid">

            {/* START */}

            <div className="search-field">

              <label>
                Start
              </label>

              <input
                value={start}
                onChange={(e) => {
                  const value =
                    e.target.value;

                  setStart(value);

                  setStartCoords(
                    null
                  );

                  searchLocation(
                    value,
                    "start"
                  );
                }}
                placeholder="Guwahati"
              />

              {startSuggestions.length >
                0 && (
                <div className="suggestions">

                  {startSuggestions.map(
                    (item, index) => (
                      <button
                        type="button"
                        key={index}
                        onClick={() =>
                          selectLocation(
                            item,
                            "start"
                          )
                        }
                      >
                        {(() => {
                          const displayName = item.name || item.display_name || "";
                          const district = item.district || item.city || "";
                          const state = item.state || "";
                          const meta = [district, state].filter(Boolean).join(", ");
                          return meta ? `${displayName} â€” ${meta}` : displayName;
                        })()}
                      </button>
                    )
                  )}

                </div>
              )}

            </div>

            {/* DESTINATION */}

            <div className="search-field">

              <label>
                Destination
              </label>

              <input
                value={
                  destination
                }
                onChange={(e) => {
                  const value =
                    e.target.value;

                  setDestination(
                    value
                  );

                  setDestinationCoords(
                    null
                  );

                  searchLocation(
                    value,
                    "destination"
                  );
                }}
                placeholder="Shillong"
              />

              {destinationSuggestions.length >
                0 && (
                <div className="suggestions">

                  {destinationSuggestions.map(
                    (item, index) => (
                      <button
                        type="button"
                        key={index}
                        onClick={() =>
                          selectLocation(
                            item,
                            "destination"
                          )
                        }
                      >
                        {(() => {
                          const displayName = item.name || item.display_name || "";
                          const district = item.district || item.city || "";
                          const state = item.state || "";
                          const meta = [district, state].filter(Boolean).join(", ");
                          return meta ? `${displayName} â€” ${meta}` : displayName;
                        })()}
                      </button>
                    )
                  )}

                </div>
              )}

            </div>

            {/* ANALYZE */}

            <button
              className="primary-btn route-btn"
              onClick={
                analyzeRoute
              }
              disabled={
                routeLoading
              }
            >
              {routeLoading
                ? "Analyzing..."
                : "Analyze Route"}
            </button>

          </div>

          {routeError && (
            <div className="error-box">
              {routeError}
            </div>
          )}

          {message && (
            <div className="success-box">
              {message}
            </div>
          )}

        </section>

        {/* =================================================
            MAP
        ================================================= */}

        <section className="panel map-panel">

          <div className="panel-title">

            <div>
              <h2>
                Live Logistics Map
              </h2>

              <p>
                Real road geometry,
                vehicle GPS and
                route analysis
              </p>
            </div>

            <div className="map-actions">

              <button
                className={
                  gpsTracking
                    ? "danger-btn"
                    : "secondary-btn"
                }
                onClick={
                  gpsTracking
                    ? stopGpsTracking
                    : startGpsTracking
                }
              >
                {gpsTracking
                  ? "Stop GPS Tracking"
                  : "Start GPS Tracking"}
              </button>

              <button
                className="danger-btn"
                onClick={
                  emergencyReroute
                }
                disabled={
                  rerouteLoading
                }
              >
                {rerouteLoading
                  ? "Rerouting..."
                  : "Emergency Reroute"}
              </button>

            </div>

          </div>

          {gpsError && (
            <div className="error-box">
              {gpsError}
            </div>
          )}

          <div className="map-wrapper">

            <MapContainer
              center={[
                25.8,
                92.0,
              ]}
              zoom={7}
              scrollWheelZoom
              className="leaflet-map"
            >

              <TileLayer
                attribution="Â© OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {route && (
                <>
                  <MapController
                    route={route}
                  />

                  <Polyline
                    positions={
                      route.geometry
                    }
                    pathOptions={{
                      weight: 6,
                    }}
                  />

                  {startCoords && (
                    <Marker
                      position={[
                        startCoords.lat,
                        startCoords.lon,
                      ]}
                    >
                      <Popup>
                        <strong>
                          Start
                        </strong>

                        <br />

                        {start}
                      </Popup>
                    </Marker>
                  )}

                  {destinationCoords && (
                    <Marker
                      position={[
                        destinationCoords.lat,
                        destinationCoords.lon,
                      ]}
                    >
                      <Popup>
                        <strong>
                          Destination
                        </strong>

                        <br />

                        {destination}
                      </Popup>
                    </Marker>
                  )}

                </>
              )}

              {fleetMarkers.map(
                (vehicle) => (
                  <Marker
                    key={
                      vehicle.id
                    }
                    position={[
                      vehicle.lat,
                      vehicle.lon,
                    ]}
                  >

                    <Popup>

                      <strong>
                        {
                          vehicle.vehicle_number
                        }
                      </strong>

                      <br />

                      Driver:
                      {" "}
                      {
                        vehicle.driver_name
                      }

                      <br />

                      Status:
                      {" "}
                      {
                        vehicle.status
                      }

                      <br />

                      GPS:
                      {" "}
                      {Number(
                        vehicle.lat
                      ).toFixed(5)}
                      ,
                      {" "}
                      {Number(
                        vehicle.lon
                      ).toFixed(5)}

                    </Popup>

                  </Marker>
                )
              )}

            </MapContainer>

          </div>

        </section>

        {/* =================================================
            METRICS
        ================================================= */}

        <section className="metrics-grid">

          <div className="metric-card">

            <span>
              Route Distance
            </span>

            <strong>
              {route
                ? `${route.distance_km} km`
                : "--"}
            </strong>

          </div>

          <div className="metric-card">

            <span>
              ETA
            </span>

            <strong>
              {route
                ? `${route.duration_minutes} min`
                : "--"}
            </strong>

          </div>

          <div className="metric-card">

            <span>
              Route Risk
            </span>

            <strong
              className={
                route?.risk_level ===
                "High"
                  ? "risk-high"
                  : route?.risk_level ===
                    "Medium"
                  ? "risk-medium"
                  : "risk-low"
              }
            >
              {route
                ? `${route.risk_score} Â· ${route.risk_level}`
                : "--"}
            </strong>

          </div>

          <div className="metric-card">

            <span>
              Live Vehicles
            </span>

            <strong>
              {vehicles.length}
            </strong>

          </div>

        </section>

        {/* =================================================
            LIVE HAZARDS
        ================================================= */}

        <section className="panel hazard-panel">

          <div className="panel-title">

            <div>

              <h2>
                Live Hazard Monitor
              </h2>

              <p>
                Official NDMA SACHET
                multi-hazard feed
              </p>

            </div>

            <div className="hazard-status">

              <span
                className={
                  hazardStatus ===
                  "LIVE"
                    ? "live-dot"
                    : "status-dot"
                }
              />

              {hazardStatus}

              <button
                className="small-btn"
                onClick={
                  loadHazards
                }
              >
                Refresh
              </button>

            </div>

          </div>

          {hazardError && (
            <div className="warning-box">
              {hazardError}
            </div>
          )}

          {hazards.length ===
          0 ? (

            <div className="empty-state">

              <strong>
                No active SACHET
                alerts returned.
              </strong>

              <span>
                The integrated feed
                currently returned
                zero active alerts.
                No artificial hazard
                is being generated.
              </span>

            </div>

          ) : (

            <div className="hazard-list">

              {hazards.map(
                (hazard, index) => (

                  <div
                    className="hazard-card"
                    key={
                      hazard.id ||
                      index
                    }
                  >

                    <div>

                      <span className="hazard-type">
                        {
                          hazard.hazard_type
                        }
                      </span>

                      <h3>
                        {
                          hazard.title
                        }
                      </h3>

                      <p>
                        {
                          hazard.description
                        }
                      </p>

                    </div>

                    <div className="hazard-meta">

                      <span>
                        Severity:
                        {" "}
                        {
                          hazard.severity ||
                          "Unknown"
                        }
                      </span>

                      <span>
                        Area:
                        {" "}
                        {
                          hazard.areas
                            ?.map(
                              (a) =>
                                a.area_desc
                            )
                            .filter(Boolean)
                            .join(
                              ", "
                            ) ||
                          "Not specified"
                        }
                      </span>

                    </div>

                  </div>

                )
              )}

            </div>

          )}

          {hazardUpdated && (
            <small className="muted">
              Last successful feed
              update:
              {" "}
              {new Date(
                hazardUpdated
              ).toLocaleString()}
            </small>
          )}

        </section>

        {/* =================================================
            REAL NER NEWS
        ================================================= */}

        <section className="panel">

          <div className="panel-title">

            <div>

              <h2>
                ðŸ“° Live NER News
              </h2>

              <p>
                Real-time news feed for
                the 8 North Eastern states
              </p>

            </div>

            <span className="safe-badge">
              LIVE
            </span>

          </div>

          {nerNews.length === 0 ? (

            <div className="empty-state">

              <strong>
                No current verified
                NER news available.
              </strong>

              <span>
                The live news service
                currently returned no
                matching articles.
              </span>

            </div>

          ) : (

            <div className="alert-list">

              {nerNews.map(
                (article, index) => (

                  <div
                    className="alert-row"
                    key={
                      `${article.link || "news"}-${index}`
                    }
                  >

                    <div>

                      <strong>
                        {
                          article.title
                        }
                      </strong>

                      <span>
                        ðŸ“ {" "}
                        {
                          article.state
                        }

                        {" â€¢ "}

                        {
                          article.category ||
                          "General NER News"
                        }
                      </span>

                      {article.published_at && (
                        <small>
                          Published:
                          {" "}
                          {new Date(
                            article.published_at
                          ).toLocaleString()}
                        </small>
                      )}

                    </div>

                    {article.link && (
                      <a
                        href={
                          article.link
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Read News â†’
                      </a>
                    )}

                  </div>

                )
              )}

            </div>

          )}

        </section>

        {/* =================================================
            WEATHER + SATELLITE
        ================================================= */}

        <section className="two-column">

          {/* WEATHER */}

          <div className="panel">

            <div className="panel-title">

              <div>

                <h2>
                  Weather Intelligence
                </h2>

                <p>
                  Open-Meteo
                </p>

              </div>

            </div>

            {weather ? (

              <div className="data-grid">

                <div>

                  <span>
                    Temperature
                  </span>

                  <strong>
                    {
                      weather.temperature_c
                    }Â°C
                  </strong>

                </div>

                <div>

                  <span>
                    Rain
                  </span>

                  <strong>
                    {
                      weather.rain_mm
                    } mm
                  </strong>

                </div>

                <div>

                  <span>
                    Wind
                  </span>

                  <strong>
                    {
                      weather.wind_kmh
                    } km/h
                  </strong>

                </div>

                <div>

                  <span>
                    Humidity
                  </span>

                  <strong>
                    {
                      weather.humidity
                    }%
                  </strong>

                </div>

              </div>

            ) : (

              <div className="empty-state">
                Analyze a route to
                load weather.
              </div>

            )}

          </div>

          {/* SATELLITE */}

          <div className="panel">

            <div className="panel-title">

              <div>

                <h2>
                  Satellite Intelligence
                </h2>

                <p>
                  Copernicus Sentinel-2
                </p>

              </div>

            </div>

            {satellite?.available ? (

              <div className="data-grid">

                <div>

                  <span>
                    Mean NDVI
                  </span>

                  <strong>
                    {
                      satellite.mean_ndvi
                    }
                  </strong>

                </div>

                <div>

                  <span>
                    Min NDVI
                  </span>

                  <strong>
                    {
                      satellite.min_ndvi
                    }
                  </strong>

                </div>

                <div>

                  <span>
                    Max NDVI
                  </span>

                  <strong>
                    {
                      satellite.max_ndvi
                    }
                  </strong>

                </div>

              </div>

            ) : (

              <div className="empty-state">

                {
                  satellite?.message ||
                  "Analyze a route to load satellite data."
                }

              </div>

            )}

          </div>

        </section>

        {/* =================================================
            ROUTE DECISION
        ================================================= */}

        {route && (

          <section className="panel">

            <div className="panel-title">

              <div>

                <h2>
                  Route Decision
                </h2>

                <p>
                  Hazard-aware routing
                  result
                </p>

              </div>

              <span
                className={
                  route.route_hazard_affected
                    ? "danger-badge"
                    : "safe-badge"
                }
              >
                {
                  route.route_hazard_affected
                    ? "Hazard affected"
                    : "No verified route hazard"
                }
              </span>

            </div>

            <div className="route-decision">

              <div>

                <strong>
                  {routeSelection}
                </strong>

                <p>
                  The system evaluates
                  OSRM route candidates
                  against available
                  geographic hazard
                  information.
                </p>

              </div>

              <div>

                <span>
                  Hazard Alerts
                </span>

                <strong>
                  {
                    route.hazard_alerts
                      ?.length || 0
                  }
                </strong>

              </div>

              <div>

                <span>
                  Alternate Routes
                </span>

                <strong>
                  {
                    routeCandidates.length
                  }
                </strong>

              </div>

            </div>

          </section>

        )}

        {/* =================================================
            FLEET
        ================================================= */}

        <section className="two-column">

          {/* FLEET CONTROL */}

          <div className="panel">

            <div className="panel-title">

              <div>

                <h2>
                  Fleet Control
                </h2>

              </div>

            </div>

            <label>

              Active Vehicle

              <select
                value={
                  selectedVehicleId ||
                  ""
                }
                onChange={(e) =>
                  setSelectedVehicleId(
                    Number(
                      e.target.value
                    )
                  )
                }
              >

                <option value="">
                  Select vehicle
                </option>

                {vehicles.map(
                  (vehicle) => (

                    <option
                      key={
                        vehicle.id
                      }
                      value={
                        vehicle.id
                      }
                    >
                      {
                        vehicle.vehicle_number
                      }
                    </option>

                  )
                )}

              </select>

            </label>

            <DriverTracker
              vehicleId={
                Number(
                  selectedVehicleId
                )
              }
              vehicleNumber={
                vehicles.find(
                  (v) =>
                    Number(v.id) ===
                    Number(
                      selectedVehicleId
                    )
                )?.vehicle_number ||
                "NER-TRUCK-01"
              }
            />

            <div className="vehicle-list">

              {vehicles.map(
                (vehicle) => (

                  <div
                    className="vehicle-row"
                    key={
                      vehicle.id
                    }
                  >

                    <div>

                      <strong>
                        {
                          vehicle.vehicle_number
                        }
                      </strong>

                      <small>
                        {
                          vehicle.driver_name
                        }
                      </small>

                    </div>

                    <span>
                      {
                        vehicle.status
                      }
                    </span>

                  </div>

                )
              )}

            </div>

          </div>

          {/* LOGISTICS */}

          <div className="panel">

            <div className="panel-title">

              <div>

                <h2>
                  Logistics Visibility
                </h2>

                <p>
                  Shipment tracking
                </p>

              </div>

            </div>

            {shipments.length ===
            0 ? (

              <div className="empty-state">
                No shipments available.
              </div>

            ) : (

              <div className="shipment-list">

                {shipments.map(
                  (shipment) => (

                    <div
                      className="shipment-row"
                      key={
                        shipment.id
                      }
                    >

                      <strong>
                        {
                          shipment.tracking_id
                        }
                      </strong>

                      <span>
                        {
                          shipment.origin
                        }

                        {" â†’ "}

                        {
                          shipment.destination
                        }
                      </span>

                      <span>
                        {
                          shipment.status
                        }
                      </span>

                    </div>

                  )
                )}

              </div>

            )}

          </div>

        </section>

        {/* =================================================
            SYSTEM ALERTS
        ================================================= */}

        <section className="panel">

          <div className="panel-title">

            <div>

              <h2>
                System Alerts
              </h2>

            </div>

          </div>

          {alerts.length ===
          0 ? (

            <div className="empty-state">
              No application alerts.
            </div>

          ) : (

            <div className="alert-list">

              {alerts.map(
                (alert) => (

                  <div
                    className="alert-row"
                    key={
                      alert.id
                    }
                  >

                    <strong>
                      {
                        alert.title
                      }
                    </strong>

                    <span>
                      {
                        alert.message
                      }
                    </span>

                    <b>
                      {
                        alert.severity
                      }
                    </b>

                  </div>

                )
              )}

            </div>

          )}

        </section>

        {/* =================================================
            FOOTER
        ================================================= */}

        <footer className="footer">

          <span>
            Data sources:
            OpenStreetMap /
            OSRM /
            Open-Meteo /
            Copernicus Sentinel-2 /
            NDMA SACHET /
            Google News RSS
          </span>

          <span>
            Decision-support system â€”
            not a guaranteed road-closure
            or safety authority.
          </span>

        </footer>

      </main>

    </div>
  );
}

export default App;



