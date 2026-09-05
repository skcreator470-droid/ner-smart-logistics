import math
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import requests


SACHET_URL = "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml"


class SachetFeed:
    def __init__(self):
        self.alerts = []
        self.etag = None
        self.last_modified = None
        self.last_success = None
        self.last_error = None
        self.last_refresh = None

        self.lock = threading.Lock()

    def _tag(self, tag):
        return tag.split("}", 1)[-1].lower()

    def _text(self, element, names):
        if element is None:
            return None

        names = {n.lower() for n in names}

        for child in element.iter():
            if self._tag(child.tag) in names:
                if child.text:
                    return child.text.strip()

        return None

    def _find_all(self, element, name):
        if element is None:
            return []

        name = name.lower()

        return [
            x for x in element.iter()
            if self._tag(x.tag) == name
        ]

    def _parse_datetime(self, value):
        if not value:
            return None

        value = value.strip()

        try:
            if value.endswith("Z"):
                return datetime.fromisoformat(
                    value.replace("Z", "+00:00")
                )
        except Exception:
            pass

        try:
            return datetime.fromisoformat(value)
        except Exception:
            pass

        try:
            return parsedate_to_datetime(value)
        except Exception:
            return None

    def _is_active(self, effective, expires):
        now = datetime.now(timezone.utc)

        if effective:
            try:
                if effective.tzinfo is None:
                    effective = effective.replace(tzinfo=timezone.utc)

                if effective > now:
                    return False
            except Exception:
                pass

        if expires:
            try:
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)

                if expires < now:
                    return False
            except Exception:
                pass

        return True

    def _hazard_type(self, event, title, description):
        text = " ".join(
            [
                event or "",
                title or "",
                description or "",
            ]
        ).lower()

        if any(
            word in text
            for word in [
                "landslide",
                "land slide",
                "mudslide",
                "rockfall",
                "land slip",
            ]
        ):
            return "Landslide"

        if any(
            word in text
            for word in [
                "flood",
                "flash flood",
                "river flood",
                "urban flood",
                "waterlogging",
            ]
        ):
            return "Flood"

        if any(
            word in text
            for word in [
                "heavy rain",
                "very heavy rain",
                "extremely heavy rain",
                "rainfall",
                "thunderstorm",
            ]
        ):
            return "Heavy Rain"

        if any(
            word in text
            for word in [
                "cyclone",
                "storm",
                "strong wind",
                "gale",
            ]
        ):
            return "Storm"

        if any(
            word in text
            for word in [
                "earthquake",
                "earth quake",
            ]
        ):
            return "Earthquake"

        return "Other"

    def _parse_circle(self, circle):
        """
        CAP circle format is generally:
        latitude,longitude radius
        where radius is usually kilometres.
        """

        if not circle:
            return None

        try:
            parts = circle.replace(",", " ").split()

            if len(parts) < 3:
                return None

            lat = float(parts[0])
            lon = float(parts[1])
            radius_km = float(parts[2])

            return {
                "lat": lat,
                "lon": lon,
                "radius_km": radius_km,
            }

        except Exception:
            return None

    def _parse_polygon(self, polygon):
        """
        CAP polygon generally:
        lat,lon lat,lon lat,lon ...
        """

        if not polygon:
            return None

        points = []

        try:
            for pair in polygon.split():
                lat, lon = pair.split(",")

                points.append(
                    [
                        float(lat),
                        float(lon),
                    ]
                )

            if len(points) < 3:
                return None

            return points

        except Exception:
            return None

    def _parse_area(self, info):
        area_desc = self._text(
            info,
            ["areaDesc"]
        )

        circle = self._text(
            info,
            ["circle"]
        )

        polygon = self._text(
            info,
            ["polygon"]
        )

        circle_data = self._parse_circle(circle)
        polygon_data = self._parse_polygon(polygon)

        geocodes = {}

        for geocode in self._find_all(info, "geocode"):
            value_name = self._text(
                geocode,
                ["valueName"]
            )

            value = self._text(
                geocode,
                ["value"]
            )

            if value_name and value:
                geocodes[value_name] = value

        return {
            "area_desc": area_desc,
            "circle": circle_data,
            "polygon": polygon_data,
            "geocodes": geocodes,
        }

    def _parse_item(self, item):
        title = self._text(item, ["title"])
        description = self._text(
            item,
            ["description"]
        )

        event = self._text(
            item,
            ["event"]
        )

        severity = self._text(
            item,
            ["severity"]
        )

        urgency = self._text(
            item,
            ["urgency"]
        )

        certainty = self._text(
            item,
            ["certainty"]
        )

        effective_raw = self._text(
            item,
            ["effective"]
        )

        expires_raw = self._text(
            item,
            ["expires"]
        )

        effective = self._parse_datetime(
            effective_raw
        )

        expires = self._parse_datetime(
            expires_raw
        )

        if not self._is_active(
            effective,
            expires
        ):
            return None

        hazard_type = self._hazard_type(
            event,
            title,
            description,
        )

        link = self._text(
            item,
            ["link"]
        )

        identifier = self._text(
            item,
            ["identifier"]
        )

        areas = []

        for info in self._find_all(item, "area"):
            areas.append(
                self._parse_area(info)
            )

        return {
            "id": identifier or link or title,
            "title": title or event or "NDMA Alert",
            "event": event,
            "hazard_type": hazard_type,
            "severity": severity,
            "urgency": urgency,
            "certainty": certainty,
            "description": description,
            "effective": effective.isoformat()
            if effective else None,
            "expires": expires.isoformat()
            if expires else None,
            "link": link,
            "areas": areas,
            "source": "NDMA SACHET",
        }

    def refresh(self):
        headers = {
            "User-Agent": (
                "NER-Smart-Logistics/1.0 "
                "hazard-monitor"
            )
        }

        if self.etag:
            headers["If-None-Match"] = self.etag

        if self.last_modified:
            headers["If-Modified-Since"] = (
                self.last_modified
            )

        try:
            response = requests.get(
                SACHET_URL,
                headers=headers,
                timeout=30,
            )

            if response.status_code == 304:
                self.last_refresh = (
                    datetime.now(timezone.utc)
                    .isoformat()
                )
                self.last_error = None
                return

            response.raise_for_status()

            root = ET.fromstring(
                response.content
            )

            parsed_alerts = []

            for item in root.iter():
                tag = self._tag(item.tag)

                if tag not in {
                    "item",
                    "entry",
                }:
                    continue

                alert = self._parse_item(item)

                if alert:
                    parsed_alerts.append(alert)

            with self.lock:
                self.alerts = parsed_alerts
                self.last_success = (
                    datetime.now(timezone.utc)
                    .isoformat()
                )
                self.last_refresh = (
                    datetime.now(timezone.utc)
                    .isoformat()
                )
                self.last_error = None

            self.etag = response.headers.get(
                "ETag",
                self.etag,
            )

            self.last_modified = response.headers.get(
                "Last-Modified",
                self.last_modified,
            )

        except Exception as exc:
            self.last_error = str(exc)
            self.last_refresh = (
                datetime.now(timezone.utc)
                .isoformat()
            )

    def get_alerts(self):
        with self.lock:
            return list(self.alerts)


