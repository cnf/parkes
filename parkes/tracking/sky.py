from datetime import timedelta
from pathlib import Path

from skyfield.api import EarthSatellite, Loader, Star, wgs84

from parkes.config import settings
from parkes.preferences import preferences
from parkes.tracking.catalog import FIXED_SOURCES
from parkes.tracking.fixed_targets import FixedTargetStore
from parkes.tracking.groups import GroupStore
from parkes.tracking.tle import TleCatalog

_BODIES = {"Sun": "sun", "Moon": "moon"}


def _satellite_id(norad: int) -> str:
    return f"sat:{norad}"


class SkyTracker:
    """Computes az/el for the Sun, Moon, a catalog of fixed radio sources,
    and satellites from enabled groups, using skyfield -- the existing,
    standard library for this kind of ephemeris/SGP4 math, not something
    worth reimplementing. Fixed targets and satellite groups are each
    individually toggleable; disabled ones are excluded from target_names()
    and list_targets() but their az/el can still be computed directly.

    Fixed targets (Sun/Moon/catalog) are keyed by their own name. Satellites
    are keyed by "sat:<norad>" since group membership is dynamic and names
    aren't guaranteed unique.

    Observer location is read from preferences fresh on every computation
    (not cached) so changes made on the Settings page apply immediately.
    """

    def __init__(
        self, tle_catalog: TleCatalog, group_store: GroupStore, fixed_target_store: FixedTargetStore
    ):
        self._tle_catalog = tle_catalog
        self._groups = group_store
        self._fixed_targets = fixed_target_store

        data_dir = Path(settings.skyfield_data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
        loader = Loader(str(data_dir))
        self._timescale = loader.timescale()
        self._eph = loader("de421.bsp")
        self._earth = self._eph["earth"]

        self._targets = {name: self._eph[body] for name, body in _BODIES.items()}
        for source in FIXED_SOURCES:
            self._targets[source.name] = Star(
                ra_hours=source.ra_hours, dec_degrees=source.dec_degrees
            )

    def _current_topos(self):
        prefs = preferences.get_all()
        return wgs84.latlon(
            prefs["observer_lat"], prefs["observer_lon"], prefs["observer_elevation_m"]
        )

    def _enabled_satellites(self) -> list[dict]:
        return [
            {"group": group["name"], **sat}
            for group in self._groups.list_groups()
            if group["enabled"]
            for sat in group["satellites"]
        ]

    def _enabled_fixed_target_names(self) -> set[str]:
        return {t["name"] for t in self._fixed_targets.list_all() if t["enabled"]}

    def target_names(self) -> list[str]:
        names = [name for name in self._targets if name in self._enabled_fixed_target_names()]
        names += [_satellite_id(sat["norad"]) for sat in self._enabled_satellites()]
        return names

    def display_name(self, target_id: str) -> str:
        if target_id.startswith("sat:"):
            sat = self._tle_catalog.get(int(target_id[4:]))
            return sat.name if sat is not None else target_id
        return target_id

    def compute_azel(self, target_id: str) -> tuple[float, float]:
        t = self._timescale.now()
        topos = self._current_topos()
        if target_id.startswith("sat:"):
            satellite = self._tle_catalog.get(int(target_id[4:]))
            if satellite is None:
                raise KeyError(target_id)
            topocentric = (satellite - topos).at(t)
        else:
            target = self._targets[target_id]
            observer = self._earth + topos
            topocentric = observer.at(t).observe(target).apparent()
        alt, az, _distance = topocentric.altaz()
        return float(az.degrees), float(alt.degrees)

    def list_targets(self) -> list[dict]:
        enabled_fixed = self._enabled_fixed_target_names()
        targets = [
            {"id": name, "name": name, "kind": "fixed", "az": az, "el": el, "visible": bool(el > 0)}
            for name in self._targets
            if name in enabled_fixed
            for az, el in [self.compute_azel(name)]
        ]
        for sat in self._enabled_satellites():
            target_id = _satellite_id(sat["norad"])
            try:
                az, el = self.compute_azel(target_id)
            except KeyError:
                continue
            targets.append(
                {
                    "id": target_id,
                    "name": sat["name"],
                    "kind": "satellite",
                    "group": sat["group"],
                    "az": az,
                    "el": el,
                    "visible": bool(el > 0),
                }
            )
        targets.sort(key=lambda t: t["el"], reverse=True)
        return targets

    def next_pass(
        self, target_id: str, min_elevation: float = 0.0, search_hours: float = 48.0
    ) -> dict | None:
        """AOS/LOS/max-elevation of the next pass reaching min_elevation,
        searched over the next search_hours. Satellites only -- Sun/Moon/
        catalog sources don't have discrete "passes" the way an orbiting
        target handed off to a decode pipeline does.

        Returns None if no full rise-to-set pass is found in the window
        (e.g. a currently mid-pass target, since a partial pass at the
        start of the search window is deliberately not counted).
        """
        if not target_id.startswith("sat:"):
            raise ValueError(f"next_pass only supports satellite targets, got {target_id!r}")
        satellite = self._tle_catalog.get(int(target_id[4:]))
        if satellite is None:
            raise KeyError(target_id)

        topos = self._current_topos()
        t0 = self._timescale.now()
        t1 = t0 + timedelta(hours=search_hours)
        times, events = satellite.find_events(topos, t0, t1, altitude_degrees=min_elevation)

        for i in range(len(events) - 2):
            if events[i] == 0 and events[i + 1] == 1 and events[i + 2] == 2:
                rise_time, culminate_time, set_time = times[i], times[i + 1], times[i + 2]
                el, _az, _dist = (satellite - topos).at(culminate_time).altaz()
                return {
                    "aos": rise_time.utc_iso(),
                    "los": set_time.utc_iso(),
                    "max_elevation": float(el.degrees),
                }
        return None

    def upcoming_passes(self, min_elevation: float = 0.0) -> list[dict]:
        """next_pass() for every enabled satellite, soonest first, skipping
        ones with no pass in the search window or unresolvable TLE data."""
        passes = []
        for sat in self._enabled_satellites():
            target_id = _satellite_id(sat["norad"])
            try:
                result = self.next_pass(target_id, min_elevation=min_elevation)
            except KeyError:
                continue
            if result is not None:
                passes.append({"id": target_id, "name": sat["name"], **result})
        passes.sort(key=lambda p: p["aos"])
        return passes
