from typing import Any, Protocol


class DishEspClient(Protocol):
    """Direct access to the EasyCommII board's own firmware -- settings
    (generic across namespaces of typed key/value entries, mirroring
    DishControll's webui component's GET/POST /api/config and POST
    /api/config/vector contract exactly: namespace -> entries[] of
    {key, description, format, unit, type, value}, so a real
    implementation of get/set_config is a pure pass-through, no
    translation layer), plus a few standalone board actions/queries
    (firmware version, homing) that aren't really "settings" but live
    here since they go over the same link.

    None/False mean "unreachable" -- same convention as SatnogsService/
    WeatherService (parkes/satnogs/service.py, parkes/weather/service.py).
    home_azimuth()/home_elevation() returning True means the command was
    sent (HANOW/HENOW), not that homing completed -- the firmware
    deliberately keeps the bare HA/HE query (see get_homed_*) separate
    from triggering, so a curious "let's see what this does" query can
    never itself move the dish.

    get_homed_azimuth()/get_homed_elevation() report whether that axis
    is *currently in a known-homed position* (a standing calibration
    fact, from bare HA/HE) -- not whether it's *actively homing right
    now* (a transient busy state, part of GS's status bitfield). Returns
    {"homed": True/False/None, "error": int | None} -- None for "homed"
    means the firmware itself doesn't know yet (wire reply "HA?"/"HE?"),
    in which case "error" is GE's bitfield (1=Sensor Error, 2=Jam,
    4=Homing Error), fetched as a same-exchange follow-up.
    """

    async def get_config(self) -> list[dict] | None: ...

    async def set_config(self, namespace: str, key: str, type: str, value: Any) -> bool: ...

    async def set_config_vector(
        self, namespace: str, key: str, action: str, item: Any
    ) -> bool: ...

    async def get_version(self) -> str | None: ...

    async def home_azimuth(self) -> bool: ...

    async def home_elevation(self) -> bool: ...

    async def get_homed_azimuth(self) -> dict | None: ...

    async def get_homed_elevation(self) -> dict | None: ...
