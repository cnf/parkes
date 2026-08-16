from fastapi import APIRouter
from pydantic import BaseModel

from parkes.config import settings
from parkes.preferences import preferences

router = APIRouter(prefix="/api/settings", tags=["settings"])


class UpdateSettingsRequest(BaseModel):
    observer_lat: float | None = None
    observer_lon: float | None = None
    observer_elevation_m: float | None = None
    tracking_interval_seconds: float | None = None
    satdump_sdr_source: str | None = None
    satdump_sdr_source_id: str | None = None
    satdump_samplerate: int | None = None
    orchestrator_min_elevation: float | None = None
    soapy_remote_bind_host: str | None = None
    soapy_remote_bind_port: int | None = None


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
def update_settings(body: UpdateSettingsRequest):
    return preferences.update(body.model_dump(exclude_unset=True))
