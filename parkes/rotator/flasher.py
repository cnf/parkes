import shutil
import tempfile
from pathlib import Path

from parkes.config import settings
from parkes.process import ManagedProcess


class FirmwareFlasher(ManagedProcess):
    """Runs `esptool write_flash` as a managed subprocess to update the
    EasyCommII board's app partition from a browser-uploaded .bin (see
    api/rotator.py's /flash endpoint). Chip/offset/flash-mode/etc. are
    hardware constants for this specific board (config.py's esptool_*
    settings) rather than parsed from an ESP-IDF build's
    flasher_args.json -- Parkes only ever rewrites the single app
    partition, so there's nothing build-specific to read beyond the
    binary itself, and hardcoding avoids making the user hunt down and
    upload a second file every time. Reuses ManagedProcess's subprocess
    handling and log_lines tailing -- same as SoapyRemoteServer.

    Flag/subcommand spelling is deliberately the underscore style
    (write_flash, default_reset, --flash_mode, ...), not esptool v5's
    newer hyphenated aliases -- underscores work on both v5+ (accepted,
    just deprecation-warns) and pre-v5 (hyphens are a hard error there,
    confirmed against a real esptool on the user's machine). Portability
    across whatever esptool version ends up installed matters more than
    silencing a deprecation warning on one specific version.
    """

    def __init__(self):
        super().__init__()
        self._workdir: Path | None = None

    async def start(self, device: str, app_bytes: bytes) -> None:
        if self.running:
            raise RuntimeError("a flash is already in progress")

        self._cleanup_workdir()
        workdir = Path(tempfile.mkdtemp(prefix="parkes-flash-"))
        self._workdir = workdir
        app_path = workdir / "app.bin"
        app_path.write_bytes(app_bytes)

        argv = [
            settings.esptool_bin,
            "--chip", settings.esptool_chip,
            "--port", device,
            "--before", "default_reset",
            "--after", "hard_reset",
            "write_flash",
            "--flash_mode", settings.esptool_flash_mode,
            "--flash_freq", settings.esptool_flash_freq,
            "--flash_size", settings.esptool_flash_size,
            settings.esptool_app_offset, str(app_path),
        ]
        await super().start(*argv)

    def _cleanup_workdir(self) -> None:
        if self._workdir is not None:
            shutil.rmtree(self._workdir, ignore_errors=True)
            self._workdir = None

    async def stop(self) -> None:
        await super().stop()
        self._cleanup_workdir()
