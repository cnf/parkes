{ pkgs, ... }:

{
  # Hardware/tool orchestration layer: rotctld bridges EasyCommII serial,
  # satdump owns the satellite pipeline, SoapySDR talks to the SDR.
  packages = with pkgs; [
    satdump
    hamlib_4
    soapysdr-with-plugins
    hackrf
    gpsd
    socat
  ];

  languages.python = {
    enable = true;
    package = pkgs.python3.withPackages (ps: with ps; [
      fastapi
      uvicorn
      websockets
      jinja2
      pydantic-settings
      skyfield
    ]);
  };

  processes.web.exec = "uvicorn parkes.main:app --reload --host 0.0.0.0 --port 8000";

  #processes.gpsfake.exec = "gpsfake --slow ./data/gpsfake.nmea";
  processes.gpsfake.exec = "python3 fake-gps.py";

  # rotctld -- the only thing that speaks serial EasyCommII to the hardware
  # -- is no longer a separate devenv process. The "web" process now starts
  # and supervises it itself (see parkes/infra_supervisor.py), the same way
  # it will in production, so this dev environment exercises the same code
  # path instead of a nix-only stand-in for it.
  #
  # Defaults to Hamlib's dummy rotator (rotator_model=1) so the app/UI can
  # be built without hardware attached. Real EasyCommII backend notes (see
  # project memory): opening the port resets the ESP32 once (an S3
  # silicon/USB-Serial-JTAG limitation, not fixable -- harmless since
  # rotctld normally opens the port once and stays up); EL query timeouts
  # were root-caused to an ESP32-S3 native USB Serial/JTAG erratum (replies
  # land late, not lost) and are worked around with a longer rotctld read
  # timeout + retry -- opt-in per device via PARKES_ROTCTLD_TIMEOUT_MS/
  # PARKES_ROTCTLD_RETRY, not a default for every rotator model.
  #
  #   PARKES_ROTATOR_MODEL=202 PARKES_ROTATOR_DEVICE=/dev/ttyACM0 \
  #   PARKES_ROTCTLD_TIMEOUT_MS=1000 PARKES_ROTCTLD_RETRY=3 devenv up
}
