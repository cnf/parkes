{ pkgs, ... }:

{
  # Hardware/tool orchestration layer: rotctld bridges EasyCommII serial,
  # satdump owns the satellite pipeline, SoapySDR talks to the SDR.
  packages = with pkgs; [
    satdump
    hamlib_4
    soapysdr-with-plugins
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

  processes.web.exec = "uvicorn pidish.main:app --reload --host 0.0.0.0 --port 8000";

  # rotctld is the only thing that speaks serial EasyCommII to the hardware.
  # Defaults to Hamlib's dummy rotator so the app/UI can be built without
  # hardware attached. Known issues with the real EasyCommII backend (DTR/RTS
  # resets the board; EL query times out) are tracked in project memory --
  # switch PIDISH_ROTATOR=real once those are sorted out.
  #
  #   PIDISH_ROTATOR=real devenv up      # use the real controller instead
  processes.rotctld.exec = ''
    if [ "''${PIDISH_ROTATOR:-dummy}" = "real" ]; then
      exec rotctld -m 202 -r "''${PIDISH_SERIAL_DEVICE:-/dev/ttyACM0}" -T 127.0.0.1 -t 4533
    else
      exec rotctld -m 1 -T 127.0.0.1 -t 4533
    fi
  '';
}
