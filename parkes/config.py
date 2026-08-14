from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PARKES_", env_file=".env")

    app_name: str = "Parkes"

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

    # Satellite TLEs for the Sky Tracking list -- same idea as satdump/
    # gpredict (fetch TLE sets, cache locally, SGP4 via skyfield).
    # Independent of satdump's own TLE cache since this list should work
    # even if satdump has never been run. Sources (URLs) and groups are
    # both user-managed and persisted as JSON, not fixed config.
    tle_data_dir: str = "data/tle"
    tle_sources_file: str = "data/tracking/tle_sources.json"
    tracking_groups_file: str = "data/tracking/groups.json"

    # Env-configured defaults for the user-editable preferences below (see
    # preferences.py) -- useful for setting a fresh deploy's starting point
    # via .env, but the UI-saved value in preferences_file wins once set.
    preferences_file: str = "data/preferences.json"

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

    # SoapyRemote: exposes whatever SDR SoapySDR's configured driver finds
    # (see satdump_sdr_source) over the network, so a laptop can run
    # gpredict/gqrx/satdump directly against it instead of through this
    # app. Mutually exclusive with this app's own SDR use (satdump
    # autotrack) -- only one process can hold the physical device at a time.
    soapy_remote_bind_host: str = "0.0.0.0"
    soapy_remote_bind_port: int = 55132

    # Pass orchestrator: sequences dish + SDR ownership across
    # tracked_objects' downlinks, launching each downlink's "app" profile
    # (see app_profiles_file) for the duration of its pass. An alternative
    # to satdump's own autotrack mode when a satellite needs something
    # other than satdump run against it.
    app_profiles_file: str = "data/tracking/app_profiles.json"


settings = Settings()
