import json
import logging
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

# Nominatim's usage policy caps this at ~1 req/s and asks for a real
# User-Agent -- both are non-issues here (a single user, hover-triggered,
# and coordinates barely change once a dish is set up), especially with
# this cache. Keyed to ~111m precision at the equator, which is plenty
# for "general area" and means retyping/adjusting nearby coordinates
# doesn't refetch.
_CACHE: dict[tuple[float, float], str | None] = {}
_USER_AGENT = "Parkes/1.0 (satellite ground station dashboard; github.com)"


def reverse_geocode(lat: float, lon: float) -> str | None:
    """Best-effort "city, region, country" for a coordinate, city-level
    detail only (zoom=10, not street-level). Returns None on any failure
    (offline, rate-limited, ocean coordinates...) -- this is a "nice to
    have" hover label, not something callers should treat as reliable.
    """
    key = (round(lat, 3), round(lon, 3))
    if key in _CACHE:
        return _CACHE[key]

    params = urllib.parse.urlencode(
        {"lat": key[0], "lon": key[1], "format": "jsonv2", "zoom": 10}
    )
    url = f"https://nominatim.openstreetmap.org/reverse?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    label = None
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            data = json.loads(response.read())
        address = data.get("address", {})
        parts = [
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("county"),
            address.get("state"),
            address.get("country"),
        ]
        label = ", ".join(p for p in parts if p) or None
    except Exception as exc:
        logger.info("reverse geocode failed for %s: %s", key, exc)

    _CACHE[key] = label
    return label
