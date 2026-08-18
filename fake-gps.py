#!/usr/bin/env python3

import os
import pty
import signal
import subprocess
import time

LAT = "5230.704"
LAT_HEMI = "N"
LON = "01324.262"
LON_HEMI = "E"

master, slave = pty.openpty()
slave_name = os.ttyname(slave)

gpsd = subprocess.Popen([
    "gpsd",
    "-N",
    "-n",
    "-S", "2947",
    slave_name,
])

running = True

def stop(signum, frame):
    global running
    running = False

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)

try:
    while running:
        now = time.gmtime()
        timestamp = time.strftime("%H%M%S", now)
        date = time.strftime("%d%m%y", now)

        gga = (
            f"$GPGGA,{timestamp}.00,"
            f"{LAT},{LAT_HEMI},{LON},{LON_HEMI},"
            "1,12,1.0,0.0,M,0.0,M,,"
        )

        rmc = (
            f"$GPRMC,{timestamp}.00,A,"
            f"{LAT},{LAT_HEMI},{LON},{LON_HEMI},"
            "0.0,0.0," + date + ",,,A"
        )

        for sentence in (gga, rmc):
            checksum = 0
            for c in sentence[1:]:
                checksum ^= ord(c)

            os.write(
                master,
                f"{sentence}*{checksum:02X}\r\n".encode()
            )

        time.sleep(1)

finally:
    gpsd.terminate()
    gpsd.wait()
    os.close(master)
    os.close(slave)
