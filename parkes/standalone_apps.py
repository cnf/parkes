import asyncio
import logging
import time

from parkes.process import ManagedProcess
from parkes.sdr.app_profiles import load_profiles, resolve_command

logger = logging.getLogger(__name__)

# How often to check whether a scheduled standalone profile is due. Also
# caps how long stop_timer() waits to interrupt the wait between checks.
_POLL_SECONDS = 30


class StandaloneAppRunner:
    """Manages "standalone"-mode app profiles: started/stopped
    independently of any satellite pass, one ManagedProcess per profile
    name. Unlike the Pass Orchestrator or SoapyRemote, these commands are
    opaque to Parkes -- it doesn't try to arbitrate rotator/SDR access for
    them, trusting the user not to start something that collides with
    whatever else is running.

    A profile with "schedule_seconds" set is auto-(re)started on that
    interval whenever it isn't already running; everything else is purely
    manual via start()/stop().
    """

    def __init__(self):
        self._processes: dict[str, ManagedProcess] = {}
        self._last_started: dict[str, float] = {}
        self._timer_task: asyncio.Task | None = None

    def _process(self, name: str) -> ManagedProcess:
        if name not in self._processes:
            self._processes[name] = ManagedProcess()
        return self._processes[name]

    def running(self, name: str) -> bool:
        return name in self._processes and self._processes[name].running

    def status(self) -> dict[str, bool]:
        return {name: proc.running for name, proc in self._processes.items()}

    async def start(self, name: str) -> None:
        profiles = load_profiles()
        if name not in profiles:
            raise KeyError(name)
        if profiles[name].get("mode", "pass") != "standalone":
            raise ValueError(f"{name!r} is not a standalone app profile")
        proc = self._process(name)
        if proc.running:
            raise RuntimeError(f"{name!r} is already running")
        command = resolve_command(profiles[name]["command"])
        try:
            await proc.start(*command)
        except OSError as exc:
            # A bad command (typo'd path, missing binary...) should surface
            # as a clean error to start()'s caller, not an opaque 500 from
            # the API layer or an unhandled exception in the timer loop.
            raise RuntimeError(f"failed to launch {name!r}: {exc}") from exc
        self._last_started[name] = time.monotonic()

    async def stop(self, name: str) -> None:
        if name in self._processes:
            await self._processes[name].stop()

    def start_timer(self) -> None:
        if self._timer_task is None:
            self._timer_task = asyncio.create_task(self._run_timer())

    async def stop_timer(self) -> None:
        if self._timer_task is not None:
            self._timer_task.cancel()
            try:
                await self._timer_task
            except asyncio.CancelledError:
                pass
            self._timer_task = None
        for proc in self._processes.values():
            await proc.stop()

    async def _run_timer(self) -> None:
        while True:
            await asyncio.sleep(_POLL_SECONDS)
            now = time.monotonic()
            for name, profile in load_profiles().items():
                if profile.get("mode", "pass") != "standalone":
                    continue
                interval = profile.get("schedule_seconds")
                if not interval or self.running(name):
                    continue
                if now - self._last_started.get(name, 0) < interval:
                    continue
                try:
                    await self.start(name)
                except Exception:
                    logger.exception("standalone app %r failed to auto-start", name)
