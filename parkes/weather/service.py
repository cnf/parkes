from parkes.config import settings
from parkes.weather import cache, client


def _normalize(raw: dict) -> dict:
    current = raw.get("current", {})
    return {
        "time": current.get("time"),
        "temperature_c": current.get("temperature_2m"),
        "humidity_pct": current.get("relative_humidity_2m"),
        "cloud_cover_pct": current.get("cloud_cover"),
        "precipitation_mm": current.get("precipitation"),
        "rain_mm": current.get("rain"),
        "snowfall_cm": current.get("snowfall"),
        "wind_speed_kmh": current.get("wind_speed_10m"),
        "weather_code": current.get("weather_code"),
    }


class WeatherService:
    """Current radio-relevant conditions (cloud cover, precipitation,
    humidity, wind) at a location, via Open-Meteo. Same shape as
    SatnogsService: disk-cached with a short TTL, best-effort live fetch
    falling back to whatever's cached on failure.
    """

    def current(self, lat: float, lon: float, *, force_refresh: bool = False) -> dict | None:
        key = cache.location_key(lat, lon)
        cached = cache.get_cached(key)
        max_age_hours = settings.weather_cache_max_age_minutes / 60
        if not force_refresh and cache.is_fresh(cached, max_age_hours):
            return cached["data"]

        live = client.get_current_conditions(lat, lon)
        if live is not None:
            normalized = _normalize(live)
            cache.put_cached(key, normalized)
            return normalized

        return cached["data"] if cached else None
