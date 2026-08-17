import functools
import json
import shutil
from pathlib import Path


def _strip_json_comments(text: str) -> str:
    """satdump's pipeline JSON files aren't strictly valid JSON -- some use
    // and /* */ comments. Strip them before parsing, tracking whether
    we're inside a string literal so a "//" inside a quoted value isn't
    mistaken for a comment.
    """
    out = []
    i, n = 0, len(text)
    in_string = False
    escape = False
    while i < n:
        c = text[i]
        if in_string:
            out.append(c)
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] not in "\r\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _pipelines_dir() -> Path | None:
    binary = shutil.which("satdump")
    if not binary:
        return None
    pipelines_dir = Path(binary).resolve().parent.parent / "share" / "satdump" / "pipelines"
    return pipelines_dir if pipelines_dir.is_dir() else None


@functools.lru_cache(maxsize=1)
def list_all_pipelines() -> list[dict]:
    """Every satdump pipeline (live-capable or not), read straight from the
    installed satdump's own pipeline definitions (share/satdump/pipelines/
    *.json) -- used to offer accurate App Profile templates/pickers without
    hardcoding pipeline ids/flags here, which would drift across satdump
    versions (see app_profiles.py's DEFAULT_PROFILES comment). Returns []
    if satdump isn't installed or its pipeline defs can't be found, so
    callers just skip offering pipeline data rather than failing.
    """
    pipelines_dir = _pipelines_dir()
    if pipelines_dir is None:
        return []

    pipelines = []
    for path in sorted(pipelines_dir.glob("*.json")):
        try:
            data = json.loads(_strip_json_comments(path.read_text()))
        except (json.JSONDecodeError, OSError):
            continue
        for pipeline_id, entry in data.items():
            pipelines.append(
                {
                    "id": pipeline_id,
                    "name": entry.get("name", pipeline_id),
                    "family": path.stem,
                    "live": bool(entry.get("live")),
                    "frequencies": entry.get("frequencies", []),
                }
            )
    pipelines.sort(key=lambda p: (p["family"], p["name"]))
    return pipelines


def list_live_pipelines() -> list[dict]:
    """Live-capable subset of list_all_pipelines() -- what "satdump live"
    can actually run against an SDR, as opposed to offline-only pipelines
    that only take a recorded file as input.
    """
    return [p for p in list_all_pipelines() if p["live"]]
