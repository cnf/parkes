import json
from pathlib import Path

from parkes.config import settings


def _path() -> Path:
    return Path(settings.tracking_groups_file)


def _load() -> dict:
    path = _path()
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def _save(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


class GroupStore:
    """Named groups of satellites the user wants shown in the Sky Tracking
    list. Persisted as JSON, loaded/saved per call -- same pattern as the
    Pass Orchestrator's tracked_objects.json, low enough traffic that
    in-memory caching isn't worth the invalidation complexity."""

    def list_groups(self) -> list[dict]:
        data = _load()
        return [{"name": name, **group} for name, group in data.items()]

    def create_group(self, name: str) -> None:
        data = _load()
        if name not in data:
            data[name] = {"enabled": True, "satellites": []}
            _save(data)

    def delete_group(self, name: str) -> None:
        data = _load()
        if data.pop(name, None) is not None:
            _save(data)

    def rename_group(self, old_name: str, new_name: str) -> None:
        data = _load()
        if old_name not in data:
            raise KeyError(old_name)
        if new_name != old_name and new_name in data:
            raise ValueError(f"group already exists: {new_name}")
        # Rebuild rather than pop+reinsert, so the renamed group keeps its
        # position in the list instead of jumping to the end.
        data = {new_name if k == old_name else k: v for k, v in data.items()}
        _save(data)

    def set_enabled(self, name: str, enabled: bool) -> None:
        data = _load()
        if name not in data:
            raise KeyError(name)
        data[name]["enabled"] = enabled
        _save(data)

    def add_satellite(self, group: str, norad: int, name: str) -> None:
        data = _load()
        if group not in data:
            raise KeyError(group)
        satellites = data[group]["satellites"]
        if not any(s["norad"] == norad for s in satellites):
            satellites.append({"norad": norad, "name": name})
            _save(data)

    def remove_satellite(self, group: str, norad: int) -> None:
        data = _load()
        if group not in data:
            raise KeyError(group)
        data[group]["satellites"] = [s for s in data[group]["satellites"] if s["norad"] != norad]
        _save(data)
