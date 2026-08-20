import json
from pathlib import Path

from parkes.config import settings
from parkes.preferences import preferences

# A physical receive chain -- name + which general bands (VHF, L-band,
# Ku-band, ... -- see web/static/bands.js's RANGES) it can actually
# receive. Only one is ever connected at a time (no multi-head support
# yet); the "active_antenna_id" preference says which. See active_bands()
# and PassOrchestrator._candidate_passes() for how that filters what the
# Pass Orchestrator will even consider tracking.
#
# Each entry's dict key is its stable id -- same convention as
# static_positions.py/app_profiles.py.


def load_antennas() -> dict:
    path = Path(settings.antennas_file)
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def save_antennas(antennas: dict) -> None:
    path = Path(settings.antennas_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(antennas, indent=2))


def put_antenna(antenna_id: str, antenna: dict) -> None:
    """Creates or replaces a single antenna -- read-modify-write against
    the current file, so a caller only ever touches the one id it names,
    never the whole collection (see api/orchestrator.py)."""
    antennas = load_antennas()
    antennas[antenna_id] = antenna
    save_antennas(antennas)


def delete_antenna(antenna_id: str) -> None:
    antennas = load_antennas()
    if antennas.pop(antenna_id, None) is not None:
        save_antennas(antennas)


def active_bands() -> set[str] | None:
    """The currently-connected antenna's receivable bands, or None if
    there's nothing to filter by -- either no antenna is selected, or the
    selected one has no bands assigned. The latter fails open rather than
    silently blocking every satellite because of an unconfigured entry.
    """
    antenna_id = preferences.get("active_antenna_id")
    if not antenna_id:
        return None
    antenna = load_antennas().get(antenna_id)
    if antenna is None or not antenna.get("bands"):
        return None
    return set(antenna["bands"])


# General band boundaries (MHz) -- a deliberately small, untagged subset of
# web/static/bands.js's RANGES (just the outer ranges, none of the ISM/
# amateur/etc. sub-ranges used only for display), kept here purely as a
# fallback for downlink_band() below.
_GENERAL_BAND_RANGES: list[tuple[float, float, str]] = [
    (3, 30, "HF"),
    (30, 300, "VHF"),
    (300, 1000, "UHF"),
    (1000, 2000, "L-band"),
    (2000, 4000, "S-band"),
    (4000, 8000, "C-band"),
    (8000, 12000, "X-band"),
    (12000, 18000, "Ku-band"),
    (18000, 27000, "K-band"),
    (26500, 40000, "Ka-band"),
]


def _band_for_frequency(frequency_hz: float | None) -> str | None:
    if not frequency_hz or frequency_hz <= 0:
        return None
    mhz = frequency_hz / 1e6
    for low, high, band in _GENERAL_BAND_RANGES:
        if low <= mhz <= high:
            return band
    return None


def downlink_band(downlink: dict) -> str | None:
    """A downlink's band, preferring the client-computed value (see
    DownlinkRequest.band in api/orchestrator.py) but falling back to
    deriving it from frequency for downlinks saved before that field
    existed. Without this, selecting an antenna for the first time would
    suddenly treat every already-configured downlink as unreachable until
    each one happened to get resaved through the editor."""
    return downlink.get("band") or _band_for_frequency(downlink.get("frequency"))
