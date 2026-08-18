from parkes.config import settings
from parkes.satnogs import cache, client


def _normalize_satellite(raw: dict) -> dict:
    # SatNOGS DB litters unset string fields with the literal text "None"
    # rather than leaving them null -- flatten that here so callers (and
    # the tooltip) only ever have to check for falsy/empty, not a
    # string that spells out its own absence.
    operator = raw.get("operator")
    return {
        "norad": raw.get("norad_cat_id"),
        "name": raw.get("name"),
        "status": raw.get("status"),
        # Alternate names (e.g. "ZARYA, RS0ISS") -- kept only so
        # search_satellites() can match against them too, not meant for
        # display.
        "names": raw.get("names"),
        # ISO date the satellite launched, e.g. "1998-11-20T00:00:00Z".
        "launched": raw.get("launched"),
        # Comma-separated ISO 3166-1 alpha-2 country codes, e.g. "RU,US" --
        # who built/registered it, not who currently operates it.
        "countries": raw.get("countries"),
        "operator": operator if operator and operator != "None" else None,
    }


def _normalize_transmitter(raw: dict) -> dict:
    return {
        "uuid": raw.get("uuid"),
        "description": raw.get("description"),
        "mode": raw.get("mode"),
        "baud": raw.get("baud"),
        "alive": raw.get("alive"),
        "status": raw.get("status"),
        "frequency": raw.get("downlink_low"),
        # Some transmitters (FM repeaters/transponders) have both --
        # None here just means this one has no uplink side.
        "uplink": raw.get("uplink_low"),
    }


class SatnogsService:
    """Search SatNOGS DB (https://db.satnogs.org/) for satellites and their
    transmitters, caching responses to disk (see satnogs/cache.py) since the
    catalog barely changes and SatNOGS rate-limits unauthenticated reads.
    Purely on-demand -- unlike TleCatalog there's nothing to warm at
    startup, since lookups are triggered by a user typing into a search box.

    SatNOGS DB's /satellites/ endpoint silently ignores free-text filter
    params -- verified against the live API, only exact norad_cat_id
    filtering works server-side -- so there's no server-side search to
    call. Instead the whole catalog (~1.3MB, well under a second to fetch)
    is cached as one blob and search_satellites() filters it locally, the
    same approach the Sky Tracking TLE catalog already uses for its own
    satellite search.
    """

    def _catalog(self, *, force_refresh: bool) -> list[dict]:
        cached = cache.get_cached_satellites()
        if not force_refresh and cache.is_fresh(cached, settings.satnogs_cache_max_age_hours):
            return cached["data"]

        live = client.list_satellites_live()
        if live is not None:
            normalized = [_normalize_satellite(s) for s in live]
            cache.put_cached_satellites(normalized)
            return normalized

        return cached["data"] if cached else []

    def search_satellites(self, query: str, *, force_refresh: bool = False) -> list[dict]:
        query = query.strip()
        if not query:
            return []
        catalog = self._catalog(force_refresh=force_refresh)

        if query.isdigit():
            norad = int(query)
            by_norad = [s for s in catalog if s["norad"] == norad]
            if by_norad:
                return by_norad

        q = query.lower()
        matches = [
            s
            for s in catalog
            if q in (s.get("name") or "").lower() or q in (s.get("names") or "").lower()
        ]
        matches.sort(key=lambda s: not (s.get("name") or "").lower().startswith(q))
        return matches[:50]

    def get_transmitters(self, norad: int, *, force_refresh: bool = False) -> list[dict]:
        cached = cache.get_cached_transmitters(norad)
        if not force_refresh and cache.is_fresh(cached, settings.satnogs_cache_max_age_hours):
            return cached["data"]

        live = client.get_transmitters_live(norad)
        if live is not None:
            normalized = [_normalize_transmitter(t) for t in live]
            cache.put_cached_transmitters(norad, normalized)
            return normalized

        return cached["data"] if cached else []
