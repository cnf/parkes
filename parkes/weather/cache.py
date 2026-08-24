import json
from datetime import UTC, datetime
from pathlib import Path

from parkes.config import settings


def _path() -> Path:
    return Path(settings.weather_cache_file)


def _load() -> dict:
    path = _path()
    if not path.exists():
        return {"locations": {}}
    data = json.loads(path.read_text())
    data.setdefault("locations", {})
    return data


def _save(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def location_key(lat: float, lon: float) -> str:
    # Rounded to ~1.1km -- close enough that GPS jitter or the observer
    # location's own small drift doesn't bust the cache and refetch on
    # every request.
    return f"{lat:.2f},{lon:.2f}"


def get_cached(key: str) -> dict | None:
    return _load()["locations"].get(key)


def put_cached(key: str, value: dict) -> None:
    data = _load()
    data["locations"][key] = {"data": value, "fetched_at": datetime.now(UTC).isoformat()}
    _save(data)


def is_fresh(entry: dict | None, max_age_hours: float) -> bool:
    if entry is None:
        return False
    fetched_at = datetime.fromisoformat(entry["fetched_at"])
    age_hours = (datetime.now(UTC) - fetched_at).total_seconds() / 3600
    return age_hours < max_age_hours
