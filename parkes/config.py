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
    fixed_targets_file: str = "data/tracking/fixed_targets.json"

    # Env-configured defaults for the user-editable preferences below (see
    # preferences.py) -- useful for setting a fresh deploy's starting point
    # via .env, but the UI-saved value in preferences_file wins once set.
    preferences_file: str = "data/preferences.json"

    # SDR parameters handed to app profile commands as {source}/{source_id}/
    # {samplerate} placeholders (see app_profiles_file). "source" must match
    # one of satdump's SDR handler ids (e.g. "hackrf", "airspy", "soapysdr",
    # "rtlsdr") since that's the most likely thing being launched, but
    # nothing here is satdump-specific.
    satdump_sdr_source: str = "hackrf"
    satdump_sdr_source_id: str | None = None
    satdump_samplerate: int = 6_000_000
    satdump_output_dir: str = "data/satdump/output"
    tracked_objects_file: str = "data/tracking/tracked_objects.json"

    # SoapyRemote: exposes whatever SDR SoapySDR's configured driver finds
    # (see satdump_sdr_source) over the network, so a laptop can run
    # gpredict/gqrx/satdump directly against it instead of through this
    # app. Mutually exclusive with this app's own SDR use (the Pass
    # Orchestrator) -- only one process can hold the physical device at a
    # time.
    soapy_remote_bind_host: str = "0.0.0.0"
    soapy_remote_bind_port: int = 55132

    # Pass Orchestrator: sequences dish + SDR ownership across
    # tracked_objects.json's downlinks, launching each downlink's "pass"-mode
    # app profile (see app_profiles_file) for the duration of its pass.
    # "Standalone"-mode profiles are unrelated to any satellite -- started/
    # stopped manually or on their own timer, no rotator/SDR involvement
    # from this app at all.
    orchestrator_min_elevation: float = 5.0
    app_profiles_file: str = "data/tracking/app_profiles.json"


settings = Settings()
