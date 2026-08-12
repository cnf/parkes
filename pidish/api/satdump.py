import asyncio

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from pidish.satdump.autotrack_config import load_tracked_objects, save_tracked_objects, write_config
from pidish.satdump.process import AutotrackProcess

router = APIRouter(prefix="/api/satdump", tags=["satdump"])


def _process(request: Request) -> AutotrackProcess:
    return request.app.state.satdump_process


@router.get("/objects")
def get_objects():
    return load_tracked_objects()


@router.put("/objects")
def put_objects(objects: list[dict]):
    save_tracked_objects(objects)
    return {"status": "ok"}


@router.get("/status")
def status(request: Request):
    return {"running": _process(request).running}


@router.post("/start")
async def start(request: Request):
    proc = _process(request)
    if proc.running:
        raise HTTPException(409, "satdump autotrack is already running")
    config_path = write_config(load_tracked_objects())
    await proc.start(config_path)
    return {"status": "ok"}


@router.post("/stop")
async def stop(request: Request):
    await _process(request).stop()
    return {"status": "ok"}


@router.websocket("/ws")
async def log_stream(websocket: WebSocket):
    await websocket.accept()
    proc: AutotrackProcess = websocket.app.state.satdump_process
    sent = 0
    try:
        while True:
            lines = proc.log_lines
            if sent < len(lines):
                for line in lines[sent:]:
                    await websocket.send_json({"line": line})
                sent = len(lines)
            await websocket.send_json({"running": proc.running})
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
