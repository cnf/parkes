import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from parkes.tracking.fixed_targets import FixedTargetStore
from parkes.tracking.geocode import reverse_geocode
from parkes.tracking.groups import GroupStore
from parkes.tracking.scheduler import TrackingScheduler
from parkes.tracking.sky import SkyTracker
from parkes.tracking.tle import TleCatalog
from parkes.tracking.tle_sources import TleSourceStore

router = APIRouter(prefix="/api/tracking", tags=["tracking"])


class TrackRequest(BaseModel):
    target: str


class CreateGroupRequest(BaseModel):
    name: str


class SetEnabledRequest(BaseModel):
    enabled: bool


class UpdateGroupRequest(BaseModel):
    enabled: bool | None = None
    name: str | None = None


class AddSatelliteRequest(BaseModel):
    norad: int
    name: str


class AddSourceRequest(BaseModel):
    name: str
    url: str


def _sky(request: Request) -> SkyTracker:
    return request.app.state.sky


def _scheduler(request: Request) -> TrackingScheduler:
    return request.app.state.tracking_scheduler


def _tle_catalog(request: Request) -> TleCatalog:
    return request.app.state.tle_catalog


def _groups(request: Request) -> GroupStore:
    return request.app.state.group_store


def _fixed_targets(request: Request) -> FixedTargetStore:
    return request.app.state.fixed_target_store


def _sources(request: Request) -> TleSourceStore:
    return request.app.state.tle_sources


@router.get("/reverse_geocode")
async def reverse_geocode_endpoint(lat: float, lon: float):
    return {"label": await asyncio.to_thread(reverse_geocode, lat, lon)}


@router.get("/targets")
def list_targets(request: Request):
    return _sky(request).list_targets()


@router.get("/passes")
def upcoming_passes(request: Request, min_elevation: float = 0.0):
    return _sky(request).upcoming_passes(min_elevation=min_elevation)


@router.get("/passes/{target_id}/track")
def pass_track(target_id: str, request: Request, min_elevation: float = 0.0, steps: int = 40):
    try:
        track = _sky(request).pass_track(target_id, min_elevation=min_elevation, steps=steps)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, f"unknown target: {target_id}") from exc
    if track is None:
        raise HTTPException(404, f"no pass found for target: {target_id}")
    return track


@router.get("/groundtracks")
def ground_tracks(request: Request):
    return _sky(request).ground_tracks()


@router.get("/status")
def status(request: Request):
    scheduler = _scheduler(request)
    return {"active_target": scheduler.active_target, "last_error": scheduler.last_error}


@router.post("/start")
async def start(body: TrackRequest, request: Request):
    if request.app.state.orchestrator.current_target is not None:
        raise HTTPException(
            409,
            "the pass orchestrator is actively tracking a pass -- stop it first, "
            "they'd fight over the rotator",
        )
    try:
        _scheduler(request).start(body.target)
    except KeyError as exc:
        raise HTTPException(404, f"unknown target: {body.target}") from exc
    return {"status": "ok"}


@router.post("/stop")
async def stop(request: Request):
    _scheduler(request).stop()
    return {"status": "ok"}


@router.get("/satellites/search")
def search_satellites(request: Request, q: str = "", source: str = ""):
    return _tle_catalog(request).list_satellites(query=q, source=source)


@router.get("/satellites/status")
def satellites_status(request: Request):
    catalog = _tle_catalog(request)
    return {"count": catalog.count(), "errors": catalog.source_errors()}


@router.post("/satellites/refresh")
def refresh_satellites(request: Request):
    catalog = _tle_catalog(request)
    count = catalog.refresh()
    return {"count": count, "errors": catalog.source_errors()}


@router.get("/sources")
def list_sources(request: Request):
    return _sources(request).list_sources()


@router.post("/sources")
def add_source(body: AddSourceRequest, request: Request):
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(400, "url must start with http:// or https://")
    try:
        _sources(request).add_source(body.name, body.url)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    _tle_catalog(request).refresh()
    return {"status": "ok"}


@router.delete("/sources/{name}")
def remove_source(name: str, request: Request):
    _sources(request).remove_source(name)
    _tle_catalog(request).refresh()
    return {"status": "ok"}


@router.get("/fixed_targets")
def list_fixed_targets(request: Request):
    return _fixed_targets(request).list_all()


@router.patch("/fixed_targets/{name}")
def set_fixed_target_enabled(name: str, body: SetEnabledRequest, request: Request):
    try:
        _fixed_targets(request).set_enabled(name, body.enabled)
    except KeyError as exc:
        raise HTTPException(404, f"unknown fixed target: {name}") from exc
    return {"status": "ok"}


@router.get("/groups")
def list_groups(request: Request):
    return _groups(request).list_groups()


@router.post("/groups")
def create_group(body: CreateGroupRequest, request: Request):
    _groups(request).create_group(body.name)
    return {"status": "ok"}


@router.delete("/groups/{group_name}")
def delete_group(group_name: str, request: Request):
    _groups(request).delete_group(group_name)
    return {"status": "ok"}


@router.patch("/groups/{group_name}")
def update_group(group_name: str, body: UpdateGroupRequest, request: Request):
    try:
        if body.name is not None and body.name != group_name:
            _groups(request).rename_group(group_name, body.name)
            group_name = body.name
        if body.enabled is not None:
            _groups(request).set_enabled(group_name, body.enabled)
    except KeyError as exc:
        raise HTTPException(404, f"unknown group: {group_name}") from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"status": "ok"}


@router.post("/groups/{group_name}/satellites")
def add_satellite(group_name: str, body: AddSatelliteRequest, request: Request):
    try:
        _groups(request).add_satellite(group_name, body.norad, body.name)
    except KeyError as exc:
        raise HTTPException(404, f"unknown group: {group_name}") from exc
    return {"status": "ok"}


@router.delete("/groups/{group_name}/satellites/{norad}")
def remove_satellite(group_name: str, norad: int, request: Request):
    try:
        _groups(request).remove_satellite(group_name, norad)
    except KeyError as exc:
        raise HTTPException(404, f"unknown group: {group_name}") from exc
    return {"status": "ok"}
