(() => {
  const locationBtn = document.getElementById("location-btn");
  const overlay = document.getElementById("location-modal-overlay");
  const closeBtn = document.getElementById("location-modal-close");
  const cancelBtn = document.getElementById("location-cancel-btn");
  const saveBtn = document.getElementById("location-save-btn");
  const modeDefaultRadio = document.getElementById("location-mode-default");
  const modeManualRadio = document.getElementById("location-mode-manual");
  const modeGpsdRadio = document.getElementById("location-mode-gpsd");
  const defaultHint = document.getElementById("location-default-hint");
  const latInput = document.getElementById("location-manual-lat");
  const lonInput = document.getElementById("location-manual-lon");
  const elevInput = document.getElementById("location-manual-elev");
  const geocodeHint = document.getElementById("location-geocode-hint");
  const gpsdHint = document.getElementById("location-gpsd-hint");
  const useBrowserBtn = document.getElementById("location-use-browser-btn");
  const statusEl = document.getElementById("location-status");
  const clockEl = document.getElementById("header-clock");

  async function apiFetch(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? "var(--danger)" : "var(--text-muted)";
  }

  // "General area" feedback -- best-effort and non-blocking. A failed
  // lookup (offline, rate-limited, ocean coordinates) just leaves the
  // hint/tooltip blank rather than showing an error, since this is a
  // nice-to-have, not something callers should depend on.
  async function geocodeLabel(lat, lon) {
    try {
      const data = await apiFetch(`/api/tracking/reverse_geocode?lat=${lat}&lon=${lon}`);
      return data.label;
    } catch {
      return null;
    }
  }

  // Local time *at the observer location*, not the browser's -- the point
  // is knowing what time it is at the dish when controlling it remotely.
  // Resolving lat/lon to an IANA zone only needs to happen when the
  // location changes; a plain interval reformats "now" in that zone every
  // tick, no refetch needed.
  let clockTimezone = null;

  function updateClockDisplay() {
    if (!clockEl) return;
    if (!clockTimezone) {
      clockEl.textContent = "";
      return;
    }
    try {
      clockEl.textContent = new Intl.DateTimeFormat([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: clockTimezone,
      }).format(new Date());
    } catch {
      clockEl.textContent = "";
    }
  }

  async function refreshClockTimezone(lat, lon) {
    try {
      const data = await apiFetch(`/api/tracking/timezone?lat=${lat}&lon=${lon}`);
      clockTimezone = data.timezone;
    } catch {
      clockTimezone = null;
    }
    updateClockDisplay();
  }

  function applyMode() {
    const manual = modeManualRadio.checked;
    const gpsd = modeGpsdRadio.checked;
    for (const el of [latInput, lonInput, elevInput, useBrowserBtn]) {
      el.disabled = !manual;
    }
    gpsdHint.style.display = gpsd ? "" : "none";
  }

  modeDefaultRadio.addEventListener("change", applyMode);
  modeManualRadio.addEventListener("change", applyMode);
  modeGpsdRadio.addEventListener("change", applyMode);

  function renderGpsdHint(gpsdStatus) {
    if (!gpsdStatus.has_fresh_fix) {
      gpsdHint.textContent = gpsdStatus.last_error
        ? `No fix yet -- gpsd: ${gpsdStatus.last_error}`
        : "No fix yet -- waiting for gpsd...";
      return;
    }
    gpsdHint.textContent =
      `Fix: ${gpsdStatus.lat.toFixed(5)}, ${gpsdStatus.lon.toFixed(5)}` +
      (gpsdStatus.altitude_m != null ? `, ${gpsdStatus.altitude_m.toFixed(0)}m` : "");
  }

  async function refreshButtonLabel() {
    const data = await apiFetch("/api/settings");
    const { lat, lon } = data.effective_location;
    locationBtn.textContent = `\u{1F4CD} ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    locationBtn.title = "";
    refreshClockTimezone(lat, lon);
    const label = await geocodeLabel(lat, lon);
    if (label) locationBtn.title = label;
  }

  let manualGeocodeDebounce;
  function scheduleManualGeocode() {
    geocodeHint.textContent = " ";
    clearTimeout(manualGeocodeDebounce);
    const lat = Number(latInput.value);
    const lon = Number(lonInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    manualGeocodeDebounce = setTimeout(async () => {
      const label = await geocodeLabel(lat, lon);
      geocodeHint.textContent = label ? `→ ${label}` : " ";
    }, 600);
  }

  for (const el of [latInput, lonInput]) {
    el.addEventListener("input", scheduleManualGeocode);
  }

  let gpsdPollTimer;

  async function openModal() {
    setStatus("", false);
    const data = await apiFetch("/api/settings");
    const p = data.preferences;
    defaultHint.textContent =
      `Default: ${p.observer_lat.toFixed(4)}, ${p.observer_lon.toFixed(4)}, ` +
      `${p.observer_elevation_m}m (set on the Settings page)`;
    geocodeLabel(p.observer_lat, p.observer_lon).then((label) => {
      if (label) defaultHint.textContent += ` — ${label}`;
    });
    modeDefaultRadio.checked = p.observer_location_mode === "default";
    modeManualRadio.checked = p.observer_location_mode === "manual";
    modeGpsdRadio.checked = p.observer_location_mode === "gpsd";
    latInput.value = p.observer_manual_lat;
    lonInput.value = p.observer_manual_lon;
    elevInput.value = p.observer_manual_elevation_m;
    renderGpsdHint(data.gpsd_status);
    applyMode();
    scheduleManualGeocode();
    overlay.style.display = "flex";
    // Live-ish while the modal's open, mainly useful right after plugging
    // a GPS module in and watching it acquire a fix -- not worth polling
    // once the modal's closed.
    clearInterval(gpsdPollTimer);
    gpsdPollTimer = setInterval(async () => {
      const fresh = await apiFetch("/api/settings");
      renderGpsdHint(fresh.gpsd_status);
    }, 3000);
  }

  function closeModal() {
    overlay.style.display = "none";
    clearInterval(gpsdPollTimer);
  }

  locationBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });

  useBrowserBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation isn't available in this browser.", true);
      return;
    }
    setStatus("Locating...", false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        latInput.value = pos.coords.latitude.toFixed(6);
        lonInput.value = pos.coords.longitude.toFixed(6);
        // Altitude is frequently unavailable (device/OS dependent) --
        // leave the existing elevation value in that case rather than
        // clobbering it with something misleading.
        if (pos.coords.altitude != null) {
          elevInput.value = Math.round(pos.coords.altitude);
        }
        setStatus("", false);
        scheduleManualGeocode();
      },
      (err) => {
        setStatus(`Couldn't get location: ${err.message}`, true);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  saveBtn.addEventListener("click", async () => {
    const mode = modeGpsdRadio.checked ? "gpsd" : modeManualRadio.checked ? "manual" : "default";
    const body = { observer_location_mode: mode };
    if (mode === "manual") {
      body.observer_manual_lat = Number(latInput.value);
      body.observer_manual_lon = Number(lonInput.value);
      body.observer_manual_elevation_m = Number(elevInput.value);
    }
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
      return;
    }
    closeModal();
    refreshButtonLabel();
    // tracking.js's az/el table is otherwise only as fresh as its own
    // polling interval -- without this, a location change looks like it
    // did nothing until that next poll (or a page reload) happens to land.
    window.dispatchEvent(new Event("parkes:location-changed"));
  });

  refreshButtonLabel();
  setInterval(updateClockDisplay, 15000);
})();
