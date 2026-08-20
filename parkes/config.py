from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PARKES_", env_file=".env")

    app_name: str = "Parkes"

    # rotctld (Hamlib) bridges this app to the EasyCommII serial hardware --
    # host/port, model, managed on/off, etc. are all fresh-deploy starting
    # points only (see preferences.py's DEFAULTS docstring): once the app
    # has run once, the UI-saved value in preferences_file (Settings page)
    # wins, so there's no need to touch these again after initial setup.
    # Only the binary path stays env-only for good -- that's a deploy-time
    # concern (which rotctld build/install to run), not something you'd
    # ever want to flip at runtime.
    rotctld_bin: str = "rotctld"
    rotctl_bin: str = "rotctl"  # the client CLI, used only to list supported models (`-l`)
    rotctld_host: str = "localhost"
    rotctld_port: int = 4533
    # What the managed daemon binds to (-T) -- a separate concern from
    # rotctld_host above, which is what Parkes *connects* to. Only used
    # when rotctld_managed is on. Defaults the same as rotctld_host, so
    # nothing changes until this is deliberately set wider (e.g. 0.0.0.0
    # to let other rotctld clients like gpredict reach it over the LAN).
    rotctld_bind_host: str = "localhost"
    rotctld_managed: bool = True
    rotator_model: int = 1
    rotator_device: str | None = None
    rotctld_timeout_ms: int | None = None
    rotctld_retry: int | None = None

    # Observer location, used for az/el tracking math. Defaults to Antwerp,
    # Belgium -- the fallback used when observer_location_mode isn't
    # "manual"/"gpsd", and gpsd's fallback when it has no fix yet.
    observer_lat: float = 51.2194
    observer_lon: float = 4.4025
    observer_elevation_m: float = 10.0

    # gpsd (or gpsfake, for testing -- same wire protocol) that
    # observer_location_mode "gpsd" reads a live fix from. See
    # tracking/gpsd_client.py. Fresh-deploy defaults only, same as rotctld
    # above -- host/port/managed/device all move to preferences_file once
    # the app has run once. Off by default, since Raspberry Pi OS already
    # ships a working gpsd.service with udev device autodetection, and
    # other things (e.g. chronyd, via SHM) may legitimately want to share
    # that same daemon -- Parkes just connects, as GpsdClient already does
    # today. Only turn this on for a single-purpose Pi with nothing else
    # consuming gpsd.
    gpsd_bin: str = "gpsd"
    gpsd_host: str = "localhost"
    gpsd_port: int = 2947
    gpsd_bind_host: str = "localhost"  # see rotctld_bind_host above
    gpsd_managed: bool = False
    gpsd_device: str | None = None

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

    # User-assigned labels for SoapySDR-detected devices (see sdr/devices.py),
    # keyed by a stable id derived from driver+serial -- lets a HackRF and an
    # RTL-SDR be told apart in the UI instead of just raw driver strings.
    sdr_devices_file: str = "data/tracking/sdr_devices.json"

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

    # Named, fixed az/el positions -- manual-only "go here, optionally
    # launch a standalone app" shortcuts. See tracking/static_positions.py.
    static_positions_file: str = "data/tracking/static_positions.json"

    # Physical receive chains (name -> which general bands, e.g. "VHF"/
    # "Ku-band", it can receive) -- see tracking/antennas.py. The
    # "active_antenna_id" preference selects which one is connected right
    # now, filtering the Pass Orchestrator's candidate downlinks down to
    # ones that band covers.
    antennas_file: str = "data/tracking/antennas.json"

    # SatNOGS DB (https://db.satnogs.org/) satellite/transmitter lookup for
    # the Tracked Objects editor (see parkes/satnogs/) -- lets downlink
    # frequencies/modes be searched instead of hand-typed. Responses are
    # cached to disk since SatNOGS rate-limits unauthenticated reads and
    # lookups are search-triggered, not something that should hit the
    # network on every keystroke.
    satnogs_base_url: str = "https://db.satnogs.org/api"
    satnogs_cache_file: str = "data/satnogs/cache.json"
    satnogs_api_token: str | None = None  # optional, raises the rate limit
    satnogs_timeout_seconds: float = 10.0
    satnogs_cache_max_age_hours: float = 24.0


settings = Settings()
