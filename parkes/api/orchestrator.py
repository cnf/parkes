from fastapi import APIRouter, HTTPException, Request

from parkes.orchestrator import PassOrchestrator
from parkes.sdr.app_profiles import load_profiles, save_profiles
from parkes.standalone_apps import StandaloneAppRunner
from parkes.tracking.tracked_objects import load_tracked_objects, save_tracked_objects

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


def _orchestrator(request: Request) -> PassOrchestrator:
    return request.app.state.orchestrator


def _standalone(request: Request) -> StandaloneAppRunner:
    return request.app.state.standalone_apps


@router.get("/status")
def status(request: Request):
    orch = _orchestrator(request)
    return {"running": orch.running, "status": orch.status, "current_target": orch.current_target}


@router.post("/start")
async def start(request: Request):
    orch = _orchestrator(request)
    if orch.running:
        raise HTTPException(409, "orchestrator is already running")
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


@router.get("/objects")
def get_objects():
    return load_tracked_objects()


@router.put("/objects")
def put_objects(objects: list[dict]):
    save_tracked_objects(objects)
    return {"status": "ok"}


@router.get("/app_profiles")
def get_app_profiles():
    return load_profiles()


@router.put("/app_profiles")
def put_app_profiles(profiles: dict):
    save_profiles(profiles)
    return {"status": "ok"}


@router.get("/standalone/status")
def standalone_status(request: Request):
    return _standalone(request).status()


@router.post("/standalone/{name}/start")
async def standalone_start(name: str, request: Request):
    try:
        await _standalone(request).start(name)
    except KeyError as exc:
        raise HTTPException(404, f"unknown app profile: {name}") from exc
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"status": "ok"}


@router.post("/standalone/{name}/stop")
async def standalone_stop(name: str, request: Request):
    await _standalone(request).stop(name)
    return {"status": "ok"}
