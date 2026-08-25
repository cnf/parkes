from typing import Any, Protocol


class DishEspClient(Protocol):
    """The EasyCommII board's own firmware settings, generic across
    namespaces of typed key/value entries -- mirrors DishControll's
    webui component's existing GET/POST /api/config and POST
    /api/config/vector contract exactly (namespace -> entries[] of
    {key, description, format, unit, type, value}), so a real
    implementation of this is a pure pass-through, no translation layer.

    None/False mean "unreachable" -- same convention as SatnogsService/
    WeatherService (parkes/satnogs/service.py, parkes/weather/service.py).
    """

    async def get_config(self) -> list[dict] | None: ...

    async def set_config(self, namespace: str, key: str, type: str, value: Any) -> bool: ...

    async def set_config_vector(
        self, namespace: str, key: str, action: str, item: Any
    ) -> bool: ...
