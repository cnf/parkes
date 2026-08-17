import subprocess


def list_devices() -> list[dict]:
    """Parses `SoapySDRUtil --find` output into device arg dicts (driver,
    label, serial, ...) so the Settings UI can show what SoapySDR actually
    sees -- a source id/driver typo in preferences otherwise only surfaces
    as an obscure satdump/SoapyRemote failure.
    """
    try:
        result = subprocess.run(
            ["SoapySDRUtil", "--find"], capture_output=True, text=True, timeout=10
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return [{"error": str(exc)}]

    devices: list[dict] = []
    current: dict | None = None
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("Found device"):
            current = {}
            devices.append(current)
        elif current is not None and "=" in stripped:
            key, _, value = stripped.partition("=")
            current[key.strip()] = value.strip()

    # When SoapyRemote sharing is running, mDNS makes this scan also find
    # this app's own server and re-list every locally-attached device a
    # second time under driver=remote -- a mirror of the direct entry, not
    # a distinct device, and not usable as-is as {source} (it needs the
    # extra remote=host:port arg our source/source_id preference pair
    # doesn't carry).
    return [d for d in devices if d.get("driver") != "remote"]
