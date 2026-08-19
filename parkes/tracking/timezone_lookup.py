import json
import logging
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

# Open-Meteo's forecast endpoint resolves an IANA timezone name for any
# coordinate when timezone=auto is passed, and returns it even with no
# forecast fields requested -- a free, no-key side door into a lat/lon ->
# timezone lookup without pulling in a timezone-boundary dataset locally.
# Same "best effort, cached" shape as geocode.reverse_geocode(): this is
# what lets the header clock show local time at the observer's location
# rather than the browser's own, which matters once the dish isn't where
# the person driving it is.
_CACHE: dict[tuple[float, float], str | None] = {}
_USER_AGENT = "Parkes/1.0 (satellite ground station dashboard; github.com)"


def resolve_timezone(lat: float, lon: float) -> str | None:
    """Best-effort IANA timezone name (e.g. "Europe/Brussels") for a
    coordinate. Returns None on any failure (offline, rate-limited...) --
    callers should treat a missing timezone as "can't show local time
    right now", not an error.
    """
    key = (round(lat, 2), round(lon, 2))
    if key in _CACHE:
        return _CACHE[key]

    params = urllib.parse.urlencode({"latitude": key[0], "longitude": key[1], "timezone": "auto"})
    url = f"https://api.open-meteo.com/v1/forecast?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    tz_name = None
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            data = json.loads(response.read())
        tz_name = data.get("timezone") or None
    except Exception as exc:
        logger.info("timezone lookup failed for %s: %s", key, exc)

    _CACHE[key] = tz_name
    return tz_name
