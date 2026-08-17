(() => {
  const statusEl = document.getElementById("orchestrator-status");
  const dotEl = document.getElementById("orchestrator-dot");
  const lineEl = document.getElementById("orchestrator-last-line");

  async function refresh() {
    try {
      const res = await fetch("/api/orchestrator/status");
      const data = await res.json();
      statusEl.textContent = data.running ? "running" : "stopped";
      dotEl.classList.toggle("on", data.running);
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
    } catch {
      // dashboard poll -- a transient failure here isn't worth surfacing
    }
  }

  refresh();
  setInterval(refresh, 5000);
})();
