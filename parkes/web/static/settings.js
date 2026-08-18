(() => {
  const preferencesForm = document.getElementById("settings-form");
  const preferencesStatusEl = document.getElementById("settings-status");
  const rotatorForm = document.getElementById("rotator-form");
  const rotatorStatusEl = document.getElementById("rotator-form-status");
  const gpsdForm = document.getElementById("gpsd-form");
  const gpsdStatusEl = document.getElementById("gpsd-form-status");
  const infraList = document.getElementById("infra-list");
  const modelSelect = rotatorForm.elements.namedItem("rotator_model");
  const rotatorManagedCheckbox = rotatorForm.elements.namedItem("rotctld_managed");
  const gpsdManagedCheckbox = gpsdForm.elements.namedItem("gpsd_managed");
  const rotatorBindRow = document.getElementById("rotator-bind-row");
  const gpsdBindRow = document.getElementById("gpsd-bind-row");

  const NUMERIC_FIELDS = new Set([
    "observer_lat",
    "observer_lon",
    "observer_elevation_m",
    "tracking_interval_seconds",
    "orchestrator_min_elevation",
    "rotctld_port",
    "rotator_model",
    "rotctld_timeout_ms",
    "rotctld_retry",
    "gpsd_port",
  ]);

  // Checkboxes: FormData omits an unchecked box entirely and stringifies a
  // checked one as "on", so these are read/written via .checked directly
  // rather than through the generic FormData loop below.
  const BOOLEAN_FIELDS = new Set(["rotctld_managed", "gpsd_managed"]);

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async function apiFetch(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  }

  function fillForm(form, values) {
    for (const [key, value] of Object.entries(values)) {
      const input = form.elements.namedItem(key);
      if (!input) continue; // this form doesn't have that field, not an error
      if (BOOLEAN_FIELDS.has(key)) input.checked = Boolean(value);
      else input.value = value ?? "";
    }
  }

  function setDot(dotId, textId, ok, onText, offText) {
    const dot = document.getElementById(dotId);
    const text = document.getElementById(textId);
    dot.classList.toggle("on", ok === true);
    dot.classList.toggle("error", ok === false);
    text.textContent = ok === true ? onText : offText;
  }

  async function populateModelOptions() {
    try {
      const models = await apiFetch("/api/rotator/models");
      modelSelect.innerHTML = "";
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = `${m.id} — ${m.mfg} ${m.model}`;
        modelSelect.appendChild(opt);
      }
    } catch {
      // rotctl isn't on PATH, or the call failed -- leave the dropdown
      // empty; ensureModelOption() below still adds a fallback entry for
      // whatever's currently saved, so a real config value is never lost.
    }
  }

  function ensureModelOption(modelId) {
    const hasMatch = Array.from(modelSelect.options).some((o) => Number(o.value) === modelId);
    if (!hasMatch) {
      const opt = document.createElement("option");
      opt.value = modelId;
      opt.textContent = `${modelId} (not in rotctl -l)`;
      modelSelect.appendChild(opt);
    }
    modelSelect.value = modelId;
  }

  function updateBindRowVisibility() {
    // Bind address only means anything when Parkes itself is spawning the
    // daemon -- hide it otherwise so it doesn't read as "this affects
    // something running elsewhere."
    rotatorBindRow.style.display = rotatorManagedCheckbox.checked ? "" : "none";
    gpsdBindRow.style.display = gpsdManagedCheckbox.checked ? "" : "none";
  }
  rotatorManagedCheckbox.addEventListener("change", updateBindRowVisibility);
  gpsdManagedCheckbox.addEventListener("change", updateBindRowVisibility);

  function renderRotatorStatus(status) {
    if (!status) {
      setDot("rotator-mgmt-dot", "rotator-mgmt-status", null, "", "not managed by Parkes");
      return;
    }
    const ok = status.state === "running" || status.state === "external";
    setDot("rotator-mgmt-dot", "rotator-mgmt-status", ok, status.state, status.state);
  }

  function renderGpsdStatus(status) {
    const fixText = status.has_fresh_fix
      ? `fix: ${status.lat.toFixed(5)}, ${status.lon.toFixed(5)}` +
        (status.altitude_m != null ? `, ${status.altitude_m.toFixed(0)}m` : "")
      : status.last_error
        ? `no fix -- ${status.last_error}`
        : "no fix yet";
    setDot("gpsd-mgmt-dot", "gpsd-mgmt-status", status.has_fresh_fix, fixText, fixText);
  }

  async function loadAll() {
    const data = await apiFetch("/api/settings");
    fillForm(preferencesForm, data.preferences);
    fillForm(rotatorForm, data.preferences);
    ensureModelOption(data.preferences.rotator_model);
    fillForm(gpsdForm, data.preferences);
    updateBindRowVisibility();
    infraList.innerHTML = "";
    for (const [key, value] of Object.entries(data.infra)) {
      const row = document.createElement("div");
      row.className = "infra-row";
      row.innerHTML = `<span>${escapeHtml(key)}</span><span class="val">${escapeHtml(String(value))}</span>`;
      infraList.appendChild(row);
    }
    renderRotatorStatus(data.infra_status.rotctld);
    renderGpsdStatus(data.gpsd_status);
  }

  async function refreshStatusOnly() {
    const data = await apiFetch("/api/settings");
    renderRotatorStatus(data.infra_status.rotctld);
    renderGpsdStatus(data.gpsd_status);
  }

  function wireForm(form, statusEl) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      statusEl.textContent = "";
      const formData = new FormData(form);
      const values = {};
      for (const [key, raw] of formData.entries()) {
        if (BOOLEAN_FIELDS.has(key)) continue; // handled below
        if (NUMERIC_FIELDS.has(key)) {
          if (raw.trim() === "") continue; // don't coerce a blank field to 0
          values[key] = Number(raw);
        } else {
          values[key] = raw;
        }
      }
      for (const key of BOOLEAN_FIELDS) {
        const input = form.elements.namedItem(key);
        if (input) values[key] = input.checked;
      }
      try {
        await apiFetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        statusEl.textContent = "saved";
        setTimeout(() => {
          statusEl.textContent = "";
        }, 2000);
        await loadAll(); // pick up the post-reconfigure live status right away
      } catch (err) {
        statusEl.textContent = `error: ${err.message}`;
      }
    });
  }

  wireForm(preferencesForm, preferencesStatusEl);
  wireForm(rotatorForm, rotatorStatusEl);
  wireForm(gpsdForm, gpsdStatusEl);

  (async () => {
    await populateModelOptions(); // must exist before loadAll() sets a value
    await loadAll();
    setInterval(() => {
      refreshStatusOnly().catch(() => {}); // transient fetch error -- next tick retries
    }, 5000);
  })();
})();
