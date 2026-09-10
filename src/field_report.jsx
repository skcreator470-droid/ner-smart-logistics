import React, { useEffect, useRef, useState } from "react";

const QUEUE_KEY = "ner_field_reports_offline_queue";

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export default function FieldReports({ API_URL }) {
  const [reports, setReports] = useState(readQueue);
  const [incident, setIncident] = useState("Road Hazard");
  const [severity, setSeverity] = useState("Medium");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [status, setStatus] = useState("");
  const [syncing, setSyncing] = useState(false);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    saveQueue(reports);
  }, [reports]);

  useEffect(() => {
    captureGPS();

    const handleOnline = () => {
      syncReports();
    };

    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  function captureGPS() {
    if (!navigator.geolocation) {
      setStatus("GPS is not supported by this browser.");
      return;
    }

    setStatus("Getting current GPS location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });

        setStatus("GPS location captured.");
      },
      (error) => {
        setStatus(`GPS unavailable: ${error.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }

  function handlePhoto(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatus("Please select an image.");
      return;
    }

    setPhoto(file);

    const reader = new FileReader();

    reader.onload = () => {
      setPhotoPreview(reader.result);
    };

    reader.readAsDataURL(file);

    setStatus("Photo attached.");
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoPreview("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;

      reader.readAsDataURL(file);
    });
  }

  async function createReport() {
    if (!description.trim()) {
      setStatus("Please enter an incident description.");
      return;
    }

    if (!location) {
      setStatus("GPS location is required. Click Capture GPS.");
      return;
    }

    setStatus("Preparing field report...");

    let photoData = null;

    if (photo) {
      try {
        photoData = await fileToBase64(photo);
      } catch {
        setStatus("Could not read the photo.");
        return;
      }
    }

    const report = {
      id: `FIELD-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,

      incident,
      severity,
      description: description.trim(),

      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,

      photo: photoData,

      createdAt: new Date().toISOString(),

      syncStatus: "pending",

      source: "NER Smart Logistics Field Intelligence",
    };

    const newQueue = [...reports, report];

    setReports(newQueue);

    setDescription("");
    removePhoto();

    setStatus(
      navigator.onLine
        ? "Report saved. Trying to sync..."
        : "Offline: report saved locally and will sync automatically."
    );

    if (navigator.onLine) {
      await syncReports(newQueue);
    }
  }

  async function syncReports(queueOverride = null) {
    const queue = queueOverride || reports;

    if (!queue.length) {
      setStatus("No reports waiting for synchronization.");
      return;
    }

    if (!navigator.onLine) {
      setStatus("Offline. Reports remain safely stored on this device.");
      return;
    }

    setSyncing(true);
    setStatus("Synchronizing field reports...");

    const remaining = [];

    for (const report of queue) {
      try {
        const response = await fetch(`${API_URL}/api/field-reports`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            incident: report.incident,
            severity: report.severity,
            description: report.description,

            latitude: report.latitude,
            longitude: report.longitude,
            accuracy: report.accuracy,

            created_at: report.createdAt,

            photo: report.photo,
          }),
        });

        if (!response.ok) {
          remaining.push(report);
        }
      } catch {
        remaining.push(report);
      }
    }

    setReports(remaining);
    saveQueue(remaining);

    setSyncing(false);

    if (remaining.length === 0) {
      setStatus("All field reports synchronized successfully.");
    } else {
      setStatus(
        `${remaining.length} report(s) remain in the offline queue.`
      );
    }
  }

  function deleteReport(id) {
    const updated = reports.filter((report) => report.id !== id);

    setReports(updated);
    saveQueue(updated);

    setStatus("Queued report removed.");
  }

  return (
    <section className="field-reports-page">
      <div className="field-reports-header">
        <div>
          <div className="section-eyebrow">FIELD INTELLIGENCE</div>

          <h2>Geo-tagged Field Reporting</h2>

          <p>
            Capture incidents with real GPS coordinates and field photos.
            Reports remain available offline until synchronization is possible.
          </p>
        </div>

        <div className="field-report-status">
          <span
            className={`connection-dot ${
              navigator.onLine ? "online" : "offline"
            }`}
          />

          {navigator.onLine ? "Online" : "Offline"}
        </div>
      </div>

      <div className="field-report-grid">
        <div className="field-report-card">
          <h3>Create Field Report</h3>

          <label>Incident Type</label>

          <select
            value={incident}
            onChange={(e) => setIncident(e.target.value)}
          >
            <option>Road Hazard</option>
            <option>Landslide</option>
            <option>Flooding</option>
            <option>Accident</option>
            <option>Road Blockage</option>
            <option>Bridge Damage</option>
            <option>Traffic Congestion</option>
            <option>Weather Hazard</option>
            <option>Infrastructure Damage</option>
            <option>Other</option>
          </select>

          <label>Severity</label>

          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Critical</option>
          </select>

          <label>Description</label>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the road condition, incident or accessibility problem..."
            rows={5}
          />

          <div className="gps-box">
            <div>
              <strong>GPS Location</strong>

              {location ? (
                <div className="gps-coordinates">
                  <div>
                    Latitude:{" "}
                    <strong>{location.latitude.toFixed(6)}</strong>
                  </div>

                  <div>
                    Longitude:{" "}
                    <strong>{location.longitude.toFixed(6)}</strong>
                  </div>

                  <div>
                    Accuracy:{" "}
                    <strong>
                      {Math.round(location.accuracy || 0)} m
                    </strong>
                  </div>
                </div>
              ) : (
                <span>Location not captured</span>
              )}
            </div>

            <button
              type="button"
              className="field-secondary-button"
              onClick={captureGPS}
            >
              📍 Capture GPS
            </button>
          </div>

          <div className="photo-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhoto}
              hidden
            />

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhoto}
              hidden
            />

            <button
              type="button"
              className="field-secondary-button"
              onClick={() => fileInputRef.current?.click()}
            >
              📁 Import Picture
            </button>

            <button
              type="button"
              className="field-secondary-button"
              onClick={() => cameraInputRef.current?.click()}
            >
              📷 Open Camera
            </button>
          </div>

          {photoPreview && (
            <div className="field-photo-preview">
              <img src={photoPreview} alt="Field report preview" />

              <button
                type="button"
                onClick={removePhoto}
                className="remove-photo-button"
              >
                Remove Photo
              </button>
            </div>
          )}

          <button
            type="button"
            className="field-submit-button"
            onClick={createReport}
          >
            Submit Field Report
          </button>

          {status && (
            <div className="field-report-message">
              {status}
            </div>
          )}
        </div>

        <div className="field-report-card">
          <div className="queue-header">
            <div>
              <h3>Offline Report Queue</h3>

              <p>
                Reports waiting to synchronize:{" "}
                <strong>{reports.length}</strong>
              </p>
            </div>

            <button
              type="button"
              className="field-sync-button"
              onClick={() => syncReports()}
              disabled={syncing || !reports.length}
            >
              {syncing ? "Syncing..." : "🔄 Sync Now"}
            </button>
          </div>

          {reports.length === 0 ? (
            <div className="empty-field-reports">
              <div className="empty-icon">✓</div>

              <h4>No pending reports</h4>

              <p>
                New field reports will appear here when created offline or
                while waiting for synchronization.
              </p>
            </div>
          ) : (
            <div className="field-report-list">
              {reports.map((report) => (
                <article
                  className="queued-field-report"
                  key={report.id}
                >
                  <div className="queued-report-top">
                    <strong>{report.incident}</strong>

                    <span
                      className={`severity-badge severity-${report.severity.toLowerCase()}`}
                    >
                      {report.severity}
                    </span>
                  </div>

                  <p>{report.description}</p>

                  <div className="queued-report-meta">
                    <span>
                      📍 {report.latitude.toFixed(5)},{" "}
                      {report.longitude.toFixed(5)}
                    </span>

                    <span>
                      {new Date(report.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {report.photo && (
                    <img
                      className="queued-report-photo"
                      src={report.photo}
                      alt="Queued field report"
                    />
                  )}

                  <button
                    type="button"
                    className="delete-queued-report"
                    onClick={() => deleteReport(report.id)}
                  >
                    Remove
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

