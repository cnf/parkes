from pathlib import Path

from skyfield.api import Loader, Star, wgs84

from pidish.config import settings
from pidish.tracking.catalog import FIXED_SOURCES

_BODIES = {"Sun": "sun", "Moon": "moon"}


class SkyTracker:
    """Computes az/el for the Sun, Moon, and a catalog of fixed radio
    sources, using skyfield -- the existing, standard library for this kind
    of ephemeris math (SGP4/JPL positions), not something worth
    reimplementing."""

    def __init__(self):
        data_dir = Path(settings.skyfield_data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
        loader = Loader(str(data_dir))
        self._timescale = loader.timescale()
        eph = loader("de421.bsp")
        observer = eph["earth"] + wgs84.latlon(
            settings.observer_lat, settings.observer_lon, settings.observer_elevation_m
        )
        self._observer = observer

        self._targets = {name: eph[body] for name, body in _BODIES.items()}
        for source in FIXED_SOURCES:
            self._targets[source.name] = Star(
                ra_hours=source.ra_hours, dec_degrees=source.dec_degrees
            )

    def target_names(self) -> list[str]:
        return list(self._targets.keys())

    def compute_azel(self, target_name: str) -> tuple[float, float]:
        target = self._targets[target_name]
        t = self._timescale.now()
        apparent = self._observer.at(t).observe(target).apparent()
        alt, az, _distance = apparent.altaz()
        return float(az.degrees), float(alt.degrees)

    def list_targets(self) -> list[dict]:
        targets = [
            {"name": name, "az": az, "el": el, "visible": bool(el > 0)}
            for name in self._targets
            for az, el in [self.compute_azel(name)]
        ]
        targets.sort(key=lambda t: t["el"], reverse=True)
        return targets
