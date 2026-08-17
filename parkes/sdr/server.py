from parkes.process import ManagedProcess


class SoapyRemoteServer(ManagedProcess):
    """Manages a `SoapySDRServer --bind=host:port` subprocess, exposing
    whatever SDR SoapySDR's configured driver finds (see
    settings.satdump_sdr_source) over the network -- so gpredict/gqrx/a
    laptop-side satdump can use it directly instead of going through this
    app's own Pass Orchestrator.

    Mutually exclusive with the Pass Orchestrator: both want the same
    physical device. Manual start/stop still refuses to run both at once
    (see api/sdr.py, api/orchestrator.py); with the "soapy_remote_auto"
    preference on, SdrArbiter (see sdr/arbiter.py) instead stops this
    automatically right before a local app profile that needs the SDR
    launches, and restarts it once nothing local needs it anymore.
    """

    async def start(self, bind_host: str, bind_port: int) -> None:
        # Must be a single "--bind=host:port" token -- SoapySDRServer
        # doesn't treat "--bind" "host:port" as two args and silently
        # falls back to its default port instead of erroring.
        await super().start("SoapySDRServer", f"--bind={bind_host}:{bind_port}")

    def connections(self) -> int:
        """Currently-open client connections, best-effort from the
        server's own stdout log ("SoapyServerListener::accept(...)" /
        "::close()" lines -- close() doesn't say which connection, so this
        is an accept/close balance, not a verified list of who's still
        attached).
        """
        if not self.running:
            return 0
        open_count = 0
        for line in self.log_lines:
            if "SoapyServerListener::accept(" in line:
                open_count += 1
            elif "SoapyServerListener::close()" in line:
                open_count = max(0, open_count - 1)
        return open_count
