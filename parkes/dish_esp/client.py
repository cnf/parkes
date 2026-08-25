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
    sent, not that homing completed -- the firmware doesn't report
    homing status yet.
    """

    async def get_config(self) -> list[dict] | None: ...

    async def set_config(self, namespace: str, key: str, type: str, value: Any) -> bool: ...

    async def set_config_vector(
        self, namespace: str, key: str, action: str, item: Any
    ) -> bool: ...

    async def get_version(self) -> str | None: ...

    async def home_azimuth(self) -> bool: ...

    async def home_elevation(self) -> bool: ...
