import json
from pathlib import Path

from parkes.config import settings

# A starter set of NOAA APT satellites -- well-known NORAD IDs/frequencies,
# just enough to demonstrate the pipeline. Edit via the Pass Orchestrator
# page. Each downlink's "app" names a "pass"-mode entry in app_profiles.json
# (see parkes/sdr/app_profiles.py); a downlink with no app just gets rotator
# tracking with nothing launched.
DEFAULT_TRACKED_OBJECTS = [
    {
        "norad": 25338,
        "name": "NOAA 15",
        "enabled": True,
        "downlinks": [{"frequency": 137620000, "app": "noaa_apt"}],
    },
    {
        "norad": 28654,
        "name": "NOAA 18",
        "enabled": True,
        "downlinks": [{"frequency": 137912500, "app": "noaa_apt"}],
    },
    {
        "norad": 33591,
        "name": "NOAA 19",
        "enabled": True,
        "downlinks": [{"frequency": 137100000, "app": "noaa_apt"}],
    },
]


def load_tracked_objects() -> list[dict]:
    path = Path(settings.tracked_objects_file)
    if not path.exists():
        save_tracked_objects(DEFAULT_TRACKED_OBJECTS)
        return DEFAULT_TRACKED_OBJECTS
    return json.loads(path.read_text())


def save_tracked_objects(objects: list[dict]) -> None:
    path = Path(settings.tracked_objects_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(objects, indent=2))
