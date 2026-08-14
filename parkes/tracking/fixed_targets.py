import json
from pathlib import Path

from parkes.config import settings
from parkes.tracking.catalog import FIXED_SOURCES

# Sun/Moon plus the FIXED_SOURCES radio catalog -- every non-satellite
# target SkyTracker can show.
ALL_FIXED_TARGETS = ["Sun", "Moon"] + [source.name for source in FIXED_SOURCES]


def _path() -> Path:
    return Path(settings.fixed_targets_file)


def _load() -> dict:
    path = _path()
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def _save(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


class FixedTargetStore:
    """Enable/disable state for the Sun/Moon/radio-catalog entries, same
    "enabled" idea as GroupStore's satellite groups. A name absent from
    the saved file is enabled, so a fresh install shows everything --
    matching the prior always-on behavior with no migration needed.
    """

    def list_all(self) -> list[dict]:
        data = _load()
        return [{"name": name, "enabled": data.get(name, True)} for name in ALL_FIXED_TARGETS]

    def set_enabled(self, name: str, enabled: bool) -> None:
        if name not in ALL_FIXED_TARGETS:
            raise KeyError(name)
        data = _load()
        data[name] = enabled
        _save(data)
