import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from pidish.rotator.rotctld_client import RotctldClient, RotctldError

router = APIRouter(prefix="/api/rotator", tags=["rotator"])


class GotoRequest(BaseModel):
    az: float
    el: float


class MoveRequest(BaseModel):
    direction: Literal["up", "down", "left", "right"]
    speed: int = 50


def _client(request: Request) -> RotctldClient:
    return request.app.state.rotator


@router.get("/position")
async def get_position(request: Request):
    try:
        az, el = await _client(request).get_position()
    except (RotctldError, ConnectionError, OSError) as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"az": az, "el": el}


@router.post("/goto")
async def goto(body: GotoRequest, request: Request):
    try:
        await _client(request).set_position(body.az, body.el)
    except (RotctldError, ConnectionError, OSError) as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"status": "ok"}


@router.post("/move")
async def move(body: MoveRequest, request: Request):
    try:
        await _client(request).move(body.direction, body.speed)
    except (RotctldError, ConnectionError, OSError) as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"status": "ok"}


@router.post("/stop")
async def stop(request: Request):
    try:
        await _client(request).stop()
    except (RotctldError, ConnectionError, OSError) as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"status": "ok"}


@router.post("/park")
async def park(request: Request):
    try:
        await _client(request).park()
    except (RotctldError, ConnectionError, OSError) as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"status": "ok"}


@router.websocket("/ws")
async def position_stream(websocket: WebSocket):
    await websocket.accept()
    client: RotctldClient = websocket.app.state.rotator
    try:
        while True:
            try:
                az, el = await client.get_position()
                await websocket.send_json({"az": az, "el": el})
            except (RotctldError, ConnectionError, OSError) as exc:
                await websocket.send_json({"error": str(exc)})
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
