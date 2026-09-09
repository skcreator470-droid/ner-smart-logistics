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
// PRODUCTION BACKEND — DO NOT CHANGE
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

    const bounds = L.latLngBounds(route.geometry);

    map.fitBounds(bounds, {
      padding: [40, 40],
    });
  }, [route, map]);

  return null;
}

// =====================================================
// SMALL UI HELPERS
// =====================================================

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}) {
  return (
    <div className="section-header">
      <div>
        {eyebrow && (
          <span className="section-eyebrow">
            {eyebrow}
          </span>
        )}

        <h2>{title}</h2>

        {description && (
          <p>{description}</p>
        )}
      </div>

      {action && (
        <div className="section-action">
          {action}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const value = String(
    status || ""
  ).toLowerCase();

  let className = "status-badge";

  if (
    value.includes("high") ||
    value.includes("critical") ||
    value.includes("danger")
  ) {
    className += " status-danger";
  } else if (
    value.includes("medium") ||
    value.includes("warning") ||
    value.includes("delay")
  ) {
    className += " status-warning";
  } else if (
    value.includes("live") ||
    value.includes("active") ||
    value.includes("safe") ||
    value.includes("delivered") ||
    value.includes("completed")
  ) {
    className += " status-success";
  }

  return (
    <span className={className}>
      {status || "Unknown"}
    </span>
  );
}

// =====================================================
// APP
// =====================================================

function App() {
  // ===================================================
  // AUTH
  // ===================================================

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

  // ===================================================
  // ROUTE
  // ===================================================

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

  // ===================================================
  // LIVE NER NEWS
  // ===================================================

  const [nerNews, setNerNews] =
    useState([]);

  const [routeLoading, setRouteLoading] =
    useState(false);

  const [routeError, setRouteError] =
    useState("");

  // ===================================================
  // HAZARDS
  // ===================================================

  const [hazards, setHazards] =
    useState([]);

  const [hazardStatus, setHazardStatus] =
    useState("Loading...");

  const [hazardUpdated, setHazardUpdated] =
    useState(null);

  const [hazardError, setHazardError] =
    useState("");

  // ===================================================
  // FLEET
  // ===================================================

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

  // ===================================================
  // SEARCH PROTECTION
  // Prevent Nominatim 429
  // ===================================================

  const searchTimersRef =
    useRef({
      start: null,
      destination: null,
    });

  const searchControllersRef =
    useRef({
      start: null,
      destination: null,
    });

  const searchCacheRef =
    useRef(new Map());

  const lastSearchRequestRef =
    useRef(0);

  // ===================================================
  // LOGISTICS
  // ===================================================

  const [shipments, setShipments] =
    useState([]);

  const [alerts, setAlerts] =
    useState([]);

  const [rerouteLoading, setRerouteLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [backendStatus, setBackendStatus] =
    useState("Checking...");

  const [backendCheckedAt, setBackendCheckedAt] =
    useState(null);

  // ===================================================
  // AUTH CHECK
  // ===================================================

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

  // ===================================================
  // LOGIN / SIGNUP
  // ===================================================

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

  // ===================================================
  // LOGOUT
  // ===================================================

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

  // ===================================================
  // API HELPER
  // ===================================================

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
      const error =
        new Error(
          data.detail ||
            "Request failed"
        );

      error.status =
        response.status;

      throw error;
    }

    return data;
  }

  // ===================================================
  // DASHBOARD AUTO REFRESH
  // ===================================================

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
      clearInterval(interval);
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
      setBackendStatus("Connected");
      setBackendCheckedAt(new Date());
    } catch (error) {
      console.error(
        "Dashboard refresh failed:",
        error
      );
      setBackendStatus("Unavailable");
      setBackendCheckedAt(new Date());
    }
  }

  // ===================================================
  // LIVE NER NEWS
  // ===================================================

  async function loadNerNews() {
    try {
      const data =
        await apiFetch(
          "/api/live-alerts"
        );

      const liveNews =
        Array.isArray(
          data.alerts
        )
          ? data.alerts.map(
              (alert) => ({
                title:
                  alert.title ||
                  alert.event ||
                  "NDMA SACHET Alert",

                description:
                  alert.description ||
                  "",

                category:
                  alert.event ||
                  "Disaster Alert",

                published_at:
                  alert.effective ||
                  "",

                link:
                  alert.link ||
                  "",

                source:
                  alert.source ||
                  "NDMA SACHET",

                severity:
                  alert.severity ||
                  "LOW",

                state:
                  alert.state ||
                  alert.area ||
                  "",
              })
            )
          : [];

      setNerNews(
        liveNews
      );
    } catch (error) {
      console.error(
        "NER news fetch failed:",
        error
      );

      setNerNews([]);
    }
  }

  // ===================================================
  // VEHICLES
  // ===================================================

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

  // ===================================================
  // VEHICLE SELECTION
  // ===================================================

  function handleVehicleChange(
    value
  ) {
    const vehicleId =
      value
        ? Number(value)
        : null;

    // Prevent GPS from continuing
    // against an old vehicle.
    if (gpsTracking) {
      stopGpsTracking();
    }

    setSelectedVehicleId(
      vehicleId
    );

    setGpsError("");
  }

  // ===================================================
  // SHIPMENTS
  // ===================================================

  async function loadShipments() {
    const data =
      await apiFetch(
        "/api/shipments"
      );

    setShipments(
      data.shipments || []
    );
  }

  // ===================================================
  // ALERTS
  // ===================================================

  async function loadAlerts() {
    const data =
      await apiFetch(
        "/api/alerts"
      );

    setAlerts(
      data.alerts || []
    );
  }

  // ===================================================
  // HAZARDS
  // ===================================================

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

  // ===================================================
  // LOCATION SEARCH
  // FIXED:
  // - debounce
  // - abort previous request
  // - cache
  // - minimum request gap
  // - 429 protection
  // ===================================================

  async function searchLocation(
    value,
    type
  ) {
    const query =
      value.trim();

    if (
      searchTimersRef.current[type]
    ) {
      clearTimeout(
        searchTimersRef.current[type]
      );

      searchTimersRef.current[type] =
        null;
    }

    if (
      searchControllersRef.current[type]
    ) {
      searchControllersRef.current[type].abort();

      searchControllersRef.current[type] =
        null;
    }

    if (!query) {
      if (type === "start") {
        setStartSuggestions([]);
      } else {
        setDestinationSuggestions([]);
      }

      return;
    }

    if (query.length < 2) {
      if (type === "start") {
        setStartSuggestions([]);
      } else {
        setDestinationSuggestions([]);
      }

      return;
    }

    const cacheKey =
      query.toLowerCase();

    const cached =
      searchCacheRef.current.get(
        cacheKey
      );

    if (cached) {
      if (type === "start") {
        setStartSuggestions(
          cached
        );
      } else {
        setDestinationSuggestions(
          cached
        );
      }

      return;
    }

    // Wait before sending request.
    // This stops one request per keystroke.
    searchTimersRef.current[type] =
      setTimeout(
        async () => {
          const now =
            Date.now();

          const minimumGap =
            1200;

          const elapsed =
            now -
            lastSearchRequestRef.current;

          const waitMore =
            Math.max(
              0,
              minimumGap -
                elapsed
            );

          if (waitMore > 0) {
            await new Promise(
              (resolve) =>
                setTimeout(
                  resolve,
                  waitMore
                )
            );
          }

          // Re-check cache after waiting.
          const cachedAfterWait =
            searchCacheRef.current.get(
              cacheKey
            );

          if (cachedAfterWait) {
            if (type === "start") {
              setStartSuggestions(
                cachedAfterWait
              );
            } else {
              setDestinationSuggestions(
                cachedAfterWait
              );
            }

            return;
          }

          const controller =
            new AbortController();

          searchControllersRef.current[type] =
            controller;

          lastSearchRequestRef.current =
            Date.now();

          try {
            const data =
              await apiFetch(
                `/api/geocode?q=${encodeURIComponent(
                  query
                )}`,
                {
                  signal:
                    controller.signal,
                }
              );

            const results =
              Array.isArray(
                data.results
              )
                ? data.results
                : [];

            searchCacheRef.current.set(
              cacheKey,
              results
            );

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
            if (
              error?.name ===
              "AbortError"
            ) {
              return;
            }

            console.error(
              `Location search failed for ${type}:`,
              error
            );

            if (
              error?.status ===
              429
            ) {
              console.warn(
                "Geocoding rate limited. Search will retry after cooldown."
              );
            }

            if (type === "start") {
              setStartSuggestions([]);
            } else {
              setDestinationSuggestions([]);
            }
          } finally {
            if (
              searchControllersRef.current[type] ===
              controller
            ) {
              searchControllersRef.current[type] =
                null;
            }
          }
        },
        800
      );
  }

  // ===================================================
  // CLEAN SEARCH REQUESTS
  // ===================================================

  useEffect(() => {
    return () => {
      Object.values(
        searchTimersRef.current
      ).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });

      Object.values(
        searchControllersRef.current
      ).forEach((controller) => {
        if (controller) {
          controller.abort();
        }
      });
    };
  }, []);

  // ===================================================
  // SELECT LOCATION
  // ===================================================

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
      setStart(
        locationName
      );

      setStartCoords(
        coords
      );

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

  // ===================================================
  // ENSURE COORDINATES
  // ===================================================

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

  // ===================================================
  // ROUTE ANALYSIS
  // ===================================================

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

    if (!selectedVehicleId) {
      setRouteError(
        "Select the vehicle you are travelling with."
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

      // IMPORTANT:
      // Backend payload remains unchanged.
      // Vehicle selection is handled on frontend.
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

      setMessage(
        `Route analyzed using ${
          vehicles.find(
            (v) =>
              Number(v.id) ===
              Number(
                selectedVehicleId
              )
          )?.vehicle_number ||
          "selected vehicle"
        }.`
      );
    } catch (error) {
      setRouteError(
        error.message
      );
    } finally {
      setRouteLoading(false);
    }
  }

  // ===================================================
  // GPS TRACKING
  // REAL DEVICE LOCATION
  // ===================================================

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
      watchIdRef.current !==
      null
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

            // Reload actual backend vehicle position.
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

  // ===================================================
  // STOP GPS
  // ===================================================

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

  // ===================================================
  // STOP GPS ON UNMOUNT
  // ===================================================

  useEffect(() => {
    return () => {
      if (
        watchIdRef.current !==
        null
      ) {
        navigator.geolocation.clearWatch(
          watchIdRef.current
        );
      }
    };
  }, []);

  // ===================================================
  // EMERGENCY REROUTE
  // ===================================================

  async function emergencyReroute() {
    setMessage("");
    setRouteError("");

    if (!selectedVehicleId) {
      setRouteError("Select a vehicle first.");
      return;
    }

    if (!destinationCoords) {
      setRouteError("Analyze a destination first.");
      return;
    }

    const vehicle = vehicles.find(
      (v) => Number(v.id) === Number(selectedVehicleId)
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

    const hasVerifiedHazard = hazards.some((hazard) => {
      const severity = String(hazard.severity || "").toLowerCase();
      return [
        "high",
        "critical",
        "severe",
        "extreme",
        "danger",
      ].some((level) => severity.includes(level));
    });

    if (!hasVerifiedHazard) {
      setRouteError(
        "No active high-severity verified hazard is currently available. Emergency backup routing was not triggered."
      );
      return;
    }

    setRerouteLoading(true);

    try {
      const data = await apiFetch("/api/emergency-reroute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vehicle_id: Number(selectedVehicleId),
          destination_lat: destinationCoords.lat,
          destination_lon: destinationCoords.lon,
          destination_name: destination,
        }),
      });

      if (!data.route) {
        throw new Error(
          "Backend did not return a valid emergency backup route."
        );
      }

      setRoute(data.route);
      setRouteCandidates(data.route_candidates || []);
      setWeather(data.weather);
      setRouteSelection(
        data.route_selection ||
          data.selection ||
          "Emergency backup route"
      );

      setMessage(
        data.selection ||
          "Verified hazard detected. Backend emergency backup route applied."
      );
    } catch (error) {
      setRouteError(error.message);
    } finally {
      setRerouteLoading(false);
    }
  }

  // ===================================================
  // FLEET MARKERS
  // ===================================================

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

  // ===================================================
  // DERIVED METRICS
  // ===================================================

  const activeVehicles =
    vehicles.filter(
      (vehicle) => {
        const status =
          String(
            vehicle.status || ""
          ).toLowerCase();

        return (
          status.includes("active") ||
          status.includes("moving") ||
          status.includes("running") ||
          status.includes("online")
        );
      }
    ).length;

  const highHazards =
    hazards.filter(
      (hazard) =>
        String(
          hazard.severity || ""
        ).toLowerCase() ===
        "high"
    ).length;

  const selectedVehicle =
    vehicles.find(
      (vehicle) =>
        Number(vehicle.id) ===
        Number(
          selectedVehicleId
        )
    );

  // ===================================================
  // AUTH LOADING
  // ===================================================

  if (authLoading) {
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
              Loading secure
              intelligence platform...
            </p>
          </div>

          <div className="auth-loader">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    );
  }

  // ===================================================
  // LOGIN / SIGNUP
  // ===================================================

  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-visual">
          <div className="auth-visual-content">
            <span className="hero-kicker">
              NORTH EASTERN REGION
            </span>

            <h1>
              Intelligent
              <br />
              Logistics
              <br />
              Infrastructure
            </h1>

            <p>
              Real-time route intelligence,
              vehicle visibility, weather,
              hazards and logistics decision
              support for the North Eastern
              Region.
            </p>

            <div className="auth-feature-grid">
              <div>
                <strong>
                  LIVE
                </strong>

                <span>
                  Fleet Intelligence
                </span>
              </div>

              <div>
                <strong>
                  AI
                </strong>

                <span>
                  Route Risk Analysis
                </span>
              </div>

              <div>
                <strong>
                  8
                </strong>

                <span>
                  NER States
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="auth-side">
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
                className="primary-btn auth-submit"
                type="submit"
              >
                {authMode ===
                "login"
                  ? "Enter Dashboard"
                  : "Create Account"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ===================================================
  // DASHBOARD
  // ===================================================

  return (
    <div className="app-shell">

      {/* =================================================
          TOP NAVIGATION
      ================================================= */}

      <header className="topbar">

        <div className="topbar-brand">

          <div className="brand-mark">
            N
          </div>

          <div>
            <h1>
              NER Smart Logistics
            </h1>

            <span>
              Intelligence &
              Accessibility Platform
            </span>
          </div>

        </div>

        <div className="topbar-right">

          <div className="system-live">
            <span className="live-dot" />

            <span>
              SYSTEM LIVE
            </span>
          </div>

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

      <div className="dashboard-layout">

        <aside className="dashboard-sidebar">
          <nav className="sidebar-nav" aria-label="Dashboard navigation">
            <a className="sidebar-nav-item active" href="#dashboard-top">⌂<span>Dashboard</span></a>
            <a className="sidebar-nav-item" href="#route-planner">⌘<span>Route Planner</span></a>
            <a className="sidebar-nav-item" href="#fleet-control">▣<span>Fleet Control</span></a>
            <a className="sidebar-nav-item" href="#hazard-monitor">△<span>Hazard Monitor</span></a>
            <a className="sidebar-nav-item" href="#live-news">▤<span>Live News</span></a>
            <a className="sidebar-nav-item" href="#logistics-visibility">◇<span>Logistics</span></a>
            <a className="sidebar-nav-item" href="#system-alerts">♧<span>System Alerts</span></a>
            <a className="sidebar-nav-item" href="#settings">⚙<span>Settings</span></a>
          </nav>

          <div className="sidebar-quote">
            <strong>Stronger Connectivity<br />for a Safer<br />North East</strong>
          </div>
        </aside>

        <main className="dashboard" id="dashboard-top">

        {/* =================================================
            WELCOME / OVERVIEW
        ================================================= */}

        <section className="dashboard-hero" id="dashboard-overview">

          <div>
            <span className="section-eyebrow">
              OPERATIONS CENTER
            </span>

            <h2>
              North Eastern Region
              <br />
              Logistics Command
            </h2>

            <p>
              Monitor routes, fleet,
              hazards and logistics
              intelligence from one
              operational dashboard.
            </p>
          </div>

          <div className="hero-status-card">

            <span>
              DATA REFRESH
            </span>

            <strong>
              15 sec
            </strong>

            <small>
              Automated live synchronization
            </small>

          </div>

        </section>

        {/* =================================================
            KPI STRIP
        ================================================= */}

        <section className="metrics-grid">

          <div className="metric-card">
            <span>
              ROUTE DISTANCE
            </span>

            <strong>
              {route
                ? `${route.distance_km} km`
                : "--"}
            </strong>

            <small>
              Current analyzed route
            </small>
          </div>

          <div className="metric-card">
            <span>
              ESTIMATED ETA
            </span>

            <strong>
              {route
                ? `${route.duration_minutes} min`
                : "--"}
            </strong>

            <small>
              Route travel duration
            </small>
          </div>

          <div className="metric-card">
            <span>
              LIVE VEHICLES
            </span>

            <strong>
              {vehicles.length}
            </strong>

            <small>
              {activeVehicles} active
            </small>
          </div>

          <div className="metric-card">
            <span>
              ACTIVE HAZARDS
            </span>

            <strong>
              {hazards.length}
            </strong>

            <small>
              {highHazards} high severity
            </small>
          </div>

        </section>

        {/* =================================================
            ROUTE PLANNER
        ================================================= */}

        <div className="route-command-row">

          <section className="panel route-panel" id="route-planner">

          <SectionHeader
            eyebrow="INTELLIGENT ROUTING"
            title="Smart Route Planner"
            description="Analyze road geometry, weather, satellite intelligence and verified hazard information."
          />

          {/* VEHICLE SELECTION */}

          <div className="search-field">

            <label>
              TRAVELLING VEHICLE
            </label>

            <select
              value={
                selectedVehicleId || ""
              }
              onChange={(e) =>
                handleVehicleChange(
                  e.target.value
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
                    {vehicle.vehicle_number}
                    {" — "}
                    {vehicle.driver_name ||
                      "Driver"}
                  </option>
                )
              )}

            </select>

            {selectedVehicle && (
              <small className="muted">
                Selected vehicle:{" "}
                {
                  selectedVehicle.vehicle_number
                }
              </small>
            )}

          </div>

          <div className="search-grid">

            {/* START */}

            <div className="search-field">

              <label>
                START LOCATION
              </label>

              <input
                value={start}
                onChange={(e) => {
                  const value =
                    e.target.value;

                  setStart(value);
                  setStartCoords(null);

                  searchLocation(
                    value,
                    "start"
                  );
                }}
                placeholder="Guwahati"
                autoComplete="off"
              />

              {startSuggestions.length >
                0 && (
                <div className="suggestions">

                  {startSuggestions.map(
                    (
                      item,
                      index
                    ) => (
                      <button
                        type="button"
                        key={
                          `${item.lat}-${item.lon}-${index}`
                        }
                        onClick={() =>
                          selectLocation(
                            item,
                            "start"
                          )
                        }
                      >

                        {(() => {
                          const displayName =
                            item.name ||
                            item.display_name ||
                            "";

                          const district =
                            item.district ||
                            item.city ||
                            "";

                          const state =
                            item.state ||
                            "";

                          const meta = [
                            district,
                            state,
                          ]
                            .filter(
                              Boolean
                            )
                            .join(
                              ", "
                            );

                          return meta
                            ? `${displayName} — ${meta}`
                            : displayName;
                        })()}

                      </button>
                    )
                  )}

                </div>
              )}

            </div>

            <div className="route-connector">
              <span />
            </div>

            {/* DESTINATION */}

            <div className="search-field">

              <label>
                DESTINATION
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
                autoComplete="off"
              />

              {destinationSuggestions.length >
                0 && (
                <div className="suggestions">

                  {destinationSuggestions.map(
                    (
                      item,
                      index
                    ) => (
                      <button
                        type="button"
                        key={
                          `${item.lat}-${item.lon}-${index}`
                        }
                        onClick={() =>
                          selectLocation(
                            item,
                            "destination"
                          )
                        }
                      >

                        {(() => {
                          const displayName =
                            item.name ||
                            item.display_name ||
                            "";

                          const district =
                            item.district ||
                            item.city ||
                            "";

                          const state =
                            item.state ||
                            "";

                          const meta = [
                            district,
                            state,
                          ]
                            .filter(
                              Boolean
                            )
                            .join(
                              ", "
                            );

                          return meta
                            ? `${displayName} — ${meta}`
                            : displayName;
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
                ? "Analyzing Route..."
                : "Analyze Route →"}
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

          <aside className="panel quick-actions-panel">
            <h2>Quick Actions</h2>
            <button
              className={gpsTracking ? "quick-action gps-active" : "quick-action gps-action"}
              onClick={gpsTracking ? stopGpsTracking : startGpsTracking}
            >
              <span className="quick-action-icon">⌖</span>
              <span>{gpsTracking ? "Stop GPS Tracking" : "Start GPS Tracking"}</span>
            </button>
            <button
              className="quick-action reroute-action"
              onClick={emergencyReroute}
              disabled={rerouteLoading}
            >
              <span className="quick-action-icon">△</span>
              <span>{rerouteLoading ? "Rerouting..." : "Emergency Reroute"}</span>
            </button>
          </aside>

        </div>

        {/* =================================================
            LIVE MAP
        ================================================= */}

        <section className="panel map-panel" id="live-map">

          <SectionHeader
            eyebrow="GEOSPATIAL OPERATIONS"
            title="Live Logistics Map"
            description="Real road geometry, fleet GPS positions and route analysis."
            action={
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
                    ? "Stop GPS"
                    : "Start GPS"}
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
            }
          />

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
                attribution="© OpenStreetMap contributors"
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

              {/* REAL BACKEND VEHICLE POSITIONS */}

              {fleetMarkers.map(
                (vehicle) => (
                  <Marker
                    key={
                      vehicle.id
                    }
                    position={[
                      Number(
                        vehicle.lat
                      ),
                      Number(
                        vehicle.lon
                      ),
                    ]}
                  >
                    <Popup>

                      <strong>
                        {
                          vehicle.vehicle_number
                        }
                      </strong>

                      <br />

                      Driver:{" "}
                      {
                        vehicle.driver_name ||
                        "Not available"
                      }

                      <br />

                      Status:{" "}
                      {
                        vehicle.status ||
                        "Unknown"
                      }

                      <br />

                      GPS:{" "}
                      {Number(
                        vehicle.lat
                      ).toFixed(5)}
                      ,{" "}
                      {Number(
                        vehicle.lon
                      ).toFixed(5)}

                      <br />

                      {Number(
                        vehicle.id
                      ) ===
                        Number(
                          selectedVehicleId
                        ) && (
                        <strong>
                          LIVE TRACKED VEHICLE
                        </strong>
                      )}

                    </Popup>
                  </Marker>
                )
              )}

            </MapContainer>

            <div className="map-overlay-status">

              <span className="live-dot" />

              LIVE GPS

              <strong>
                {fleetMarkers.length}
              </strong>

            </div>

          </div>

        </section>

        {/* =================================================
            HAZARD MONITOR
        ================================================= */}

        <section className="panel hazard-panel" id="hazard-monitor">

          <SectionHeader
            eyebrow="DISASTER INTELLIGENCE"
            title="Live Hazard Monitor"
            description="Official NDMA SACHET multi-hazard information."
            action={
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
            }
          />

          {hazardError && (
            <div className="warning-box">
              {hazardError}
            </div>
          )}

          {hazards.length ===
          0 ? (
            <div className="empty-state">

              <div className="empty-icon">
                ✓
              </div>

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
                (
                  hazard,
                  index
                ) => (
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

                      <StatusBadge
                        status={
                          hazard.severity ||
                          "Unknown"
                        }
                      />

                      <span>
                        Area:{" "}
                        {
                          hazard.areas
                            ?.map(
                              (a) =>
                                a.area_desc
                            )
                            .filter(
                              Boolean
                            )
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
              Last successful feed update:{" "}
              {new Date(
                hazardUpdated
              ).toLocaleString()}
            </small>
          )}

        </section>

        {/* =================================================
            ROUTE DECISION
        ================================================= */}

        {route && (
          <section className="panel">

            <SectionHeader
              eyebrow="AI DECISION SUPPORT"
              title="Route Decision"
              description="Hazard-aware routing result."
              action={
                <span
                  className={
                    route.route_hazard_affected
                      ? "danger-badge"
                      : "safe-badge"
                  }
                >
                  {route.route_hazard_affected
                    ? "Hazard affected"
                    : "No verified route hazard"}
                </span>
              }
            />

            <div className="route-decision">

              <div className="decision-main">

                <span>
                  SELECTED ROUTE
                </span>

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

              <div className="decision-stat">

                <span>
                  HAZARD ALERTS
                </span>

                <strong>
                  {
                    route.hazard_alerts
                      ?.length || 0
                  }
                </strong>

              </div>

              <div className="decision-stat">

                <span>
                  ALTERNATE ROUTES
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
            WEATHER + SATELLITE
        ================================================= */}

        <section className="two-column weather-satellite-grid">

          <div className="panel">

            <SectionHeader
              eyebrow="ENVIRONMENTAL DATA"
              title="Weather Intelligence"
              description="Open-Meteo"
            />

            {weather ? (
              <div className="data-grid">

                <div>
                  <span>
                    Temperature
                  </span>

                  <strong>
                    {
                      weather.temperature_c
                    }°C
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

          <div className="panel">

            <SectionHeader
              eyebrow="EARTH OBSERVATION"
              title="Satellite Intelligence"
              description="Copernicus Sentinel-2"
            />

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
            LIVE NER NEWS
        ================================================= */}

        <section className="panel">

          <SectionHeader
            eyebrow="REGIONAL INTELLIGENCE"
            title="Live NER News"
            description="Verified live alerts and information for the eight North Eastern states."
            action={
              <span className="safe-badge">
                LIVE
              </span>
            }
          />

          {nerNews.length ===
          0 ? (
            <div className="empty-state">

              <div className="empty-icon">
                —
              </div>

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
                (
                  article,
                  index
                ) => (
                  <div
                    className="alert-row"
                    key={
                      `${
                        article.link ||
                        "news"
                      }-${index}`
                    }
                  >

                    <div className="alert-content">

                      <strong>
                        {
                          article.title
                        }
                      </strong>

                      <span>
                        📍{" "}
                        {
                          article.state ||
                          "North Eastern Region"
                        }

                        {" • "}

                        {
                          article.category ||
                          "General NER News"
                        }
                      </span>

                      {article.published_at && (
                        <small>
                          Published:{" "}
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
                        Read News →
                      </a>
                    )}

                  </div>
                )
              )}

            </div>
          )}

        </section>

        {/* =================================================
            FLEET + LOGISTICS
        ================================================= */}

        <section className="two-column fleet-logistics-grid">

          {/* FLEET */}

          <div className="panel fleet-panel" id="fleet-control">

            <SectionHeader
              eyebrow="VEHICLE OPERATIONS"
              title="Fleet Control"
              description="Choose the vehicle and manage real device GPS tracking."
            />

            <label className="select-label">

              ACTIVE VEHICLE

              <select
                value={
                  selectedVehicleId || ""
                }
                onChange={(e) =>
                  handleVehicleChange(
                    e.target.value
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

            {selectedVehicle && (
              <div className="success-box">
                Tracking vehicle:{" "}
                <strong>
                  {
                    selectedVehicle.vehicle_number
                  }
                </strong>
              </div>
            )}

            <DriverTracker
              vehicleId={
                Number(
                  selectedVehicleId
                )
              }
              vehicleNumber={
                selectedVehicle?.vehicle_number ||
                "NER-TRUCK-01"
              }
            />

            <div className="vehicle-list">

              {vehicles.map(
                (vehicle) => (
                  <div
                    className={
                      Number(
                        selectedVehicleId
                      ) ===
                      Number(
                        vehicle.id
                      )
                        ? "vehicle-row selected"
                        : "vehicle-row"
                    }
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
                          vehicle.driver_name ||
                          "Driver not available"
                        }
                      </small>

                    </div>

                    <StatusBadge
                      status={
                        vehicle.status
                      }
                    />

                  </div>
                )
              )}

            </div>

          </div>

          {/* LOGISTICS */}

          <div className="panel logistics-panel" id="logistics-visibility">

            <SectionHeader
              eyebrow="SUPPLY CHAIN"
              title="Logistics Visibility"
              description="Live shipment tracking and delivery visibility."
            />

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

                      <div>

                        <strong>
                          {
                            shipment.tracking_id
                          }
                        </strong>

                        <small>
                          Tracking ID
                        </small>

                      </div>

                      <span>
                        {
                          shipment.origin
                        }

                        {" → "}

                        {
                          shipment.destination
                        }
                      </span>

                      <StatusBadge
                        status={
                          shipment.status
                        }
                      />

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

        <section className="panel" id="system-alerts">

          <SectionHeader
            eyebrow="PLATFORM MONITORING"
            title="System Alerts"
            description="Application-level operational alerts from the connected backend."
          />

          {alerts.length ===
          0 ? (
            <div className="empty-state">

              <div className="empty-icon">
                ✓
              </div>

              <strong>
                No application alerts.
              </strong>

              <span>
                The connected system
                currently returned
                no application alerts.
              </span>

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

                    <div className="alert-content">

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

                    </div>

                    <StatusBadge
                      status={
                        alert.severity
                      }
                    />

                  </div>
                )
              )}

            </div>
          )}

        </section>

        {/* =================================================
            FOOTER
        ================================================= */}

        <section className="panel settings-panel" id="settings">

          <SectionHeader
            eyebrow="PLATFORM SETTINGS"
            title="System Settings"
            description="Connected backend and live data-service status."
          />

          <div className="settings-grid">

            <div className="setting-card">
              <span>BACKEND API</span>
              <strong>{API_URL}</strong>
              <small>
                Production FastAPI service used by this dashboard.
              </small>
            </div>

            <div className="setting-card">
              <span>BACKEND STATUS</span>
              <strong
                className={
                  backendStatus === "Connected"
                    ? "setting-online"
                    : backendStatus === "Unavailable"
                      ? "setting-offline"
                      : "setting-checking"
                }
              >
                {backendStatus}
              </strong>
              <small>
                {backendCheckedAt
                  ? `Last checked ${backendCheckedAt.toLocaleTimeString()}`
                  : "Waiting for first dashboard refresh."}
              </small>
            </div>

            <div className="setting-card">
              <span>DATA MODE</span>
              <strong>REAL DATA</strong>
              <small>
                Vehicles, hazards, alerts, shipments, GPS and route results come from the connected backend/services.
              </small>
            </div>

          </div>
        </section>

        <footer className="footer" id="dashboard-footer">

          <div>

            <strong>
              NER SMART LOGISTICS
            </strong>

            <span>
              Real-data decision-support
              platform for the North
              Eastern Region.
            </span>

          </div>

          <div>

            <span>
              OpenStreetMap / OSRM /
              Open-Meteo / Copernicus
              Sentinel-2 / NDMA SACHET /
              Google News RSS
            </span>

            <small>
              Decision-support system —
              not a guaranteed road-closure
              or safety authority.
            </small>

          </div>

        </footer>

        </main>

      </div>

    </div>
  );
}

export default App;
