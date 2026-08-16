import asyncio
import contextlib
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from parkes.rotator.rotctld_client import RotctldClient, RotctldError

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

    async def send_loop() -> None:
        while True:
            try:
                az, el = await client.get_position()
                await websocket.send_json({"az": az, "el": el})
            except (RotctldError, ConnectionError, OSError) as exc:
                await websocket.send_json({"error": str(exc)})
            await asyncio.sleep(1)

    # The client never sends anything on this socket -- receive() is used
    # purely to detect disconnection. A pure send loop can't rely on this:
    # a write into an already-dead connection can silently no-op instead
    # of raising, so send_loop() alone would spin forever logging
    # "socket.send() raised exception." from asyncio instead of exiting.
    send_task = asyncio.create_task(send_loop())
    try:
        await websocket.receive()
    except WebSocketDisconnect:
        pass
    finally:
        send_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await send_task
