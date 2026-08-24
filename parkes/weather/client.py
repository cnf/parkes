import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from parkes.config import settings

logger = logging.getLogger(__name__)

# Open-Meteo (https://open-meteo.com/) -- free, no API key/signup, no rate
# limit for this kind of light polling. Fields chosen for what actually
# matters to eyeballing rain-fade/scintillation risk on a link, not a
# general-purpose weather report.
_USER_AGENT = "Parkes/1.0 (satellite ground station dashboard; github.com)"
_CURRENT_FIELDS = (
    "temperature_2m,relative_humidity_2m,precipitation,rain,snowfall,"
    "cloud_cover,wind_speed_10m,weather_code"
)


def get_current_conditions(lat: float, lon: float) -> dict | None:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": _CURRENT_FIELDS,
        "timezone": "auto",
    }
    url = f"{settings.weather_base_url}?{urllib.parse.urlencode(params)}"
    headers = {"User-Agent": _USER_AGENT, "Accept": "application/json"}
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=settings.weather_timeout_seconds) as response:
            return json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        logger.info("Open-Meteo request failed for %s: %s", url, exc)
        return None
