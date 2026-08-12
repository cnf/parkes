from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from pidish.tracking.scheduler import TrackingScheduler
from pidish.tracking.sky import SkyTracker

router = APIRouter(prefix="/api/tracking", tags=["tracking"])


class TrackRequest(BaseModel):
    target: str


def _sky(request: Request) -> SkyTracker:
    return request.app.state.sky


def _scheduler(request: Request) -> TrackingScheduler:
    return request.app.state.tracking_scheduler


@router.get("/targets")
def list_targets(request: Request):
    return _sky(request).list_targets()


@router.get("/status")
def status(request: Request):
    scheduler = _scheduler(request)
    return {"active_target": scheduler.active_target, "last_error": scheduler.last_error}


@router.post("/start")
async def start(body: TrackRequest, request: Request):
    try:
        _scheduler(request).start(body.target)
    except KeyError as exc:
        raise HTTPException(404, f"unknown target: {body.target}") from exc
    return {"status": "ok"}


@router.post("/stop")
async def stop(request: Request):
    _scheduler(request).stop()
    return {"status": "ok"}
