import asyncio
import re

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


class AutotrackProcess:
    """Manages a single `satdump autotrack <config>` subprocess.

    satdump's CLI autotrack mode owns the entire satellite pass pipeline
    internally (scheduling, tracking, capture, decode) -- this only starts,
    stops, and tails its log output.
    """

    def __init__(self):
        self._process: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task | None = None
        self.log_lines: list[str] = []

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def start(self, config_path: str) -> None:
        if self.running:
            raise RuntimeError("satdump autotrack is already running")
        self.log_lines = []
        self._process = await asyncio.create_subprocess_exec(
            "satdump",
            "autotrack",
            config_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        self._reader_task = asyncio.create_task(self._read_output())

    async def _read_output(self) -> None:
        assert self._process is not None and self._process.stdout is not None
        async for raw_line in self._process.stdout:
            line = _ANSI_RE.sub("", raw_line.decode(errors="replace")).rstrip()
            self.log_lines.append(line)

    async def stop(self) -> None:
        if self._process is None:
            return
        if self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()
        if self._reader_task is not None:
            await self._reader_task
        self._process = None
        self._reader_task = None
