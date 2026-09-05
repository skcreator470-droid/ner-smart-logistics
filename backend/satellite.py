import os
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv

load_dotenv()

CLIENT_ID = os.getenv("COPERNICUS_CLIENT_ID")
CLIENT_SECRET = os.getenv("COPERNICUS_CLIENT_SECRET")

TOKEN_URL = (
    "https://identity.dataspace.copernicus.eu/"
    "auth/realms/CDSE/protocol/openid-connect/token"
)

STATS_URL = "https://sh.dataspace.copernicus.eu/statistics/v1"


def get_access_token():
    if not CLIENT_ID or not CLIENT_SECRET:
        raise RuntimeError(
            "Copernicus credentials are missing from .env"
        )

    response = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        },
        timeout=30,
    )

    if not response.ok:
        print("COPERNICUS AUTH ERROR:")
        print(response.text)

    response.raise_for_status()

    return response.json()["access_token"]


def get_satellite_ndvi(latitude, longitude):
    token = get_access_token()

    # Small area around route midpoint
    delta = 0.02

    bbox = [
        longitude - delta,
        latitude - delta,
        longitude + delta,
        latitude + delta,
    ]

    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=365)

    # Sentinel-2 NDVI evalscript
    evalscript = """
    //VERSION=3

    function setup() {
      return {
        input: [{
          bands: [
            "B04",
            "B08",
            "SCL",
            "dataMask"
          ]
        }],
        output: [
          {
            id: "data",
            bands: 1,
            sampleType: "FLOAT32"
          },
          {
            id: "dataMask",
            bands: 1
          }
        ]
      };
    }

    function evaluatePixel(samples) {

      let denominator = samples.B08 + samples.B04;

      if (denominator == 0) {
        return {
          data: [0],
          dataMask: [0]
        };
      }

      let ndvi =
        (samples.B08 - samples.B04) / denominator;

      // Remove water pixels
      let waterMask = samples.SCL == 6 ? 0 : 1;

      return {
        data: [ndvi],
        dataMask: [
          samples.dataMask * waterMask
        ]
      };
    }
    """

    request_body = {
        "input": {
            "bounds": {
                "bbox": bbox,
                "properties": {
                    "crs": (
                        "http://www.opengis.net/def/"
                        "crs/OGC/1.3/CRS84"
                    )
                },
            },
            "data": [
                {
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "mosaickingOrder": "leastRecent",
                        "maxCloudCoverage": 50,
                    },
                }
            ],
        },
        "aggregation": {
            "timeRange": {
                "from": start_date.isoformat(),
                "to": end_date.isoformat(),
            },
            "aggregationInterval": {
                "of": "P60D"
            },
            "evalscript": evalscript,
            "resx": 0.0002,
            "resy": 0.0002,
        },
    }

    response = requests.post(
        STATS_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json=request_body,
        timeout=90,
    )

    if not response.ok:
        print("COPERNICUS STATISTICS ERROR:")
        print(response.text)

    response.raise_for_status()

    result = response.json()

    if result.get("status") != "OK":
        raise RuntimeError(
            f"Satellite statistics failed: {result}"
        )

    data = result.get("data", [])

    if not data:
        return {
            "available": False,
            "mean_ndvi": None,
            "minimum_ndvi": None,
            "maximum_ndvi": None,
            "source": "Copernicus Sentinel-2 L2A",
            "message": (
                "No valid Sentinel-2 observation found "
                "for this area and time period."
            ),
        }

    outputs = data[0].get("outputs", {})

    ndvi_output = outputs.get("data")

    if not ndvi_output:
        return {
            "available": False,
            "mean_ndvi": None,
            "minimum_ndvi": None,
            "maximum_ndvi": None,
            "source": "Copernicus Sentinel-2 L2A",
            "message": "NDVI output was not returned.",
        }

    bands = ndvi_output.get("bands", {})

    first_band = next(iter(bands.values()), {})

    stats = first_band.get("stats", {})

    mean = stats.get("mean")
    minimum = stats.get("min")
    maximum = stats.get("max")

    if mean is None:
        return {
            "available": False,
            "mean_ndvi": None,
            "minimum_ndvi": None,
            "maximum_ndvi": None,
            "source": "Copernicus Sentinel-2 L2A",
            "message": "Mean NDVI was not available.",
        }

    return {
        "available": True,
        "mean_ndvi": round(float(mean), 3),
        "min_ndvi": (
            round(float(minimum), 3)
            if minimum is not None
            else None
        ),
        "max_ndvi": (
            round(float(maximum), 3)
            if maximum is not None
            else None
        ),
        "source": "Copernicus Sentinel-2 L2A",
        "message": (
            "Real Sentinel-2 NDVI analysis completed."
        ),
        "analysis_period": {
            "from": start_date.isoformat(),
            "to": end_date.isoformat(),
        },
        "cloud_filter_percent": 50,
    }