import shlex
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from parkes.orchestrator import PassOrchestrator, find_overlaps
from parkes.preferences import preferences
from parkes.sdr.app_profiles import delete_profile, load_profiles, put_profile
from parkes.sdr.satdump_pipelines import list_live_pipelines
from parkes.standalone_apps import StandaloneAppRunner
from parkes.tracking.sky import SkyTracker
from parkes.tracking.tracked_objects import (
    delete_tracked_object,
    load_tracked_objects,
    move_tracked_object,
    put_tracked_object,
)

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


class DownlinkRequest(BaseModel):
    frequency: float
    app: str | None = None


class MoveObjectRequest(BaseModel):
    direction: Literal["up", "down"]


class UpsertTrackedObjectRequest(BaseModel):
    name: str
    enabled: bool = True
    downlinks: list[DownlinkRequest] = []


class UpsertProfileRequest(BaseModel):
    name: str
    mode: Literal["pass", "standalone"] = "pass"
    uses_sdr: bool = True
    command: list[str]
    schedule_seconds: float | None = None


def _orchestrator(request: Request) -> PassOrchestrator:
    return request.app.state.orchestrator


def _standalone(request: Request) -> StandaloneAppRunner:
    return request.app.state.standalone_apps


def _sky(request: Request) -> SkyTracker:
    return request.app.state.sky


@router.get("/status")
def status(request: Request):
    orch = _orchestrator(request)
    target_name = _sky(request).display_name(orch.current_target) if orch.current_target else None
    return {
        "running": orch.running,
        "status": orch.status,
        "current_target": orch.current_target,
        "current_target_name": target_name,
        "current_profile": orch.current_profile,
        "current_continuous": orch.current_continuous,
        "current_command": shlex.join(orch.current_command) if orch.current_command else None,
        "current_app_error": orch.current_app_error,
    }


@router.post("/start")
async def start(request: Request):
    orch = _orchestrator(request)
    if orch.running:
        raise HTTPException(409, "orchestrator is already running")
    # With soapy_remote_auto on, SdrArbiter releases SoapyRemote itself
    # right before a pass actually needs the SDR -- the orchestrator loop
    # merely running isn't a conflict in that mode.
    if request.app.state.soapy_remote.running and not preferences.get("soapy_remote_auto"):
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


@router.put("/objects/{norad}")
def put_object(norad: int, body: UpsertTrackedObjectRequest):
    put_tracked_object(
        norad,
        {
            "norad": norad,
            "name": body.name,
            "enabled": body.enabled,
            "downlinks": [d.model_dump() for d in body.downlinks],
        },
    )
    return {"status": "ok"}


@router.delete("/objects/{norad}")
def delete_object(norad: int):
    delete_tracked_object(norad)
    return {"status": "ok"}


@router.post("/objects/{norad}/move")
def move_object(norad: int, body: MoveObjectRequest):
    move_tracked_object(norad, body.direction)
    return {"status": "ok"}


@router.get("/overlaps")
def get_overlaps(request: Request):
    return find_overlaps(_sky(request))


@router.get("/app_profiles")
def get_app_profiles():
    return load_profiles()


@router.get("/satdump_pipelines")
def get_satdump_pipelines():
    return list_live_pipelines()


@router.put("/app_profiles/{profile_id}")
def put_app_profile(profile_id: str, body: UpsertProfileRequest):
    profile = {
        "name": body.name,
        "mode": body.mode,
        "uses_sdr": body.uses_sdr,
        "command": body.command,
    }
    if body.schedule_seconds:
        profile["schedule_seconds"] = body.schedule_seconds
    put_profile(profile_id, profile)
    return {"status": "ok"}


@router.delete("/app_profiles/{profile_id}")
def delete_app_profile(profile_id: str):
    delete_profile(profile_id)
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
