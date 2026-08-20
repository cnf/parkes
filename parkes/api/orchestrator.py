import shlex
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from parkes.orchestrator import PassOrchestrator, find_overlaps
from parkes.preferences import preferences
from parkes.rotator.rotctld_client import RotctldError
from parkes.sdr.app_profiles import delete_profile, load_profiles, put_profile
from parkes.sdr.command_modules import list_command_modules
from parkes.sdr.satdump_pipelines import list_all_pipelines, list_live_pipelines
from parkes.standalone_apps import StandaloneAppRunner
from parkes.tracking.antennas import (
    active_antenna,
    delete_antenna,
    downlink_receivable,
    load_antennas,
    put_antenna,
)
from parkes.tracking.sky import SkyTracker
from parkes.tracking.static_positions import (
    delete_static_position,
    load_static_positions,
    put_static_position,
)
from parkes.tracking.tracked_objects import (
    delete_tracked_object,
    load_tracked_objects,
    move_tracked_object,
    put_tracked_object,
)

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


# Uplink is a field on the downlink it's paired with (e.g. a transponder or
# repeater's up/down pair), not a separate list -- Parkes doesn't care
# whether the launched app receives, transmits, or both, it just fills in
# command placeholders (see resolve_command in sdr/app_profiles.py). None
# means this downlink has no associated uplink. When set, the app profile
# command can reference {up_frequency}; {frequency}/{down_frequency} are
# always aliases for the same value (see PassOrchestrator._run_pass).
class DownlinkRequest(BaseModel):
    frequency: float
    up_frequency: float | None = None
    app: str | None = None
    description: str | None = None
    mode: str | None = None
    baud: float | None = None
    # Both optional, per-downlink SDR overrides -- available to an app
    # profile's command as {gain}/{bias} (see resolve_command). gain unset
    # behaves like up_frequency unset: a command that references {gain}
    # without one raises KeyError and the app just doesn't launch for that
    # pass. bias always resolves to "--bias" or "" (never missing), since
    # "no bias tee" needs to be the normal, silent case, not a
    # misconfiguration.
    gain: float | None = None
    bias: bool = False
    # General band (e.g. "VHF"/"Ku-band" -- see web/static/bands.js),
    # computed client-side from frequency and refreshed whenever it
    # changes. Only consulted for a "band"-mode active antenna (see
    # tracking/antennas.downlink_receivable) -- a "range"-mode one
    # compares frequency directly instead.
    band: str | None = None
    enabled: bool = True


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
    # Editor metadata only -- `command` (above) is always the actual,
    # already-resolved arg list that gets executed; these three just let
    # the App Profiles editor reconstruct its structured form next time
    # it's opened. Parkes itself never reads them (see command_modules.py).
    module: str | None = None
    module_mode: str | None = None
    module_fields: dict | None = None
    module_extra_args: list[str] | None = None


class UpsertStaticPositionRequest(BaseModel):
    name: str
    # "azel": az/el are the stored, authoritative values, entered directly.
    # "latlon": lat/lon/alt_m are authoritative; az/el are derived from
    # them (relative to the observer's current location) and recomputed
    # fresh on every read/go, not trusted from what's stored -- see
    # get_static_positions()/go_static_position(). Stored anyway as a
    # last-known-good display value.
    position_mode: Literal["azel", "latlon"] = "azel"
    az: float | None = None
    el: float | None = None
    lat: float | None = None
    lon: float | None = None
    alt_m: float = 0.0
    # Same shape as a tracked object's downlinks (see DownlinkRequest) --
    # "Go" launches the first enabled entry's app, if any (see
    # go_static_position()). The app must be "standalone"-mode, since a
    # static position is never pass-triggered.
    downlinks: list[DownlinkRequest] = []


class UpsertAntennaRequest(BaseModel):
    name: str
    # "band": bands (general band names, see web/static/bands.js) is
    # authoritative. "range": freq_min_mhz/freq_max_mhz is, for anything
    # narrowband/resonant where the coarse band boundaries would be wrong
    # -- see tracking/antennas.downlink_receivable(). Either an empty
    # bands list or an incomplete range means unconfigured, which fails
    # open (no filtering) rather than treating that as "covers nothing".
    coverage_mode: Literal["band", "range"] = "band"
    bands: list[str] = []
    freq_min_mhz: float | None = None
    freq_max_mhz: float | None = None


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


@router.get("/antennas")
def get_antennas():
    return load_antennas()


@router.put("/antennas/{antenna_id}")
def put_antenna_route(antenna_id: str, body: UpsertAntennaRequest):
    put_antenna(antenna_id, body.model_dump())
    return {"status": "ok"}


@router.delete("/antennas/{antenna_id}")
def delete_antenna_route(antenna_id: str):
    delete_antenna(antenna_id)
    return {"status": "ok"}


@router.get("/overlaps")
def get_overlaps(request: Request):
    return find_overlaps(_sky(request))


@router.get("/app_profiles")
def get_app_profiles():
    return load_profiles()


@router.get("/satdump_pipelines")
def get_satdump_pipelines(live_only: bool = True):
    return list_live_pipelines() if live_only else list_all_pipelines()


