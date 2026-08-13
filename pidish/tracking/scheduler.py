import asyncio
import logging

from pidish.rotator.rotctld_client import RotctldClient, RotctldError
from pidish.tracking.sky import SkyTracker

logger = logging.getLogger(__name__)


class TrackingScheduler:
    """Periodically goto's the rotator to the active target's current az/el.

    Skips sending a goto whenever the target is below the horizon, rather
    than pointing the dish at the ground.
    """

    def __init__(self, sky: SkyTracker, rotator: RotctldClient, interval_seconds: float):
        self._sky = sky
        self._rotator = rotator
        self._interval = interval_seconds
        self._task: asyncio.Task | None = None
        self.active_target: str | None = None
        self.last_error: str | None = None

    def start(self, target_id: str) -> None:
        if target_id not in self._sky.target_names():
            raise KeyError(target_id)
        self.stop()
        self.active_target = self._sky.display_name(target_id)
        self.last_error = None
        self._task = asyncio.create_task(self._run(target_id))

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None
        self.active_target = None

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
            await asyncio.sleep(self._interval)
