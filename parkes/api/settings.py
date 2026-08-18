from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from parkes.config import settings
from parkes.preferences import preferences

router = APIRouter(prefix="/api/settings", tags=["settings"])


class UpdateSettingsRequest(BaseModel):
    observer_lat: float | None = None
    observer_lon: float | None = None
    observer_elevation_m: float | None = None
    observer_location_mode: Literal["default", "manual", "gpsd"] | None = None
    observer_manual_lat: float | None = None
    observer_manual_lon: float | None = None
    observer_manual_elevation_m: float | None = None
    tracking_interval_seconds: float | None = None
    satdump_sdr_source: str | None = None
    satdump_sdr_source_id: str | None = None
    satdump_samplerate: int | None = None
    orchestrator_min_elevation: float | None = None
    soapy_remote_bind_host: str | None = None
    soapy_remote_bind_port: int | None = None
    soapy_remote_auto: bool | None = None
    rotctld_host: str | None = None
    rotctld_port: int | None = None
    rotctld_bind_host: str | None = None
    rotctld_managed: bool | None = None
    rotator_model: int | None = None
    rotator_device: str | None = None
    rotctld_timeout_ms: int | None = None
    rotctld_retry: int | None = None
    gpsd_host: str | None = None
    gpsd_port: int | None = None
    gpsd_bind_host: str | None = None
    gpsd_managed: bool | None = None
    gpsd_device: str | None = None


# Fields that InfraSupervisor's daemons are built from -- a save touching
# any of these needs to restart the affected daemon(s) to take effect, same
# as toggling soapy_remote_auto acts on SdrArbiter right away below.
_INFRA_FIELDS = {
    "rotctld_bind_host", "rotctld_port", "rotctld_managed", "rotator_model", "rotator_device",
    "rotctld_timeout_ms", "rotctld_retry",
    "gpsd_bind_host", "gpsd_port", "gpsd_managed", "gpsd_device",
}
# Only the *connect* address matters to the clients Parkes itself uses --
# rotctld_bind_host/gpsd_bind_host affect only the managed daemon (handled
# above via _INFRA_FIELDS) and never what RotctldClient/GpsdClient dial.
_ROTCTLD_ADDR_FIELDS = {"rotctld_host", "rotctld_port"}
_GPSD_ADDR_FIELDS = {"gpsd_host", "gpsd_port"}


@router.get("")
def get_settings(request: Request):
    gpsd = request.app.state.gpsd
    lat, lon, elevation, source = request.app.state.sky.current_location()
    return {
        "preferences": preferences.get_all(),
        "infra": {
            "rotctld_bin": settings.rotctld_bin,
            "gpsd_bin": settings.gpsd_bin,
            "satdump_output_dir": settings.satdump_output_dir,
            "tle_data_dir": settings.tle_data_dir,
            "skyfield_data_dir": settings.skyfield_data_dir,
        },
        # Live state of whatever InfraSupervisor currently owns (or found
        # already running externally) -- e.g. {"rotctld": {"state":
        # "running", ...}}. Empty for anything with its "managed" preference
        # off.
        "infra_status": request.app.state.infra.status(),
        # What's actually in effect right now, regardless of mode -- lets
        # the location modal show gpsd's live fix (or lack of one) without
        # duplicating GpsdClient's staleness logic client-side.
        "effective_location": {"lat": lat, "lon": lon, "elevation_m": elevation, "source": source},
        "gpsd_status": {
            "has_fresh_fix": gpsd.has_fresh_fix,
            "lat": gpsd.lat,
            "lon": gpsd.lon,
            "altitude_m": gpsd.altitude_m,
            "last_error": gpsd.last_error,
        },
    }


@router.put("")
async def update_settings(body: UpdateSettingsRequest, request: Request):
    changed = body.model_dump(exclude_unset=True)
    updated = preferences.update(changed)
    if body.soapy_remote_auto is not None:
        # Toggling this on should take effect right away if the SDR is
        # currently idle, not wait for the next acquire()/release() cycle.
        # A no-op if it was turned off, or if something already has it.
        await request.app.state.sdr_arbiter.ensure_idle_state()
    if _INFRA_FIELDS & changed.keys():
        await request.app.state.infra.reconfigure()
    if _ROTCTLD_ADDR_FIELDS & changed.keys():
        request.app.state.rotator.reconfigure(updated["rotctld_host"], updated["rotctld_port"])
    if _GPSD_ADDR_FIELDS & changed.keys():
        await request.app.state.gpsd.reconfigure(updated["gpsd_host"], updated["gpsd_port"])
    return updated
