(() => {
  const statusEl = document.getElementById("sdr-status");
  const dotEl = document.getElementById("sdr-dot");
  const startBtn = document.getElementById("sdr-start-btn");
  const stopBtn = document.getElementById("sdr-stop-btn");
  const rescanBtn = document.getElementById("sdr-rescan-btn");
  const errorEl = document.getElementById("sdr-error");
  const hostInput = document.getElementById("sdr-bind-host");
  const portInput = document.getElementById("sdr-bind-port");
  const devicesList = document.getElementById("sdr-devices-list");

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

  async function refreshStatus() {
    const status = await apiFetch("/api/sdr/status");
    statusEl.textContent = status.running ? `running on ${status.bind_host}:${status.bind_port}` : "stopped";
    dotEl.classList.toggle("on", status.running);
    startBtn.disabled = status.running;
    stopBtn.disabled = !status.running;
    // Only reflect saved values while stopped -- don't clobber whatever
    // the user is mid-typing into the bind fields once a server is up.
    if (!status.running) {
      hostInput.value = status.bind_host;
      portInput.value = status.bind_port;
    }
  }

  async function refreshDevices() {
    devicesList.textContent = "scanning...";
    try {
      const devices = await apiFetch("/api/sdr/devices");
      if (devices.length === 1 && devices[0].error) {
        devicesList.textContent = `error: ${devices[0].error}`;
      } else if (devices.length) {
        devicesList.innerHTML = devices
          .map((d) => `<div>${escapeHtml(d.driver || "?")} -- ${escapeHtml(d.label || d.serial || "")}</div>`)
          .join("");
      } else {
        devicesList.textContent = "no devices found";
      }
    } catch (err) {
      devicesList.textContent = `error: ${err.message}`;
    }
  }

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

  rescanBtn.addEventListener("click", refreshDevices);

  refreshStatus();
  refreshDevices();
  setInterval(refreshStatus, 5000);
})();
