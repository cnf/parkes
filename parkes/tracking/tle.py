import hashlib
import logging
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
        self._source_errors: dict[str, str] = {}

    def ensure_loaded(self) -> None:
        if not self._by_norad:
            self._load(reload=False)

    def refresh(self) -> int:
        self._load(reload=True)
        return len(self._by_norad)

    def _load(self, reload: bool) -> None:
        by_norad: dict[int, EarthSatellite] = {}
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
        self._source_errors = errors
        if by_norad:
            self._by_norad = by_norad

    def source_errors(self) -> dict[str, str]:
        return dict(self._source_errors)

    def count(self) -> int:
        return len(self._by_norad)

    def get(self, norad: int) -> EarthSatellite | None:
        return self._by_norad.get(norad)

    def search(self, query: str, limit: int = 20) -> list[dict]:
        query = query.strip().lower()
        if not query:
            return []
        results = [
            {"norad": sat.model.satnum, "name": sat.name}
            for sat in self._by_norad.values()
            if query in sat.name.lower()
        ]
        results.sort(key=lambda r: r["name"])
        return results[:limit]
