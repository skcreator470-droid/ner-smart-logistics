import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

let vehicles = [
  {
    id: "NER-001",
    name: "Vehicle 1",
    lat: 26.1445,
    lng: 91.7362,
    status: "Moving",
    destination: "Shillong",
  },
  {
    id: "NER-002",
    name: "Vehicle 2",
    lat: 25.5788,
    lng: 91.8933,
    status: "Moving",
    destination: "Imphal",
  },
  {
    id: "NER-003",
    name: "Vehicle 3",
    lat: 23.7271,
    lng: 92.7176,
    status: "Delayed",
    destination: "Aizawl",
  },
];

app.get("/api/vehicles", (req, res) => {
  res.json(vehicles);
});

app.post("/api/vehicles/:id/location", (req, res) => {
  const vehicle = vehicles.find(
    (v) => v.id === req.params.id
  );

  if (!vehicle) {
    return res.status(404).json({
      message: "Vehicle not found",
    });
  }

  const { lat, lng } = req.body;

  vehicle.lat = Number(lat);
  vehicle.lng = Number(lng);

  res.json({
    message: "Location updated",
    vehicle,
  });
});

const PORT = 5000;

app.listen(PORT, () => {
  console.log(
    `🚚 NER Logistics Server running on http://localhost:${PORT}`
  );
});