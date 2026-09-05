import { useEffect, useRef, useState } from "react";

const API_URL = "https://ner-smart-logistics-3hbr.onrender.com";

export default function DriverTracker({
  vehicleId = 1,
  vehicleNumber = "NER-TRUCK-01",
}) {
  const watchIdRef = useRef(null);

  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState("GPS not started");
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState("");

  const sendLocation = async (position) => {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const speed = position.coords.speed;
    const heading = position.coords.heading;

    setCoords({
      latitude,
      longitude,
      speed,
      heading,
    });

    try {
      const response = await fetch(`${API_URL}/api/location`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vehicle_id: Number(vehicleId),
          latitude,
          longitude,
          speed_kmh:
            speed !== null && speed !== undefined
              ? Number((speed * 3.6).toFixed(2))
              : null,
          heading:
            heading !== null && heading !== undefined
              ? Number(heading.toFixed(2))
              : null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Location update failed: HTTP ${response.status}`);
      }

      setStatus("GPS LIVE • Location sent");
      setError("");
    } catch (err) {
      console.error(err);
      setStatus("GPS active • Server update failed");
      setError(err.message);
    }
  };

  const handleGpsError = (gpsError) => {
    console.error(gpsError);

    setTracking(false);

    if (gpsError.code === 1) {
      setError("Location permission denied. Please allow GPS permission.");
    } else if (gpsError.code === 2) {
      setError("Current location could not be determined.");
    } else if (gpsError.code === 3) {
      setError("GPS request timed out.");
    } else {
      setError("Unable to access device GPS.");
    }

    setStatus("GPS unavailable");
  };

  const startTracking = () => {
    setError("");

    if (!navigator.geolocation) {
      setError("This device/browser does not support GPS.");
      setStatus("GPS unsupported");
      return;
    }

    if (watchIdRef.current !== null) {
      return;
    }

    setStatus("Requesting GPS permission...");

    const watchId = navigator.geolocation.watchPosition(
      sendLocation,
      handleGpsError,
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );

    watchIdRef.current = watchId;
    setTracking(true);
    setStatus("GPS tracking started");
  };

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setTracking(false);
    setStatus("GPS tracking stopped");
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return (
    <div
      style={{
        marginTop: "20px",
        padding: "20px",
        border: "1px solid #e5e7eb",
        borderRadius: "14px",
        background: "#ffffff",
      }}
    >
      <h3 style={{ marginTop: 0 }}>Driver GPS Tracking</h3>

      <p style={{ marginBottom: "8px" }}>
        Vehicle: <strong>{vehicleNumber}</strong>
      </p>

      <p style={{ marginBottom: "15px" }}>
        Status:{" "}
        <strong style={{ color: tracking ? "#16a34a" : "#64748b" }}>
          {status}
        </strong>
      </p>

      {!tracking ? (
        <button
          onClick={startTracking}
          style={{
            width: "100%",
            padding: "12px",
            border: 0,
            borderRadius: "10px",
            background: "#2563eb",
            color: "white",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Start GPS Tracking
        </button>
      ) : (
        <button
          onClick={stopTracking}
          style={{
            width: "100%",
            padding: "12px",
            border: 0,
            borderRadius: "10px",
            background: "#dc2626",
            color: "white",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Stop GPS Tracking
        </button>
      )}

      {coords && (
        <div
          style={{
            marginTop: "16px",
            padding: "12px",
            background: "#f8fafc",
            borderRadius: "10px",
            fontSize: "14px",
          }}
        >
          <div>
            <strong>Latitude:</strong> {coords.latitude.toFixed(6)}
          </div>

          <div>
            <strong>Longitude:</strong> {coords.longitude.toFixed(6)}
          </div>

          {coords.speed !== null && coords.speed !== undefined && (
            <div>
              <strong>Speed:</strong>{" "}
              {(coords.speed * 3.6).toFixed(1)} km/h
            </div>
          )}

          {coords.heading !== null && coords.heading !== undefined && (
            <div>
              <strong>Heading:</strong> {coords.heading.toFixed(0)}°
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: "12px",
            padding: "10px",
            borderRadius: "8px",
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: "14px",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
