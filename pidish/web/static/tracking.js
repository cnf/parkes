const targetsBody = document.getElementById("targets-body");
const trackingStatus = document.getElementById("tracking-status");
const stopTrackingBtn = document.getElementById("stop-tracking-btn");

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

async function refreshStatus() {
  const res = await fetch("/api/tracking/status");
  const status = await res.json();
  trackingStatus.textContent = status.active_target
    ? `tracking: ${status.active_target}${status.last_error ? ` (error: ${status.last_error})` : ""}`
    : "not tracking";
  stopTrackingBtn.disabled = !status.active_target;
}

async function refreshTargets() {
  const res = await fetch("/api/tracking/targets");
  const targets = await res.json();
  targetsBody.innerHTML = "";
  for (const target of targets) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${target.name}</td>
      <td>${target.az.toFixed(1)}&deg;</td>
      <td>${target.el.toFixed(1)}&deg;</td>
      <td>${target.visible ? "up" : "down"}</td>
      <td><button ${target.visible ? "" : "disabled"} data-target="${target.name}">Track</button></td>
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
