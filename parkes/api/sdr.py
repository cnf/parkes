import socket

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from parkes.preferences import preferences
from parkes.sdr.arbiter import SdrArbiter
from parkes.sdr.devices import list_devices_with_labels, set_label
from parkes.sdr.server import SoapyRemoteServer

router = APIRouter(prefix="/api/sdr", tags=["sdr"])


def _server(request: Request) -> SoapyRemoteServer:
    return request.app.state.soapy_remote


def _arbiter(request: Request) -> SdrArbiter:
    return request.app.state.sdr_arbiter


@router.get("/status")
def status(request: Request):
    prefs = preferences.get_all()
    server = _server(request)
    return {
        "running": server.running,
        "bind_host": prefs["soapy_remote_bind_host"],
        "bind_port": prefs["soapy_remote_bind_port"],
        "auto": prefs["soapy_remote_auto"],
        "connections": server.connections(),
        "claimed_by_local_apps": _arbiter(request).active,
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
    prefs = preferences.get_all()
    bind_host = prefs["soapy_remote_bind_host"]
    # 0.0.0.0/:: (bind-all) isn't itself dialable from another machine --
    # substitute this host's own name, which is what a remote client would
    # actually need to type.
    display_host = bind_host if bind_host not in ("0.0.0.0", "::") else socket.gethostname()
    bind_port = prefs["soapy_remote_bind_port"]

    result = []
    for device in list_devices_with_labels():
        if "error" in device:
            result.append(device)
            continue
        serial = device.get("serial")
        local_args = [f"driver={device['driver']}"]
        remote_args = [
            "driver=remote",
            f"remote={display_host}:{bind_port}",
            f"remote:driver={device['driver']}",
        ]
        if serial:
            local_args.append(f"serial={serial}")
            remote_args.append(f"remote:serial={serial}")
        result.append(
            {
                **device,
                "connect_local": ",".join(local_args),
                "connect_remote": ",".join(remote_args),
            }
        )
    return result


class SetDeviceLabelRequest(BaseModel):
    label: str


@router.put("/devices/{device_id}/label")
def set_device_label(device_id: str, body: SetDeviceLabelRequest):
    set_label(device_id, body.label)
    return {"status": "ok"}
