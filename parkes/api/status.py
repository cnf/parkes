from fastapi import APIRouter, Request

from parkes.rotator.rotctld_client import RotctldError

router = APIRouter(prefix="/api/status", tags=["status"])


@router.get("")
async def get_status(request: Request):
    """Cheap, site-wide reachability summary for the header's rotator/GPS
    icons -- deliberately independent of whether either is "managed" by
    InfraSupervisor, since an unmanaged rotctld/gpsd someone else started
    is just as reachable (or not) as a managed one. rotctld has no cached
    "am I connected" flag to read, so this is a live probe, same as
    api/rotator.py's own position endpoint; gpsd's freshness is already
    tracked in the background by GpsdClient, so that's a free read.
    """
    try:
        await request.app.state.rotator.get_position()
        rotctld_ok = True
    except (RotctldError, ConnectionError, OSError):
        rotctld_ok = False
    return {"rotctld": rotctld_ok, "gpsd": request.app.state.gpsd.has_fresh_fix}
