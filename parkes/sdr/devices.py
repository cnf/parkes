import json
from pathlib import Path

from parkes.config import settings
from parkes.sdr.discovery import list_devices


def _stable_id(device: dict, index: int) -> str:
    """Best-effort stable id for a discovered device so a saved label
    survives rescans/restarts. Prefers `serial` (present for hackrf/rtlsdr),
    falling back to `label` (which for rtlsdr usually embeds the serial
    anyway, e.g. "Generic RTL2832U OEM :: 00000001"), then to a driver+index
    fallback that's only unique within a single scan -- multiple identical
    stock dongles (which often share the same default serial) will collide
    and re-label under whichever position they enumerate in.
    """
    driver = device.get("driver", "unknown")
    ident = device.get("serial") or device.get("label")
    if ident:
        return f"{driver}:{ident}"
    return f"{driver}:{index}"


def load_labels() -> dict[str, str]:
    path = Path(settings.sdr_devices_file)
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def save_labels(labels: dict[str, str]) -> None:
    path = Path(settings.sdr_devices_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(labels, indent=2))


def set_label(device_id: str, label: str) -> None:
    """Sets (or, given an empty label, clears) a single device's label --
    read-modify-write against the current file, so a caller only ever
    touches the one id it names, never the whole collection (see
    api/sdr.py)."""
    labels = load_labels()
    if label:
        labels[device_id] = label
    else:
        labels.pop(device_id, None)
    save_labels(labels)


def list_devices_with_labels() -> list[dict]:
    devices = list_devices()
    if len(devices) == 1 and "error" in devices[0]:
        return devices
    labels = load_labels()
    result = []
    for index, device in enumerate(devices):
        device_id = _stable_id(device, index)
        result.append({**device, "id": device_id, "custom_label": labels.get(device_id, "")})
    return result
