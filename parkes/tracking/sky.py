from pathlib import Path

from skyfield.api import EarthSatellite, Loader, Star, wgs84

from parkes.config import settings
from parkes.tracking.catalog import FIXED_SOURCES
from parkes.tracking.groups import GroupStore
from parkes.tracking.tle import TleCatalog

_BODIES = {"Sun": "sun", "Moon": "moon"}


def _satellite_id(norad: int) -> str:
    return f"sat:{norad}"


class SkyTracker:
    """Computes az/el for the Sun, Moon, a catalog of fixed radio sources,
    and satellites from enabled groups, using skyfield -- the existing,
    standard library for this kind of ephemeris/SGP4 math, not something
    worth reimplementing.

    Fixed targets (Sun/Moon/catalog) are keyed by their own name. Satellites
    are keyed by "sat:<norad>" since group membership is dynamic and names
    aren't guaranteed unique.
    """

    def __init__(self, tle_catalog: TleCatalog, group_store: GroupStore):
        self._tle_catalog = tle_catalog
        self._groups = group_store

        data_dir = Path(settings.skyfield_data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
        loader = Loader(str(data_dir))
        self._timescale = loader.timescale()
        eph = loader("de421.bsp")
        self._topos = wgs84.latlon(
            settings.observer_lat, settings.observer_lon, settings.observer_elevation_m
        )
        self._observer = eph["earth"] + self._topos

        self._targets = {name: eph[body] for name, body in _BODIES.items()}
        for source in FIXED_SOURCES:
            self._targets[source.name] = Star(
                ra_hours=source.ra_hours, dec_degrees=source.dec_degrees
            )

    def _enabled_satellites(self) -> list[dict]:
        return [
            {"group": group["name"], **sat}
            for group in self._groups.list_groups()
            if group["enabled"]
            for sat in group["satellites"]
        ]

    def target_names(self) -> list[str]:
        names = list(self._targets.keys())
        names += [_satellite_id(sat["norad"]) for sat in self._enabled_satellites()]
        return names

    def display_name(self, target_id: str) -> str:
        if target_id.startswith("sat:"):
            sat = self._tle_catalog.get(int(target_id[4:]))
            return sat.name if sat is not None else target_id
        return target_id

    def compute_azel(self, target_id: str) -> tuple[float, float]:
        t = self._timescale.now()
        if target_id.startswith("sat:"):
            satellite = self._tle_catalog.get(int(target_id[4:]))
            if satellite is None:
                raise KeyError(target_id)
            topocentric = (satellite - self._topos).at(t)
        else:
            target = self._targets[target_id]
            topocentric = self._observer.at(t).observe(target).apparent()
        alt, az, _distance = topocentric.altaz()
        return float(az.degrees), float(alt.degrees)

    def list_targets(self) -> list[dict]:
        targets = [
            {"id": name, "name": name, "kind": "fixed", "az": az, "el": el, "visible": bool(el > 0)}
            for name in self._targets
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
