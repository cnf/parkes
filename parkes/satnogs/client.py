import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from parkes.config import settings

logger = logging.getLogger(__name__)

# SatNOGS DB (https://db.satnogs.org/) rate-limits unauthenticated reads and
# is a community-run service -- best-effort only, like geocode.py. Returning
# None (vs. []) on failure lets the caching layer above tell "fetch failed,
# keep whatever's cached" apart from "fetched fine, there really are zero
# results".
_USER_AGENT = "Parkes/1.0 (satellite ground station dashboard; github.com)"


def _headers() -> dict:
    headers = {"User-Agent": _USER_AGENT, "Accept": "application/json"}
    if settings.satnogs_api_token:
        headers["Authorization"] = f"Token {settings.satnogs_api_token}"
    return headers


def _get(path: str, params: dict) -> list | None:
    query = urllib.parse.urlencode(params)
    url = f"{settings.satnogs_base_url}{path}?{query}"
    request = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(request, timeout=settings.satnogs_timeout_seconds) as response:
            return json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        logger.info("SatNOGS request failed for %s: %s", url, exc)
        return None


def list_satellites_live() -> list[dict] | None:
    # SatNOGS DB's /satellites/ endpoint silently ignores free-text filters
    # (search=/name=/q= all return the same unfiltered ~2700-satellite
    # catalog -- verified against the live API, only exact norad_cat_id
    # filtering actually works server-side). So there's no server-side
    # search to call: fetch the whole catalog (~1.3MB, well under a
    # second) and let the caller filter locally, same as this app already
    # does for the TLE catalog's satellite search.
    return _get("/satellites/", {})


def get_transmitters_live(norad: int) -> list[dict] | None:
    return _get("/transmitters/", {"satellite__norad_cat_id": norad})
