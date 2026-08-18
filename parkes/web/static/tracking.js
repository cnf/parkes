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

  let passesById = new Map();
  let activeTarget = null;
  let staticPositions = [];

  async function loadStaticPositions() {
    const res = await fetch("/api/orchestrator/static_positions");
    const data = await res.json();
    staticPositions = Object.entries(data).map(([id, position]) => ({ id, ...position }));
  }

  async function refreshPasses() {
    const res = await fetch("/api/tracking/passes");
    const passes = await res.json();
    // Pre-sorted soonest-AOS-first by the API -- the Map's first entry is
    // "up next" across every target, not just satellites.
    passesById = new Map(passes.map((p) => [p.id, p]));
  }

  // Highlights the currently-tracked row (TrackingScheduler.active_target
  // -- shared with the Pass Orchestrator, so this reflects its passes too,
  // not just manual tracking) and the soonest upcoming one. Cheap enough
  // to run on every status/targets refresh rather than only rebuilding
  // rows, so tracking starting/stopping shows up within one status poll
  // instead of waiting for the next full targets rebuild.
  //
  // TrackingScheduler.active_target is a display name (e.g. "NOAA 19"),
  // not the "sat:NNNNN" id used everywhere else -- it's resolved once via
  // SkyTracker.display_name() at start() and never converted back, so the
  // "current" comparison has to match on name, not id.
  function upNextId() {
    // The first entry overall is soonest by "aos", but that can be a
    // "synthesized" pass -- something already above the horizon, not
    // actually about to rise. "Up next" should mean the soonest genuine
    // future rise, so skip those.
    for (const pass of passesById.values()) {
      if (!pass.synthesized) return pass.id;
    }
    return null;
  }

  function applyHighlights() {
    const nextId = upNextId();
    for (const row of targetsBody.querySelectorAll("tr[data-target-id]")) {
      const id = row.dataset.targetId;
      row.classList.toggle("tracking-current", row.dataset.targetName === activeTarget);
      row.classList.toggle("tracking-next", row.dataset.targetName !== activeTarget && id === nextId);
    }
  }

  function formatPass(target) {
    const pass = passesById.get(target.id);
    if (!pass) return "";
    if (pass.unbounded) return "Always visible";
    const minsUntil = Math.round((new Date(pass.aos) - Date.now()) / 60000);
    if (minsUntil <= 0) return ""; // already mid-pass -- no meaningful "AOS in..." to show
    const when = minsUntil < 60 ? `${minsUntil}m` : `${(minsUntil / 60).toFixed(1)}h`;
    return `AOS in ${when} (max ${pass.max_elevation.toFixed(0)}&deg;)`;
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
    activeTarget = status.active_target || null;
    applyHighlights();
  }

  async function refreshTargets() {
    const res = await fetch("/api/tracking/targets");
    const targets = await res.json();
    targetsBody.innerHTML = "";
    for (const target of targets) {
      const row = document.createElement("tr");
      row.dataset.targetId = target.id;
      row.dataset.targetName = target.name;
      const icon = target.kind === "satellite" ? "&#128752; " : "";
      const noradAttr =
        target.kind === "satellite" ? ` data-satnogs-norad="${target.id.split(":")[1]}"` : "";
      row.innerHTML = `
        <td${noradAttr}>${icon}${escapeHtml(target.name)}</td>
        <td>${target.az.toFixed(1)}&deg;</td>
        <td>${target.el.toFixed(1)}&deg;</td>
        <td><span class="badge ${target.visible ? "up" : "down"}">${target.visible ? "up" : "down"}</span></td>
        <td>${formatPass(target)}</td>
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
    // Static positions are a one-shot "Go" (goto + optional app launch),
    // not continuous tracking -- listed here so they're not buried on the
    // Orchestrator page, but kept visually distinct (pin icon, no AOS/
    // up-down badge, "Go" instead of "Track") since the underlying action
    // is different. See tracking/static_positions.py.
    for (const position of staticPositions) {
      const row = document.createElement("tr");
      row.dataset.positionId = position.id;
      row.innerHTML = `
        <td>&#128205; ${escapeHtml(position.name)}</td>
        <td>${position.az.toFixed(1)}&deg;</td>
        <td>${position.el.toFixed(1)}&deg;</td>
        <td class="hint">fixed</td>
        <td></td>
        <td><button class="btn-sm" data-position="${escapeHtml(position.id)}">Go</button></td>
      `;
      targetsBody.appendChild(row);
    }
    for (const btn of targetsBody.querySelectorAll("[data-position]")) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const original = btn.textContent;
        try {
          await post(`/api/orchestrator/static_positions/${encodeURIComponent(btn.dataset.position)}/go`);
        } catch (err) {
          btn.textContent = "error";
          btn.title = err.message;
          setTimeout(() => {
            btn.textContent = original;
            btn.title = "";
          }, 2500);
          btn.disabled = false;
          return;
        }
        btn.disabled = false;
      });
    }
    applyHighlights();
  }

  document.getElementById("stop-tracking-btn").addEventListener("click", async () => {
    await post("/api/tracking/stop");
    refreshStatus();
  });

  Promise.all([loadStaticPositions(), refreshPasses()]).then(refreshTargets);
  refreshStatus();
  setInterval(refreshTargets, 15000);
  setInterval(refreshStatus, 5000);
  // Pass predictions change slowly (minutes at least) -- no need to
  // recompute skyfield's find_events search on every fast az/el poll.
  // Static positions change even more rarely (only edited on the
  // Orchestrator page) -- piggyback on the same slow interval.
  setInterval(() => Promise.all([loadStaticPositions(), refreshPasses()]).then(refreshTargets), 120000);

  // Every az/el shown here depends on the observer location. The location
  // modal (location.js) fires this after a successful save so the table
  // reflects it right away instead of waiting for the next slow poll (up
  // to 15s for satellites/fixed targets, 2 minutes for lat/lon-derived
  // static positions) or a manual page reload.
  window.addEventListener("parkes:location-changed", () => {
    Promise.all([loadStaticPositions(), refreshPasses()]).then(refreshTargets);
  });
})();
