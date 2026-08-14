from parkes.process import ManagedProcess


class SoapyRemoteServer(ManagedProcess):
    """Manages a `SoapySDRServer --bind host:port` subprocess, exposing
    whatever SDR SoapySDR's configured driver finds (see
    settings.satdump_sdr_source) over the network -- so gpredict/gqrx/a
    laptop-side satdump can use it directly instead of going through this
    app's own satdump autotrack process.

    Mutually exclusive with AutotrackProcess: both want the same physical
    device, so the API layer refuses to start one while the other runs.
    """

    async def start(self, bind_host: str, bind_port: int) -> None:
        await super().start("SoapySDRServer", "--bind", f"{bind_host}:{bind_port}")
