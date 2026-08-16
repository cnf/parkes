import asyncio
import logging
from datetime import datetime, timezone

from parkes.preferences import preferences
from parkes.process import ManagedProcess
from parkes.sdr.app_profiles import load_profiles, resolve_command
from parkes.tracking.scheduler import TrackingScheduler
from parkes.tracking.sky import SkyTracker
from parkes.tracking.tracked_objects import load_tracked_objects

logger = logging.getLogger(__name__)

# How often to re-check for a sooner pass (an edit to tracked_objects, a
# refreshed TLE...) while waiting for one that's still more than this many
# seconds out. Keeps a stop() request responsive too, since asyncio.sleep
# is cancellable and this caps how long any single sleep call runs.
_POLL_SECONDS = 60


class PassOrchestrator:
    """Sequences dish + SDR ownership across tracked_objects' downlinks:
    finds the soonest upcoming pass, points the rotator at it, and runs
    the matching "pass"-mode app profile's process for the duration --
    then repeats. (Standalone-mode profiles are unrelated to this and are
    run by StandaloneAppRunner instead.)

    A downlink with no "app" set still gets rotator tracking but no
    process launch, which is a reasonable "dish only" way to try this out.

    current_target is non-None only while actively mid-pass (i.e. the
    rotator is claimed) -- callers that need to know whether the rotator
    is free right now, as opposed to whether the orchestrator loop is
    merely running, should check that rather than `running`.
    """

    def __init__(self, sky: SkyTracker, scheduler: TrackingScheduler):
        self._sky = sky
        self._scheduler = scheduler
        self._app_process = ManagedProcess()
        self._task: asyncio.Task | None = None
        self.status: str = "idle"
        self.current_target: str | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        if self.running:
            raise RuntimeError("orchestrator is already running")
        self.status = "starting"
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self._scheduler.stop()
        await self._app_process.stop()
        self.status = "idle"
        self.current_target = None

    async def _run(self) -> None:
        while True:
            next_up = self._find_next_pass()
            if next_up is None:
                self.status = "no upcoming passes"
                await asyncio.sleep(_POLL_SECONDS)
                continue

            target_id, downlink, pass_info = next_up
            wait_seconds = (
                datetime.fromisoformat(pass_info["aos"]) - datetime.now(timezone.utc)
            ).total_seconds()
            if wait_seconds > _POLL_SECONDS:
                self.status = f"next: {target_id} in {int(wait_seconds / 60)}m"
                await asyncio.sleep(_POLL_SECONDS)
                continue
            if wait_seconds > 0:
                self.status = f"waiting for AOS: {target_id}"
                await asyncio.sleep(wait_seconds)

            await self._run_pass(target_id, downlink, pass_info)

    def _find_next_pass(self) -> tuple[str, dict, dict] | None:
        min_elevation = preferences.get("orchestrator_min_elevation")
        best: tuple[str, dict, dict] | None = None
        for obj in load_tracked_objects():
            if not obj.get("enabled", True):
                continue
            target_id = f"sat:{obj['norad']}"
            for downlink in obj.get("downlinks", []):
                try:
                    pass_info = self._sky.next_pass(target_id, min_elevation=min_elevation)
                except KeyError:
                    continue
                if pass_info is None:
                    continue
                if best is None or pass_info["aos"] < best[2]["aos"]:
                    best = (target_id, downlink, pass_info)
        return best

    async def _run_pass(self, target_id: str, downlink: dict, pass_info: dict) -> None:
        logger.info("orchestrator: starting pass for %s", target_id)
        self.status = f"tracking {target_id}"
        self.current_target = target_id
        self._scheduler.start(target_id)

        profile_name = downlink.get("app")
        profile = load_profiles().get(profile_name) if profile_name else None
        if profile is not None and profile.get("mode", "pass") != "pass":
            logger.warning(
                "orchestrator: app profile %r is standalone, not launching for %s",
                profile_name,
                target_id,
            )
        elif profile is not None:
            try:
                command = resolve_command(profile["command"], frequency=downlink["frequency"])
            except (KeyError, IndexError) as exc:
                logger.warning("orchestrator: bad app profile %r: %s", profile_name, exc)
            else:
                try:
                    await self._app_process.start(*command)
                except OSError as exc:
                    # A bad command (typo'd path, missing binary...) shouldn't
                    # take down the whole orchestrator loop -- log it and
                    # keep tracking the pass with no process running.
                    logger.warning("orchestrator: failed to launch %r: %s", profile_name, exc)
        elif profile_name:
            logger.warning("orchestrator: unknown app profile %r for %s", profile_name, target_id)

        remaining = (
            datetime.fromisoformat(pass_info["los"]) - datetime.now(timezone.utc)
        ).total_seconds()
        if remaining > 0:
            await asyncio.sleep(remaining)

        await self._app_process.stop()
        self._scheduler.stop()
        self.status = "idle"
        self.current_target = None
