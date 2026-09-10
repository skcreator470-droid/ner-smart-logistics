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
import "./Resilience.css";
import DriverTracker from "./DriverTracker";

// =====================================================
// PRODUCTION BACKEND — DO NOT CHANGE
// =====================================================

const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV
    ? "http://127.0.0.1:8001"
    : "https://ner-smart-logistics-1.onrender.com");

// =====================================================
// NER OPERATIONS INTELLIGENCE — FRONTEND ONLY
// Uses existing backend endpoints without changing main.py.
// =====================================================

const NER_STATES = [
  "Arunachal Pradesh",
  "Assam",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Sikkim",
  "Tripura",
];

const NER_LANGUAGES = {
  en: {
    name: "English",
    alertPrefix: "NER logistics alert",
    fieldSaved: "Field report saved and queued for sync.",
    fieldSent: "Field report submitted to the connected alert service.",
    offline: "Offline mode: report will sync when connectivity returns.",
  },
  hi: {
    name: "हिन्दी",
    alertPrefix: "NER लॉजिस्टिक्स अलर्ट",
    fieldSaved: "फील्ड रिपोर्ट सेव हो गई है और सिंक के लिए कतार में है।",
    fieldSent: "फील्ड रिपोर्ट कनेक्टेड अलर्ट सेवा को भेज दी गई है।",
    offline: "ऑफलाइन मोड: कनेक्टिविटी लौटने पर रिपोर्ट सिंक होगी।",
  },
  as: {
    name: "অসমীয়া",
    alertPrefix: "NER লজিষ্টিক্স সতৰ্কতা",
    fieldSaved: "ফিল্ড ৰিপ’ৰ্ট সংৰক্ষণ কৰি ছিংকৰ বাবে শাৰীত ৰখা হৈছে।",
    fieldSent: "ফিল্ড ৰিপ’ৰ্ট সংযুক্ত এলাৰ্ট সেৱালৈ পঠিওৱা হৈছে।",
    offline: "অফলাইন মোড: সংযোগ ঘূৰি আহিলে ৰিপ’ৰ্ট ছিংক হ’ব।",
  },
  bn: {
    name: "বাংলা",
    alertPrefix: "NER লজিস্টিক্স সতর্কতা",
    fieldSaved: "ফিল্ড রিপোর্ট সংরক্ষণ করে সিঙ্কের জন্য রাখা হয়েছে।",
    fieldSent: "ফিল্ড রিপোর্ট সংযুক্ত অ্যালার্ট সার্ভিসে পাঠানো হয়েছে।",
    offline: "অফলাইন মোড: সংযোগ ফিরে এলে রিপোর্ট সিঙ্ক হবে।",
  },
};

const FIELD_REPORT_QUEUE_KEY = "ner-smart-logistics-field-report-queue";
const LAST_ROUTE_CACHE_KEY = "ner-smart-logistics-last-route";

const ROAD_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ROAD_TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const SATELLITE_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_TILE_ATTRIBUTION = "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const SATELLITE_LABEL_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";


const NER_ROLES = {
  authority: { label: "Logistics Authority", landing: "Command Center" },
  field_official: { label: "Field Official", landing: "Field Intelligence" },
  logistics_operator: { label: "Logistics Operator", landing: "Fleet + Shipments" },
  emergency_response: { label: "Emergency Response", landing: "Emergency Operations" },
};

function safeLocalStorageGet(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

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

function MapSizeFix() {
  const map = useMap();

  useEffect(() => {
    const invalidate = () => {
      try {
        map.invalidateSize({ animate: false });
      } catch {
        // Map may already be unmounted.
      }
    };

    const timers = [0, 100, 300, 700, 1200].map((delay) =>
      window.setTimeout(invalidate, delay)
    );

    const container = map.getContainer();
    let observer;
    if (typeof ResizeObserver !== "undefined" && container) {
      observer = new ResizeObserver(invalidate);
      observer.observe(container);
    }

    window.addEventListener("resize", invalidate);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
      window.removeEventListener("resize", invalidate);
    };
  }, [map]);

  return null;
}

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

function MapLayerSwitcher({ defaultMode = "road" }) {
  const map = useMap();
  const [mode, setMode] = useState(defaultMode);

  useEffect(() => {
    map.invalidateSize({ animate: false });
  }, [mode, map]);

  return (
    <>
      {mode === "satellite" ? (
        <>
          <TileLayer
            attribution={SATELLITE_TILE_ATTRIBUTION}
            url={SATELLITE_TILE_URL}
            maxZoom={19}
          />
          <TileLayer
            attribution="&copy; Esri reference labels"
            url={SATELLITE_LABEL_URL}
            maxZoom={19}
            opacity={0.9}
          />
        </>
      ) : (
        <TileLayer
          attribution={ROAD_TILE_ATTRIBUTION}
          url={ROAD_TILE_URL}
          maxZoom={19}
        />
      )}

      <div className="map-layer-switcher" role="group" aria-label="Map view">
        <button
          type="button"
          className={mode === "road" ? "active" : ""}
          onClick={() => setMode("road")}
          title="Road map view"
        >
          🗺 Road
        </button>
        <button
          type="button"
          className={mode === "satellite" ? "active" : ""}
          onClick={() => setMode("satellite")}
          title="Real satellite imagery"
        >
          🛰 Satellite
        </button>
      </div>
    </>
  );
}

