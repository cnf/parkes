(() => {
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

  function flashStatus(el, text, isError) {
    el.textContent = text;
    el.style.color = isError ? "var(--danger)" : "var(--text-muted)";
    if (!isError) {
      setTimeout(() => {
        if (el.textContent === text) el.textContent = "";
      }, 2000);
    }
  }

  // ---------------------------------------------------------------------
  // SDR Devices -- detected via SoapySDR (SoapySDRUtil --find). Devices
  // aren't user-created like profiles/satellites, so there's no add/edit
  // view -- just an inline-editable label per detected device, saved as
  // soon as it changes. The SDR Source picker below is populated from the
  // same scan.
  // ---------------------------------------------------------------------

  const devicesTableBody = document.getElementById("devices-table-body");
  const devicesRescanBtn = document.getElementById("devices-rescan-btn");
  const devicesStatus = document.getElementById("devices-status");
  const sourcePicker = document.getElementById("sdr-source-picker");

  let devices = [];

  // PUTs by device id, one label at a time -- never the whole label
  // collection.
  async function saveDeviceLabel(id, value) {
    await apiFetch(`/api/sdr/devices/${encodeURIComponent(id)}/label`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: value }),
    });
  }

  function renderSourcePicker() {
    sourcePicker.innerHTML = '<option value="">-- pick a detected device --</option>';
    for (const d of devices) {
      const opt = document.createElement("option");
      opt.value = JSON.stringify({ source: d.driver, source_id: d.serial || "" });
      opt.textContent = d.custom_label
        ? `${d.custom_label} (${d.driver})`
        : `${d.driver} -- ${d.label || d.serial || d.id}`;
      sourcePicker.appendChild(opt);
    }
  }

  function connectStringCell(text) {
    const td = document.createElement("td");
    const code = document.createElement("code");
    code.style.cssText = "font-size: 0.78rem; word-break: break-all;";
    code.textContent = text;
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn-sm";
    copyBtn.textContent = "Copy";
    copyBtn.style.cssText = "margin-left: 0.4rem; white-space: nowrap;";
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(text);
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = original;
      }, 1200);
    });
    td.append(code, copyBtn);
    return td;
  }

  async function loadDevices() {
    devicesTableBody.innerHTML = `<tr><td colspan="5" class="hint">scanning...</td></tr>`;
    try {
      devices = await apiFetch("/api/sdr/devices");
    } catch (err) {
      devicesTableBody.innerHTML = `<tr><td colspan="5" class="hint">error: ${escapeHtml(err.message)}</td></tr>`;
      devices = [];
      renderSourcePicker();
      return;
    }
    if (devices.length === 1 && devices[0].error) {
      devicesTableBody.innerHTML = `<tr><td colspan="5" class="hint">error: ${escapeHtml(devices[0].error)}</td></tr>`;
      devices = [];
      renderSourcePicker();
      return;
    }
    if (devices.length === 0) {
      devicesTableBody.innerHTML = `<tr><td colspan="5" class="hint">no devices found</td></tr>`;
      renderSourcePicker();
      return;
    }

    devicesTableBody.innerHTML = "";
    for (const device of devices) {
      const row = document.createElement("tr");

      const labelTd = document.createElement("td");
      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.placeholder = device.label || device.driver || "device";
      labelInput.value = device.custom_label || "";
      labelInput.addEventListener("change", async () => {
        try {
          await saveDeviceLabel(device.id, labelInput.value.trim());
          device.custom_label = labelInput.value.trim();
          flashStatus(devicesStatus, "saved", false);
          renderSourcePicker();
        } catch (err) {
          flashStatus(devicesStatus, `error: ${err.message}`, true);
        }
      });
      labelTd.appendChild(labelInput);

      const driverTd = document.createElement("td");
      driverTd.textContent = device.driver || "?";

      const idTd = document.createElement("td");
      idTd.style.cssText = "color: var(--text-muted); font-family: ui-monospace, monospace; font-size: 0.8rem;";
      idTd.textContent = device.serial || device.id;

      row.append(
        labelTd,
        driverTd,
        idTd,
        connectStringCell(device.connect_local),
        connectStringCell(device.connect_remote)
      );
      devicesTableBody.appendChild(row);
    }

    renderSourcePicker();
  }

  devicesRescanBtn.addEventListener("click", loadDevices);

  // ---------------------------------------------------------------------
  // SDR Source -- the source/source_id/samplerate preferences app profiles
  // fill their {source}/{source_id}/{samplerate} command placeholders from.
  // ---------------------------------------------------------------------

  const sourceForm = document.getElementById("sdr-source-form");
  const sourceStatus = document.getElementById("sdr-source-status");

  sourcePicker.addEventListener("change", () => {
    if (!sourcePicker.value) return;
    const { source, source_id } = JSON.parse(sourcePicker.value);
    sourceForm.elements.namedItem("satdump_sdr_source").value = source;
    sourceForm.elements.namedItem("satdump_sdr_source_id").value = source_id;
  });

  async function loadSourcePrefs() {
    const data = await apiFetch("/api/settings");
    for (const key of ["satdump_sdr_source", "satdump_sdr_source_id", "satdump_samplerate"]) {
      const input = sourceForm.elements.namedItem(key);
      if (input) input.value = data.preferences[key] ?? "";
    }
  }

  sourceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(sourceForm);
    const values = {
      satdump_sdr_source: formData.get("satdump_sdr_source"),
      satdump_sdr_source_id: formData.get("satdump_sdr_source_id"),
    };
    const rate = formData.get("satdump_samplerate").trim();
    if (rate !== "") values.satdump_samplerate = Number(rate);
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      flashStatus(sourceStatus, "saved", false);
    } catch (err) {
      flashStatus(sourceStatus, `error: ${err.message}`, true);
    }
  });

  // ---------------------------------------------------------------------
  // SDR Network Sharing (SoapyRemote)
  // ---------------------------------------------------------------------

  const statusEl = document.getElementById("sdr-status");
  const dotEl = document.getElementById("sdr-dot");
  const startBtn = document.getElementById("sdr-start-btn");
  const stopBtn = document.getElementById("sdr-stop-btn");
  const manualControls = document.getElementById("sdr-manual-controls");
  const autoToggle = document.getElementById("sdr-auto-toggle");
  const errorEl = document.getElementById("sdr-error");
  const hostInput = document.getElementById("sdr-bind-host");
  const portInput = document.getElementById("sdr-bind-port");

  function statusText(status) {
    const connected = status.connections ? ` (${status.connections} connected)` : "";
    if (status.running) return `running on ${status.bind_host}:${status.bind_port}${connected}`;
    if (status.auto && status.claimed_by_local_apps > 0) {
      return `released -- claimed by ${status.claimed_by_local_apps} local app profile(s)`;
    }
    return "stopped";
  }

  async function refreshStatus() {
    const status = await apiFetch("/api/sdr/status");
    statusEl.textContent = statusText(status);
    dotEl.classList.toggle("on", status.running);
    if (document.activeElement !== autoToggle) autoToggle.checked = status.auto;
    // Parkes drives start/stop itself in auto mode -- manual buttons would
    // just fight it.
    manualControls.style.display = status.auto ? "none" : "";
    startBtn.disabled = status.running;
    stopBtn.disabled = !status.running;
    // Only reflect saved values while stopped -- don't clobber whatever
    // the user is mid-typing into the bind fields once a server is up.
    if (!status.running) {
      hostInput.value = status.bind_host;
      portInput.value = status.bind_port;
    }
  }

  autoToggle.addEventListener("change", async () => {
    errorEl.textContent = "";
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soapy_remote_auto: autoToggle.checked }),
      });
      await refreshStatus();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  startBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soapy_remote_bind_host: hostInput.value,
          soapy_remote_bind_port: Number(portInput.value),
        }),
      });
      await apiFetch("/api/sdr/start", { method: "POST" });
      await refreshStatus();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  stopBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    try {
      await apiFetch("/api/sdr/stop", { method: "POST" });
      await refreshStatus();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  loadDevices();
  loadSourcePrefs();
  refreshStatus();
  setInterval(refreshStatus, 5000);
})();
