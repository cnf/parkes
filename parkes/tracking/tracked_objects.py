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


def put_tracked_object(norad: int, obj: dict) -> None:
    """Creates or replaces a single tracked object by norad id --
    read-modify-write against the current file, so a caller only ever
    touches the one norad it names, never the whole list (see
    api/orchestrator.py)."""
    objects = load_tracked_objects()
    for i, existing in enumerate(objects):
        if existing["norad"] == norad:
            objects[i] = obj
            break
    else:
        objects.append(obj)
    save_tracked_objects(objects)


def delete_tracked_object(norad: int) -> None:
    objects = load_tracked_objects()
    remaining = [o for o in objects if o["norad"] != norad]
    if len(remaining) != len(objects):
        save_tracked_objects(remaining)


def move_tracked_object(norad: int, direction: str) -> None:
    """Shifts one tracked object up or down in list order. Position
    doubles as the Pass Orchestrator's priority (see orchestrator.py's
    _rank()) -- lower index wins when two candidate passes are otherwise
    tied. Swaps with its neighbor server-side against the current file, so
    (like put/delete) a caller only ever names the one norad it wants
    moved, never supplies the whole list. No-ops at either end.
    """
    objects = load_tracked_objects()
    index = next((i for i, o in enumerate(objects) if o["norad"] == norad), None)
    if index is None:
        return
    swap_with = index - 1 if direction == "up" else index + 1
    if 0 <= swap_with < len(objects):
        objects[index], objects[swap_with] = objects[swap_with], objects[index]
        save_tracked_objects(objects)
