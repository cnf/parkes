(() => {
  const statusEl = document.getElementById("orch-status");
  const dotEl = document.getElementById("orch-dot");
  const startBtn = document.getElementById("orch-start-btn");
  const stopBtn = document.getElementById("orch-stop-btn");
  const currentEl = document.getElementById("orch-current");
  const profilesTextarea = document.getElementById("app-profiles");
  const saveProfilesBtn = document.getElementById("save-profiles-btn");
  const profilesStatus = document.getElementById("profiles-status");

  async function apiFetch(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  }

  async function refreshStatus() {
    const status = await apiFetch("/api/orchestrator/status");
    statusEl.textContent = status.running ? status.status : "stopped";
    dotEl.classList.toggle("on", status.running);
    startBtn.disabled = status.running;
    stopBtn.disabled = !status.running;
    currentEl.textContent = status.current_target ? `tracking: ${status.current_target}` : " ";
  }

  startBtn.addEventListener("click", async () => {
    try {
      await apiFetch("/api/orchestrator/start", { method: "POST" });
    } catch (err) {
      statusEl.textContent = `error: ${err.message}`;
      dotEl.classList.add("error");
      return;
    }
    refreshStatus();
  });

  stopBtn.addEventListener("click", async () => {
    await apiFetch("/api/orchestrator/stop", { method: "POST" });
    refreshStatus();
  });

  async function loadProfiles() {
    const profiles = await apiFetch("/api/orchestrator/app_profiles");
    profilesTextarea.value = JSON.stringify(profiles, null, 2);
  }

  saveProfilesBtn.addEventListener("click", async () => {
    let parsed;
    try {
      parsed = JSON.parse(profilesTextarea.value);
    } catch (err) {
      profilesStatus.textContent = `invalid JSON: ${err.message}`;
      return;
    }
    try {
      await apiFetch("/api/orchestrator/app_profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      profilesStatus.textContent = "saved";
    } catch (err) {
      profilesStatus.textContent = `error: ${err.message}`;
    }
  });

  loadProfiles();
  refreshStatus();
  setInterval(refreshStatus, 5000);
})();
