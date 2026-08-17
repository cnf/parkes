import json
from pathlib import Path

from parkes.config import settings

# A named, fixed az/el pair -- unlike a satellite or a fixed_targets.py sky
# object (Sun/Moon/radio catalog, tracked via RA/Dec), this never moves and
# is never computed. Purely a manual shortcut: point the dish here, and
# optionally launch a standalone app profile alongside the move. Never
# touched by the Pass Orchestrator's candidate/priority logic -- there's no
# AOS/LOS, so there's nothing for it to schedule.
#
# Each entry's dict key is its stable id -- generated once (by the UI, from
# the position's name) and never changed again, same reasoning as
# app_profiles.py's profile ids.


def load_static_positions() -> dict:
    path = Path(settings.static_positions_file)
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def save_static_positions(positions: dict) -> None:
    path = Path(settings.static_positions_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(positions, indent=2))


def put_static_position(position_id: str, position: dict) -> None:
    """Creates or replaces a single position -- read-modify-write against
    the current file, so a caller only ever touches the one id it names,
    never the whole collection (see api/orchestrator.py)."""
    positions = load_static_positions()
    positions[position_id] = position
    save_static_positions(positions)


def delete_static_position(position_id: str) -> None:
    positions = load_static_positions()
    if positions.pop(position_id, None) is not None:
        save_static_positions(positions)
