from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("")
def get_weather(request: Request, refresh: bool = False):
    lat, lon, _elevation, _source = request.app.state.sky.current_location()
    data = request.app.state.weather.current(lat, lon, force_refresh=refresh)
    if data is None:
        raise HTTPException(503, "weather unavailable")
    return data
