from datetime import timedelta
from pathlib import Path

from skyfield.api import Loader, Star, wgs84

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
        self,
        tle_catalog: TleCatalog,
        group_store: GroupStore,
        fixed_target_store: FixedTargetStore,
        gpsd_client=None,
    ):
        self._tle_catalog = tle_catalog
        self._groups = group_store
        self._fixed_targets = fixed_target_store
        self._gpsd = gpsd_client

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

    def current_location(self) -> tuple[float, float, float, str]:
        """The observer lat/lon/elevation actually in effect right now,
        plus which source produced it -- "gpsd" only when that mode is
        selected *and* has a fix no older than GpsdClient's staleness
        window; "manual"/"default" otherwise, same as before gpsd support
        existed. Exposed separately from _current_topos() so the Settings
        API can show live gpsd status without duplicating this logic.
        """
        prefs = preferences.get_all()
        mode = prefs["observer_location_mode"]
        if mode == "manual":
            return (
                prefs["observer_manual_lat"],
                prefs["observer_manual_lon"],
                prefs["observer_manual_elevation_m"],
                "manual",
            )
        if mode == "gpsd" and self._gpsd is not None and self._gpsd.has_fresh_fix:
            elevation = self._gpsd.altitude_m
            if elevation is None:
                elevation = prefs["observer_elevation_m"]
            return (self._gpsd.lat, self._gpsd.lon, elevation, "gpsd")
        return (
            prefs["observer_lat"], prefs["observer_lon"], prefs["observer_elevation_m"], "default"
        )

    def _current_topos(self):
        lat, lon, elevation, _source = self.current_location()
        return wgs84.latlon(lat, lon, elevation)

    def azel_of_point(self, lat: float, lon: float, elevation_m: float) -> tuple[float, float]:
        """az/el of an arbitrary fixed ground point (not a satellite or sky
        object) as seen from the current observer location right now --
        the same site-to-site geometry skyfield uses for satellites, just
        with a second wgs84.latlon() instead of an orbit. Used by Static
        Positions' lat/lon/alt input mode (see api/orchestrator.py).
        """
        t = self._timescale.now()
        topocentric = (wgs84.latlon(lat, lon, elevation_m) - self._current_topos()).at(t)
        alt, az, _distance = topocentric.altaz()
        return float(az.degrees), float(alt.degrees)

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

    def _find_satellite(self, target_id: str):
        if not target_id.startswith("sat:"):
            raise ValueError(f"expected a satellite target, got {target_id!r}")
        satellite = self._tle_catalog.get(int(target_id[4:]))
        if satellite is None:
            raise KeyError(target_id)
        return satellite

    def next_pass(
        self, target_id: str, min_elevation: float = 0.0, search_hours: float = 48.0
    ) -> dict | None:
        """AOS/LOS/max-elevation of the next pass reaching min_elevation,
        searched over the next search_hours. Satellites only -- Sun/Moon/
        catalog sources don't have discrete "passes" the way an orbiting
        target handed off to a decode pipeline does.

        If the target is already above min_elevation right now with no
        rise event inside the window -- e.g. it's mid-pass, or (for
        certain high-inclination orbits) continuously visible from here --
        "aos" is "now" and "synthesized" is True instead of returning None.

        "synthesized" alone doesn't distinguish "ordinary pass that just
        happens to have already started" (still has a real, bounded "los")
        from "genuinely never sets in the search window" -- a satellite
        mid-pass with a real set event coming up is still a real, bounded
        pass, just observed slightly late. "unbounded" is only true for
        the latter (no set event found anywhere in the window, "los" falls
        back to the window's edge) -- that's what the Pass Orchestrator
        treats as lower priority than anything with a genuine end, since
        "synthesized" alone would also match its own already-launched
        pass on every re-check after the moment it started (see
        orchestrator.py's _rank()).

        Returns None only if the target isn't reachable at all in the
        window (never rises above min_elevation).
        """
        satellite = self._find_satellite(target_id)
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

        current_el, _az, _dist = (satellite - topos).at(t0).altaz()
        if current_el.degrees >= min_elevation:
            set_time = None
            max_elevation = current_el.degrees
            for time, event in zip(times, events, strict=True):
                if event == 1:
                    el, _az, _dist = (satellite - topos).at(time).altaz()
                    max_elevation = max(max_elevation, float(el.degrees))
                elif event == 2:
                    set_time = time
                    break
            return {
                "aos": t0.utc_iso(),
                "los": (set_time or t1).utc_iso(),
                "max_elevation": max_elevation,
                "synthesized": True,
                "unbounded": set_time is None,
            }
        return None

    def passes_in_window(
        self, target_id: str, min_elevation: float = 0.0, search_hours: float = 48.0
    ) -> list[dict]:
        """Every complete rise-to-set pass in the window, not just the
        first -- unlike next_pass(), doesn't stop early and doesn't
        synthesize a currently-in-progress/continuous entry (a pass
        without a real end wouldn't mean much in an overlap listing).
        Used for overlap prediction, not scheduling.
        """
        satellite = self._find_satellite(target_id)
        topos = self._current_topos()
        t0 = self._timescale.now()
        t1 = t0 + timedelta(hours=search_hours)
        times, events = satellite.find_events(topos, t0, t1, altitude_degrees=min_elevation)

        passes = []
        for i in range(len(events) - 2):
            if events[i] == 0 and events[i + 1] == 1 and events[i + 2] == 2:
                rise_time, culminate_time, set_time = times[i], times[i + 1], times[i + 2]
                el, _az, _dist = (satellite - topos).at(culminate_time).altaz()
                passes.append(
                    {
                        "aos": rise_time.utc_iso(),
                        "los": set_time.utc_iso(),
                        "max_elevation": float(el.degrees),
                    }
                )
        return passes

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
