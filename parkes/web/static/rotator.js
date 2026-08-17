(() => {
  const headingEl = document.getElementById("rotator-heading");
  const elEl = document.getElementById("rotator-el");
  const statusEl = document.getElementById("rotator-status");
  const dotEl = document.getElementById("rotator-dot");
  const ticksEl = document.getElementById("compass-ticks");
  const dishGroupEl = document.getElementById("elevation-dish-group");

  // The dish pivots directly above the azimuth marker (DISH_CENTER_X, at
  // the compass's own top edge). Its vertical position moves independently
  // of its rotation: PIVOT_Y_AT_0/90 are chosen so the dish -- a fixed
  // shape, sized to real parabolic-dish proportions (radius 35, sag-based
  // depth 22) -- always stays fully above the compass, closing to a small
  // visible gap at 90 degrees rather than swinging through the tape at
  // some angle in between. See project memory / chat history for the
  // geometry this was derived from.
  const DISH_CENTER_X = 200;
  const PIVOT_Y_AT_0 = 55;
  const PIVOT_Y_AT_90 = 78;

  const CARDINALS = { 0: "N", 90: "E", 180: "S", 270: "W" };
  const INTERCARDINALS = { 45: "NE", 135: "SE", 225: "SW", 315: "NW" };
  const PX_PER_DEG = 6;
  const TICK_STEP = 10;
  // Labeled ticks (numbers and cardinals/intercardinals alike) sit on one
  // shared 15-degree grid, so the labeled spacing along the tape reads as
  // one steady rhythm -- every 3rd label lands on N/NE/E/... -- instead of
  // numbers every 30 degrees with cardinals overlaid on a different,
  // incompatible 45/90-degree grid (which looked randomly spaced).
  const LABEL_STEP = 15;
  const HALF_RANGE = 70;

  function renderCompass(heading) {
    ticksEl.innerHTML = "";
    const end = heading + HALF_RANGE;

    const minorStart = Math.ceil((heading - HALF_RANGE) / TICK_STEP) * TICK_STEP;
    for (let deg = minorStart; deg <= end; deg += TICK_STEP) {
      const normalized = ((deg % 360) + 360) % 360;
      if (normalized % LABEL_STEP === 0) continue; // drawn in the labeled pass below

      const tick = document.createElement("div");
      tick.className = "compass-tick";
      tick.style.left = `calc(50% + ${(deg - heading) * PX_PER_DEG}px)`;

      const line = document.createElement("div");
      line.className = "line";
      tick.appendChild(line);

      ticksEl.appendChild(tick);
    }

    const labelStart = Math.ceil((heading - HALF_RANGE) / LABEL_STEP) * LABEL_STEP;
    for (let deg = labelStart; deg <= end; deg += LABEL_STEP) {
      const normalized = ((deg % 360) + 360) % 360;
      const isCardinal = normalized % 90 === 0;
      const isIntercardinal = !isCardinal && normalized % 45 === 0;

      const tick = document.createElement("div");
      tick.className =
        "compass-tick" + (isCardinal ? " cardinal" : isIntercardinal ? " intercardinal" : " major");
      tick.style.left = `calc(50% + ${(deg - heading) * PX_PER_DEG}px)`;

      const line = document.createElement("div");
      line.className = "line";
      tick.appendChild(line);

      const label = document.createElement("div");
      label.className = "label";
      label.textContent = isCardinal
        ? CARDINALS[normalized]
        : isIntercardinal
          ? INTERCARDINALS[normalized]
          : String(normalized).padStart(3, "0");
      tick.appendChild(label);

      ticksEl.appendChild(tick);
    }
  }

  function setStatus(text, dotState) {
    statusEl.textContent = text;
    dotEl.classList.toggle("on", dotState === "on");
    dotEl.classList.toggle("error", dotState === "error");
  }

  function renderPosition(az, el) {
    headingEl.textContent = az.toFixed(1);
    elEl.textContent = el.toFixed(1);
    renderCompass(az);
    const clampedEl = Math.max(0, Math.min(90, el));
    const pivotY = PIVOT_Y_AT_0 + (clampedEl / 90) * (PIVOT_Y_AT_90 - PIVOT_Y_AT_0);
    dishGroupEl.setAttribute("transform", `translate(${DISH_CENTER_X} ${pivotY}) rotate(${-el})`);
  }

  // The websocket only pushes a fresh az/el once a second (see
  // api/rotator.py's position_stream). Easing toward each new value (an
  // earlier version of this) necessarily decelerates as it arrives --
  // that's inherent to "smoothing toward a fixed point" -- so there was
  // always a coast-to-a-stop before the next update, however it was tuned.
  //
  // Dead reckoning instead: estimate the rotator's angular velocity from
  // the last two updates, and keep extrapolating forward every frame
  // rather than re-approaching a static target each time (the standard fix
  // for smoothing periodic updates of something that's actually moving
  // continuously). That alone reads as continuous motion during steady
  // slewing, but the rotator decelerates approaching a target -- the
  // velocity estimated from the previous (faster) second over-predicts
  // right as it's slowing down, so the next real update lands behind the
  // extrapolation and yanks it back.
  //
  // Rather than rendering the raw extrapolation directly, a second value
  // (displayedAz/El) chases it with a short, continuous ease
  // (CORRECTION_TIME_CONSTANT): negligible lag during steady motion since
  // there's nothing to correct, but it absorbs a bad prediction as a brief
  // smooth slide instead of an instant snap when the velocity estimate
  // turns out to have been wrong.
  let lastAz = null;
  let lastEl = null;
  let lastUpdateTime = null;
  let velAz = 0; // degrees/second
  let velEl = 0;
  let displayedAz = null;
  let displayedEl = null;
  let lastFrameTime = null;
  const CORRECTION_TIME_CONSTANT = 0.2;

  function azDelta(from, to) {
    // Shortest signed distance from `from` to `to` around the compass, so
    // e.g. 350 -> 10 is a velocity of +20/dt (through 360/0), not -340/dt.
    return (((to - from + 180) % 360) + 360) % 360 - 180;
  }

  function animate(timestamp) {
    if (lastAz !== null) {
      // Capped so a stalled/delayed update (or the tab having been
      // backgrounded) doesn't extrapolate wildly off a stale velocity.
      const elapsed = Math.min((timestamp - lastUpdateTime) / 1000, 2);
      const predictedAz = (((lastAz + velAz * elapsed) % 360) + 360) % 360;
      const predictedEl = lastEl + velEl * elapsed;

      if (displayedAz === null) {
        displayedAz = predictedAz;
        displayedEl = predictedEl;
        lastFrameTime = timestamp;
      } else {
        const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.25);
        lastFrameTime = timestamp;
        const factor = 1 - Math.exp(-dt / CORRECTION_TIME_CONSTANT);
        displayedAz = (((displayedAz + azDelta(displayedAz, predictedAz) * factor) % 360) + 360) % 360;
        displayedEl += (predictedEl - displayedEl) * factor;
      }
      renderPosition(displayedAz, displayedEl);
    }
    requestAnimationFrame(animate);
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/rotator/ws`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        setStatus(`error: ${data.error}`, "error");
        return;
      }
      const now = performance.now();
      if (lastAz !== null) {
        const dt = (now - lastUpdateTime) / 1000;
        // Upper bound comfortably above the server's idle heartbeat
        // interval (currently 5s) so those heartbeats still get used to
        // (re)confirm velocity settling to ~0 while stationary, rather
        // than leaving whatever velocity was last estimated during motion.
        if (dt > 0 && dt < 10) {
          velAz = azDelta(lastAz, data.az) / dt;
          velEl = (data.el - lastEl) / dt;
        }
      }
      lastAz = data.az;
      lastEl = data.el;
      lastUpdateTime = now;
      setStatus("connected", "on");
    };
    ws.onclose = () => {
      setStatus("disconnected, retrying...", "error");
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
  }

  async function post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      setStatus(`error: ${await res.text()}`, "error");
    }
  }

  document.getElementById("goto-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const az = parseFloat(document.getElementById("goto-az").value);
    const el = parseFloat(document.getElementById("goto-el").value);
    post("/api/rotator/goto", { az, el });
  });

  document.getElementById("park-btn").addEventListener("click", () => {
    post("/api/rotator/park");
  });

  for (const btn of document.querySelectorAll("[data-jog]")) {
    const direction = btn.dataset.jog;
    const start = (event) => {
      event.preventDefault();
      post("/api/rotator/move", { direction });
    };
    const stop = () => post("/api/rotator/stop");
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointerleave", stop);
  }

  connect();
  requestAnimationFrame(animate);
})();
