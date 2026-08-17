import asyncio
import logging
from datetime import datetime, timedelta, timezone

from parkes.preferences import preferences
from parkes.process import ManagedProcess
from parkes.sdr.app_profiles import load_profiles, resolve_command
from parkes.sdr.arbiter import SdrArbiter
from parkes.tracking.scheduler import TrackingScheduler
from parkes.tracking.sky import SkyTracker
from parkes.tracking.tracked_objects import load_tracked_objects

logger = logging.getLogger(__name__)

# How often to re-check for a sooner pass (an edit to tracked_objects, a
# refreshed TLE...) while waiting for one that's still more than this many
# seconds out, or with nothing at all on the horizon yet. Also the safety-net
# cap on how long a single _run_pass() sleep runs before re-evaluating, so a
# config change is noticed even mid-pass. Keeps a stop() request responsive
# too, since asyncio.sleep is cancellable and this caps how long any single
# sleep call runs.
_POLL_SECONDS = 60

# A tuple of (priority, target_id, downlink, pass_info) -- one candidate
# pass. `priority` is the owning tracked object's position in
# tracked_objects.json (lower index = higher priority); see _rank().
_Candidate = tuple[int, str, dict, dict]


class PassOrchestrator:
    """Sequences dish + SDR ownership across tracked_objects' downlinks.

    Each loop iteration finds every candidate pass (see _candidate_passes())
    and, among whichever are available *right now*, picks the
    highest-priority one (see _rank()): anything with a real, bounded end
    always beats a genuinely unbounded one (never sets in the search
    window -- e.g. a continuously-visible orbit), and within the same
    tier, earlier position in tracked_objects.json wins. If nothing is
    available yet, it waits for the soonest AOS.

    While tracking a pass, it doesn't just block for that pass's own
    duration -- it wakes up (via precise sleep-until, not polling) whenever
    something would now outrank the one it's tracking, and hands off. A
    continuously-visible target run as filler this way yields to any real
    pass as soon as it starts, and a lower-priority real pass already
    running yields to a higher-priority one the moment the latter's AOS
    arrives -- not just when the current one ends.

    A downlink with no "app" set still gets rotator tracking but no
    process launch, which is a reasonable "dish only" way to try this out.

    current_target is non-None only while actively mid-pass (i.e. the
    rotator is claimed) -- callers that need to know whether the rotator
    is free right now, as opposed to whether the orchestrator loop is
    merely running, should check that rather than `running`.
    """

    def __init__(self, sky: SkyTracker, scheduler: TrackingScheduler, arbiter: SdrArbiter):
        self._sky = sky
        self._scheduler = scheduler
        self._arbiter = arbiter
        self._app_process = ManagedProcess()
        self._task: asyncio.Task | None = None
        self.status: str = "idle"
        self.current_target: str | None = None
        self.current_profile: str | None = None
        self.current_continuous: bool = False
        self.current_command: list[str] | None = None
        self.current_app_error: str | None = None

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
        self.current_profile = None
        self.current_continuous = False
        self.current_command = None
        self.current_app_error = None

    async def _run(self) -> None:
        while True:
            candidates = self._candidate_passes()
            current = self._best_available_now(candidates)
            if current is not None:
                await self._run_pass(current)
                continue

            if not candidates:
                self.status = "no upcoming passes"
                await asyncio.sleep(_POLL_SECONDS)
                continue

            next_up = min(candidates, key=lambda c: c[3]["aos"])
            wait_seconds = (
                datetime.fromisoformat(next_up[3]["aos"]) - datetime.now(timezone.utc)
            ).total_seconds()
            if wait_seconds > _POLL_SECONDS:
                self.status = f"next: {next_up[1]} in {int(wait_seconds / 60)}m"
                await asyncio.sleep(_POLL_SECONDS)
                continue
            if wait_seconds > 0:
                self.status = f"waiting for AOS: {next_up[1]}"
                await asyncio.sleep(wait_seconds)

    def _candidate_passes(self) -> list[_Candidate]:
        """Every enabled downlink's next_pass() -- see SkyTracker.next_pass
        for what "synthesized" means. `priority` is the owning tracked
        object's position in tracked_objects.json.
        """
        min_elevation = preferences.get("orchestrator_min_elevation")
        candidates: list[_Candidate] = []
        for priority, obj in enumerate(load_tracked_objects()):
            if not obj.get("enabled", True):
                continue
            target_id = f"sat:{obj['norad']}"
            for downlink in obj.get("downlinks", []):
                try:
                    pass_info = self._sky.next_pass(target_id, min_elevation=min_elevation)
                except KeyError:
                    continue
                if pass_info is not None:
                    candidates.append((priority, target_id, downlink, pass_info))
        return candidates

    @staticmethod
    def _rank(candidate: _Candidate) -> tuple[bool, int]:
        """Sort key -- lower sorts first, i.e. wins. Anything with a real,
        bounded end (a genuine pass, whether upcoming or already mid-way
        through) always outranks something that's unbounded -- genuinely
        never sets in the search window, e.g. a continuously-visible orbit
        -- since "synthesized" alone would also match this candidate's own
        already-launched pass on every re-check after it started (see
        SkyTracker.next_pass()). Within the same tier, lower priority
        (earlier in tracked_objects.json) wins.
        """
        priority, _target_id, _downlink, pass_info = candidate
        return (bool(pass_info.get("unbounded")), priority)

    def _best_available_now(self, candidates: list[_Candidate]) -> _Candidate | None:
        now = datetime.now(timezone.utc)
        available = [c for c in candidates if datetime.fromisoformat(c[3]["aos"]) <= now]
        return min(available, key=self._rank) if available else None

    def _outranked(self, current: _Candidate, candidates: list[_Candidate], now: datetime) -> bool:
        """Whether something in `candidates` both beats `current` and is
        already available (its AOS has arrived), meaning `current` should
        yield to it now."""
        current_rank = self._rank(current)
        return any(
            self._rank(c) < current_rank and datetime.fromisoformat(c[3]["aos"]) <= now
            for c in candidates
        )

    def _next_wake_time(
        self, current: _Candidate, candidates: list[_Candidate], own_los: datetime, now: datetime
    ) -> datetime:
        """Earliest of: this pass's own end, or the AOS of anything that
        would outrank `current` once its AOS arrives -- an exact wake-up,
        not polling, since the ephemeris already gives us both. Capped at
        _POLL_SECONDS so a tracked_objects.json edit or refreshed TLE is
        still noticed reasonably soon even during a long, otherwise
        uncontested continuous fill.
        """
        current_rank = self._rank(current)
        candidate_times = [
            datetime.fromisoformat(c[3]["aos"])
            for c in candidates
            if self._rank(c) < current_rank and datetime.fromisoformat(c[3]["aos"]) > now
        ]
        candidate_times.append(own_los)
        candidate_times.append(now + timedelta(seconds=_POLL_SECONDS))
        return min(candidate_times)

    async def _run_pass(self, current: _Candidate) -> None:
        _priority, target_id, downlink, pass_info = current
        logger.info("orchestrator: starting pass for %s", target_id)
        self.current_continuous = bool(pass_info.get("unbounded"))
        self.status = f"tracking {target_id}" + (" (continuous)" if self.current_continuous else "")
        self.current_target = target_id
        self._scheduler.start(target_id)

        profile_name = downlink.get("app")
        profile = load_profiles().get(profile_name) if profile_name else None
        command = None
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
        elif profile_name:
            logger.warning("orchestrator: unknown app profile %r for %s", profile_name, target_id)

        self.current_profile = profile.get("name", profile_name) if command is not None else None
        self.current_command = command
        self.current_app_error = None

        # One try/finally around acquire..the wait loop so a cancelled task
        # (stop() mid-pass, or the loop below deciding to yield to a
        # higher-priority candidate) still releases the arbiter and stops
        # the process, same as the uneventful path.
        uses_sdr = command is not None and profile.get("uses_sdr", True)
        try:
            if uses_sdr:
                await self._arbiter.acquire()
            if command is not None:
                try:
                    await self._app_process.start(*command)
                except OSError as exc:
                    # A bad command (typo'd path, missing binary...) shouldn't
                    # take down the whole orchestrator loop -- log it and
                    # keep tracking the pass with no process running.
                    logger.warning("orchestrator: failed to launch %r: %s", profile_name, exc)
                    self.current_app_error = f"failed to launch: {exc}"

            own_los = datetime.fromisoformat(pass_info["los"])
            # Once the launched process exits, its exit is only worth
            # reporting once -- after that, exited() would just resolve
            # immediately on every following iteration (nothing to wait
            # on), so stop racing it and fall back to a plain sleep.
            watch_process = command is not None and self.current_app_error is None
            while True:
                # `now` is captured *after* _candidate_passes(), not before --
                # SkyTracker.next_pass() stamps a synthesized pass's "aos"
                # with its own fresh now() call, which happens strictly
                # after any `now` captured before it. Capturing `now` first
                # would make a just-synthesized "aos" always look
                # microseconds in the future, so "aos <= now" would never
                # match and preemption would never trigger.
                fresh = self._candidate_passes()
                now = datetime.now(timezone.utc)
                if now >= own_los:
                    break
                if self._outranked(current, fresh, now):
                    break
                wake_at = self._next_wake_time(current, fresh, own_los, now)
                sleep_for = (wake_at - now).total_seconds()
                if sleep_for <= 0:
                    continue
                if watch_process:
                    try:
                        await asyncio.wait_for(self._app_process.exited(), timeout=sleep_for)
                    except asyncio.TimeoutError:
                        continue
                    code = self._app_process.returncode
                    logger.warning(
                        "orchestrator: %r exited mid-pass (code %s)", profile_name, code
                    )
                    self.current_app_error = f"{self.current_profile} exited early (code {code})"
                    watch_process = False
                else:
                    await asyncio.sleep(sleep_for)
        finally:
            await self._app_process.stop()
            if uses_sdr:
                await self._arbiter.release()
            self._scheduler.stop()
            self.status = "idle"
            self.current_target = None
            self.current_profile = None
            self.current_continuous = False
            self.current_command = None
            self.current_app_error = None


