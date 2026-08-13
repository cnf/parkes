import asyncio
import logging
import socket
from contextlib import asynccontextmanager
from pathlib import Path

# skyfield's TLE/ephemeris downloader uses urlopen() with no timeout at all,
# so a stalled connection would otherwise hang forever.
socket.setdefaulttimeout(15)

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from pidish.api.rotator import router as rotator_router
from pidish.api.satdump import router as satdump_router
from pidish.api.tracking import router as tracking_router
from pidish.config import settings
from pidish.rotator.rotctld_client import RotctldClient
from pidish.satdump.process import AutotrackProcess
from pidish.tracking.groups import GroupStore
from pidish.tracking.scheduler import TrackingScheduler
from pidish.tracking.sky import SkyTracker
from pidish.tracking.tle import TleCatalog
from pidish.tracking.tle_sources import TleSourceStore

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
    app.state.sky = SkyTracker(app.state.tle_catalog, app.state.group_store)
    app.state.tracking_scheduler = TrackingScheduler(
        app.state.sky, app.state.rotator, settings.tracking_interval_seconds
    )
    app.state.satdump_process = AutotrackProcess()
    yield
    tle_load_task.cancel()
    app.state.tracking_scheduler.stop()
    await app.state.satdump_process.stop()
    await app.state.rotator.close()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.include_router(rotator_router)
app.include_router(tracking_router)
app.include_router(satdump_router)
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


@app.get("/satdump", response_class=HTMLResponse)
def satdump_page(request: Request):
    return templates.TemplateResponse(
        request, "satdump.html", {"app_name": settings.app_name}
    )


@app.get("/health")
def health():
    return {"status": "ok"}
