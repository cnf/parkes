import json
from datetime import UTC, datetime
from pathlib import Path

from parkes.config import settings
from parkes.preferences import preferences

# A starter profile showing the expected shape -- {frequency}/{output_dir}/
# {source}/{source_id}/{samplerate}/{timestamp} are filled in at launch
# time (frequency only for "pass"-mode profiles, from their triggering
# downlink; timestamp is fresh per launch, see resolve_command; the rest
# from current preferences). Verify these flags against `satdump live
# --help` for your installed satdump version before relying on it; CLI
# flags aren't guaranteed stable across releases.
#
# Each profile's dict key is its stable id -- generated once (by the UI,
# from the profile's name) and never changed again, so renaming a profile
# (the "name" field) doesn't orphan every tracked-object downlink that
# references it by id.
#
# mode:
#   "pass"       -- launched by the Pass Orchestrator for the duration of
#                    a satellite pass it's referenced from (see
#                    tracked_objects.json); needs {frequency}.
#   "standalone" -- unrelated to any satellite/pass. Started/stopped by
#                    hand, or automatically every schedule_seconds if set
#                    (skipped if already running). Parkes never touches
#                    the rotator for these.
#
# uses_sdr (default true if absent): whether this profile claims the
# physical SDR while running. SdrArbiter (sdr/arbiter.py) uses it to decide
# what to acquire/release when "soapy_remote_auto" is on -- set false for a
# profile that doesn't touch the SDR (e.g. post-processing already-
# downloaded files), so it never releases/reclaims SoapyRemote sharing.
DEFAULT_PROFILES = {
    "noaa_apt": {
        "name": "noaa_apt",
        "mode": "pass",
        "uses_sdr": True,
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


def put_profile(profile_id: str, profile: dict) -> None:
    """Creates or replaces a single profile -- read-modify-write against
    the current file, so a caller only ever touches the one id it names,
    never the whole collection (see api/orchestrator.py)."""
    profiles = load_profiles()
    profiles[profile_id] = profile
    save_profiles(profiles)


def delete_profile(profile_id: str) -> None:
    profiles = load_profiles()
    if profiles.pop(profile_id, None) is not None:
        save_profiles(profiles)


def resolve_command(command: list[str], **overrides) -> list[str]:
    """Fills in a profile's command-arg placeholders. `overrides` (e.g.
    frequency, from the triggering downlink) take precedence over the
    shared, always-available preference-derived values. Raises KeyError
    via str.format if the command references a placeholder that isn't
    supplied -- e.g. {frequency} on a standalone profile, which has no
    downlink to take it from.

    {timestamp} is computed fresh on every call (not cached/shared) --
    it's meant to be used in an output path/filename (e.g.
    "{output_dir}/{timestamp}") so consecutive runs of the same profile
    don't overwrite each other's output.
    """
    prefs = preferences.get_all()
    values = {
        "output_dir": settings.satdump_output_dir,
        "source": prefs["satdump_sdr_source"],
        "source_id": prefs["satdump_sdr_source_id"] or "",
        "samplerate": prefs["satdump_samplerate"],
        "timestamp": datetime.now(UTC).strftime("%Y%m%d_%H%M%S"),
        **overrides,
    }
    return [part.format(**values) for part in command]
