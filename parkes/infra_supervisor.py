import asyncio
import logging
import time

from parkes.config import settings
from parkes.preferences import preferences
from parkes.process import ManagedProcess

logger = logging.getLogger(__name__)

# Backoff for unexpected exits -- doubles up to the cap, resets once a
# restart survives _STABLE_SECONDS. No periodic/proactive restarts: rotctld
# resets the EasyCommII board's ESP32 once per serial-port open, so
# health-cycling a daemon that's otherwise fine has a real (if small) cost.
_MIN_BACKOFF_SECONDS = 5.0
_MAX_BACKOFF_SECONDS = 60.0
_STABLE_SECONDS = 30.0


class InfraDaemon:
    """One always-on managed subprocess (rotctld, optionally gpsd): starts
    once, crash-restarts with backoff if it exits unexpectedly, never
    proactively health-cycled -- unlike StandaloneAppRunner's
    schedule_seconds restarts or PassOrchestrator's per-pass transient
    lifecycle, this is for a daemon meant to stay up for the app's whole
    uptime.
    """

    def __init__(self, name: str, command: list[str], host: str, port: int):
        self.name = name
        self.command = command
        self._host = host
        self._port = port
        self._process = ManagedProcess()
        self._watch_task: asyncio.Task | None = None
        self._stopping = False
        self._external = False

    @property
    def state(self) -> str:
        if self._external:
            return "external"
        if self._process.running:
            return "running"
        if self._stopping:
            return "stopped"
        return "crashed"

    async def start(self) -> None:
        self._stopping = False
        if await self._already_listening():
            # Something (a previous run left behind, or a manually-started
            # instance) is already on this host:port -- don't spawn a
            # second one, and don't claim ownership so stop() won't kill
            # something we didn't start.
            self._external = True
            logger.info(
                "%s: %s:%s already has a listener, not starting our own",
                self.name, self._host, self._port,
            )
            return
        self._external = False
        await self._process.start(*self.command)
        self._watch_task = asyncio.create_task(self._watch())

    async def _already_listening(self) -> bool:
        # self._host is a *bind* address here (see InfraSupervisor._rebuild)
        # -- a wildcard like 0.0.0.0/:: isn't a connectable destination for
        # this probe, but anything bound there is equally reachable via
        # loopback, so check that instead.
        probe_host = "127.0.0.1" if self._host in ("0.0.0.0", "::") else self._host
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(probe_host, self._port), timeout=1
            )
        except (OSError, asyncio.TimeoutError):
            return False
        writer.close()
        await writer.wait_closed()
        return True

    async def _watch(self) -> None:
        backoff = _MIN_BACKOFF_SECONDS
        while True:
            exited = self._process.exited()
            if exited is None:
                return
            started_at = time.monotonic()
            await exited
            if self._stopping:
                return
            if time.monotonic() - started_at >= _STABLE_SECONDS:
                backoff = _MIN_BACKOFF_SECONDS
            logger.warning(
                "%s exited unexpectedly (code=%s), restarting in %.0fs",
                self.name, self._process.returncode, backoff,
            )
            await asyncio.sleep(backoff)
            if self._stopping:
                return
            try:
                await self._process.start(*self.command)
            except OSError:
                logger.exception("%s: failed to restart", self.name)
                return
            backoff = min(backoff * 2, _MAX_BACKOFF_SECONDS)

    async def stop(self) -> None:
        self._stopping = True
        if self._watch_task is not None:
            self._watch_task.cancel()
            try:
                await self._watch_task
            except asyncio.CancelledError:
                pass
            self._watch_task = None
        if not self._external:
            await self._process.stop()


class InfraSupervisor:
    """Owns Parkes's always-on infrastructure daemons -- rotctld, and
    optionally gpsd -- as sibling child processes, started once at app
    startup and kept running for its whole uptime via InfraDaemon's
    crash-restart policy.

    What's launched (rotator model/device, managed on/off, ...) comes from
    preferences.py -- the same UI-editable, restart-free config as the rest
    of the Settings page -- not from Settings/env vars, which only seed
    preferences.py's DEFAULTS for a fresh deploy. reconfigure() re-reads
    preferences and bounces whichever daemons that affects; called by
    api/settings.py after a save that touches rotator/gpsd fields.
    """

    def __init__(self):
        self.daemons: dict[str, InfraDaemon] = {}

    def _rebuild(self) -> None:
        prefs = preferences.get_all()
        self.daemons = {}
        if prefs["rotctld_managed"]:
            self.daemons["rotctld"] = InfraDaemon(
                "rotctld", _rotctld_command(prefs), prefs["rotctld_bind_host"], prefs["rotctld_port"]
            )
        if prefs["gpsd_managed"]:
            self.daemons["gpsd"] = InfraDaemon(
                "gpsd", _gpsd_command(prefs), prefs["gpsd_bind_host"], prefs["gpsd_port"]
            )

    async def start(self) -> None:
        self._rebuild()
        for daemon in self.daemons.values():
            try:
                await daemon.start()
            except OSError:
                logger.exception("failed to start %s", daemon.name)

    async def stop(self) -> None:
        for daemon in self.daemons.values():
            await daemon.stop()

    async def reconfigure(self) -> None:
        """Re-reads preferences and restarts affected daemons -- called
        after a settings save that touches rotator/gpsd process config.
        Bounces whatever's currently managed; for rotctld that means paying
        the EasyCommII board's one-time reset-on-open cost, an accepted
        tradeoff of being able to change it live instead of needing a
        restart.
        """
        await self.stop()
        await self.start()

    def status(self) -> dict[str, dict]:
        return {
            name: {"state": daemon.state, "command": daemon.command}
            for name, daemon in self.daemons.items()
        }


def _rotctld_command(prefs: dict) -> list[str]:
    # -m is generic over any Hamlib-supported rotator model (see
    # `rotctld --list`), not just a dummy/EasyCommII pair.
    command = [
        settings.rotctld_bin,
        "-m", str(prefs["rotator_model"]),
        "-T", prefs["rotctld_bind_host"],
        "-t", str(prefs["rotctld_port"]),
    ]
    if prefs["rotator_device"]:
        command += ["-r", prefs["rotator_device"]]
    # Opt-in only -- e.g. the EasyCommII board's ESP32-S3 USB erratum needs
    # timeout=1000,retry=3, but that's specific to that device, not a
    # default every rotator should pay for.
    tuning = []
    if prefs["rotctld_timeout_ms"] is not None:
        tuning.append(f"timeout={prefs['rotctld_timeout_ms']}")
    if prefs["rotctld_retry"] is not None:
        tuning.append(f"retry={prefs['rotctld_retry']}")
    if tuning:
        command += ["-C", ",".join(tuning)]
    return command


def _gpsd_command(prefs: dict) -> list[str]:
    # -N: stay in the foreground -- without it gpsd daemonizes and the
    # child ManagedProcess holds is the forking parent, which exits almost
    # immediately and would read as an instant crash.
    command = [settings.gpsd_bin, "-N"]
    # gpsd only has an all-interfaces on/off switch (-G), not an arbitrary
    # bind address like rotctld's -T -- gpsd_bind_host still drives it,
    # anything other than localhost/127.0.0.1 means "listen everywhere".
    if prefs["gpsd_bind_host"] not in ("localhost", "127.0.0.1"):
        command.append("-G")
    command += ["-S", str(prefs["gpsd_port"])]
    if prefs["gpsd_device"]:
        command.append(prefs["gpsd_device"])
    return command
