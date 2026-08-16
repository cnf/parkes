{ pkgs, ... }:

{
  # Hardware/tool orchestration layer: rotctld bridges EasyCommII serial,
  # satdump owns the satellite pipeline, SoapySDR talks to the SDR.
  packages = with pkgs; [
    satdump
    hamlib_4
    soapysdr-with-plugins
    hackrf
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

  processes.web.exec = "uvicorn parkes.main:app --host 0.0.0.0 --port 8000";

  # rotctld is the only thing that speaks serial EasyCommII to the hardware.
  # Defaults to Hamlib's dummy rotator so the app/UI can be built without
  # hardware attached. Real EasyCommII backend notes (see project memory):
  # opening the port resets the ESP32 once (an S3 silicon/USB-Serial-JTAG
  # limitation, not fixable -- harmless since rotctld normally opens the
  # port once and stays up); EL query timeouts were root-caused to an
  # ESP32-S3 native USB Serial/JTAG erratum (replies land late, not lost)
  # and are fixed here with a longer rotctld read timeout + retry.
  #
  #   PARKES_ROTATOR=real devenv up      # use the real controller instead
  processes.rotctld.exec = ''
    if [ "''${PARKES_ROTATOR:-dummy}" = "real" ]; then
      exec rotctld -m 202 -r "''${PARKES_SERIAL_DEVICE:-/dev/ttyACM0}" -C timeout=1000,retry=3 -T 127.0.0.1 -t 4533
    else
      exec rotctld -m 1 -T 127.0.0.1 -t 4533
    fi
  '';
}
