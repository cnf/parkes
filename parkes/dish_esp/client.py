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


class UnconfiguredDishEspClient:
    """What app.state.dish_esp is today -- no transport has been chosen
    yet. Wi-Fi (either the Pi joining the ESP's AP, or implementing the
    ESP's currently-unimplemented STA mode) was ruled out to avoid an
    always-on 2.4GHz emitter next to the SDR front end; multiplexing a
    config protocol over the existing USB-serial link (time-shared with
    EasyComm, the same way the firmware flasher borrows the port from
    rotctld) is the leading candidate, but doesn't exist in DishControll
    yet. Always reports "unreachable" so the Settings page's ESP32
    Settings card has something real to wire against -- swap this
    instance in main.py for a real DishEspClient implementation once a
    transport exists; no API/UI changes needed.
    """

    async def get_config(self) -> list[dict] | None:
        return None

    async def set_config(self, namespace: str, key: str, type: str, value: Any) -> bool:
        return False

    async def set_config_vector(self, namespace: str, key: str, action: str, item: Any) -> bool:
        return False
