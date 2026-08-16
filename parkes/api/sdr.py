from fastapi import APIRouter, HTTPException, Request

from parkes.preferences import preferences
from parkes.sdr.discovery import list_devices
from parkes.sdr.server import SoapyRemoteServer

router = APIRouter(prefix="/api/sdr", tags=["sdr"])


def _server(request: Request) -> SoapyRemoteServer:
    return request.app.state.soapy_remote


@router.get("/status")
def status(request: Request):
    prefs = preferences.get_all()
    return {
        "running": _server(request).running,
        "bind_host": prefs["soapy_remote_bind_host"],
        "bind_port": prefs["soapy_remote_bind_port"],
    }


@router.post("/start")
async def start(request: Request):
    server = _server(request)
    if server.running:
        raise HTTPException(409, "SoapyRemote server is already running")
    if request.app.state.orchestrator.running:
        raise HTTPException(
            409, "the pass orchestrator is running -- stop it first, they can't share the SDR"
        )
    prefs = preferences.get_all()
    await server.start(prefs["soapy_remote_bind_host"], prefs["soapy_remote_bind_port"])
    return {"status": "ok"}


@router.post("/stop")
async def stop(request: Request):
    await _server(request).stop()
    return {"status": "ok"}


@router.get("/devices")
def devices():
    return list_devices()
