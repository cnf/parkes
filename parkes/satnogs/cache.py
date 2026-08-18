import json
from datetime import datetime, timezone
from pathlib import Path

from parkes.config import settings


def _path() -> Path:
    return Path(settings.satnogs_cache_file)


def _load() -> dict:
    path = _path()
    if not path.exists():
        return {"satellites": None, "transmitters": {}}
    data = json.loads(path.read_text())
    data.setdefault("satellites", None)
    data.setdefault("transmitters", {})
    return data


def _save(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def _entry(value: list) -> dict:
    return {"data": value, "fetched_at": datetime.now(timezone.utc).isoformat()}


def is_fresh(entry: dict | None, max_age_hours: float) -> bool:
    if entry is None:
        return False
    fetched_at = datetime.fromisoformat(entry["fetched_at"])
    age_hours = (datetime.now(timezone.utc) - fetched_at).total_seconds() / 3600
    return age_hours < max_age_hours


def get_cached_satellites() -> dict | None:
    return _load()["satellites"]


def put_cached_satellites(results: list) -> None:
    data = _load()
    data["satellites"] = _entry(results)
    _save(data)


def get_cached_transmitters(norad: int) -> dict | None:
    return _load()["transmitters"].get(str(norad))


def put_cached_transmitters(norad: int, results: list) -> None:
    data = _load()
    data["transmitters"][str(norad)] = _entry(results)
    _save(data)
