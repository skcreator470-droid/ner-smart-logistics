import React, { useEffect, useState } from "react";

const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV
    ? "http://127.0.0.1:8001"
    : "https://ner-smart-logistics-1.onrender.com");

export default function DriverTracker({ vehicleId, vehicleNumber }) {
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState("");
  const [lastSent, setLastSent] = useState(null);

  useEffect(() => {
    if (!tracking || !vehicleId || !navigator.geolocation) return undefined;

    let cancelled = false;
    const send = (position) => {
      if (cancelled) return;
      const payload = {
        vehicle_id: Number(vehicleId),
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        speed_kmh: position.coords.speed == null ? null : position.coords.speed * 3.6,
      };
      fetch(`${API_URL}/api/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "GPS update failed");
          setLastSent(new Date());
          setStatus("GPS update sent");
        })
        .catch((e) => setStatus(e.message));
    };

    const watch = navigator.geolocation.watchPosition(
      send,
      (e) => setStatus(e.message || "Unable to read device GPS"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    setStatus(`Tracking ${vehicleNumber || "vehicle"}`);
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watch);
    };
  }, [tracking, vehicleId, vehicleNumber]);

  return (
    <div className="driver-tracker-card">
      <div>
        <strong>Device GPS Tracker</strong>
        <small>{status || "Use the real device GPS to update the selected vehicle."}</small>
        {lastSent && <small>Last update: {lastSent.toLocaleTimeString()}</small>}
      </div>
      <button
        type="button"
        className={tracking ? "danger-btn" : "secondary-btn"}
        disabled={!vehicleId}
        onClick={() => setTracking((v) => !v)}
      >
        {tracking ? "Stop device GPS" : "Start device GPS"}
      </button>
    </div>
  );
}
