import asyncio

_MOVE_DIRECTIONS = {"up": 2, "down": 4, "left": 8, "right": 16}


class RotctldError(RuntimeError):
    pass


class RotctldClient:
    """Thin async client for Hamlib's rotctld network protocol.

    Wire format verified against a live rotctld (dummy and EasycommII
    backends): `p` (get_pos) replies with two bare lines (az, el) and no
    RPRT terminator; every other command replies with a single `RPRT n`
    line, n=0 on success.
    """

    def __init__(self, host: str, port: int):
        self._host = host
        self._port = port
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._lock = asyncio.Lock()

    async def _ensure_connected(self) -> None:
        if self._writer is None or self._writer.is_closing():
            self._reader, self._writer = await asyncio.open_connection(
                self._host, self._port
            )

    def reconfigure(self, host: str, port: int) -> None:
        """Points this client at a different rotctld -- e.g. after a
        Settings page save changes rotctld_host/port. Just drops the
        current connection; _ensure_connected() reconnects lazily on the
        next command, same as it does after any other disconnect."""
        if (host, port) == (self._host, self._port):
            return
        self._host, self._port = host, port
        if self._writer is not None:
            self._writer.close()
        self._reader = None
        self._writer = None

    async def _send(self, command: str) -> None:
        await self._ensure_connected()
        self._writer.write(f"{command}\n".encode())
        await self._writer.drain()

    async def _read_line(self) -> str:
        line = await self._reader.readline()
        if not line:
            raise ConnectionError("rotctld closed the connection")
        return line.decode().strip()

    async def _expect_rprt(self) -> None:
        line = await self._read_line()
        code = int(line.split()[1])
        if code != 0:
            raise RotctldError(f"rotctld returned error {code}")

    async def get_position(self) -> tuple[float, float]:
        async with self._lock:
            await self._send("p")
            az = float(await self._read_line())
            el = float(await self._read_line())
            return az, el

    async def set_position(self, az: float, el: float) -> None:
        async with self._lock:
            await self._send(f"P {az:.2f} {el:.2f}")
            await self._expect_rprt()

    async def move(self, direction: str, speed: int = 50) -> None:
        code = _MOVE_DIRECTIONS[direction]
        async with self._lock:
            await self._send(f"M {code} {speed}")
            await self._expect_rprt()

    async def stop(self) -> None:
        async with self._lock:
            await self._send("S")
            await self._expect_rprt()

    async def park(self) -> None:
        async with self._lock:
            await self._send("K")
            await self._expect_rprt()

    async def close(self) -> None:
        if self._writer is not None:
            self._writer.close()
            await self._writer.wait_closed()
