(() => {
  const locationBtn = document.getElementById("location-btn");
  const overlay = document.getElementById("location-modal-overlay");
  const closeBtn = document.getElementById("location-modal-close");
  const cancelBtn = document.getElementById("location-cancel-btn");
  const saveBtn = document.getElementById("location-save-btn");
  const modeDefaultRadio = document.getElementById("location-mode-default");
  const modeManualRadio = document.getElementById("location-mode-manual");
  const defaultHint = document.getElementById("location-default-hint");
  const latInput = document.getElementById("location-manual-lat");
  const lonInput = document.getElementById("location-manual-lon");
  const elevInput = document.getElementById("location-manual-elev");
  const geocodeHint = document.getElementById("location-geocode-hint");
  const useBrowserBtn = document.getElementById("location-use-browser-btn");
  const statusEl = document.getElementById("location-status");

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

  function applyMode() {
    const manual = modeManualRadio.checked;
    for (const el of [latInput, lonInput, elevInput, useBrowserBtn]) {
      el.disabled = !manual;
    }
  }

  modeDefaultRadio.addEventListener("change", applyMode);
  modeManualRadio.addEventListener("change", applyMode);

  async function refreshButtonLabel() {
    const data = await apiFetch("/api/settings");
    const p = data.preferences;
    const usingManual = p.observer_location_mode === "manual";
    const lat = usingManual ? p.observer_manual_lat : p.observer_lat;
    const lon = usingManual ? p.observer_manual_lon : p.observer_lon;
    locationBtn.textContent = `\u{1F4CD} ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    locationBtn.title = "";
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
    const usingManual = p.observer_location_mode === "manual";
    modeDefaultRadio.checked = !usingManual;
    modeManualRadio.checked = usingManual;
    latInput.value = p.observer_manual_lat;
    lonInput.value = p.observer_manual_lon;
    elevInput.value = p.observer_manual_elevation_m;
    applyMode();
    scheduleManualGeocode();
    overlay.style.display = "flex";
  }

  function closeModal() {
    overlay.style.display = "none";
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
    const mode = modeManualRadio.checked ? "manual" : "default";
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
  });

  refreshButtonLabel();
})();
