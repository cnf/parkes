import json
from pathlib import Path
from typing import Any

from parkes.config import settings

# User-editable operating preferences -- observer location, tracking
# cadence, satdump/SDR parameters, and everything about the rotctld/gpsd
# connection: which process InfraSupervisor runs (if any) and where to
# reach it, whether Parkes owns it or not. Deliberately excludes config
# that's tied to the filesystem layout or a deploy-time binary choice
# (rotctld/gpsd binary paths, data directories) -- those stay in Settings,
# set via devenv.nix/.env, and require a restart to change. Everything
# else is meant to be changed at runtime through the UI, not by editing
# environment variables.
DEFAULTS: dict[str, Any] = {
    "observer_lat": settings.observer_lat,
    "observer_lon": settings.observer_lon,
    "observer_elevation_m": settings.observer_elevation_m,
    # "default" uses observer_lat/lon/elevation_m above; "manual" uses the
    # values below instead -- kept as a separate set so switching back to
    # "default" doesn't lose whatever was last set manually. A future
    # "gpsd" mode would read from a local gpsd daemon instead of either.
    "observer_location_mode": "default",
    "observer_manual_lat": settings.observer_lat,
    "observer_manual_lon": settings.observer_lon,
    "observer_manual_elevation_m": settings.observer_elevation_m,
    "tracking_interval_seconds": settings.tracking_interval_seconds,
    "satdump_sdr_source": settings.satdump_sdr_source,
    "satdump_sdr_source_id": settings.satdump_sdr_source_id,
    "satdump_samplerate": settings.satdump_samplerate,
    "orchestrator_min_elevation": settings.orchestrator_min_elevation,
    "soapy_remote_bind_host": settings.soapy_remote_bind_host,
    "soapy_remote_bind_port": settings.soapy_remote_bind_port,
    # When on, SdrArbiter (see sdr/arbiter.py) runs SoapyRemote whenever no
    # local "uses_sdr" app profile is active, stopping it right before one
    # launches and restarting it once the last one finishes.
    "soapy_remote_auto": False,
    # rotctld connection + what InfraSupervisor launches there (see
    # infra_supervisor.py). rotctld_host/port are always where RotctldClient
    # connects. rotctld_bind_host is a *separate* concern, only meaningful
    # when rotctld_managed is on: what interface the daemon Parkes spawns
    # listens on (-T). These are deliberately not the same field -- e.g.
    # binding 0.0.0.0 so a laptop's gpredict can reach rotctld over the LAN
    # (a documented side-benefit of rotctld being a standard network bridge)
    # while Parkes's own client still connects via localhost, since
    # connecting *to* 0.0.0.0 isn't a well-defined client target. When
    # rotctld_managed is off, rotctld_bind_host is unused. rotator_model is
    # Hamlib's numeric rotator id (1 = dummy, 202 = EasyCommII, or any other
    # `rotctld --list`-supported model), not just a dummy/real toggle.
    # rotctld_timeout_ms/rotctld_retry are opt-in tuning for devices with
    # slow/flaky replies, not a default for every rotator.
    "rotctld_host": settings.rotctld_host,
    "rotctld_port": settings.rotctld_port,
    "rotctld_bind_host": settings.rotctld_bind_host,
    "rotctld_managed": settings.rotctld_managed,
    "rotator_model": settings.rotator_model,
    "rotator_device": settings.rotator_device,
    "rotctld_timeout_ms": settings.rotctld_timeout_ms,
    "rotctld_retry": settings.rotctld_retry,
    # Same idea for gpsd. Managed off by default -- most setups rely on the
    # system's own gpsd.service, which other things (e.g. chronyd) may also
    # use. See infra_supervisor.py.
    "gpsd_host": settings.gpsd_host,
    "gpsd_port": settings.gpsd_port,
    "gpsd_bind_host": settings.gpsd_bind_host,
    "gpsd_managed": settings.gpsd_managed,
    "gpsd_device": settings.gpsd_device,
    # Which widgets share a card, and their stacking order within it --
    # e.g. [["rotator", "orchestrator"], ["tracking"], ...] puts the
    # rotator and orchestrator widgets on one shared card, rotator on top.
    # Global rather than per-profile: whether two widgets belong on the
    # same card is a structural choice, not something that should flip
    # depending on viewport width. A group's first member is its "leader"
    # -- the id dashboard_layout_wide/narrow entries below key on, and the
    # id merge/split in dashboard-layout.js preserve (merging never changes
    # the surviving leader; splitting only ever pulls out a non-leader
    # member, so an entry's id is stable across regrouping).
    "dashboard_groups": [
        ["rotator"], ["orchestrator"], ["tracking"], ["pass-plot"], ["world-map"],
    ],
    # Dashboard-page layout editor state (index.html only). "id" values are
    # group leader ids (see dashboard_groups) -- for an unmerged widget
    # that's just its own data-widget-id, so adding a new widget card later
    # needs no migration here -- dashboard-layout.js appends any card
    # missing from either list at render time. Two separate layouts
    # because phone/tablet-portrait (narrow, below the 60rem breakpoint
    # dashboard-layout.js and style.css both key off) doesn't have room
    # for side-by-side cards or a meaningful span choice -- it's always a
    # single column, so narrow entries carry no "span". "wide"/"columns"
    # only matter above that breakpoint. List order is display order in
    # the grid; "span" is 1-dashboard_columns, clamped to the intersection
    # of a merged card's members' individual span limits.
    "dashboard_layout_wide": [
        {"id": "rotator", "span": 2, "hidden": False},
        {"id": "orchestrator", "span": 1, "hidden": False},
        {"id": "tracking", "span": 1, "hidden": False},
        {"id": "pass-plot", "span": 2, "hidden": False},
        {"id": "world-map", "span": 2, "hidden": False},
    ],
    "dashboard_layout_narrow": [
        {"id": "rotator", "hidden": False},
        {"id": "orchestrator", "hidden": False},
        {"id": "tracking", "hidden": False},
        {"id": "pass-plot", "hidden": False},
        {"id": "world-map", "hidden": False},
    ],
    # How many grid columns the wide layout uses -- 2 or 3.
    "dashboard_columns": 3,
    # "controlled" keeps the site-wide 75rem max-width on the dashboard;
    # "full" lets the dashboard grid use the full viewport width. Scoped to
    # index.html only via body.dashboard-page -- see style.css.
    "dashboard_width": "controlled",
}


class PreferencesStore:
    """JSON-persisted overrides layered on top of DEFAULTS, loaded/saved
    per call -- same pattern as GroupStore/TleSourceStore. Callers that
    need to react to changes without a restart (SkyTracker, the tracking
    scheduler, the Pass Orchestrator) read via get()/get_all() at the
    point of use rather than caching values at construction time.
    """

    def _path(self) -> Path:
        return Path(settings.preferences_file)

    def _load(self) -> dict[str, Any]:
        data = dict(DEFAULTS)
        path = self._path()
        if path.exists():
            data.update(json.loads(path.read_text()))
        return data

    def get_all(self) -> dict[str, Any]:
        return self._load()

    def get(self, key: str) -> Any:
        return self._load().get(key, DEFAULTS.get(key))

    def update(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self._load()
        data.update({k: v for k, v in values.items() if k in DEFAULTS})
        path = self._path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2))
        return data


preferences = PreferencesStore()
