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
    observer_location_mode: Literal["default", "manual"] | None = None
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


@router.get("")
def get_settings():
    return {
        "preferences": preferences.get_all(),
        "infra": {
            "rotctld_host": settings.rotctld_host,
            "rotctld_port": settings.rotctld_port,
            "satdump_output_dir": settings.satdump_output_dir,
            "tle_data_dir": settings.tle_data_dir,
            "skyfield_data_dir": settings.skyfield_data_dir,
        },
    }


@router.put("")
async def update_settings(body: UpdateSettingsRequest, request: Request):
    updated = preferences.update(body.model_dump(exclude_unset=True))
    if body.soapy_remote_auto is not None:
        # Toggling this on should take effect right away if the SDR is
        # currently idle, not wait for the next acquire()/release() cycle.
        # A no-op if it was turned off, or if something already has it.
        await request.app.state.sdr_arbiter.ensure_idle_state()
    return updated
