import asyncio
import logging
import time

from parkes.process import ManagedProcess
from parkes.sdr.app_profiles import load_profiles, resolve_command
from parkes.sdr.arbiter import SdrArbiter

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

    A profile with "uses_sdr" true (the default) acquires/releases
    `arbiter` around its run, same as the Pass Orchestrator's pass-mode
    profiles -- see SdrArbiter for what that does.
    """

    def __init__(self, arbiter: SdrArbiter):
        self._arbiter = arbiter
        self._processes: dict[str, ManagedProcess] = {}
        self._uses_sdr: dict[str, bool] = {}
        self._last_started: dict[str, float] = {}
        self._stopped_by_user: dict[str, bool] = {}
        self._timer_task: asyncio.Task | None = None

    def _process(self, name: str) -> ManagedProcess:
        if name not in self._processes:
            self._processes[name] = ManagedProcess()
        return self._processes[name]

    def running(self, name: str) -> bool:
        return name in self._processes and self._processes[name].running

    def status(self) -> dict[str, dict]:
        # "crashed" means it exited on its own with a non-zero code, and
        # nobody called stop() for this run. Two things it's deliberately
        # not: a deliberate stop() (SIGTERM, so returncode is often
        # nonzero too) shouldn't read as a failure; neither should a
        # one-shot command that simply finished (exit code 0) before
        # anyone got around to calling stop() on it.
        result = {}
        for name, proc in self._processes.items():
            if proc.running:
                state = "running"
            elif self._stopped_by_user.get(name, True) or proc.returncode == 0:
                state = "stopped"
            else:
                state = "crashed"
            result[name] = {"state": state, "exit_code": proc.returncode}
        return result

    async def start(self, name: str, **overrides) -> None:
        """`overrides` (e.g. frequency, from a static position that
        launched this) fill in placeholders the same way a pass-mode
        launch's downlink frequency does -- see app_profiles.py's
        resolve_command()."""
        profiles = load_profiles()
        if name not in profiles:
            raise KeyError(name)
        if profiles[name].get("mode", "pass") != "standalone":
            raise ValueError(f"{name!r} is not a standalone app profile")
        proc = self._process(name)
        if proc.running:
            raise RuntimeError(f"{name!r} is already running")
        try:
            command = resolve_command(profiles[name]["command"], **overrides)
        except KeyError as exc:
            # `name` is already confirmed valid above -- a KeyError here is
            # resolve_command()'s str.format() choking on an unresolved
            # {placeholder}, not an unknown profile. Re-raise as ValueError
            # so it doesn't get mistaken for one by this method's own
            # callers (see api/orchestrator.py's standalone_start()).
            raise ValueError(
                f"{name!r}'s command references {{{exc.args[0]}}}, which has no value here"
            ) from exc
        uses_sdr = profiles[name].get("uses_sdr", True)
        if uses_sdr:
            await self._arbiter.acquire()
        try:
            await proc.start(*command)
        except OSError as exc:
            # A bad command (typo'd path, missing binary...) should surface
            # as a clean error to start()'s caller, not an opaque 500 from
            # the API layer or an unhandled exception in the timer loop.
            if uses_sdr:
                await self._arbiter.release()
            raise RuntimeError(f"failed to launch {name!r}: {exc}") from exc
        self._uses_sdr[name] = uses_sdr
        self._last_started[name] = time.monotonic()
        self._stopped_by_user[name] = False
        if uses_sdr:
            # A one-shot profile's process can exit on its own, with
            # nobody ever calling stop() -- watch for that so the arbiter
            # still gets released instead of leaking the claim forever.
            # Racing with an explicit stop() below is fine: whichever
            # reaches the dict.pop() first releases, the other is a no-op.
            asyncio.create_task(self._release_when_done(name, proc))

    async def _release_when_done(self, name: str, proc: ManagedProcess) -> None:
        await proc.wait()
        if self._uses_sdr.pop(name, False):
            await self._arbiter.release()

    async def stop(self, name: str) -> None:
        if name in self._processes:
            self._stopped_by_user[name] = True
            await self._processes[name].stop()
        if self._uses_sdr.pop(name, False):
            await self._arbiter.release()

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
        for name in list(self._processes):
            await self.stop(name)

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