function SatelliteCoverageMap({ route, fleetMarkers = [] }) {
  const geometry = route?.geometry || [];
  const center = geometry[0] || [25.8, 92.0];

  return (
    <div className="satellite-coverage-map">
      <MapContainer
        center={center}
        zoom={7}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <MapSizeFix />
        <MapLayerSwitcher defaultMode="satellite" />

        {geometry.length > 1 && (
          <>
            <MapController route={route} />
            <Polyline
              positions={geometry}
              pathOptions={{ color: "#18c7ff", weight: 6, opacity: 0.9 }}
            >
              <Popup>
                <strong>Analyzed logistics corridor</strong>
                <br />
                {route.distance_km ?? "--"} km · {route.duration_minutes ?? "--"} min
              </Popup>
            </Polyline>
          </>
        )}

        {fleetMarkers.map((vehicle) => (
          <Marker
            key={`sat-fleet-${vehicle.id}`}
            position={[Number(vehicle.lat), Number(vehicle.lon)]}
          >
            <Popup>
              <strong>{vehicle.vehicle_number}</strong>
              <br />
              Live backend GPS
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="satellite-map-badge">
        <span className="live-dot" /> REAL SATELLITE IMAGERY · ESRI WORLD IMAGERY
      </div>
    </div>
  );
}

// =====================================================
// RESILIENCE VISUAL MAP
// =====================================================

function ResilienceMapController({ geometries, startCoords, destinationCoords }) {
  const map = useMap();

  useEffect(() => {
    const points = [];

    (geometries || []).forEach((geometry) => {
      (geometry || []).forEach((point) => points.push(point));
    });

    if (startCoords?.lat != null && startCoords?.lon != null) {
      points.push([startCoords.lat, startCoords.lon]);
    }

    if (destinationCoords?.lat != null && destinationCoords?.lon != null) {
      points.push([destinationCoords.lat, destinationCoords.lon]);
    }

    if (!points.length) return;

    map.fitBounds(L.latLngBounds(points), {
      padding: [28, 28],
    });
  }, [geometries, startCoords, destinationCoords, map]);

  return null;
}


function resilienceHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resiliencePointToSegmentKm(point, a, b) {
  if (!point || !a || !b) return Infinity;
  const latScale = 111.32;
  const lonScale = 111.32 * Math.cos((point[0] * Math.PI) / 180);
  const px = point[1] * lonScale;
  const py = point[0] * latScale;
  const ax = a[1] * lonScale;
  const ay = a[0] * latScale;
  const bx = b[1] * lonScale;
  const by = b[0] * latScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function resilienceDistanceToRouteKm(lat, lon, geometry) {
  if (lat == null || lon == null || !geometry?.length) return null;
  const point = [Number(lat), Number(lon)];
  let best = Infinity;
  for (let i = 1; i < geometry.length; i += 1) {
    best = Math.min(best, resiliencePointToSegmentKm(point, geometry[i - 1], geometry[i]));
  }
  return Number.isFinite(best) ? Number(best.toFixed(1)) : null;
}

function resilienceWeatherLabel(code) {
  const value = Number(code);
  if (!Number.isFinite(value)) return "Current provider data";
  if (value === 0) return "Clear sky";
  if ([1, 2, 3].includes(value)) return "Partly cloudy";
  if ([45, 48].includes(value)) return "Fog / low visibility";
  if ([51, 53, 55, 56, 57].includes(value)) return "Drizzle";
  if ([61, 63, 65, 66, 67].includes(value)) return "Rain";
  if ([71, 73, 75, 77].includes(value)) return "Snow / ice";
  if ([80, 81, 82].includes(value)) return "Rain showers";
  if ([85, 86].includes(value)) return "Snow showers";
  if ([95, 96, 99].includes(value)) return "Thunderstorm";
  return "Weather code " + value;
}

function resilienceHazardPosition(hazard) {
  const lat = Number(hazard?.lat ?? hazard?.latitude ?? hazard?.geometry?.lat ?? hazard?.location?.lat);
  const lon = Number(hazard?.lon ?? hazard?.longitude ?? hazard?.geometry?.lon ?? hazard?.location?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
}

function ResilienceMap({ result, startCoords, destinationCoords }) {
  const candidates = result?.route_candidates || [];
  const baselineGeometry = result?.baseline?.route?.geometry || [];
  const selectedGeometry = result?.simulation?.selected_route?.geometry || [];
  const fleet = result?.fleet_impact?.vehicles || [];
  const hazards = result?.hazards || result?.baseline?.route?.hazard_alerts || [];
  const hazardPoints = hazards.map((hazard) => ({ hazard, position: resilienceHazardPosition(hazard) })).filter((item) => item.position);

  const geometries = candidates
    .map((item) => item.geometry)
    .filter((geometry) => geometry?.length);

  const fallback = selectedGeometry.length
    ? selectedGeometry
    : baselineGeometry;

  const center = fallback[0] || [26.1445, 91.7362];

  return (
    <div className="resilience-map-wrap">
      <div className="resilience-map-head">
        <div>
          <span>ROUTE IMPACT MAP</span>
          <strong>Real road network + current fleet positions</strong>
        </div>
        <div className="resilience-map-legend">
          <span><i className="legend-dot baseline" />Baseline</span>
          <span><i className="legend-dot simulated" />Selected</span>
          <span><i className="legend-dot fleet" />Fleet</span>
        </div>
      </div>

      <div className="resilience-map-canvas">
        <MapContainer
          center={center}
          zoom={8}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <MapSizeFix />

          <MapLayerSwitcher />

          <ResilienceMapController
            geometries={geometries}
            startCoords={startCoords}
            destinationCoords={destinationCoords}
          />

          {candidates.map((candidate, index) => {
            const geometry = candidate.geometry || [];
            const isSelected =
              candidate === result?.simulation?.selected_route ||
              candidate.candidate_index === result?.simulation?.selected_route?.candidate_index;

            if (!geometry.length) return null;

            return (
              <Polyline
                key={`candidate-${candidate.candidate_index ?? index}`}
                positions={geometry}
                pathOptions={{
                  color: isSelected ? "#18c7ff" : "#64748b",
                  weight: isSelected ? 6 : 3,
                  opacity: isSelected ? 0.95 : 0.45,
                }}
              >
                <Popup>
                  <strong>{isSelected ? "Selected simulated route" : `OSRM candidate ${index + 1}`}</strong>
                  <br />
                  {candidate.distance_km} km · {candidate.duration_minutes} min
                  <br />
                  Risk: {candidate.scenario_risk_score ?? candidate.risk_score}/100
                </Popup>
              </Polyline>
            );
          })}

          {baselineGeometry.length > 1 && (
            <Polyline
              positions={baselineGeometry}
              pathOptions={{
                color: "#f59e0b",
                weight: 5,
                dashArray: "10 8",
                opacity: 0.8,
              }}
            >
              <Popup>Baseline route · current observed risk: {result?.baseline?.risk_score}/100</Popup>
            </Polyline>
          )}

          {startCoords?.lat != null && startCoords?.lon != null && (
            <Marker position={[startCoords.lat, startCoords.lon]}>
              <Popup><strong>Start</strong><br />{result?.baseline?.route?.start || "Origin"}</Popup>
            </Marker>
          )}

          {destinationCoords?.lat != null && destinationCoords?.lon != null && (
            <Marker position={[destinationCoords.lat, destinationCoords.lon]}>
              <Popup><strong>Destination</strong><br />{result?.baseline?.route?.destination || "Destination"}</Popup>
            </Marker>
          )}


          {hazardPoints.map(({ hazard, position }, index) => (
            <Marker key={`hazard-${hazard?.id ?? index}`} position={position}>
              <Popup>
                <strong>{hazard?.title || hazard?.hazard_type || "Verified hazard"}</strong>
                <br />
                Severity: {hazard?.severity || "Unknown"}
                <br />
                Source: NDMA SACHET / connected hazard feed
              </Popup>
            </Marker>
          ))}

          {selectedGeometry.length > 2 && (
            <Marker position={selectedGeometry[Math.floor(selectedGeometry.length / 2)]}>
              <Popup><strong>Simulation disruption point</strong><br />Hypothetical {result?.simulation?.scenario_label || "scenario"} overlay only.</Popup>
            </Marker>
          )}


          {selectedGeometry.length > 3 && (
            <Polyline
              positions={selectedGeometry.slice(0, Math.ceil(selectedGeometry.length * 0.34))}
              pathOptions={{ color: "#22c55e", weight: 8, opacity: 0.35 }}
            />
          )}
          {selectedGeometry.length > 6 && (
            <Polyline
              positions={selectedGeometry.slice(Math.floor(selectedGeometry.length * 0.34), Math.floor(selectedGeometry.length * 0.67) + 1)}
              pathOptions={{ color: "#f59e0b", weight: 8, opacity: 0.35 }}
            />
          )}
          {selectedGeometry.length > 9 && (
            <Polyline
              positions={selectedGeometry.slice(Math.floor(selectedGeometry.length * 0.67))}
              pathOptions={{ color: "#ef4444", weight: 8, opacity: 0.35 }}
            />
          )}

          {fleet.map((vehicle) => (
            <Marker key={`fleet-${vehicle.id}`} position={[vehicle.lat, vehicle.lon]}>
              <Popup>
                <strong>{vehicle.vehicle_number}</strong>
                <br />
                Current backend GPS
                <br />
                {vehicle.corridor_distance_km} km from route corridor
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
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
      role: "authority",
    });

  const [userRole, setUserRole] = useState("authority");
  const [roleInfo, setRoleInfo] = useState(null);

  // ===================================================
  // ADVANCED NER INTELLIGENCE
  // ===================================================
  const [advancedIntel, setAdvancedIntel] = useState(null);
  const [advancedLoading, setAdvancedLoading] = useState(false);
  const [advancedError, setAdvancedError] = useState("");
  const [intelWhatIf, setIntelWhatIf] = useState({
    rainfall_mm: 10,
    wind_kmh: 30,
    extra_delay_minutes: 30,
    additional_hazard_count: 1,
  });

  async function loadAdvancedIntel() {
    setAdvancedLoading(true);
    setAdvancedError("");
    try {
      const twin = await apiFetch("/api/intelligence/digital-twin");
      const memory = await apiFetch("/api/intelligence/disruption-memory");
      setAdvancedIntel((current) => ({ ...(current || {}), twin, memory }));
    } catch (error) {
      setAdvancedError(error?.message || "Advanced intelligence service unavailable.");
    } finally {
      setAdvancedLoading(false);
    }
  }

  async function runAdvancedWhatIf() {
    setAdvancedLoading(true);
    setAdvancedError("");
    try {
      const data = await apiFetch("/api/intelligence/what-if", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_risk_score: route?.risk_score || 0,
          ...intelWhatIf,
        }),
      });
      setAdvancedIntel((current) => ({ ...(current || {}), whatIf: data }));
    } catch (error) {
      setAdvancedError(error?.message || "Scenario analysis failed.");
    } finally {
      setAdvancedLoading(false);
    }
  }

  async function runSafeWindow() {
    setAdvancedLoading(true);
    setAdvancedError("");
    try {
      const data = await apiFetch("/api/intelligence/safe-window", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_risk_score: route?.risk_score || 0,
          rainfall_mm: weather?.rain_mm ?? null,
          wind_kmh: weather?.wind_kmh ?? null,
        }),
      });
      setAdvancedIntel((current) => ({ ...(current || {}), safeWindow: data }));
    } catch (error) {
      setAdvancedError(error?.message || "Safe-window analysis failed.");
    } finally {
      setAdvancedLoading(false);
    }
  }

  async function runImpact() {
    setAdvancedLoading(true);
    setAdvancedError("");
    try {
      const data = await apiFetch("/api/intelligence/impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route_distance_km: route?.distance_km || 0,
          route_duration_minutes: route?.duration_minutes || 0,
          risk_score: route?.risk_score || 0,
          vehicle_count: vehicles.length,
          shipment_count: shipments.length,
        }),
      });
      setAdvancedIntel((current) => ({ ...(current || {}), impact: data }));
    } catch (error) {
      setAdvancedError(error?.message || "Impact analysis failed.");
    } finally {
      setAdvancedLoading(false);
    }
  }

  async function runVerification() {
    setAdvancedLoading(true);
    setAdvancedError("");
    try {
      const data = await apiFetch("/api/intelligence/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          government_alerts: hazards.length,
          field_reports: advancedIntel?.memory?.historical_evidence?.field_report_count || 0,
          weather_risk_score: weather?.risk_score || route?.risk_score || 0,
        }),
      });
      setAdvancedIntel((current) => ({ ...(current || {}), verification: data }));
    } catch (error) {
      setAdvancedError(error?.message || "Verification analysis failed.");
    } finally {
      setAdvancedLoading(false);
    }
  }


  const [activeNav, setActiveNav] = useState("dashboard");
  const [globalSearch, setGlobalSearch] = useState("");

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

  async function loadProblemStatementOps() {
    const results = await Promise.allSettled([
      apiFetch("/api/analytics/overview"),
      apiFetch("/api/connectivity/districts"),
      apiFetch("/api/logistics/bottlenecks"),
      apiFetch("/api/notifications"),
      apiFetch("/api/emergency/accessibility"),
    ]);

    if (results[0].status === "fulfilled") setOpsAnalytics(results[0].value);
    if (results[1].status === "fulfilled") setDistrictConnectivity(results[1].value.districts || []);
    if (results[2].status === "fulfilled") setBottlenecks(results[2].value);
    if (results[3].status === "fulfilled") setOpsNotifications(results[3].value.notifications || []);
    if (results[4].status === "fulfilled") setEmergencyAccess(results[4].value);
  }

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
  // NER RESILIENCE INTELLIGENCE
  // ===================================================

  const [resilienceScenario, setResilienceScenario] =
    useState("flood");

  const [resilienceResult, setResilienceResult] =
    useState(null);

  const [resilienceLoading, setResilienceLoading] =
    useState(false);

  const [resilienceError, setResilienceError] =
    useState("");

  // ===================================================
  // PROBLEM-STATEMENT OPERATIONS INTELLIGENCE
  // Additive endpoints: district connectivity, bottlenecks,
  // notifications, emergency accessibility and analytics.
  // ===================================================

  const [opsAnalytics, setOpsAnalytics] = useState(null);
  const [districtConnectivity, setDistrictConnectivity] = useState([]);
  const [bottlenecks, setBottlenecks] = useState(null);
  const [opsNotifications, setOpsNotifications] = useState([]);
  const [emergencyAccess, setEmergencyAccess] = useState(null);


  // ===================================================
  // REGIONAL OPERATIONS / FIELD REPORTING / OFFLINE
  // ===================================================

  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  const [fieldReport, setFieldReport] = useState({
    incidentType: "Road obstruction",
    severity: "Medium",
    description: "",
    lat: "",
    lon: "",
    photoName: "",
  });

  const [fieldReportPhoto, setFieldReportPhoto] = useState("");
  const [fieldReportPhotoFile, setFieldReportPhotoFile] = useState(null);
  const [fieldReportLoading, setFieldReportLoading] = useState(false);
  const [fieldReportMessage, setFieldReportMessage] = useState("");
  const [fieldReportError, setFieldReportError] = useState("");
  const [offlineReportCount, setOfflineReportCount] = useState(() =>
    safeLocalStorageGet(FIELD_REPORT_QUEUE_KEY, []).length
  );
  const [language, setLanguage] = useState("en");
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const [cachedRoute, setCachedRoute] = useState(() =>
    safeLocalStorageGet(LAST_ROUTE_CACHE_KEY, null)
  );

  const lastNotifiedAlertRef = useRef(null);

  // ===================================================
  // ONLINE / OFFLINE SYNCHRONIZATION
  // ===================================================

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineFieldReports();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [user]);

  async function syncOfflineFieldReports() {
    if (!navigator.onLine || !user) return;

    const queue = safeLocalStorageGet(FIELD_REPORT_QUEUE_KEY, []);
    if (!queue.length) {
      setOfflineReportCount(0);
      return;
    }

    const remaining = [];
    for (const report of queue) {
      try {
        const created = await apiFetch("/api/field-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            incident_type: report.incidentType,
            severity: report.severity,
            description: report.description || report.message || "Offline field report",
            lat: report.lat ? Number(report.lat) : null,
            lon: report.lon ? Number(report.lon) : null,
          }),
        });

        await apiFetch("/api/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `[FIELD REPORT] ${report.incidentType}`,
            message: report.message,
            severity: report.severity,
          }),
        });

        // Offline photos are intentionally not auto-uploaded from localStorage.
        // The online submission path uploads the actual File object securely.
        void created;
      } catch {
        remaining.push(report);
      }
    }

    safeLocalStorageSet(FIELD_REPORT_QUEUE_KEY, remaining);
    setOfflineReportCount(remaining.length);
    if (queue.length !== remaining.length) {
      loadAlerts().catch(() => {});
    }
  }

  useEffect(() => {
    if (!user || !isOnline) return;
    syncOfflineFieldReports();
  }, [user, isOnline]);

  useEffect(() => {
    if (!route) return;
    const snapshot = {
      start,
      destination,
      startCoords,
      destinationCoords,
      route,
      routeCandidates,
      routeSelection,
      weather,
      savedAt: new Date().toISOString(),
    };
    if (safeLocalStorageSet(LAST_ROUTE_CACHE_KEY, snapshot)) {
      setCachedRoute(snapshot);
    }
  }, [route, routeCandidates, routeSelection, weather, start, destination, startCoords, destinationCoords]);

  // Browser notifications are optional and only use data already returned by the backend.
  useEffect(() => {
    if (!user || !alerts.length || typeof Notification === "undefined") return;
    const newest = alerts[0];
    if (!newest?.id || newest.id === lastNotifiedAlertRef.current) return;
    lastNotifiedAlertRef.current = newest.id;
    if (Notification.permission === "granted") {
      const copy = NER_LANGUAGES[language] || NER_LANGUAGES.en;
      new Notification(copy.alertPrefix, {
        body: `${newest.title || "Operational alert"}: ${newest.message || ""}`,
      });
    }
  }, [alerts, language, user]);

  async function enableBrowserNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    } catch {
      setNotificationPermission("denied");
    }
  }

  function captureFieldLocation() {
    setFieldReportError("");
    if (!navigator.geolocation) {
      setFieldReportError("Browser geolocation is not available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFieldReport((current) => ({
          ...current,
          lat: position.coords.latitude.toFixed(6),
          lon: position.coords.longitude.toFixed(6),
        }));
      },
      (error) => setFieldReportError(error.message || "Unable to read device location."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function buildFieldReportMessage(report) {
    const coords = report.lat && report.lon
      ? `Geo-tag: ${report.lat}, ${report.lon}.`
      : "Geo-tag: not captured.";
    const photo = report.photoName
      ? ` Photo selected locally: ${report.photoName}.`
      : "";
    return `${report.description.trim() || "No additional description provided."} ${coords}${photo} Reported from the NER Smart Logistics field console.`;
  }

  async function submitFieldReport(event) {
    event.preventDefault();
    setFieldReportMessage("");
    setFieldReportError("");

    if (!fieldReport.description.trim()) {
      setFieldReportError("Add a short incident description before submitting.");
      return;
    }

    let reportForSubmit = { ...fieldReport };

    if ((!reportForSubmit.lat || !reportForSubmit.lon) && navigator.geolocation) {
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        });
        reportForSubmit = {
          ...reportForSubmit,
          lat: position.coords.latitude.toFixed(6),
          lon: position.coords.longitude.toFixed(6),
        };
        setFieldReport((current) => ({ ...current, lat: reportForSubmit.lat, lon: reportForSubmit.lon }));
      } catch {
        // GPS permission may be denied; the report can still be submitted without coordinates.
      }
    }

    const payload = {
      ...reportForSubmit,
      message: buildFieldReportMessage(reportForSubmit),
      createdAt: new Date().toISOString(),
    };

    setFieldReportLoading(true);
    try {
      if (!navigator.onLine) throw new Error("offline");

      const reportResponse = await apiFetch("/api/field-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_type: reportForSubmit.incidentType,
          severity: reportForSubmit.severity,
          description: reportForSubmit.description,
          lat: reportForSubmit.lat ? Number(reportForSubmit.lat) : null,
          lon: reportForSubmit.lon ? Number(reportForSubmit.lon) : null,
        }),
      });

      if (fieldReportPhotoFile && reportResponse.report?.id) {
        const reader = new FileReader();
        const base64 = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
          reader.onerror = reject;
          reader.readAsDataURL(fieldReportPhotoFile);
        });
        await apiFetch(`/api/field-reports/${reportResponse.report.id}/photo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: fieldReportPhotoFile.name,
            content_base64: base64,
            mime_type: fieldReportPhotoFile.type || "image/jpeg",
          }),
        });
      }

      // Preserve the legacy alert stream as well, so existing alert/dashboard behaviour remains intact.
      await apiFetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `[FIELD REPORT] ${fieldReport.incidentType}`,
          message: payload.message,
          severity: fieldReport.severity,
        }),
      });

      setFieldReportMessage((NER_LANGUAGES[language] || NER_LANGUAGES.en).fieldSent);
      setFieldReport({
        incidentType: "Road obstruction",
        severity: "Medium",
        description: "",
        lat: fieldReport.lat,
        lon: fieldReport.lon,
        photoName: "",
      });
      setFieldReportPhoto("");
      setFieldReportPhotoFile(null);
      loadAlerts().catch(() => {});
    } catch {
      const queue = safeLocalStorageGet(FIELD_REPORT_QUEUE_KEY, []);
      queue.push(payload);
      safeLocalStorageSet(FIELD_REPORT_QUEUE_KEY, queue);
      setOfflineReportCount(queue.length);
      setFieldReportMessage(
        navigator.onLine
          ? (NER_LANGUAGES[language] || NER_LANGUAGES.en).fieldSaved
          : (NER_LANGUAGES[language] || NER_LANGUAGES.en).offline
      );
    } finally {
      setFieldReportLoading(false);
    }
  }

  const regionalAccessibility = useMemo(() => {
    const routeText = `${start || ""} ${destination || ""}`.toLowerCase();
    const hazardText = hazards
      .map((item) => `${item?.state || ""} ${item?.area || ""} ${item?.district || ""} ${item?.location || ""}`)
      .join(" ")
      .toLowerCase();

    return NER_STATES.map((state) => {
      const stateKey = state.toLowerCase();
      const hazardMatch = hazardText.includes(stateKey);
      const routeMatch = routeText.includes(stateKey);
      return {
        state,
        status: hazardMatch
          ? "Hazard feed attention"
          : routeMatch
            ? "Active route corridor"
            : "No verified hazard returned",
        tone: hazardMatch ? "danger" : routeMatch ? "route" : "neutral",
      };
    });
  }, [hazards, start, destination]);

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
        try {
          const access = await fetch(`${API_URL}/api/access/role`, { credentials: "include" });
          if (access.ok) {
            const roleData = await access.json();
            if (roleData.assigned && roleData.role?.key) {
              setUserRole(roleData.role.key);
              setRoleInfo(roleData.role);
            }
          }
        } catch {}
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

    const selectedRole = authForm.role || "authority";
    const body =
      authMode === "login"
        ? {
            email: authForm.email,
            password: authForm.password,
          }
        : {
            name: authForm.name,
            email: authForm.email,
            password: authForm.password,
          };

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

      let finalRole = selectedRole;
      try {
        const existing = await fetch(`${API_URL}/api/access/role`, { credentials: "include" });
        if (existing.ok) {
          const roleData = await existing.json();
          if (roleData.assigned && roleData.role?.key) {
            finalRole = roleData.role.key;
            if (finalRole !== selectedRole) {
              throw new Error(`This account is assigned to ${roleData.role.label}. Please select that role.`);
            }
          } else {
            const assigned = await fetch(`${API_URL}/api/access/role`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ role: selectedRole }),
            });
            const assignedData = await assigned.json();
            if (!assigned.ok) throw new Error(assignedData.detail || "Unable to assign account role");
            finalRole = assignedData.role?.key || selectedRole;
          }
        }
      } catch (roleError) {
        // Role service is additive. Never block legacy authentication when it is unavailable.
        console.warn("Optional role service unavailable:", roleError);
        finalRole = selectedRole;
      }

      setUserRole(finalRole);
      setRoleInfo(NER_ROLES[finalRole] || { label: finalRole, landing: "Dashboard" });
      setAuthForm({
        name: "",
        email: "",
        password: "",
        role: "authority",
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
    setUserRole("authority");
    setRoleInfo(null);
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
        loadProblemStatementOps(),
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
  // NER RESILIENCE / WHAT-IF SIMULATOR
  // Uses real route, weather, SACHET and fleet data.
  // The selected scenario itself is explicitly hypothetical.
  // ===================================================

  async function runResilienceSimulation() {
    setResilienceError("");

    if (!startCoords || !destinationCoords || !route) {
      setResilienceError(
        "Analyze a route first so the simulator can use the real route, weather and hazard data already returned by the backend."
      );
      return;
    }

    setResilienceLoading(true);

    try {
      // Frontend-only what-if layer. The original FastAPI backend is untouched.
      // Baseline values come from /api/analyze-route; only the scenario penalty
      // is hypothetical and is explicitly labelled as simulation.
      const penalties = {
        flood: 25,
        landslide: 30,
        road_closure: 100,
        extreme_rainfall: 20,
        accident: 20,
        severe_weather: 25,
      };

      const baseCandidates = routeCandidates.length > 0 ? routeCandidates : [route];
      const penalty = penalties[resilienceScenario] ?? 20;

      const simulatedCandidates = baseCandidates.map((candidate, index) => ({
        ...candidate,
        candidate_index: candidate.candidate_index ?? index,
        scenario_risk_score: Math.min(100, Number(candidate.risk_score ?? 0) + penalty),
      }));

      let available = simulatedCandidates;

      if (resilienceScenario === "road_closure" && available.length > 1) {
        available = available.filter(
          (candidate) =>
            candidate.geometry !== route.geometry &&
            candidate.candidate_index !== route.candidate_index
        );
      }

      if (!available.length) available = simulatedCandidates;

      const selectedRoute =
        resilienceScenario === "road_closure"
          ? [...available].sort((a, b) => a.scenario_risk_score - b.scenario_risk_score || a.duration_minutes - b.duration_minutes)[0]
          : [...available].sort((a, b) => a.scenario_risk_score - b.scenario_risk_score || a.duration_minutes - b.duration_minutes)[0];

      const baselineRisk = Number(route.risk_score ?? 0);
      const projectedRisk = Math.min(100, Number(selectedRoute?.scenario_risk_score ?? baselineRisk + penalty));
      const baselineDistance = Number(route.distance_km ?? 0);
      const baselineEta = Number(route.duration_minutes ?? 0);
      const simulatedDistance = Number(selectedRoute?.distance_km ?? baselineDistance);
      const simulatedEta = Number(selectedRoute?.duration_minutes ?? baselineEta);
      const etaDelta = Math.max(0, simulatedEta - baselineEta);

      const scenarioLabel = resilienceScenario
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

      const liveHazards = [
        ...(route.hazard_alerts || []),
        ...(route.regional_hazard_alerts || []),
      ];
      const uniqueHazards = liveHazards.filter((item, index, array) => {
        const key = item?.id ?? item?.title ?? item?.message ?? index;
        return array.findIndex((candidate) => (candidate?.id ?? candidate?.title ?? candidate?.message ?? index) === key) === index;
      });

      const routeGeometry = selectedRoute?.geometry || route.geometry || [];
      const corridorThresholdKm = 10;
      const fleetWithDistance = vehicles
        .filter((vehicle) => vehicle.lat != null && vehicle.lon != null)
        .map((vehicle) => ({
          ...vehicle,
          corridor_distance_km: resilienceDistanceToRouteKm(vehicle.lat, vehicle.lon, routeGeometry),
        }))
        .sort((a, b) => (a.corridor_distance_km ?? Infinity) - (b.corridor_distance_km ?? Infinity));

      const corridorFleet = fleetWithDistance.filter(
        (vehicle) => vehicle.corridor_distance_km != null && vehicle.corridor_distance_km <= corridorThresholdKm
      );

      const actualReasons = Array.isArray(route.reasons) ? route.reasons : [];
      const decisionReasons = [
        ...actualReasons,
        resilienceScenario === "road_closure"
          ? corridorFleet.length
            ? `${corridorFleet.length} GPS-positioned vehicle(s) are within ${corridorThresholdKm} km of the simulated route corridor.`
            : `No GPS-positioned vehicle is within ${corridorThresholdKm} km of the simulated route corridor.`
          : `The ${scenarioLabel.toLowerCase()} effect is modelled as a +${penalty} risk-point comparison only; it is not a live incident.`,
        selectedRoute !== route
          ? "A different real OSRM candidate has lower projected scenario risk."
          : "The current real OSRM route remains the best available candidate under this scenario model.",
      ].slice(0, 6);

      const scenarioComparison = Object.entries(penalties).map(([scenario, scenarioPenalty]) => {
        const bestCandidateRisk = Math.min(...baseCandidates.map((candidate) => Number(candidate.risk_score ?? baselineRisk)));
        const score = scenario === resilienceScenario && scenario === "road_closure" && baseCandidates.length > 1
          ? Math.min(100, Number(available[0]?.risk_score ?? bestCandidateRisk) + scenarioPenalty)
          : Math.min(100, bestCandidateRisk + scenarioPenalty);
        return {
          scenario,
          label: scenario.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
          score,
        };
      });

      const baselineHazards = route.hazard_alerts?.length || 0;
      const selectedHazards = selectedRoute?.hazard_alerts?.length || 0;
      const routeChanged = selectedRoute !== route;

      setResilienceResult({
        scenario_label: scenarioLabel,
        baseline: {
          risk_score: baselineRisk,
          risk_level: route.risk_level,
          route,
          hazard_count: baselineHazards,
        },
        simulation: {
          scenario: resilienceScenario,
          scenario_label: scenarioLabel,
          projected_risk_score: projectedRisk,
          projected_risk_level: projectedRisk >= 70 ? "High" : projectedRisk >= 40 ? "Medium" : "Low",
          resilience_score: Math.max(0, 100 - projectedRisk),
          route_status: routeChanged ? "Alternate real OSRM route selected" : "Current route retained",
          selected_route: selectedRoute,
          reasons: decisionReasons,
          explanation: routeChanged
            ? `The ${scenarioLabel.toLowerCase()} simulation projects ${projectedRisk}/100 risk. A real OSRM candidate is shown as the alternate because it has lower projected scenario risk. ETA changes by ${etaDelta} min.`
            : `The ${scenarioLabel.toLowerCase()} simulation projects ${projectedRisk}/100 risk on the current real route. This disruption effect is a modelled comparison, not a live event.`,
          eta_delta_minutes: etaDelta,
          distance_delta_km: Number(Math.max(0, simulatedDistance - baselineDistance).toFixed(1)),
          hazard_count: selectedHazards,
        },
        route_candidates: simulatedCandidates,
        scenario_comparison: scenarioComparison,
        weather: weather || {},
        hazard_count: baselineHazards,
        hazards: uniqueHazards,
        fleet_impact: {
          corridor_threshold_km: corridorThresholdKm,
          vehicles_in_corridor: corridorFleet.length,
          vehicles: corridorFleet.length ? corridorFleet : fleetWithDistance,
          message: `${corridorFleet.length} of ${fleetWithDistance.length} GPS-positioned vehicle(s) are within ${corridorThresholdKm} km of the simulated route.`,
        },
        notice: "SIMULATION ONLY — the selected disruption is hypothetical. Existing backend data remains unchanged.",
        data_sources: [
          "Existing /api/analyze-route response",
          "OSRM route geometry",
          "Open-Meteo / MET Norway weather returned by backend",
          "NDMA SACHET hazards returned by backend",
          "Current backend fleet GPS",
        ],
      });
    } catch (error) {
      setResilienceResult(null);
      setResilienceError(error.message);
    } finally {
      setResilienceLoading(false);
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
              Smarter Logistics.
              <br />
              Stronger <span>North East.</span>
            </h1>

            <p>
              Real-time route intelligence, live alerts, weather updates and AI-powered
              logistics decision support for a safer, more connected North East.
            </p>

            <div className="auth-feature-grid">
              <div>
                <strong>LIVE</strong>
                <span>Fleet Intelligence</span>
              </div>
              <div>
                <strong>AI</strong>
                <span>Route Risk Analysis</span>
              </div>
              <div>
                <strong>8</strong>
                <span>NER States</span>
              </div>
              <div>
                <strong>24/7</strong>
                <span>Safety Monitoring</span>
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
                <span className="auth-label-row"><span>Email</span><span className="auth-field-icon">✉</span></span>

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
                <span className="auth-label-row"><span>Password</span><span className="auth-field-icon">▣</span></span>

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

              <label>
                <span className="auth-label-row"><span>Access Role</span><span className="auth-field-icon">◇</span></span>
                <select
                  value={authForm.role}
                  onChange={(e) => setAuthForm({ ...authForm, role: e.target.value })}
                >
                  {Object.entries(NER_ROLES).map(([key, value]) => (
                    <option key={key} value={key}>{value.label}</option>
                  ))}
                </select>
              </label>

              <div className="auth-role-note">
                {authMode === "signup"
                  ? "Your first selected role is attached to this account."
                  : "The selected role must match the role already assigned to this account."}
              </div>

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

        <div className="topbar-search">
          <span>⌕</span>
          <input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && globalSearch.trim()) {
                setDestination(globalSearch.trim());
                setGlobalSearch("");
                setActiveNav("route");
                document.getElementById("route-planner")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
            placeholder="Search destination, vehicle, or location..."
            aria-label="Search destination, vehicle, or location"
          />
        </div>

        <div className="topbar-right">

          <button className="notification-btn" type="button" onClick={() => {
            setActiveNav("alerts");
            document.getElementById("system-alerts")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }} aria-label="Open alerts">
            ♧<span>{alerts.length > 0 ? Math.min(alerts.length, 9) : ""}</span>
          </button>

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
            <span className="role-chip">{roleInfo?.label || NER_ROLES[userRole]?.label || "Logistics Authority"}</span>
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
          <div className="sidebar-brand">
            <div className="sidebar-logo">⌁</div>
            <div>
              <strong>NER</strong>
              <span>Smart Logistics</span>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="Dashboard navigation">
            {[
              ["dashboard", "dashboard-top", "D", "Dashboard"],
              ["route", "route-planner", "R", "Route Planner"],
              ["fleet", "fleet-control", "F", "Fleet Control"],
              ["gps", "live-map", "G", "Live GPS"],
              ["weather", "regional-operations", "W", "Weather"],
              ["satellite", "regional-operations", "S", "Satellite"],
              ["news", "live-news", "N", "News"],
              ["alerts", "system-alerts", "A", "Alerts"],
              ["logistics", "logistics-visibility", "L", "Logistics"],
              ["emergency", "live-map", "E", "Emergency Route"],
              ["ai", "operations-intelligence", "AI", "AI Decision"],
              ["reports", "operations-intelligence", "RP", "Reports"],
              ["field-reports", "regional-operations", "FR", "Field Reports"],
              ["advanced", "advanced-intelligence", "AD", "Advanced Intelligence"],
              ["settings", "settings", "ST", "Settings"],
            ].map(([key, target, icon, label]) => (
              <a
                key={key}
                className={`sidebar-nav-item ${activeNav === key ? "active" : ""}`}
                href={`#${target}`}
                onClick={(event) => {
                  event.preventDefault();
                  setActiveNav(key);
                  window.requestAnimationFrame(() => {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  });
                }}
              >
                <span className="sidebar-nav-icon">{icon}</span>
                <span>{label}</span>
              </a>
            ))}
          </nav>

          <div className="sidebar-quote">
            <strong>Stronger Connectivity<br />for a Safer<br />North East</strong>
            <span>◢◣</span>
          </div>
        </aside>

        <main className={`dashboard dashboard-view-${activeNav}`} id="dashboard-top">

        <section className="role-focus-strip" aria-label="Role workspace">
          <div>
            <span>ROLE WORKSPACE</span>
            <strong>{roleInfo?.label || NER_ROLES[userRole]?.label || "Logistics Authority"}</strong>
            <small>{roleInfo?.landing || NER_ROLES[userRole]?.landing || "Command Center"}</small>
          </div>
          <div className="role-focus-items">
            {(userRole === "authority"
              ? ["District connectivity", "Bottlenecks", "Fleet + shipments", "Alerts"]
              : userRole === "field_official"
                ? ["Field reports", "Hazards", "Offline sync", "Route risk"]
                : userRole === "logistics_operator"
                  ? ["Fleet GPS", "Shipments", "Alternate routes", "Delay alerts"]
                  : ["Emergency routes", "Disaster alerts", "High-risk corridors", "Analytics"]
            ).map((item) => <span key={item}>{item}</span>)}
          </div>
        </section>

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

              <MapSizeFix />

              <MapLayerSwitcher />

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
          <section className="panel route-decision-panel" id="route-decision">

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
            NER RESILIENCE INTELLIGENCE
        ================================================= */}

        <section className="panel resilience-panel" id="resilience-command-center">
          <SectionHeader
            eyebrow="RESILIENCE INTELLIGENCE"
            title="NER Resilience Command Center"
            description="A visual what-if layer grounded in the real OSRM route, backend weather, verified SACHET hazards and current GPS fleet data."
            action={<span className="resilience-simulation-badge">SIMULATION ONLY</span>}
          />

          <div className="resilience-controls">
            <label className="resilience-select">
              <span>WHAT-IF SCENARIO</span>
              <select
                value={resilienceScenario}
                onChange={(event) => {
                  setResilienceScenario(event.target.value);
                  setResilienceResult(null);
                  setResilienceError("");
                }}
              >
                <option value="flood">Flood / waterlogging</option>
                <option value="landslide">Landslide / slope disruption</option>
                <option value="road_closure">Road closure</option>
                <option value="extreme_rainfall">Extreme rainfall</option>
                <option value="accident">Major road accident</option>
                <option value="severe_weather">Severe weather</option>
              </select>
            </label>
            <button type="button" className="primary-btn resilience-run-btn" onClick={runResilienceSimulation} disabled={resilienceLoading}>
              {resilienceLoading ? "Running impact analysis..." : "Run What-If Analysis →"}
            </button>
          </div>

          <div className="resilience-grounding-note">
            <strong>REAL INPUTS:</strong> OSRM road geometry · backend weather · NDMA SACHET hazard results · current GPS. <strong>MODELLED:</strong> only the selected disruption effect.
          </div>

          {resilienceError && <div className="error-box resilience-error">{resilienceError}</div>}

          {!resilienceResult && !resilienceError && (
            <div className="resilience-empty">
              <strong>Impact before action</strong>
              <span>Analyze a route first, then run a scenario to see the route map, risk shift, live weather, verified hazards, fleet corridor and before/after comparison.</span>
            </div>
          )}

          {resilienceResult && (
            <div className="resilience-results">
              <div className="resilience-summary-grid">
                <div className="resilience-kpi resilience-kpi-baseline">
                  <span>BASELINE RISK</span>
                  <strong>{resilienceResult.baseline?.risk_score ?? "--"}<em>/100</em></strong>
                  <small>{resilienceResult.baseline?.risk_level || "Unavailable"} · backend result</small>
                </div>
                <div className="resilience-kpi resilience-kpi-simulated">
                  <span>SIMULATED RISK</span>
                  <strong>{resilienceResult.simulation?.projected_risk_score ?? "--"}<em>/100</em></strong>
                  <small>{resilienceResult.simulation?.projected_risk_level || "Unavailable"} · modelled</small>
                </div>
                <div className="resilience-kpi resilience-kpi-resilience">
                  <span>RESILIENCE SCORE</span>
                  <strong>{resilienceResult.simulation?.resilience_score ?? "--"}<em>/100</em></strong>
                  <small>Higher = more resilient</small>
                </div>
                <div className="resilience-kpi resilience-kpi-fleet">
                  <span>FLEET IN CORRIDOR</span>
                  <strong>{resilienceResult.fleet_impact?.vehicles_in_corridor ?? 0}</strong>
                  <small>GPS vehicles within {resilienceResult.fleet_impact?.corridor_threshold_km ?? 10} km</small>
                </div>
              </div>

              <div className="resilience-visual-grid">
                <ResilienceMap result={resilienceResult} startCoords={startCoords} destinationCoords={destinationCoords} />

                <div className="resilience-intelligence-stack">
                  <div className="resilience-card resilience-risk-card">
                    <div className="resilience-card-heading">
                      <div><span>RISK INTELLIGENCE</span><strong>Current route → what-if</strong></div>
                      <span className="resilience-impact-chip">{resilienceResult.scenario_label}</span>
                    </div>
                    <div className="resilience-risk-bars">
                      <div className="risk-bar-row">
                        <div><span>Current route</span><b>{resilienceResult.baseline?.risk_score ?? 0}/100</b></div>
                        <div className="risk-track"><i style={{ width: `${Math.min(100, resilienceResult.baseline?.risk_score ?? 0)}%` }} /></div>
                      </div>
                      <div className="risk-bar-row">
                        <div><span>Simulated route</span><b>{resilienceResult.simulation?.projected_risk_score ?? 0}/100</b></div>
                        <div className="risk-track simulated-track"><i style={{ width: `${Math.min(100, resilienceResult.simulation?.projected_risk_score ?? 0)}%` }} /></div>
                      </div>
                    </div>
                    <div className="risk-delta-row">
                      <span>Risk change</span>
                      <strong>{(resilienceResult.simulation?.projected_risk_score ?? 0) - (resilienceResult.baseline?.risk_score ?? 0) >= 0 ? "+" : ""}{(resilienceResult.simulation?.projected_risk_score ?? 0) - (resilienceResult.baseline?.risk_score ?? 0)} pts</strong>
                    </div>
                  </div>

                  <div className="resilience-card resilience-weather-card">
                    <div className="resilience-card-heading">
                      <div><span>LIVE WEATHER INPUT</span><strong>{resilienceWeatherLabel(resilienceResult.weather?.weather_code)}</strong></div>
                      <span className="live-dot">LIVE</span>
                    </div>
                    <div className="resilience-weather-metrics">
                      <div><strong>{resilienceResult.weather?.temperature_c ?? "--"}°</strong><span>Temperature</span></div>
                      <div><strong>{resilienceResult.weather?.rain_mm ?? "--"}</strong><span>Rain mm</span></div>
                      <div><strong>{resilienceResult.weather?.wind_kmh ?? "--"}</strong><span>Wind km/h</span></div>
                    </div>
                    <small className="weather-source-mini">{resilienceResult.weather?.source || "Backend weather provider"}</small>
                  </div>

                  <div className="resilience-card resilience-route-choice">
                    <div className="resilience-card-heading">
                      <div><span>AI DECISION VIEW</span><strong>Why this route?</strong></div>
                    </div>
                    <ul>
                      {(resilienceResult.simulation?.reasons || []).slice(0, 4).map((reason, index) => <li key={`reason-${index}`}><b>✓</b>{reason}</li>)}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="resilience-before-after">
                <div className="resilience-card resilience-before-card">
                  <div className="route-state-label"><span>01</span><div><small>BASELINE</small><strong>Current real route</strong></div></div>
                  <div className="route-flow"><span>{resilienceResult.baseline?.route?.start || start || "Origin"}</span><i className="route-line" /><span>{resilienceResult.baseline?.route?.destination || destination || "Destination"}</span></div>
                  <div className="route-state-metrics"><b>{resilienceResult.baseline?.route?.distance_km ?? "--"} km</b><span>{resilienceResult.baseline?.route?.duration_minutes ?? "--"} min</span><em>Risk {resilienceResult.baseline?.risk_score ?? "--"}</em></div>
                </div>
                <div className="resilience-route-arrow">→</div>
                <div className="resilience-card resilience-after-card">
                  <div className="route-state-label"><span>02</span><div><small>SIMULATION</small><strong>{resilienceResult.simulation?.route_status || "Projected route"}</strong></div></div>
                  <div className="route-flow"><span>{start || "Origin"}</span><i className="route-line simulated-line" /><span>{destination || "Destination"}</span></div>
                  <div className="route-state-metrics"><b>{resilienceResult.simulation?.selected_route?.distance_km ?? "--"} km</b><span>{resilienceResult.simulation?.selected_route?.duration_minutes ?? "--"} min</span><em>Risk {resilienceResult.simulation?.projected_risk_score ?? "--"}</em></div>
                </div>
              </div>

              <div className="resilience-intelligence-lower">
                <div className="resilience-card resilience-scenarios-card">
                  <div className="resilience-card-heading"><div><span>SCENARIO COMPARISON</span><strong>Projected risk across what-if cases</strong></div><small>MODELLED</small></div>
                  <div className="scenario-bars">
                    {(resilienceResult.scenario_comparison || []).map((item) => (
                      <div className={`scenario-bar-row ${item.scenario === resilienceScenario ? "selected" : ""}`} key={item.scenario}>
                        <div><span>{item.label}</span><b>{item.score}</b></div>
                        <div className="scenario-track"><i style={{ width: `${item.score}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="resilience-card resilience-hazard-card">
                  <div className="resilience-card-heading"><div><span>VERIFIED HAZARD INTELLIGENCE</span><strong>{resilienceResult.hazard_count ?? 0} route-linked alert(s)</strong></div><span className="hazard-live-chip">SACHET</span></div>
                  <div className="hazard-summary-row">
                    <div><strong>{resilienceResult.hazard_count ?? 0}</strong><span>Matched route</span></div>
                    <div><strong>{resilienceResult.hazards?.filter((h) => String(h.severity || "").toLowerCase().includes("high") || String(h.severity || "").toLowerCase().includes("critical")).length ?? 0}</strong><span>High severity</span></div>
                    <div><strong>{resilienceResult.hazards?.length ?? 0}</strong><span>Verified feed</span></div>
                  </div>
                  <small className="hazard-note">Hazard points are plotted on the map when the connected alert payload contains coordinates. No synthetic hazard is created.</small>
                </div>
              </div>

              <div className="resilience-two-column">
                <div className="resilience-card">
                  <div className="resilience-card-heading"><div><span>ROUTE IMPACT</span><strong>{resilienceResult.simulation?.route_status || "Analysis complete"}</strong></div><StatusBadge status={resilienceResult.simulation?.projected_risk_level || "Unknown"} /></div>
                  <div className="resilience-route-metrics">
                    <div><span>Distance</span><strong>{resilienceResult.simulation?.selected_route?.distance_km ?? "--"} km</strong></div>
                    <div><span>ETA</span><strong>{resilienceResult.simulation?.selected_route?.duration_minutes ?? "--"} min</strong></div>
                    <div><span>ETA change</span><strong>+{resilienceResult.simulation?.eta_delta_minutes ?? 0} min</strong></div>
                  </div>
                  <p className="resilience-explanation">{resilienceResult.simulation?.explanation || "No simulation explanation returned."}</p>
                </div>

                <div className="resilience-card">
                  <div className="resilience-card-heading"><div><span>FLEET IMPACT</span><strong>{resilienceResult.fleet_impact?.message || "Live fleet corridor analysis"}</strong></div></div>
                  {resilienceResult.fleet_impact?.vehicles?.length ? (
                    <div className="resilience-fleet-list">
                      {resilienceResult.fleet_impact.vehicles.slice(0, 6).map((vehicle) => (
                        <div className={`resilience-fleet-row ${(vehicle.corridor_distance_km ?? 999) <= (resilienceResult.fleet_impact?.corridor_threshold_km ?? 10) ? "inside-corridor" : "outside-corridor"}`} key={vehicle.id}>
                          <div><strong>{vehicle.vehicle_number}</strong><small>{vehicle.status || "Unknown"} · {vehicle.corridor_distance_km != null ? `${vehicle.corridor_distance_km} km from route` : "GPS distance unavailable"}</small></div>
                          <StatusBadge status={(vehicle.corridor_distance_km ?? 999) <= (resilienceResult.fleet_impact?.corridor_threshold_km ?? 10) ? "In corridor" : "Outside"} />
                        </div>
                      ))}
                    </div>
                  ) : <div className="resilience-no-fleet">No vehicles with a current GPS position were returned.</div>}
                </div>
              </div>

              <div className="resilience-data-strip">
                <span><strong>Scenario:</strong> {resilienceResult.scenario_label}</span>
                <span><strong>Weather:</strong> {resilienceResult.weather?.temperature_c ?? "--"}°C · rain {resilienceResult.weather?.rain_mm ?? "--"} mm · wind {resilienceResult.weather?.wind_kmh ?? "--"} km/h</span>
                <span><strong>Verified hazards:</strong> {resilienceResult.hazard_count ?? 0}</span>
                <span><strong>GPS corridor:</strong> {resilienceResult.fleet_impact?.corridor_threshold_km ?? 10} km</span>
              </div>

              <small className="resilience-source-note">{resilienceResult.notice} · Sources: {(resilienceResult.data_sources || []).join(" / ")}</small>
            </div>
          )}
        </section>

        {/* =================================================
            WEATHER + SATELLITE
        ================================================= */}

        <section className="two-column weather-satellite-grid">

          <div className="panel weather-intelligence-panel" id="weather-intelligence">

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

          <div className="panel satellite-intelligence-panel" id="satellite-intelligence">

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

            <SatelliteCoverageMap route={route} fleetMarkers={fleetMarkers} />
            <p className="data-disclaimer satellite-source-note">
              Visual layer: real Esri World Imagery satellite tiles. Analytical vegetation values come from the connected satellite intelligence service when a route has been analyzed.
            </p>

          </div>

        </section>

        {/* =================================================
            REGIONAL ACCESSIBILITY + FIELD OPERATIONS
        ================================================= */}

        <section className="panel regional-operations-panel" id="regional-operations">
          <SectionHeader
            eyebrow="REGIONAL OPERATIONS"
            title="Accessibility & Field Intelligence"
            description="Live feed-based accessibility watch, multilingual notifications and field reporting using the existing backend alert service."
            action={
              <div className="ops-toolbar">
                <span className={isOnline ? "connection-chip online" : "connection-chip offline"}>
                  <i /> {isOnline ? "ONLINE" : "OFFLINE"}
                </span>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Notification language">
                  {Object.entries(NER_LANGUAGES).map(([key, value]) => (
                    <option key={key} value={key}>{value.name}</option>
                  ))}
                </select>
                <button className="small-btn" type="button" onClick={enableBrowserNotifications}>
                  {notificationPermission === "granted" ? "Notifications On" : "Enable Notifications"}
                </button>
              </div>
            }
          />

          <div className="regional-ops-grid">
            <div className="regional-watch-card">
              <div className="regional-card-head">
                <div>
                  <span>STATE-WISE FEED WATCH</span>
                  <strong>8 NER states</strong>
                </div>
                <span className="data-source-chip">NDMA SACHET + route context</span>
              </div>
              <div className="state-watch-grid">
                {regionalAccessibility.map((item) => (
                  <div className={`state-watch-item ${item.tone}`} key={item.state}>
                    <span>{item.state}</span>
                    <strong>{item.status}</strong>
                  </div>
                ))}
              </div>
              <p className="data-disclaimer">This is a verified-feed watch, not a claim that every road in a state is open or closed. District-wide connectivity requires a dedicated authoritative road-status feed.</p>
            </div>

            <div className="field-report-card">
              <div className="regional-card-head">
                <div>
                  <span>FIELD INTELLIGENCE</span>
                  <strong>Geo-tagged incident report</strong>
                </div>
                <span className="queue-chip">{offlineReportCount} queued</span>
              </div>

              <form className="field-report-form" onSubmit={submitFieldReport}>
                <div className="field-report-row">
                  <label>Incident type
                    <select value={fieldReport.incidentType} onChange={(e) => setFieldReport({ ...fieldReport, incidentType: e.target.value })}>
                      <option>Road obstruction</option>
                      <option>Landslide</option>
                      <option>Flooding</option>
                      <option>Bridge / infrastructure issue</option>
                      <option>Traffic / accident</option>
                      <option>Weather disruption</option>
                    </select>
                  </label>
                  <label>Severity
                    <select value={fieldReport.severity} onChange={(e) => setFieldReport({ ...fieldReport, severity: e.target.value })}>
                      <option>Low</option>
                      <option>Medium</option>
                      <option>High</option>
                      <option>Critical</option>
                    </select>
                  </label>
                </div>

                <label>Description
                  <textarea
                    value={fieldReport.description}
                    onChange={(e) => setFieldReport({ ...fieldReport, description: e.target.value })}
                    placeholder="Describe what the field team observed..."
                    rows={3}
                  />
                </label>

                <div className="field-report-row">
                  <label>Latitude
                    <input value={fieldReport.lat} onChange={(e) => setFieldReport({ ...fieldReport, lat: e.target.value })} placeholder="Auto from GPS" />
                  </label>
                  <label>Longitude
                    <input value={fieldReport.lon} onChange={(e) => setFieldReport({ ...fieldReport, lon: e.target.value })} placeholder="Auto from GPS" />
                  </label>
                </div>

                <div className="field-report-actions">
                  <button className="secondary-btn" type="button" onClick={captureFieldLocation}>⌖ Capture device GPS</button>
                  <label className="photo-picker">
                    <span>📷 {fieldReportPhoto ? fieldReportPhoto : "Attach field photo"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        setFieldReportPhoto(file?.name || "");
                        setFieldReportPhotoFile(file || null);
                        setFieldReport({ ...fieldReport, photoName: file?.name || "" });
                      }}
                    />
                  </label>
                  <button className="primary-btn" type="submit" disabled={fieldReportLoading}>
                    {fieldReportLoading ? "Saving..." : "Submit Field Report →"}
                  </button>
                </div>

                {fieldReportPhoto && (
                  <small className="photo-local-note">Photo selected: {fieldReportPhoto}. The image is uploaded as evidence to the additive field-report backend when connectivity is available.</small>
                )}
                {fieldReportError && <div className="error-box">{fieldReportError}</div>}
                {fieldReportMessage && <div className="success-box">{fieldReportMessage}</div>}
              </form>
            </div>
          </div>

          <div className="offline-sync-strip">
            <div>
              <span className="sync-icon">↻</span>
              <div>
                <strong>Offline synchronization</strong>
                <small>{offlineReportCount ? `${offlineReportCount} field report(s) waiting for sync.` : "No field reports waiting for sync."}</small>
              </div>
            </div>
            <span>{isOnline ? "Connection restored automatically syncs queued reports." : "Keep working locally; queued reports will sync when the browser reconnects."}</span>
          </div>

          {cachedRoute && !route && (
            <div className="cached-route-card">
              <div>
                <span>OFFLINE ROUTE CACHE</span>
                <strong>{cachedRoute.start} → {cachedRoute.destination}</strong>
              </div>
              <div>
                <strong>{cachedRoute.route?.distance_km ?? "--"} km</strong>
                <small>Last successful route analysis · {cachedRoute.savedAt ? new Date(cachedRoute.savedAt).toLocaleString() : ""}</small>
              </div>
            </div>
          )}
        </section>

        {/* =================================================
            LIVE NER NEWS
        ================================================= */}

        <section className="panel live-news-panel" id="live-news">

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
            PROBLEM STATEMENT OPERATIONS DASHBOARD
        ================================================= */}

        <section className="panel operations-intelligence-panel" id="operations-intelligence">
          <SectionHeader
            eyebrow="SIH26002 OPERATIONS INTELLIGENCE"
            title="Regional Connectivity & Logistics Command"
            description="Centralized decision-support for district connectivity, supply-chain bottlenecks, emergency accessibility and field evidence."
            action={<button className="small-btn" onClick={loadProblemStatementOps}>Refresh</button>}
          />

          <div className="ops-kpi-grid">
            <div className="ops-kpi"><span>Fleet vehicles</span><strong>{opsAnalytics?.vehicles?.total ?? vehicles.length}</strong><small>{opsAnalytics?.vehicles?.with_gps ?? vehicles.filter(v => v.lat != null && v.lon != null).length} with GPS</small></div>
            <div className="ops-kpi"><span>Shipments</span><strong>{opsAnalytics?.shipments?.total ?? shipments.length}</strong><small>Recorded operational data</small></div>
            <div className="ops-kpi"><span>Field reports</span><strong>{opsAnalytics?.field_reports?.total ?? 0}</strong><small>Geo-tagged evidence</small></div>
            <div className="ops-kpi"><span>Active alerts</span><strong>{opsAnalytics?.alerts?.total ?? alerts.length}</strong><small>Backend alert stream</small></div>
          </div>

          <div className="ops-intelligence-grid">
            <div className="ops-data-card">
              <div className="regional-card-head"><div><span>DISTRICT CONNECTIVITY</span><strong>{districtConnectivity.length} evidence-backed district signal(s)</strong></div></div>
              {districtConnectivity.length ? <div className="ops-table-list">{districtConnectivity.slice(0, 10).map((item, i) => <div className="ops-table-row" key={`${item.state}-${item.district}-${i}`}><div><strong>{item.district}</strong><small>{item.state}</small></div><StatusBadge status={item.status} /><strong>{item.risk_score}/100</strong></div>)}</div> : <div className="empty-state">No geo-tagged district evidence has been reported yet. This panel does not fabricate road-open/road-closed status.</div>}
            </div>

            <div className="ops-data-card">
              <div className="regional-card-head"><div><span>LOGISTICS BOTTLENECKS</span><strong>{bottlenecks?.delayed_shipments?.length ?? 0} recorded exception shipment(s)</strong></div></div>
              {bottlenecks?.status_counts ? <div className="ops-status-counts">{Object.entries(bottlenecks.status_counts).map(([status,count]) => <div key={status}><span>{status}</span><strong>{count}</strong></div>)}</div> : <div className="empty-state">No shipment status data returned.</div>}
              <small className="data-disclaimer">Bottlenecks are derived from recorded backend shipment status; no synthetic delay is generated.</small>
            </div>

            <div className="ops-data-card">
              <div className="regional-card-head"><div><span>EMERGENCY ACCESSIBILITY</span><strong>{emergencyAccess?.available ? "Service available" : "Unavailable"}</strong></div><span className="data-source-chip">REAL ROUTING</span></div>
              <p>Emergency accessibility reuses the existing emergency reroute engine with the connected route, hazard and weather data.</p>
              <button className="danger-btn" onClick={emergencyReroute} disabled={rerouteLoading}>{rerouteLoading ? "Calculating..." : "Calculate Emergency Route →"}</button>
            </div>

            <div className="ops-data-card">
              <div className="regional-card-head"><div><span>NOTIFICATION CENTER</span><strong>{opsNotifications.length} backend notification(s)</strong></div></div>
              {opsNotifications.length ? <div className="ops-notification-list">{opsNotifications.slice(0, 5).map((item, i) => <div key={item.id ?? i}><strong>{item.title || "Operational alert"}</strong><small>{item.message || ""}</small></div>)}</div> : <div className="empty-state">No backend notifications returned.</div>}
            </div>
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

        {/* =================================================
            ADVANCED INTELLIGENCE — NEW ADDITIVE LAYER
        ================================================= */}
        <section className="panel advanced-intelligence-panel" id="advanced-intelligence">
          <SectionHeader
            eyebrow="NEXT-GENERATION NER INTELLIGENCE"
            title="Regional Digital Twin & Self-Healing Logistics"
            description="Live evidence, scenario analysis and operational impact tools built on the connected NER services."
            action={
              <button className="primary-btn" type="button" onClick={loadAdvancedIntel} disabled={advancedLoading}>
                {advancedLoading ? "Refreshing..." : "Refresh Intelligence"}
              </button>
            }
          />

          <div className="advanced-feature-grid">
            <div className="advanced-feature-card">
              <span>DIGITAL TWIN</span>
              <strong>{advancedIntel?.twin?.digital_twin?.vehicles ?? vehicles.length} vehicles · {advancedIntel?.twin?.digital_twin?.shipments ?? shipments.length} shipments</strong>
              <small>
                {advancedIntel?.twin
                  ? `${advancedIntel.twin.digital_twin.application_alerts} application alerts and ${advancedIntel.twin.digital_twin.field_reports} field reports connected.`
                  : "Refresh to load the live operational twin."}
              </small>
            </div>

            <div className="advanced-feature-card">
              <span>DISRUPTION MEMORY</span>
              <strong>{advancedIntel?.memory?.historical_evidence?.field_report_count ?? 0} stored field reports</strong>
              <small>
                Historical evidence is derived from authenticated field submissions; no report does not mean no incident.
              </small>
            </div>

            <div className="advanced-feature-card">
              <span>VERIFICATION</span>
              <strong>{advancedIntel?.verification?.verification_status || "Not checked"}</strong>
              <small>
                Cross-checks government alerts, field evidence and route weather risk.
              </small>
            </div>

            <div className="advanced-feature-card">
              <span>RESILIENCE</span>
              <strong>{route ? `${route.risk_score ?? "--"}/100 route risk` : "Awaiting route"}</strong>
              <small>
                Use the route analysis together with alternate-route availability to assess corridor resilience.
              </small>
            </div>
          </div>

          <div className="advanced-tool-grid">
            <div className="advanced-tool-card">
              <div className="advanced-tool-head">
                <div>
                  <span>WHAT-IF SIMULATOR</span>
                  <strong>Stress-test the current corridor</strong>
                </div>
                <button className="secondary-btn" type="button" onClick={runAdvancedWhatIf} disabled={advancedLoading}>Run</button>
              </div>
              <div className="advanced-input-grid">
                <label>Rainfall (mm)<input type="number" min="0" value={intelWhatIf.rainfall_mm} onChange={(e) => setIntelWhatIf({...intelWhatIf, rainfall_mm: Number(e.target.value)})} /></label>
                <label>Wind (km/h)<input type="number" min="0" value={intelWhatIf.wind_kmh} onChange={(e) => setIntelWhatIf({...intelWhatIf, wind_kmh: Number(e.target.value)})} /></label>
                <label>Extra delay (min)<input type="number" min="0" value={intelWhatIf.extra_delay_minutes} onChange={(e) => setIntelWhatIf({...intelWhatIf, extra_delay_minutes: Number(e.target.value)})} /></label>
                <label>Extra hazards<input type="number" min="0" value={intelWhatIf.additional_hazard_count} onChange={(e) => setIntelWhatIf({...intelWhatIf, additional_hazard_count: Number(e.target.value)})} /></label>
              </div>
              {advancedIntel?.whatIf && (
                <div className="advanced-result">
                  <strong>{advancedIntel.whatIf.scenario.risk_level} · {advancedIntel.whatIf.scenario.risk_score}/100</strong>
                  <span>{advancedIntel.whatIf.scenario.reasons.join(" ") || "No additional scenario factors."}</span>
                </div>
              )}
            </div>

            <div className="advanced-tool-card">
              <div className="advanced-tool-head">
                <div>
                  <span>SAFE TIME WINDOW</span>
                  <strong>Compare departure scenarios</strong>
                </div>
                <button className="secondary-btn" type="button" onClick={runSafeWindow} disabled={advancedLoading}>Compare</button>
              </div>
              {advancedIntel?.safeWindow ? (
                <div className="window-list">
                  {advancedIntel.safeWindow.windows.map((item) => (
                    <div key={item.departure_offset_minutes} className={item.departure_offset_minutes === advancedIntel.safeWindow.recommended_window.departure_offset_minutes ? "window-row recommended" : "window-row"}>
                      <span>{item.departure_offset_minutes === 0 ? "Now" : `+${item.departure_offset_minutes} min`}</span>
                      <strong>{item.scenario_risk_score}</strong>
                      <em>{item.risk_level}</em>
                    </div>
                  ))}
                </div>
              ) : <small>Run the comparison after a route has been analyzed.</small>}
            </div>

            <div className="advanced-tool-card">
              <div className="advanced-tool-head">
                <div>
                  <span>LOGISTICS IMPACT</span>
                  <strong>Translate route risk into operations</strong>
                </div>
                <button className="secondary-btn" type="button" onClick={runImpact} disabled={advancedLoading}>Calculate</button>
              </div>
              {advancedIntel?.impact ? (
                <div className="impact-metrics">
                  <div><strong>{advancedIntel.impact.impact.estimated_delay_minutes} min</strong><span>Scenario delay</span></div>
                  <div><strong>{advancedIntel.impact.impact.potentially_affected_shipments}</strong><span>Potential shipments</span></div>
                  <div><strong>{advancedIntel.impact.impact.potentially_affected_vehicles}</strong><span>Potential vehicles</span></div>
                </div>
              ) : <small>Uses the currently analyzed route and connected fleet/shipment counts.</small>}
            </div>

            <div className="advanced-tool-card">
              <div className="advanced-tool-head">
                <div>
                  <span>RISK PROPAGATION</span>
                  <strong>See how disruption can spread</strong>
                </div>
                <button className="secondary-btn" type="button" onClick={async () => {
                  setAdvancedLoading(true);
                  try {
                    const data = await apiFetch("/api/intelligence/propagation", {
                      method: "POST",
                      headers: {"Content-Type": "application/json"},
                      body: JSON.stringify({
                        risk_score: route?.risk_score || 0,
                        hazard_count: hazards.length,
                        field_report_count: advancedIntel?.memory?.historical_evidence?.field_report_count || 0,
                        vehicle_count: vehicles.length,
                        shipment_count: shipments.length,
                      }),
                    });
                    setAdvancedIntel((current) => ({...(current || {}), propagation: data}));
                  } catch (error) {
                    setAdvancedError(error?.message || "Propagation analysis failed.");
                  } finally {
                    setAdvancedLoading(false);
                  }
                }} disabled={advancedLoading}>Trace</button>
              </div>
              {advancedIntel?.propagation ? (
                <div className="propagation-list">
                  {advancedIntel.propagation.chain.map((node) => (
                    <div key={node.stage}><span>{node.stage}</span><strong>{node.score}</strong></div>
                  ))}
                </div>
              ) : <small>Hazard → road → fleet → shipment exposure chain.</small>}
            </div>
          </div>

          {advancedError && <div className="error-box">{advancedError}</div>}

          <div className="advanced-disclaimer">
            <strong>Evidence-first safety rule:</strong>
            No road is automatically declared closed by this intelligence layer. Government alerts, live weather, routing and authenticated field evidence remain distinguishable sources. Scenario scores are decision-support, not guaranteed predictions.
          </div>
        </section>


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
