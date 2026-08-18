# Parkes

A web app for driving a motorized parabolic dish: rotator control, satellite/radio tracking, and SDR/satdump orchestration, built for a Raspberry Pi.

It's a Python/FastAPI app (server-rendered Jinja2 + htmx, no SPA build step). It doesn't reimplement rotator control, orbital mechanics, or signal decoding -- it orchestrates existing, well-tested tools instead:

- **[Hamlib](https://hamlib.github.io/)'s `rotctld`** is the only thing that speaks serial EasyCommII to the rotator hardware. Parkes starts and supervises it itself (crash-restart with backoff, kept up for the app's whole runtime) -- see `parkes/infra_supervisor.py`.
- **[satdump](https://github.com/SatDump/SatDump)** owns satellite pass capture/decode, launched as an ordinary user-configured "app profile" for the duration of a pass.
- **[skyfield](https://rhodesmill.org/skyfield/)** computes az/el for satellites (from TLEs) and fixed radio sources (Sun, Moon, Cas A, ...) alike.
- **gpsd** (or a real GPS dongle) can feed the observer's live lat/lon/elevation instead of a fixed location.
- **SoapySDR** exposes whatever SDR is attached, either to Parkes's own launched commands or, via SoapyRemote, directly to a laptop running gpredict/gqrx/satdump.

## Quickstart (development)

The dev environment is managed by [devenv](https://devenv.sh/) (Nix), which provisions Python, Hamlib, satdump, SoapySDR, and gpsd/gpsfake together:

```bash
devenv up
```

This starts the web app at `http://localhost:8000` (uvicorn, auto-reloading) alongside a fake GPS source. Rotator hardware defaults to Hamlib's dummy backend (`rotator_model=1`) so the UI works with nothing physically attached -- see [Configuration](#configuration) below for pointing it at a real EasyCommII controller.

## Configuration

Two layers, deliberately kept separate:

- **Bootstrap-only environment variables** (`PARKES_*`, see `parkes/config.py`, optionally via a `.env` file) -- deploy-time/filesystem concerns: binary paths, data directories, and the *fresh-deploy starting point* for everything else. They only matter before `data/preferences.json` exists; once the app has run once, the UI value wins and the env var is ignored.
- **The Settings page** (`/settings`) -- everything you'd actually want to change without a restart: observer location, tracking cadence, rotator/gpsd process management (managed on/off, host to connect to, bind address, model, serial device, timeout/retry tuning), SDR parameters, SoapyRemote. Stored in `data/preferences.json`, edited at runtime, and saves take effect immediately (`InfraSupervisor.reconfigure()` restarts just the affected daemon; `RotctldClient`/`GpsdClient.reconfigure()` repoints the live connection).

See [docs/deploy.md](docs/deploy.md) for running on the actual Pi (systemd unit, permissions) rather than under devenv.

## Linting

```bash
ruff check .
ruff format .
```

## Layout

```
parkes/       FastAPI app, rotator/tracking/SDR orchestration
parkes/web/   Jinja2 templates + static JS/CSS (no build step)
parkes/api/   HTTP routes
docs/         Deployment docs + example systemd unit
data/         Runtime state (preferences, TLE cache, tracked objects...) -- gitignored
```
