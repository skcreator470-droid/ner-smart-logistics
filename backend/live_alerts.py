from fastapi import APIRouter
import httpx
import feedparser

router = APIRouter()

NDMA_RSS_URL = "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml"

NER_STATES = {
    "assam",
    "arunachal pradesh",
    "meghalaya",
    "manipur",
    "mizoram",
    "nagaland",
    "tripura",
    "sikkim",
}

def _severity(title, description):
    text = f"{title} {description}".lower()

    if any(x in text for x in [
        "red", "severe", "extremely heavy", "very heavy",
        "high risk", "danger", "landslide", "flash flood"
    ]):
        return "HIGH"

    if any(x in text for x in [
        "orange", "moderate", "heavy", "warning", "watch"
    ]):
        return "MEDIUM"

    return "LOW"


@router.get("/api/live-alerts")
def live_alerts():
    try:
        response = httpx.get(
            NDMA_RSS_URL,
            timeout=15.0,
            follow_redirects=True,
            headers={"User-Agent": "NER-Smart-Logistics/1.0"}
        )
        response.raise_for_status()

        feed = feedparser.parse(response.content)
        alerts = []

        for entry in feed.entries:
            title = str(entry.get("title", "")).strip()
            description = str(
                entry.get("summary", entry.get("description", ""))
            ).strip()
            area = str(
                entry.get("area", entry.get("cap_areaDesc", ""))
            ).strip()

            combined = f"{title} {description} {area}".lower()

            if not any(state in combined for state in NER_STATES):
                continue

            alerts.append({
                "title": title,
                "event": str(entry.get("event", title)).strip(),
                "severity": _severity(title, description),
                "state": area,
                "district": area,
                "area": area,
                "description": description,
                "effective": str(entry.get("published", "")),
                "expires": str(entry.get("expires", "")),
                "source": "NDMA SACHET"
            })

        return {
            "success": True,
            "source": "NDMA SACHET",
            "count": len(alerts),
            "alerts": alerts
        }

    except Exception as e:
        return {
            "success": False,
            "source": "NDMA SACHET",
            "count": 0,
            "alerts": [],
            "error": str(e)
        }
