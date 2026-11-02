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
    # Flashes new firmware onto the EasyCommII board's app partition (see
    # parkes/rotator/flasher.py) -- deploy-time bin path, same treatment as
    # rotctld_bin/gpsd_bin above. The rest are hardware constants for this
    # specific board (its chip, app partition offset, and flash chip
    # settings -- from DishControll's partitions16M.csv/sdkconfig), not
    # something a build's flasher_args.json needs to be parsed for, since
    # Parkes only ever rewrites the one app partition. Only change these
    # if the board itself changes (different chip, bigger flash, a moved
    # partition table).
    esptool_bin: str = "esptool"
    esptool_chip: str = "esp32s3"
    esptool_app_offset: str = "0x10000"
    esptool_flash_mode: str = "dio"
    esptool_flash_freq: str = "80m"
    esptool_flash_size: str = "16MB"

    # SerialDishEspClient (parkes/dish_esp/serial_client.py) talks the
    # firmware's CR/CW config protocol directly over the same USB-serial
    # link as EasyCommII, borrowing rotctld's port the same way the
    # flasher does. Generous default: this board's native-USB Serial/JTAG
    # peripheral has a known erratum causing multi-second reply latency
    # (rotctld_timeout_ms/rotctld_retry below are tuned for the same
    # reason), and a config exchange is a synchronous multi-line
    # round-trip, not a single quick query.
    dish_esp_serial_timeout_s: float = 5.0

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
    # Serial baud (-s). Unset lets Hamlib use the backend's own max
    # (EasyComm: 19200), which a 115200 hardware-UART board won't answer.
    rotctld_serial_speed: int | None = None
    rotctld_timeout_ms: int | None = None
    rotctld_retry: int | None = None
    # Hamlib's rot_open() defaults dtr_state/rts_state to "Unset", which
    # takes the same code path as "OFF" -- ioctl(TIOCMBIC) clearing both
    # lines on open. On this board that clear (on top of the Linux kernel
    # already raising DTR by default on open()) is a transition the
    # ESP32-S3's native-USB Serial/JTAG peripheral treats as a soft-reset
    # trigger (confirmed via strace + testing against real hardware).
    # Setting "ON" instead makes Hamlib raise (ioctl TIOCMBIS) to match
    # what the kernel already did, rather than undo it -- no second
    # transition, no reset. Opt-in, like timeout_ms/retry above: this is
    # specific to this board, not a default every rotator should get.
    rotctld_dtr_state: str | None = None
    rotctld_rts_state: str | None = None

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

    # Open-Meteo (https://open-meteo.com/, free, no API key) current
    # conditions at the observer location for the Weather widget -- cloud
    # cover/precipitation/humidity/wind, the numbers relevant to eyeballing
    # rain-fade/scintillation risk. Cached like SatNOGS above (see
    # parkes/weather/), just with a much shorter TTL since actual weather
    # changes on the order of minutes, not days.
    weather_base_url: str = "https://api.open-meteo.com/v1/forecast"
    weather_cache_file: str = "data/weather/cache.json"
    weather_timeout_seconds: float = 10.0
    weather_cache_max_age_minutes: float = 15.0


settings = Settings()
