import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path

from skyfield.api import EarthSatellite, Loader

from parkes.config import settings
from parkes.tracking.tle_sources import TleSourceStore

logger = logging.getLogger(__name__)


def _cache_filename(url: str) -> str:
    # Two different source URLs can share the same path (e.g. Celestrak's
    # gp.php differing only by query string), which skyfield's loader
    # ignores when deriving a cache filename from the URL -- without an
    # explicit, distinct filename per source they'd overwrite each other.
    return hashlib.sha1(url.encode()).hexdigest()[:16] + ".tle"


class TleCatalog:
    """Satellite TLE data for the Sky Tracking list -- fetched from
    user-managed source URLs and cached to disk via skyfield's loader, the
    same approach satdump/gpredict use (SGP4 from TLE sets)."""

    def __init__(self, source_store: TleSourceStore):
        self._source_store = source_store
        data_dir = Path(settings.tle_data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
        self._loader = Loader(str(data_dir))
        self._by_norad: dict[int, EarthSatellite] = {}
        self._source_by_norad: dict[int, str] = {}
        self._source_errors: dict[str, str] = {}

    def ensure_loaded(self) -> None:
        if not self._by_norad:
            self._load(reload=False)

    def refresh(self) -> int:
        self._load(reload=True)
        return len(self._by_norad)

    def _load(self, reload: bool) -> None:
        by_norad: dict[int, EarthSatellite] = {}
        source_by_norad: dict[int, str] = {}
        errors: dict[str, str] = {}
        for source in self._source_store.list_sources():
            try:
                sats = self._loader.tle_file(
                    source["url"], reload=reload, filename=_cache_filename(source["url"])
                )
            except Exception as exc:
                logger.warning("failed to load TLE source %s: %s", source["name"], exc)
                errors[source["name"]] = str(exc)
                continue
            for sat in sats:
                by_norad[sat.model.satnum] = sat
                source_by_norad[sat.model.satnum] = source["name"]
        self._source_errors = errors
        if by_norad:
            self._by_norad = by_norad
            self._source_by_norad = source_by_norad

    def source_errors(self) -> dict[str, str]:
        return dict(self._source_errors)

    def count(self) -> int:
        return len(self._by_norad)

    def get(self, norad: int) -> EarthSatellite | None:
        return self._by_norad.get(norad)

    def list_satellites(self, query: str = "", source: str = "", limit: int = 2000) -> list[dict]:
        """All satellites (or a filtered subset) with enough info to browse
        and judge freshness -- empty query/source means "everything". query
        matches the satellite's own name/NORAD id or its TLE source's name
        (e.g. "weather" surfaces every satellite in a "Weather" source),
        so it doubles as a quick way to browse a whole source without the
        separate source dropdown."""
        query = query.strip().lower()
        now = datetime.now(timezone.utc)
        results = []
        for sat in self._by_norad.values():
            sat_source = self._source_by_norad.get(sat.model.satnum, "")
            if (
                query
                and query not in sat.name.lower()
                and query != str(sat.model.satnum)
                and query not in sat_source.lower()
            ):
                continue
            if source and sat_source != source:
                continue
            age_days = (now - sat.epoch.utc_datetime()).total_seconds() / 86400
            results.append(
                {
                    "norad": sat.model.satnum,
                    "name": sat.name,
                    "source": sat_source,
                    "epoch_days_old": round(age_days, 1),
                }
            )
        results.sort(key=lambda r: r["name"])
        return results[:limit]
