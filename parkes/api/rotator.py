import asyncio
import contextlib
import time
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

    # Polls rotctld frequently (fast enough for smooth client-side
    # animation during a slew), but only actually pushes to the browser
    # when the position moved by more than sensor noise, or often enough
    # anyway (IDLE_HEARTBEAT_SECONDS) that a stationary dish doesn't look
    # like a stale/dead connection. Keeps the idle case cheap while still
    # catching motion within one poll interval instead of once a second.
    POLL_INTERVAL_SECONDS = 0.2
    IDLE_HEARTBEAT_SECONDS = 5.0
    POSITION_TOLERANCE_DEG = 0.1

    async def send_loop() -> None:
        last_sent_az: float | None = None
        last_sent_el: float | None = None
        last_sent_time = 0.0
        was_moving = False
        while True:
            try:
                az, el = await client.get_position()
                now = time.monotonic()
                moved = (
                    last_sent_az is None
                    or abs(az - last_sent_az) > POSITION_TOLERANCE_DEG
                    or abs(el - last_sent_el) > POSITION_TOLERANCE_DEG
                )
                # The moment motion stops is itself worth sending
                # immediately, not just whenever the idle heartbeat next
                # happens to land -- the client dead-reckons from the last
                # known velocity between updates, so a delayed "it actually
                # stopped" leaves it extrapolating forward on a stale
                # velocity and overshooting for however long that delay is.
                just_stopped = was_moving and not moved
                if moved or just_stopped or now - last_sent_time >= IDLE_HEARTBEAT_SECONDS:
                    await websocket.send_json({"az": az, "el": el})
                    last_sent_az, last_sent_el, last_sent_time = az, el, now
                was_moving = moved
            except (RotctldError, ConnectionError, OSError) as exc:
                await websocket.send_json({"error": str(exc)})
                # Re-sync after an error instead of comparing the next
                # good read against a now-stale last-sent position.
                last_sent_az = None
                was_moving = False
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

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
