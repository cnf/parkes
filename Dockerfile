# Parkes: web app + the hardware-orchestration tools it drives (rotctld via
# libhamlib-utils, satdump, SoapySDR, gpsd). All of these are ordinary
# `main`-section Debian trixie packages, so no source builds are needed --
# see docs/deploy.md for the equivalent bare-metal/systemd deployment this
# mirrors.
FROM python:3-slim-trixie

# tini is PID 1: reaps/forwards signals to the single uvicorn process this
# image runs, which is enough since ManagedProcess (parkes/process.py)
# starts rotctld/gpsd/satdump/SoapySDRServer as its own asyncio children,
# not double-forked daemons of their own.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini \
        libhamlib-utils \
        gpsd \
        satdump \
        soapysdr-tools \
        soapysdr-module-all \
        hackrf \
        rtl-sdr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so they're cached across source-only changes.
COPY pyproject.toml ./
COPY parkes ./parkes
RUN pip install --no-cache-dir .

# Everything stateful (preferences.json, TLE/skyfield caches, satdump
# output, SatNOGS cache) lives under data/ -- see parkes/config.py. Mount a
# volume here to persist it across container recreation.
RUN mkdir -p data

RUN useradd --home-dir /app --uid 4213 parkes \
    && chown -R parkes:parkes /app
VOLUME /app/data

# Serial (rotator) and USB (HackRF/RTL-SDR) device access is granted at
# `docker run` time, not baked into the image -- see docs/deploy.md:
#   --device=/dev/serial/by-id/<rotator>:/dev/rotator   # rotctld
#   --device=/dev/bus/usb                                # SoapySDR/HackRF
# and the user running the container needs dialout-equivalent permission on
# whatever device node(s) get passed in (--group-add matching the host's
# dialout gid, or --privileged for quick local testing).
USER parkes

#ENV PARKES_SATDUMP_OUTPUT_DIR=/app/data/satdump
#ENV PARKES_TLE_DATA_DIR=/app/data/tle
#ENV PARKES_SKYFIELD_DATA_DIR=/app/data/skyfield

# 8000: the web UI/API. 4533: rotctld. 55132: SoapyRemote sharing (soapy_remote_bind_port),
# only reachable if that feature is turned on and bound wider than localhost.
EXPOSE 8000 55132 4533
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=3)" || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "parkes.main:app", "--host", "0.0.0.0", "--port", "8000"]
