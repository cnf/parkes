(() => {
  const form = document.getElementById("flash-form");
  const fileInput = document.getElementById("flash-file");
  const deviceInput = document.getElementById("flash-device");
  const btn = document.getElementById("flash-btn");
  const statusEl = document.getElementById("flash-form-status");
  const logEl = document.getElementById("flash-log");

  const POLL_INTERVAL_MS = 1000;
  let pollHandle = null;

  function renderLog(log) {
    logEl.style.display = "";
    logEl.textContent = log.join("\n");
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setBusy(busy) {
    btn.disabled = busy;
    fileInput.disabled = busy;
    deviceInput.disabled = busy;
  }

  async function poll() {
    let data;
    try {
      const res = await fetch("/api/rotator/flash/status");
      data = await res.json();
    } catch {
      return; // transient fetch error -- next tick retries
    }
    renderLog(data.log);
    if (data.running) return;
    clearInterval(pollHandle);
    pollHandle = null;
    setBusy(false);
    statusEl.textContent =
      data.returncode === 0 ? "flash complete" : `flash failed (exit code ${data.returncode})`;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusEl.textContent = "";
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    if (deviceInput.value.trim()) {
      formData.append("device", deviceInput.value.trim());
    }
    setBusy(true);
    logEl.style.display = "";
    logEl.textContent = "";
    try {
      const res = await fetch("/api/rotator/flash", { method: "POST", body: formData });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      statusEl.textContent = "flashing...";
      pollHandle = setInterval(() => poll().catch(() => {}), POLL_INTERVAL_MS);
    } catch (err) {
      setBusy(false);
      statusEl.textContent = `error: ${err.message}`;
    }
  });

  // Resume watching a flash that was already running (e.g. the page was
  // reloaded mid-flash) instead of leaving the UI looking idle.
  (async () => {
    try {
      const res = await fetch("/api/rotator/flash/status");
      const data = await res.json();
      if (data.running) {
        setBusy(true);
        statusEl.textContent = "flashing...";
        renderLog(data.log);
        pollHandle = setInterval(() => poll().catch(() => {}), POLL_INTERVAL_MS);
      }
    } catch {
      // nothing to resume
    }
  })();
})();
