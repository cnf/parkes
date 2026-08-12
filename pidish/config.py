from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PIDISH_", env_file=".env")

    app_name: str = "PiDish"

    # rotctld (Hamlib) bridges this app to the EasyCommII serial hardware.
    rotctld_host: str = "localhost"
    rotctld_port: int = 4533

    # Observer location, used for az/el tracking math. Manually configured
    # for now (defaults to Antwerp, Belgium); gpsd / browser-geolocation
    # sourcing can replace this later without changing callers.
    observer_lat: float = 51.2194
    observer_lon: float = 4.4025
    observer_elevation_m: float = 10.0

    # Where skyfield caches its downloaded ephemeris/timescale data.
    skyfield_data_dir: str = "data/skyfield"

    tracking_interval_seconds: float = 30.0

    # satdump autotrack: it owns the whole satellite pass pipeline (TLE,
    # scheduling, az/el, capture, decode) -- this app only generates its
    # config and manages the process. "source" must match one of satdump's
    # SDR handler ids (e.g. "hackrf", "airspy", "soapysdr", "rtlsdr").
    satdump_sdr_source: str = "hackrf"
    satdump_sdr_source_id: str | None = None
    satdump_samplerate: int = 6_000_000
    satdump_initial_frequency: int = 137_500_000
    satdump_output_dir: str = "data/satdump/output"
    satdump_autotrack_min_elevation: float = 5.0
    satdump_tracked_objects_file: str = "data/satdump/tracked_objects.json"
    satdump_config_path: str = "data/satdump/autotrack_config.json"


settings = Settings()
