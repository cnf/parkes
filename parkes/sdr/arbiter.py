import asyncio
import logging

from parkes.preferences import preferences
from parkes.sdr.server import SoapyRemoteServer

logger = logging.getLogger(__name__)


class SdrArbiter:
    """Coordinates SoapyRemote sharing with local app profiles that claim
    the SDR (app_profiles.json entries with "uses_sdr" true, the default).
    Only active while the "soapy_remote_auto" preference is on -- with it
    off, SoapyRemote is purely manual (see api/sdr.py) and acquire()/
    release() are no-ops beyond the refcount.

    A refcount, not a lock: multiple uses_sdr profiles can be "active" at
    once from Parkes's point of view. Nothing here stops them from
    colliding with each other over the one physical device -- only
    SoapyRemote sharing is arbitrated, the same scope the existing manual
    409 checks cover.
    """

    def __init__(self, soapy_remote: SoapyRemoteServer):
        self._soapy_remote = soapy_remote
        self._active = 0
        self._lock = asyncio.Lock()

    @property
    def active(self) -> int:
        return self._active

    async def _maybe_start(self) -> None:
        if not preferences.get("soapy_remote_auto") or self._soapy_remote.running:
            return
        prefs = preferences.get_all()
        try:
            await self._soapy_remote.start(
                prefs["soapy_remote_bind_host"], prefs["soapy_remote_bind_port"]
            )
        except Exception:
            logger.exception("SDR arbiter: failed to auto-start SoapyRemote")

    async def acquire(self) -> None:
        async with self._lock:
            self._active += 1
            if preferences.get("soapy_remote_auto") and self._soapy_remote.running:
                await self._soapy_remote.stop()

    async def release(self) -> None:
        async with self._lock:
            self._active = max(0, self._active - 1)
            if self._active == 0:
                await self._maybe_start()

    async def ensure_idle_state(self) -> None:
        """Called once at app startup to bring SoapyRemote up if auto mode
        is on and nothing has claimed the SDR yet."""
        async with self._lock:
            if self._active == 0:
                await self._maybe_start()
