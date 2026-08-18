from fastapi import APIRouter, Request

from parkes.satnogs.service import SatnogsService

router = APIRouter(prefix="/api/satnogs", tags=["satnogs"])


def _satnogs(request: Request) -> SatnogsService:
    return request.app.state.satnogs


@router.get("/satellites")
def search_satellites(q: str, request: Request):
    return _satnogs(request).search_satellites(q)


@router.get("/transmitters")
def get_transmitters(norad: int, request: Request, refresh: bool = False):
    return _satnogs(request).get_transmitters(norad, force_refresh=refresh)
