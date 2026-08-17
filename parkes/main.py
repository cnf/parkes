import asyncio
import logging
import socket
from contextlib import asynccontextmanager
from pathlib import Path

# skyfield's TLE/ephemeris downloader uses urlopen() with no timeout at all,
# so a stalled connection would otherwise hang forever.
socket.setdefaulttimeout(15)

# asyncio logs "socket.send() raised exception." (selector_events.py) as a
# benign WARNING whenever something writes to a connection whose peer
# already closed it -- a generic, widely-reported pattern across the async
# Python ecosystem (uvicorn, websockets, aioftp, anyio...), not specific to
# this app. It doesn't indicate broken functionality, just log noise from
# a dead rotator-websocket or rotctld connection; silence it specifically
# rather than raising the root logger level, which would hide real errors.
logging.getLogger("asyncio").setLevel(logging.ERROR)

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from parkes.api.orchestrator import router as orchestrator_router
from parkes.api.rotator import router as rotator_router
from parkes.api.sdr import router as sdr_router
from parkes.api.settings import router as settings_router
from parkes.api.tracking import router as tracking_router
from parkes.config import settings
from parkes.orchestrator import PassOrchestrator
from parkes.rotator.rotctld_client import RotctldClient
from parkes.sdr.arbiter import SdrArbiter
from parkes.sdr.server import SoapyRemoteServer
from parkes.standalone_apps import StandaloneAppRunner
from parkes.tracking.fixed_targets import FixedTargetStore
from parkes.tracking.groups import GroupStore
from parkes.tracking.scheduler import TrackingScheduler
from parkes.tracking.sky import SkyTracker
from parkes.tracking.tle import TleCatalog
from parkes.tracking.tle_sources import TleSourceStore

logger = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"


async def _load_tles_in_background(tle_catalog: TleCatalog) -> None:
    try:
        await asyncio.to_thread(tle_catalog.ensure_loaded)
    except Exception:
        logger.warning("could not load TLEs at startup (offline?)", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.rotator = RotctldClient(settings.rotctld_host, settings.rotctld_port)
    app.state.tle_sources = TleSourceStore()
    app.state.tle_catalog = TleCatalog(app.state.tle_sources)
    # Fetches multiple TLE sets over the network -- run in the background so
    # a slow/offline connection can't block the whole app from starting.
    tle_load_task = asyncio.create_task(_load_tles_in_background(app.state.tle_catalog))
    app.state.group_store = GroupStore()
    app.state.fixed_target_store = FixedTargetStore()
    app.state.sky = SkyTracker(app.state.tle_catalog, app.state.group_store, app.state.fixed_target_store)
    app.state.tracking_scheduler = TrackingScheduler(app.state.sky, app.state.rotator)
    app.state.soapy_remote = SoapyRemoteServer()
    app.state.sdr_arbiter = SdrArbiter(app.state.soapy_remote)
    app.state.orchestrator = PassOrchestrator(
        app.state.sky, app.state.tracking_scheduler, app.state.sdr_arbiter
    )
    app.state.standalone_apps = StandaloneAppRunner(app.state.sdr_arbiter)
    app.state.standalone_apps.start_timer()
    await app.state.sdr_arbiter.ensure_idle_state()
    yield
    tle_load_task.cancel()
    app.state.tracking_scheduler.stop()
    await app.state.soapy_remote.stop()
    await app.state.orchestrator.stop()
    await app.state.standalone_apps.stop_timer()
    await app.state.rotator.close()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.include_router(rotator_router)
app.include_router(tracking_router)
app.include_router(sdr_router)
app.include_router(orchestrator_router)
app.include_router(settings_router)
app.mount("/static", StaticFiles(directory=WEB_DIR / "static"), name="static")


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store"
    return response

templates = Jinja2Templates(directory=WEB_DIR / "templates")


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(
        request, "index.html", {"app_name": settings.app_name}
    )


@app.get("/satellites", response_class=HTMLResponse)
def satellites_page(request: Request):
    return templates.TemplateResponse(
        request, "satellites.html", {"app_name": settings.app_name}
    )


@app.get("/orchestrator", response_class=HTMLResponse)
def orchestrator_page(request: Request):
    return templates.TemplateResponse(
        request, "orchestrator.html", {"app_name": settings.app_name}
    )


@app.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request):
    return templates.TemplateResponse(
        request, "settings.html", {"app_name": settings.app_name}
    )


@app.get("/sdr", response_class=HTMLResponse)
def sdr_page(request: Request):
    return templates.TemplateResponse(
        request, "sdr.html", {"app_name": settings.app_name}
    )


@app.get("/health")
def health():
    return {"status": "ok"}
