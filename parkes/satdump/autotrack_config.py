import json
from pathlib import Path

from parkes.config import settings
from parkes.preferences import preferences

# A starter set of NOAA APT satellites -- well-known NORAD IDs/frequencies,
# just enough to demonstrate the pipeline. Edit via /api/satdump/objects.
DEFAULT_TRACKED_OBJECTS = [
    {
        "norad": 25338,  # NOAA 15
        "downlinks": [
            {"frequency": 137620000, "live": True, "record": False, "pipeline_name": "noaa_apt"}
        ],
    },
    {
        "norad": 28654,  # NOAA 18
        "downlinks": [
            {"frequency": 137912500, "live": True, "record": False, "pipeline_name": "noaa_apt"}
        ],
    },
    {
        "norad": 33591,  # NOAA 19
        "downlinks": [
            {"frequency": 137100000, "live": True, "record": False, "pipeline_name": "noaa_apt"}
        ],
    },
]


def load_tracked_objects() -> list[dict]:
    path = Path(settings.satdump_tracked_objects_file)
    if not path.exists():
        save_tracked_objects(DEFAULT_TRACKED_OBJECTS)
        return DEFAULT_TRACKED_OBJECTS
    return json.loads(path.read_text())


def save_tracked_objects(objects: list[dict]) -> None:
    path = Path(settings.satdump_tracked_objects_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(objects, indent=2))


def build_autotrack_config(tracked_objects: list[dict]) -> dict:
    prefs = preferences.get_all()
    parameters = {
        "samplerate": prefs["satdump_samplerate"],
        "initial_frequency": prefs["satdump_initial_frequency"],
        "source": prefs["satdump_sdr_source"],
    }
    if prefs["satdump_sdr_source_id"]:
        parameters["source_id"] = prefs["satdump_sdr_source_id"]

    return {
        "parameters": parameters,
        "output_folder": settings.satdump_output_dir,
        "qth": {
            "lon": prefs["observer_lon"],
            "lat": prefs["observer_lat"],
            "alt": prefs["observer_elevation_m"],
        },
        "tracked_objects": tracked_objects,
        "tracking": {
            "autotrack_cfg": {
                "autotrack_min_elevation": prefs["satdump_autotrack_min_elevation"],
                "stop_sdr_when_idle": False,
                "multi_mode": False,
                "use_localtime": False,
            },
            "rotator_cfg": {
                "address": settings.rotctld_host,
                "port": settings.rotctld_port,
            },
        },
    }


def write_config(tracked_objects: list[dict]) -> str:
    config = build_autotrack_config(tracked_objects)
    path = Path(settings.satdump_config_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2))
    return str(path)
