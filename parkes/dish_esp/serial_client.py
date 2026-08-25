import asyncio

import serial

from parkes.config import settings
from parkes.infra_supervisor import InfraSupervisor
from parkes.preferences import preferences

# Baud is meaningless for this board's native-USB Serial/JTAG peripheral
# (confirmed in earlier project sessions) -- any conventional value works.
_BAUD = 115200

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
    EasyCommII/rotctld already use. Stops/restarts rotctld around each
    exchange the same way FirmwareFlasher does (parkes/rotator/flasher.py)
    -- there's only one physical port, and rotctld normally owns it.

    Metadata (type/unit/format) is cached in-process: it's fixed per
    ConfigEntry and there's no bulk metadata dump, only one CR?<ns>.<key>
    query per key -- caching turns "N+1 round-trips every call" into
    "N+1 once, 1 round-trip after" on a link with multi-second latency.
    Values are never cached, since those are exactly what's changing.
    """

    def __init__(self, infra: InfraSupervisor):
        self._infra = infra
        self._metadata_cache: dict[str, dict] = {}  # "ns.key" -> {"type","unit","format"}
        # Every exchange borrows the one physical port from rotctld --
        # without this, concurrent calls (e.g. the Settings page's
        # config/version/home-status fetches, which fire in parallel)
        # race on stop_daemon/start_daemon and can crash rotctld
        # (confirmed: "RuntimeError: process is already running" from
        # two overlapping restarts). Serializing here is correct anyway,
        # not just a workaround -- it's a single serial port, exchanges
        # were never actually concurrent-safe.
        self._lock = asyncio.Lock()

    def _device(self) -> str | None:
        return preferences.get_all()["rotator_device"]

    async def _exchange(self, sync_fn, *args, default=None):
        if not self._device():
            return default
        async with self._lock:
            await self._infra.stop_daemon("rotctld")
            try:
                return await asyncio.to_thread(sync_fn, *args)
            finally:
                await self._infra.start_daemon("rotctld")

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

    def _get_config_sync(self) -> list[dict] | None:
        device = self._device()
        if not device:
            return None
        try:
            with serial.Serial(device, _BAUD, timeout=settings.dish_esp_serial_timeout_s) as ser:
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
                return [
                    {"namespace": ns, "entries": entries} for ns, entries in namespaces.items()
                ]
        except (serial.SerialException, OSError):
            return None

    def _set_config_sync(self, namespace: str, key: str, value) -> bool:
        device = self._device()
        if not device:
            return False
        try:
            with serial.Serial(device, _BAUD, timeout=settings.dish_esp_serial_timeout_s) as ser:
                prefix = f"CW{namespace}.{key}="
                reply = self._send_and_read(ser, f"{prefix}{value}", terminator=None)
                return bool(reply) and reply[0].startswith(prefix)
        except (serial.SerialException, OSError):
            return False

    def _get_version_sync(self) -> str | None:
        device = self._device()
        if not device:
            return None
        try:
            with serial.Serial(device, _BAUD, timeout=settings.dish_esp_serial_timeout_s) as ser:
                reply = self._send_and_read(ser, "VE", terminator=None)
                if reply and reply[0].startswith("VE"):
                    return reply[0][2:]
                return None
        except (serial.SerialException, OSError):
            return None

    def _send_home_sync(self, command: str) -> bool:
        # HANOW/HENOW (home_azimuth/home_elevation) don't send a reply at
        # all -- so this only confirms the command was written, not that
        # homing completed or even started successfully. No point waiting
        # on readline() for a reply that will never come. Deliberately
        # separate from bare HA/HE (see _get_homed_sync) so a "let's see
        # what this does" query can never itself move the dish.
        device = self._device()
        if not device:
            return False
        try:
            with serial.Serial(device, _BAUD, timeout=settings.dish_esp_serial_timeout_s) as ser:
                ser.reset_input_buffer()
                ser.write((command + "\r").encode())
                ser.flush()
                return True
        except (serial.SerialException, OSError):
            return False

    def _get_homed_sync(self, command: str) -> dict | None:
        # Bare HA/HE report whether that axis is *currently in a known-
        # homed position* (a standing calibration fact) -- distinct from
        # GS's transient "is it actively homing right now" bit. Replies
        # "<command>1"/"<command>0"/"<command>?" -- on "?" the firmware
        # itself doesn't know, and a same-exchange GE follow-up gives the
        # error bitfield (1=Sensor Error, 2=Jam, 4=Homing Error) that may
        # explain why.
        device = self._device()
        if not device:
            return None
        try:
            with serial.Serial(device, _BAUD, timeout=settings.dish_esp_serial_timeout_s) as ser:
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
        except (serial.SerialException, OSError):
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
