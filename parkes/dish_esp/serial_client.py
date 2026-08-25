import asyncio

import serial

from parkes.config import settings
from parkes.infra_supervisor import InfraSupervisor
from parkes.preferences import preferences

# Baud is meaningless for this board's native-USB Serial/JTAG peripheral
# (confirmed in earlier project sessions) -- any conventional value works.
_BAUD = 115200

# How long to keep the port open (and rotctld paused) after the last
# exchange before handing it back -- see _release_after_idle.
_IDLE_RELEASE_S = 30.0

# CR<ns>.<key> -> "kInt"/"kDouble"/... (easycomm.cpp's ConfigValueTypeToString)
# normalized to what the Settings page's dish-esp-settings.js already
# compares against (type.toLowerCase() === "int"/"double"/"bool"/"vector").
_WIRE_TYPE_MAP = {
    "kInt": "int",
    "kDouble": "double",
    "kBool": "bool",
    "kString": "string",
    "kVector": "vector",
    "kBytes": "bytes",
}


def _coerce_value(type_: str, raw: str):
    """Wire text -> a real Python value, matching what the HTTP /api/config
    path would have returned as JSON (dish-esp-settings.js was built
    against that contract, e.g. `Boolean(entry.value)` for checkboxes --
    a raw "0" string would render as checked otherwise).
    """
    if type_ == "bool":
        return raw not in ("0", "", "false", "off")
    if type_ == "int":
        try:
            return int(raw)
        except ValueError:
            return raw
    if type_ == "double":
        try:
            return float(raw)
        except ValueError:
            return raw
    if type_ == "vector":
        return raw.split(",") if raw else []
    return raw


