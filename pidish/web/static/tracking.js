(() => {
  const targetsBody = document.getElementById("targets-body");
  const trackingStatus = document.getElementById("tracking-status");
  const stopTrackingBtn = document.getElementById("stop-tracking-btn");
  const trackingDot = document.getElementById("tracking-dot");

  async function post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async function refreshStatus() {
    const res = await fetch("/api/tracking/status");
    const status = await res.json();
    trackingStatus.textContent = status.active_target
      ? `tracking: ${status.active_target}${status.last_error ? ` (error: ${status.last_error})` : ""}`
      : "not tracking";
    stopTrackingBtn.disabled = !status.active_target;
    trackingDot.classList.toggle("on", !!status.active_target && !status.last_error);
    trackingDot.classList.toggle("error", !!status.last_error);
  }

  async function refreshTargets() {
    const res = await fetch("/api/tracking/targets");
    const targets = await res.json();
    targetsBody.innerHTML = "";
    for (const target of targets) {
      const row = document.createElement("tr");
      const icon = target.kind === "satellite" ? "&#128752; " : "";
      row.innerHTML = `
        <td>${icon}${escapeHtml(target.name)}</td>
        <td>${target.az.toFixed(1)}&deg;</td>
        <td>${target.el.toFixed(1)}&deg;</td>
        <td><span class="badge ${target.visible ? "up" : "down"}">${target.visible ? "up" : "down"}</span></td>
        <td><button class="btn-sm primary" ${target.visible ? "" : "disabled"} data-target="${escapeHtml(target.id)}">Track</button></td>
      `;
      targetsBody.appendChild(row);
    }
    for (const btn of targetsBody.querySelectorAll("[data-target]")) {
      btn.addEventListener("click", async () => {
        await post("/api/tracking/start", { target: btn.dataset.target });
        refreshStatus();
      });
    }
  }

  document.getElementById("stop-tracking-btn").addEventListener("click", async () => {
    await post("/api/tracking/stop");
    refreshStatus();
  });

  refreshTargets();
  refreshStatus();
  setInterval(refreshTargets, 15000);
  setInterval(refreshStatus, 5000);
})();
