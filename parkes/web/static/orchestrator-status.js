(() => {
  const statusEl = document.getElementById("orchestrator-status");
  const dotEl = document.getElementById("orchestrator-dot");
  const lineEl = document.getElementById("orchestrator-last-line");
  const commandEl = document.getElementById("orchestrator-command");
  const appErrorEl = document.getElementById("orchestrator-app-error");
  const toggleBtn = document.getElementById("orchestrator-toggle-btn");

  let running = false;

  async function refresh() {
    try {
      const res = await fetch("/api/orchestrator/status");
      const data = await res.json();
      running = !!data.running;
      statusEl.textContent = data.running ? "running" : "stopped";
      dotEl.classList.toggle("on", data.running);
      toggleBtn.textContent = data.running ? "Stop" : "Start";
      toggleBtn.classList.toggle("danger", data.running);
      toggleBtn.classList.toggle("primary", !data.running);
      toggleBtn.disabled = false;
      if (data.current_target) {
        // data.status already reads e.g. "tracking sat:X (continuous)" --
        // build our own line from the structured fields instead of
        // concatenating it with current_target again.
        const label =
          data.current_target_name && data.current_target_name !== data.current_target
            ? `${data.current_target_name} (${data.current_target})`
            : data.current_target;
        const continuous = data.current_continuous ? " (continuous)" : "";
        const profile = data.current_profile ? ` -- ${data.current_profile}` : "";
        lineEl.textContent = `${label}${continuous}${profile}`;
      } else {
        lineEl.textContent = data.status;
      }
      commandEl.textContent = data.current_command || "";
      appErrorEl.textContent = data.current_app_error || "";
    } catch {
      // dashboard poll -- a transient failure here isn't worth surfacing
    }
  }

  toggleBtn.addEventListener("click", async () => {
    toggleBtn.disabled = true;
    try {
      await fetch(`/api/orchestrator/${running ? "stop" : "start"}`, { method: "POST" });
    } catch {
      // refresh() below will put the button back into a clickable state
    }
    refresh();
  });

  refresh();
  setInterval(refresh, 5000);
})();
