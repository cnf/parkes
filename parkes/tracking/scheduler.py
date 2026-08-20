import asyncio
import logging

from parkes.preferences import preferences
from parkes.rotator.rotctld_client import RotctldClient, RotctldError
from parkes.tracking.sky import SkyTracker

logger = logging.getLogger(__name__)


class TrackingScheduler:
    """Periodically goto's the rotator to the active target's current az/el.

    Skips sending a goto whenever the target is below the horizon, rather
    than pointing the dish at the ground. The poll interval is read from
    preferences fresh each loop iteration, so a change on the Settings page
    applies to the next tick without a restart.
    """

    def __init__(self, sky: SkyTracker, rotator: RotctldClient):
        self._sky = sky
        self._rotator = rotator
        self._task: asyncio.Task | None = None
        self.active_target: str | None = None
        # The raw id (e.g. "sat:25544"), alongside active_target's already-
        # resolved display name -- kept separately since active_target
        # alone can't be turned back into something compute_azel() accepts.
        # See api/tracking.py's /targets route, which uses this to keep the
        # actively-tracked target showing on the dashboard even when it
        # isn't (or is no longer) part of any enabled group.
        self.active_target_id: str | None = None
        self.last_error: str | None = None

    def start(self, target_id: str, *, require_enabled: bool = True) -> None:
        """require_enabled gates against SkyTracker.target_names() -- the
        Satellites page's enabled-groups/fixed-targets allowlist. That's
        deliberate curation for the dashboard's manual "Track" button (see
        satellites.html), but it has nothing to do with the Pass
        Orchestrator's own tracked_objects.json, a completely separate
        list with its own "enabled" flags. PassOrchestrator passes False,
        since a satellite it's allowed to schedule shouldn't also have to
        be in some unrelated group just to actually get tracked --
        compute_azel()/display_name() below work off the full TLE catalog
        either way, group membership doesn't affect them.
        """
        if require_enabled and target_id not in self._sky.target_names():
            raise KeyError(target_id)
        self.stop()
        self.active_target = self._sky.display_name(target_id)
        self.active_target_id = target_id
        self.last_error = None
        self._task = asyncio.create_task(self._run(target_id))

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None
        self.active_target = None
        self.active_target_id = None

    async def _run(self, target_name: str) -> None:
        while True:
            az, el = self._sky.compute_azel(target_name)
            if el >= 0:
                try:
                    await self._rotator.set_position(az, el)
                    self.last_error = None
                except (RotctldError, ConnectionError, OSError) as exc:
                    self.last_error = str(exc)
                    logger.warning("tracking goto failed: %s", exc)
            await asyncio.sleep(preferences.get("tracking_interval_seconds"))
