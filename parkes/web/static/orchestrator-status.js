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
      lineEl.textContent = data.current_target ? `tracking ${data.current_target} -- ${data.status}` : data.status;
    } catch {
      // dashboard poll -- a transient failure here isn't worth surfacing
    }
  }

  refresh();
  setInterval(refresh, 5000);
})();
