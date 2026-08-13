import json
from pathlib import Path

from parkes.config import settings

# Seeded on first run only -- after that the file is the source of truth
# and the user can add/remove whatever URLs they want.
DEFAULT_SOURCES = [
    {"name": "Stations", "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"},
    {"name": "Amateur", "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle"},
    {"name": "Weather", "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle"},
    {"name": "CubeSat", "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=tle"},
]


def _path() -> Path:
    return Path(settings.tle_sources_file)


def _load() -> list[dict]:
    path = _path()
    if not path.exists():
        _save(DEFAULT_SOURCES)
        return list(DEFAULT_SOURCES)
    return json.loads(path.read_text())


def _save(sources: list[dict]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sources, indent=2))


class TleSourceStore:
    """User-managed list of TLE URLs -- any URL serving a TLE-formatted
    file, not just Celestrak's group query pattern. Adding a source and
    assigning its satellites into groups are deliberately separate actions:
    this store only tracks *where to fetch from*."""

    def list_sources(self) -> list[dict]:
        return _load()

    def add_source(self, name: str, url: str) -> None:
        sources = _load()
        if any(s["name"] == name for s in sources):
            raise ValueError(f"a source named {name!r} already exists")
        sources.append({"name": name, "url": url})
        _save(sources)

    def remove_source(self, name: str) -> None:
        sources = _load()
        remaining = [s for s in sources if s["name"] != name]
        if len(remaining) != len(sources):
            _save(remaining)
