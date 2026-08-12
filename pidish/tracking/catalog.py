from dataclasses import dataclass


def hms(h: float, m: float, s: float) -> float:
    return h + m / 60 + s / 3600


def dms(d: float, m: float, s: float) -> float:
    sign = -1 if d < 0 else 1
    return sign * (abs(d) + m / 60 + s / 3600)


@dataclass(frozen=True)
class FixedSource:
    name: str
    ra_hours: float
    dec_degrees: float


# The "A-team" bright radio sources plus the galactic center -- standard,
# easy calibration/demo targets for amateur radio astronomy. Coordinates are
# J2000 equatorial.
FIXED_SOURCES = [
    FixedSource("Cassiopeia A", hms(23, 23, 24), dms(58, 48, 54)),
    FixedSource("Cygnus A", hms(19, 59, 28.36), dms(40, 44, 2.1)),
    FixedSource("Taurus A (Crab Nebula)", hms(5, 34, 31.94), dms(22, 0, 52.2)),
    FixedSource("Virgo A (M87)", hms(12, 30, 49.42), dms(12, 23, 28.0)),
    FixedSource("Sagittarius A* (Galactic Center)", hms(17, 45, 40.04), dms(-29, 0, 28.1)),
]

FIXED_SOURCES_BY_NAME = {source.name: source for source in FIXED_SOURCES}
