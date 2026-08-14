from fastapi import APIRouter, HTTPException, Request

from parkes.orchestrator import PassOrchestrator
from parkes.sdr.app_profiles import load_profiles, save_profiles

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


def _orchestrator(request: Request) -> PassOrchestrator:
    return request.app.state.orchestrator


@router.get("/status")
def status(request: Request):
    orch = _orchestrator(request)
    return {"running": orch.running, "status": orch.status, "current_target": orch.current_target}


@router.post("/start")
async def start(request: Request):
    orch = _orchestrator(request)
    if orch.running:
        raise HTTPException(409, "orchestrator is already running")
    if request.app.state.satdump_process.running:
        raise HTTPException(
            409, "satdump autotrack is running -- stop it first, they can't share the SDR"
        )
    if request.app.state.soapy_remote.running:
        raise HTTPException(
            409, "SoapyRemote server is running -- stop it first, they can't share the SDR"
        )
    if request.app.state.tracking_scheduler.active_target is not None:
        raise HTTPException(
            409, "manual tracking is active -- stop it first, they'd fight over the rotator"
        )
    orch.start()
    return {"status": "ok"}


@router.post("/stop")
async def stop(request: Request):
    await _orchestrator(request).stop()
    return {"status": "ok"}


@router.get("/app_profiles")
def get_app_profiles():
    return load_profiles()


@router.put("/app_profiles")
def put_app_profiles(profiles: dict):
    save_profiles(profiles)
    return {"status": "ok"}
