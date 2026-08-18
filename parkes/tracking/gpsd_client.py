import asyncio
import contextlib
import json
import logging
import time

logger = logging.getLogger(__name__)

# How long a fix is trusted after it was last updated before falling back
# to the configured default location -- protects against silently steering
# by a GPS fix that's actually gone stale (module unplugged, gpsd died and
# our reconnect loop hasn't caught up yet) rather than a fresh one.
_FIX_STALE_SECONDS = 30.0

# How long to wait between reconnect attempts when gpsd isn't reachable
# (e.g. no GPS hardware attached this session) -- matches the "polling a
# thing that might not be there" pattern used elsewhere (ManagedProcess,
# SdrArbiter), not an error worth logging loudly on every retry.
_RECONNECT_SECONDS = 5.0


class GpsdClient:
    """Maintains a live connection to a gpsd instance (the real daemon, or
    gpsfake acting as one for testing -- identical wire protocol) and keeps
    the latest fix cached for cheap synchronous reads from SkyTracker.

    gpsd's protocol is simple newline-delimited JSON over a plain TCP
    socket: connect, send `?WATCH={"enable":true,"json":true}`, then read
    reports. "TPV" ("Time-Position-Velocity") reports carry lat/lon/
    altHAE when mode >= 2 (2D/3D fix). Small enough to speak directly --
    not worth a client library dependency for.
    """

    def __init__(self, host: str, port: int):
        self._host = host
        self._port = port
        self._task: asyncio.Task | None = None
        self.lat: float | None = None
        self.lon: float | None = None
        self.altitude_m: float | None = None
        self._fix_time: float | None = None
        self.last_error: str | None = None

    @property
    def has_fresh_fix(self) -> bool:
        return (
            self._fix_time is not None
            and (time.monotonic() - self._fix_time) < _FIX_STALE_SECONDS
        )

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def reconfigure(self, host: str, port: int) -> None:
        """Points this client at a different gpsd -- e.g. after a Settings
        page save changes gpsd_host/port. Drops the current fix, since it
        came from the old source, and restarts the connect/listen loop
        against the new address."""
        if (host, port) == (self._host, self._port):
            return
        await self.stop()
        self._host, self._port = host, port
        self.lat = self.lon = self.altitude_m = None
        self._fix_time = None
        self.start()

    async def _run(self) -> None:
        while True:
            try:
                await self._connect_and_listen()
            except asyncio.CancelledError:
                raise
            except (OSError, ConnectionError) as exc:
                self.last_error = str(exc)
            await asyncio.sleep(_RECONNECT_SECONDS)

    async def _connect_and_listen(self) -> None:
        reader, writer = await asyncio.open_connection(self._host, self._port)
        try:
            writer.write(b'?WATCH={"enable":true,"json":true}\n')
            await writer.drain()
            self.last_error = None
            logger.info("gpsd: connected to %s:%d", self._host, self._port)
            async for line in reader:
                if not line.strip():
                    continue
                try:
                    report = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self._handle_report(report)
        finally:
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()
            logger.info("gpsd: disconnected from %s:%d", self._host, self._port)

    def _handle_report(self, report: dict) -> None:
        if report.get("class") != "TPV" or report.get("mode", 0) < 2:
            return
        lat, lon = report.get("lat"), report.get("lon")
        if lat is None or lon is None:
            return
        self.lat = lat
        self.lon = lon
        # altHAE (height above the WGS84 ellipsoid) is what skyfield's
        # wgs84.latlon() elevation_m expects; "alt" is gpsd's older,
        # pre-3.13 key for roughly the same thing -- fall back to it for
        # older gpsd versions that don't send altHAE.
        alt = report.get("altHAE", report.get("alt"))
        if alt is not None:
            self.altitude_m = alt
        self._fix_time = time.monotonic()
