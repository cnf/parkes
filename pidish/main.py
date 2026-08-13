from contextlib import asynccontextmanager
from pathlib import Path

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
from pidish.tracking.scheduler import TrackingScheduler
from pidish.tracking.sky import SkyTracker

WEB_DIR = Path(__file__).parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.rotator = RotctldClient(settings.rotctld_host, settings.rotctld_port)
    app.state.sky = SkyTracker()
    app.state.tracking_scheduler = TrackingScheduler(
        app.state.sky, app.state.rotator, settings.tracking_interval_seconds
    )
    app.state.satdump_process = AutotrackProcess()
    yield
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


@app.get("/health")
def health():
    return {"status": "ok"}
