from parkes.process import ManagedProcess


class AutotrackProcess(ManagedProcess):
    """Manages a single `satdump autotrack <config>` subprocess.

    satdump's CLI autotrack mode owns the entire satellite pass pipeline
    internally (scheduling, tracking, capture, decode) -- this only starts,
    stops, and tails its log output.
    """

    async def start(self, config_path: str) -> None:
        await super().start("satdump", "autotrack", config_path)