sachet_feed = SachetFeed()


def haversine_km(
    lat1,
    lon1,
    lat2,
    lon2,
):
    r = 6371.0

    p1 = math.radians(lat1)
    p2 = math.radians(lat2)

    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)

    a = (
        math.sin(dp / 2) ** 2
        + math.cos(p1)
        * math.cos(p2)
        * math.sin(dl / 2) ** 2
    )

    return (
        2
        * r
        * math.atan2(
            math.sqrt(a),
            math.sqrt(1 - a),
        )
    )


def point_in_polygon(
    lat,
    lon,
    polygon,
):
    inside = False

    j = len(polygon) - 1

    for i in range(len(polygon)):
        lat_i, lon_i = polygon[i]
        lat_j, lon_j = polygon[j]

        intersects = (
            (lon_i > lon) != (lon_j > lon)
            and
            lat
            <
            (
                (lat_j - lat_i)
                * (lon - lon_i)
                / (
                    (lon_j - lon_i)
                    or 1e-12
                )
                + lat_i
            )
        )

        if intersects:
            inside = not inside

        j = i

    return inside


def route_hits_alert(
    geometry,
    alert,
):
    """
    geometry:
        [[lat, lon], [lat, lon], ...]

    Returns:
        True only when the actual alert geometry
        intersects/contains a route point.

    If an alert has no geographic geometry,
    we DO NOT claim the route is affected.
    """

    if not geometry:
        return False

    for area in alert.get("areas", []):
        circle = area.get("circle")

        if circle:
            for point in geometry:
                try:
                    distance = haversine_km(
                        point[0],
                        point[1],
                        circle["lat"],
                        circle["lon"],
                    )

                    if distance <= circle["radius_km"]:
                        return True

                except Exception:
                    continue

        polygon = area.get("polygon")

        if polygon:
            for point in geometry:
                try:
                    if point_in_polygon(
                        point[0],
                        point[1],
                        polygon,
                    ):
                        return True

                except Exception:
                    continue

    return False


def score_route_hazards(
    geometry,
    alerts,
):
    matched = []
    regional = []

    for alert in alerts:
        if route_hits_alert(
            geometry,
            alert,
        ):
            matched.append(alert)
        elif any(
            area.get("area_desc")
            for area in alert.get("areas", [])
        ):
            regional.append(alert)

    penalty = 0

    for alert in matched:
        hazard = alert.get(
            "hazard_type",
            "Other",
        )

        severity = (
            alert.get("severity")
            or ""
        ).lower()

        if hazard in {
            "Flood",
            "Landslide",
        }:
            base = 35
        elif hazard in {
            "Heavy Rain",
            "Storm",
        }:
            base = 20
        else:
            base = 10

        if severity == "extreme":
            base += 20
        elif severity == "severe":
            base += 10

        penalty += base

    penalty = min(
        80,
        penalty,
    )

    return {
        "matched_alerts": matched,
        "regional_alerts": regional,
        "penalty": penalty,
        "route_affected": len(matched) > 0,
    }