class SerialDishEspClient:
    """Talks the firmware's EasyComm-extension commands (CR/CW config,
    VE version, HA/HE/HANOW/HENOW homing -- components/EasyComm/
    easycomm.cpp in DishControll) directly over the same USB-serial link
    EasyCommII/rotctld already use.

    Holds one persistent connection across exchanges rather than opening
    a fresh one each time: opening this board's port resets the ESP32-S3.
    Confirmed by stracing a real rotctld against a test port: its
    EasyCommII backend unconditionally calls ioctl(TIOCMBIC, DTR) and
    ioctl(TIOCMBIC, RTS) right after open() -- present even with
    `-C dtr_state=OFF,rts_state=OFF` set, so it's not something a Hamlib
    config token can suppress. This board's native-USB Serial/JTAG
    peripheral treats that DTR/RTS control-line change as a soft-reset
    trigger (the same convention esptool's `--before default_reset` uses
    over native USB -- a ROM/silicon feature of this USB peripheral, not
    contingent on any physical DTR/RTS-to-EN wiring, which revB doesn't
    have). So every rotctld (re)connection resets the board, full stop --
    reopening/restarting around every single call, as an earlier version
    of this client did, sandwiched every exchange between two resets,
    silently wiping any firmware-side state that doesn't survive reboot.

    Holding one connection open and only handing rotctld back after
    _IDLE_RELEASE_S of inactivity reduces resets to one per burst of use
    instead of one per call -- but it does NOT make transient
    firmware-side state (e.g. homed-status, if it's tracked as steps
    counted since a reference point rather than read fresh off a
    physical sensor) safe to trust once rotctld reconnects and tracking
    resumes. That reset is unavoidable -- there's no timing/sequencing
    fix for it -- so a value like "homed" is only ever reliable within
    the same connection that established it, never as a standing fact
    Parkes can keep showing afterward.

    Metadata (type/unit/format) is cached in-process: it's fixed per
    ConfigEntry and there's no bulk metadata dump, only one CR?<ns>.<key>
    query per key -- caching turns "N+1 round-trips every call" into
    "N+1 once, 1 round-trip after" on a link with multi-second latency.
    Values are never cached, since those are exactly what's changing.
    """

    def __init__(self, infra: InfraSupervisor):
        self._infra = infra
        self._metadata_cache: dict[str, dict] = {}  # "ns.key" -> {"type","unit","format"}
        # Guards _ser/_release_task -- also fixes a real bug found in
        # testing: concurrent calls (the Settings page's config/version/
        # home-status fetches, which fire in parallel) raced on
        # stop_daemon/start_daemon and crashed rotctld ("RuntimeError:
        # process is already running"). Correct regardless of that,
        # since there's only one physical port.
        self._lock = asyncio.Lock()
        self._ser: serial.Serial | None = None
        self._release_task: asyncio.Task | None = None

    def _device(self) -> str | None:
        return preferences.get_all()["rotator_device"]

    def _open_locked(self) -> serial.Serial | None:
        # Call only with self._lock held. Reuses the existing connection
        # if it's still open and pointed at the currently-configured
        # device; otherwise (re)opens -- see the class docstring for why
        # minimizing opens matters here.
        device = self._device()
        if not device:
            return None
        if self._ser is not None:
            if self._ser.port == device and self._ser.is_open:
                return self._ser
            self._close_locked()
        try:
            self._ser = serial.Serial(device, _BAUD, timeout=settings.dish_esp_serial_timeout_s)
            return self._ser
        except (serial.SerialException, OSError):
            self._ser = None
            return None

    def _close_locked(self) -> None:
        if self._ser is not None:
            try:
                self._ser.close()
            except (serial.SerialException, OSError):
                pass
            self._ser = None

    def _run_locked(self, sync_fn, args, default):
        # Runs in a worker thread (via asyncio.to_thread) while the
        # caller holds self._lock for the whole exchange, so mutating
        # self._ser here is safe -- no other call can be in this method
        # at the same time.
        ser = self._open_locked()
        if ser is None:
            return default
        try:
            return sync_fn(ser, *args)
        except (serial.SerialException, OSError):
            self._close_locked()
            return default

    async def _release_after_idle(self) -> None:
        try:
            await asyncio.sleep(_IDLE_RELEASE_S)
        except asyncio.CancelledError:
            return
        async with self._lock:
            self._close_locked()
            await self._infra.start_daemon("rotctld")
            self._release_task = None

    async def _exchange(self, sync_fn, *args, default=None):
        if not self._device():
            return default
        async with self._lock:
            if self._release_task is not None:
                self._release_task.cancel()
                self._release_task = None
            if self._ser is None:
                await self._infra.stop_daemon("rotctld")
            try:
                result = await asyncio.to_thread(self._run_locked, sync_fn, args, default)
            except Exception:
                self._close_locked()
                await self._infra.start_daemon("rotctld")
                raise
            self._release_task = asyncio.create_task(self._release_after_idle())
            return result

    def _send_and_read(self, ser: serial.Serial, command: str, terminator: str | None) -> list[str]:
        ser.reset_input_buffer()
        ser.write((command + "\r").encode())
        ser.flush()
        lines = []
        while True:
            raw = ser.readline()
            if not raw:
                break  # timed out
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            lines.append(line)
            if terminator is None or line == terminator:
                break
        return lines

    def _fetch_metadata(self, ser: serial.Serial, namespace: str, key: str) -> dict:
        cache_key = f"{namespace}.{key}"
        cached = self._metadata_cache.get(cache_key)
        if cached is not None:
            return cached
        reply = self._send_and_read(ser, f"CR?{namespace}.{key}", terminator=None)
        meta = {"type": "string", "unit": "", "format": ""}
        for line in reply:
            if not line.startswith("CR?"):
                continue
            parts = line[3:].split(",", 3)
            if len(parts) == 4:
                _key, wire_type, unit, fmt = parts
                type_ = _WIRE_TYPE_MAP.get(wire_type, "string")
                meta = {"type": type_, "unit": unit, "format": fmt}
            break
        self._metadata_cache[cache_key] = meta
        return meta

    def _get_config_sync(self, ser: serial.Serial) -> list[dict]:
        value_lines = self._send_and_read(ser, "CR*", terminator="CREND")
        namespaces: dict[str, list[dict]] = {}
        for line in value_lines:
            if line == "CREND" or not line.startswith("CR") or "=" not in line:
                continue
            ns_key, value = line[2:].split("=", 1)
            if "." not in ns_key:
                continue
            namespace, key = ns_key.split(".", 1)
            meta = self._fetch_metadata(ser, namespace, key)
            namespaces.setdefault(namespace, []).append({
                "key": key,
                "description": key,  # not available over this transport
                "value": _coerce_value(meta["type"], value),
                **meta,
            })
        return [{"namespace": ns, "entries": entries} for ns, entries in namespaces.items()]

    def _set_config_sync(self, ser: serial.Serial, namespace: str, key: str, value) -> bool:
        prefix = f"CW{namespace}.{key}="
        reply = self._send_and_read(ser, f"{prefix}{value}", terminator=None)
        return bool(reply) and reply[0].startswith(prefix)

    def _get_version_sync(self, ser: serial.Serial) -> str | None:
        reply = self._send_and_read(ser, "VE", terminator=None)
        if reply and reply[0].startswith("VE"):
            return reply[0][2:]
        return None

    def _send_home_sync(self, ser: serial.Serial, command: str) -> bool:
        # HANOW/HENOW (home_azimuth/home_elevation) don't send a reply at
        # all -- so this only confirms the command was written, not that
        # homing completed or even started successfully. No point waiting
        # on readline() for a reply that will never come. Deliberately
        # separate from bare HA/HE (see _get_homed_sync) so a "let's see
        # what this does" query can never itself move the dish.
        ser.reset_input_buffer()
        ser.write((command + "\r").encode())
        ser.flush()
        return True

    def _get_homed_sync(self, ser: serial.Serial, command: str) -> dict | None:
        # Bare HA/HE report whether that axis is *currently in a known-
        # homed position* (a standing calibration fact) -- distinct from
        # GS's transient "is it actively homing right now" bit. Replies
        # "<command>1"/"<command>0"/"<command>?" -- on "?" the firmware
        # itself doesn't know, and a same-exchange GE follow-up gives the
        # error bitfield (1=Sensor Error, 2=Jam, 4=Homing Error) that may
        # explain why.
        reply = self._send_and_read(ser, command, terminator=None)
        if not reply or not reply[0].startswith(command):
            return None
        value = reply[0][len(command):]
        if value == "1":
            return {"homed": True, "error": None}
        if value == "0":
            return {"homed": False, "error": None}
        if value == "?":
            error_reply = self._send_and_read(ser, "GE", terminator=None)
            error = None
            if error_reply and error_reply[0].startswith("GE"):
                try:
                    error = int(error_reply[0][2:])
                except ValueError:
                    error = None
            return {"homed": None, "error": error}
        return None

    async def get_config(self) -> list[dict] | None:
        return await self._exchange(self._get_config_sync)

    async def set_config(self, namespace: str, key: str, type: str, value) -> bool:
        return await self._exchange(self._set_config_sync, namespace, key, value, default=False)

    async def set_config_vector(self, namespace: str, key: str, action: str, item) -> bool:
        # The firmware itself rejects vector writes over EasyComm today
        # (CWERR5) -- nothing to attempt.
        return False

    async def get_version(self) -> str | None:
        return await self._exchange(self._get_version_sync)

    async def home_azimuth(self) -> bool:
        return await self._exchange(self._send_home_sync, "HANOW", default=False)

    async def home_elevation(self) -> bool:
        return await self._exchange(self._send_home_sync, "HENOW", default=False)

    async def get_homed_azimuth(self) -> dict | None:
        return await self._exchange(self._get_homed_sync, "HA")

    async def get_homed_elevation(self) -> dict | None:
        return await self._exchange(self._get_homed_sync, "HE")

    async def close(self) -> None:
        """Releases the port and hands rotctld back, if currently held --
        called on app shutdown so a mid-idle-window hold doesn't leave
        rotctld paused after Parkes exits.
        """
        async with self._lock:
            if self._release_task is not None:
                self._release_task.cancel()
                self._release_task = None
            if self._ser is not None:
                self._close_locked()
                await self._infra.start_daemon("rotctld")
