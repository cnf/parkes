import json
from pathlib import Path

from parkes.config import settings

# A starter profile showing the expected shape -- {frequency}/{output_dir}/
# {source}/{source_id}/{samplerate} are filled in from the downlink and
# current preferences at launch time. Verify these flags against
# `satdump live --help` for your installed satdump version before relying
# on it; CLI flags aren't guaranteed stable across releases.
DEFAULT_PROFILES = {
    "noaa_apt": {
        "command": [
            "satdump",
            "live",
            "noaa_apt",
            "{output_dir}",
            "--source",
            "{source}",
            "--samplerate",
            "{samplerate}",
            "--frequency",
            "{frequency}",
        ],
    },
}


def load_profiles() -> dict:
    path = Path(settings.app_profiles_file)
    if not path.exists():
        save_profiles(DEFAULT_PROFILES)
        return DEFAULT_PROFILES
    return json.loads(path.read_text())


def save_profiles(profiles: dict) -> None:
    path = Path(settings.app_profiles_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(profiles, indent=2))
