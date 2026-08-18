# Running Parkes on the Pi

Parkes starts and supervises `rotctld` itself (see `parkes/infra_supervisor.py`) —
crash-restarted with backoff, kept running for the app's whole uptime. `gpsd`
stays externally managed by default (`PARKES_GPSD_MANAGED=false`, the
default): Raspberry Pi OS already ships a working `gpsd.service` with udev
device autodetection, and other things (e.g. `chronyd`, via SHM, for
GPS-based time sync) may legitimately want to share that same daemon.
Because of this, one systemd unit is enough — it replaces the need for a
separate `rotctld.service`, but deliberately not `gpsd.service`.

## `/etc/systemd/system/parkes.service`

See [parkes.service](parkes.service) for a copy-pasteable unit file.

```bash
sudo cp docs/parkes.service /etc/systemd/system/parkes.service
sudo systemctl daemon-reload
sudo systemctl enable --now parkes.service
```

`KillMode=control-group` means stopping/restarting this unit also stops the
rotctld child it launched — that's a deliberate tradeoff of owning rotctld
as a child process rather than a separate systemd unit: an app restart
incurs rotctld's one-time EasyCommII board reset-on-open, not just a
genuine reboot. See `parkes/infra_supervisor.py`'s module docstring and the
design plan for the full reasoning.

## Rotator/gpsd config: use the Settings page, not env vars

Everything about rotctld/gpsd -- host/port to connect to, bind address (see
below), model, device, managed on/off, timeout/retry tuning -- is a
**runtime setting, edited on the Settings page** (`/settings` → Rotator /
GPS cards), not something you set in `parkes.env` and restart for. They're
stored in `data/preferences.json` (see `parkes/preferences.py`) and take
effect immediately: saving restarts just the affected daemon(s)
(`InfraSupervisor.reconfigure()`) and/or repoints the live client
(`RotctldClient`/`GpsdClient.reconfigure()`), no app restart needed.

The matching `PARKES_*` environment variables still exist in
`parkes/config.py`, but only matter as the **fresh-deploy starting point**
-- the value baked into `data/preferences.json` the very first time the app
runs, before anyone's touched the Settings page. Once that file exists
(which is immediately, on first boot), the UI value wins and the env var is
ignored; there's no need to keep it set in `parkes.env` afterward. Real
per-device config belongs in the Settings page on first login, not in
`parkes.env`.

What *does* stay env-var-only, because it's a deploy-time/filesystem
concern rather than something you'd change per session: `PARKES_ROTCTLD_BIN`,
`PARKES_ROTCTL_BIN`, `PARKES_GPSD_BIN` (which binaries to run), and the
various `*_dir`/`*_file` data-path settings.

### Host vs. bind address

"Host" (`rotctld_host`/`gpsd_host`) is always what *this app* connects to.
"Bind address" (`rotctld_bind_host`/`gpsd_bind_host`) is a separate field,
only used when "Managed" is on: it's what interface the daemon Parkes
spawns actually listens on. They default to the same value (`localhost`),
so nothing changes until deliberately set wider. Set bind address to
`0.0.0.0` to let other rotctld clients (gpredict on a laptop, say -- a
documented side-benefit of rotctld being a standard network bridge) reach
it over the LAN, while leaving Host as `localhost` so Parkes's own
connection stays local. Setting Host itself to `0.0.0.0` wouldn't work --
that's not a well-defined destination for a TCP client to connect to.

## Permissions

The user running `parkes.service` (`parkes` above) needs read/write
access to whatever serial device the rotator/gpsd Settings-page fields
point at — on Raspberry Pi OS, that means being a member of the `dialout`
group:

```bash
sudo usermod -aG dialout parkes
```

This is a one-time setup step regardless of which specific device path
gets configured later through the UI.
