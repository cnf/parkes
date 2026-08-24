from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/dish", tags=["dish_esp"])


class SetConfigRequest(BaseModel):
    namespace: str
    key: str
    type: str
    value: Any


class SetConfigVectorRequest(BaseModel):
    namespace: str
    key: str
    action: Literal["add", "remove"]
    item: Any


@router.get("/config")
async def get_config(request: Request):
    # "Not connected" is an expected, common state (no transport is wired
    # up yet -- see dish_esp/client.py), not an error -- always 200, same
    # pattern as gpsd_status in api/settings.py.
    namespaces = await request.app.state.dish_esp.get_config()
    return {"connected": namespaces is not None, "namespaces": namespaces or []}


@router.post("/config")
async def set_config(body: SetConfigRequest, request: Request):
    dish_esp = request.app.state.dish_esp
    ok = await dish_esp.set_config(body.namespace, body.key, body.type, body.value)
    if not ok:
        raise HTTPException(502, "ESP unreachable or rejected the change")
    return {"status": "ok"}


@router.post("/config/vector")
async def set_config_vector(body: SetConfigVectorRequest, request: Request):
    ok = await request.app.state.dish_esp.set_config_vector(
        body.namespace, body.key, body.action, body.item
    )
    if not ok:
        raise HTTPException(502, "ESP unreachable or rejected the change")
    return {"status": "ok"}
