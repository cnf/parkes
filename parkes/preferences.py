import json
from pathlib import Path
from typing import Any

from parkes.config import settings

# User-editable operating preferences -- observer location, tracking
# cadence, satdump/SDR parameters. Deliberately excludes infrastructure
# config (rotctld host/port, data directories, file paths) that's tied to
# a live connection or the filesystem layout; those stay in Settings,
# set via devenv.nix/.env, and require a restart to change.
DEFAULTS: dict[str, Any] = {
    "observer_lat": settings.observer_lat,
    "observer_lon": settings.observer_lon,
    "observer_elevation_m": settings.observer_elevation_m,
    "tracking_interval_seconds": settings.tracking_interval_seconds,
    "satdump_sdr_source": settings.satdump_sdr_source,
    "satdump_sdr_source_id": settings.satdump_sdr_source_id,
    "satdump_samplerate": settings.satdump_samplerate,
    "satdump_initial_frequency": settings.satdump_initial_frequency,
    "satdump_autotrack_min_elevation": settings.satdump_autotrack_min_elevation,
}


class PreferencesStore:
    """JSON-persisted overrides layered on top of DEFAULTS, loaded/saved
    per call -- same pattern as GroupStore/TleSourceStore. Callers that
    need to react to changes without a restart (SkyTracker, the tracking
    scheduler, satdump config generation) read via get()/get_all() at the
    point of use rather than caching values at construction time.
    """

    def _path(self) -> Path:
        return Path(settings.preferences_file)

    def _load(self) -> dict[str, Any]:
        data = dict(DEFAULTS)
        path = self._path()
        if path.exists():
            data.update(json.loads(path.read_text()))
        return data

    def get_all(self) -> dict[str, Any]:
        return self._load()

    def get(self, key: str) -> Any:
        return self._load().get(key, DEFAULTS.get(key))

    def update(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self._load()
        data.update({k: v for k, v in values.items() if k in DEFAULTS})
        path = self._path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2))
        return data


preferences = PreferencesStore()