def find_overlaps(sky: SkyTracker, search_hours: float = 48.0) -> list[dict]:
    """Where two enabled tracked objects' passes would overlap in time
    within the next search_hours -- the orchestrator can only track one
    target at a time (see PassOrchestrator._rank() for how it'd decide
    between them), so this is a read-only heads-up, not something that
    feeds back into scheduling.
    """
    min_elevation = preferences.get("orchestrator_min_elevation")
    passes = []
    for obj in load_tracked_objects():
        if not obj.get("enabled", True):
            continue
        target_id = f"sat:{obj['norad']}"
        try:
            for p in sky.passes_in_window(target_id, min_elevation=min_elevation, search_hours=search_hours):
                passes.append({"target_id": target_id, "name": obj["name"], **p})
        except KeyError:
            continue
    passes.sort(key=lambda p: p["aos"])

    overlaps = []
    for i, a in enumerate(passes):
        for b in passes[i + 1 :]:
            if b["aos"] >= a["los"]:
                break  # sorted by aos -- nothing further can overlap `a` either
            overlaps.append(
                {
                    "a": {k: a[k] for k in ("target_id", "name", "aos", "los")},
                    "b": {k: b[k] for k in ("target_id", "name", "aos", "los")},
                    "overlap_start": max(a["aos"], b["aos"]),
                    "overlap_end": min(a["los"], b["los"]),
                }
            )
    return overlaps