@router.get("/command_modules")
def get_command_modules():
    return list_command_modules()


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
    if body.module:
        profile["module"] = body.module
        profile["module_mode"] = body.module_mode
        profile["module_fields"] = body.module_fields or {}
        profile["module_extra_args"] = body.module_extra_args or []
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


def _effective_azel(position: dict, sky: SkyTracker) -> tuple[float, float]:
    """A latlon-mode position's az/el is derived from the observer's
    *current* location, not trusted from whatever was last stored --
    that's the whole point of keeping lat/lon/alt around (see
    UpsertStaticPositionRequest's docstring comment)."""
    if position.get("position_mode") == "latlon" and position.get("lat") is not None:
        return sky.azel_of_point(position["lat"], position["lon"], position.get("alt_m") or 0.0)
    return position["az"], position["el"]


def _effective_downlinks(position: dict) -> list[dict]:
    """Positions saved before the downlinks-list format (a single
    app/frequency pair) are migrated on the fly into one entry, so they
    keep working exactly as before until next opened and saved through
    the new editor -- same reasoning as _effective_azel, just for the
    app/frequency side instead of the position side."""
    if "downlinks" in position:
        return position["downlinks"]
    frequency = position.get("frequency")
    app = position.get("app")
    if frequency is None and not app:
        return []
    return [
        {
            "frequency": frequency or 0,
            "up_frequency": None,
            "app": app,
            "description": None,
            "mode": None,
            "baud": None,
            "gain": None,
            "bias": False,
            "band": None,
            "enabled": True,
        }
    ]


@router.get("/static_positions/compute_azel")
def compute_static_position_azel(lat: float, lon: float, request: Request, alt_m: float = 0.0):
    """Live az/el preview for the lat/lon/alt editor -- doesn't touch
    stored data, just the same math put_static_position_route() uses."""
    az, el = request.app.state.sky.azel_of_point(lat, lon, alt_m)
    return {"az": az, "el": el}


@router.get("/static_positions")
def get_static_positions(request: Request):
    positions = load_static_positions()
    sky = request.app.state.sky
    for position in positions.values():
        position["az"], position["el"] = _effective_azel(position, sky)
        position["downlinks"] = _effective_downlinks(position)
    return positions


@router.put("/static_positions/{position_id}")
def put_static_position_route(
    position_id: str, body: UpsertStaticPositionRequest, request: Request
):
    if body.position_mode == "latlon":
        if body.lat is None or body.lon is None:
            raise HTTPException(422, "lat/lon are required in latlon mode")
        az, el = request.app.state.sky.azel_of_point(body.lat, body.lon, body.alt_m)
    else:
        if body.az is None or body.el is None:
            raise HTTPException(422, "az/el are required in azel mode")
        az, el = body.az, body.el
    payload = body.model_dump()
    payload["az"], payload["el"] = az, el
    put_static_position(position_id, payload)
    return {"status": "ok"}


@router.delete("/static_positions/{position_id}")
def delete_static_position_route(position_id: str):
    delete_static_position(position_id)
    return {"status": "ok"}


def _active_downlink(position: dict) -> dict | None:
    """Same "first enabled wins" convention as PassOrchestrator's own
    downlink selection (see _candidate_passes/_rank), including its active-
    antenna band filter -- there's no AOS/priority competition for a
    static position, but reusing it keeps "which one is active" predictable
    and consistent with Tracked Satellites, and there's no more point
    "Go"-ing to a position and launching an app whose downlink the current
    antenna can't receive than there is winning a pass for one."""
    antenna = active_antenna()
    for d in _effective_downlinks(position):
        if not d.get("enabled", True):
            continue
        if antenna is not None and not downlink_receivable(d, antenna):
            continue
        return d
    return None


@router.post("/static_positions/{position_id}/go")
async def go_static_position(position_id: str, request: Request):
    position = load_static_positions().get(position_id)
    if position is None:
        raise HTTPException(404, f"unknown static position: {position_id}")
    az, el = _effective_azel(position, request.app.state.sky)
    try:
        await request.app.state.rotator.set_position(az, el)
    except (RotctldError, ConnectionError, OSError) as exc:
        raise HTTPException(502, str(exc)) from exc
    active = _active_downlink(position)
    app_id = active.get("app") if active else None
    if app_id:
        standalone = _standalone(request)
        if not standalone.running(app_id):
            overrides = {
                "frequency": active["frequency"],
                "down_frequency": active["frequency"],
                "bias": "--bias" if active.get("bias") else "",
            }
            if active.get("up_frequency"):
                overrides["up_frequency"] = active["up_frequency"]
            if active.get("gain") is not None:
                overrides["gain"] = active["gain"]
            try:
                await standalone.start(app_id, **overrides)
            except KeyError as exc:
                raise HTTPException(404, f"unknown app profile: {app_id}") from exc
            except (ValueError, RuntimeError) as exc:
                raise HTTPException(409, str(exc)) from exc
    return {"status": "ok"}


@router.post("/static_positions/{position_id}/stop")
async def stop_static_position(position_id: str, request: Request):
    position = load_static_positions().get(position_id)
    if position is None:
        raise HTTPException(404, f"unknown static position: {position_id}")
    active = _active_downlink(position)
    app_id = active.get("app") if active else None
    if app_id:
        await _standalone(request).stop(app_id)
    return {"status": "ok"}
