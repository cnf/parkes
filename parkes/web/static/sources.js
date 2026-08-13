(() => {
  const sourcesList = document.getElementById("sources-list");
  const addSourceForm = document.getElementById("add-source-form");
  const sourceNameInput = document.getElementById("source-name");
  const sourceUrlInput = document.getElementById("source-url");
  const addSourceStatus = document.getElementById("add-source-status");
  const tleStatus = document.getElementById("tle-status");
  const tleRefreshBtn = document.getElementById("tle-refresh-btn");

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
    const status = await apiFetch("/api/tracking/satellites/status");
    tleStatus.textContent = `${status.count} satellites loaded`;
    return status.errors || {};
  }

  async function refreshSources() {
    const [sources, errors] = await Promise.all([apiFetch("/api/tracking/sources"), refreshStatus()]);
    sourcesList.innerHTML = "";
    for (const source of sources) {
      const error = errors[source.name];
      const row = document.createElement("div");
      row.className = "source-row";
      row.innerHTML = `
        <div class="source-row-top">
          <div>
            <div class="source-name">${escapeHtml(source.name)}</div>
            <div class="source-url">${escapeHtml(source.url)}</div>
          </div>
          <button type="button" class="btn-sm">Delete</button>
        </div>
        ${error ? `<div class="source-error">${escapeHtml(error)}</div>` : ""}
      `;
      row.querySelector("button").addEventListener("click", async () => {
        await apiFetch(`/api/tracking/sources/${encodeURIComponent(source.name)}`, { method: "DELETE" });
        refreshSources();
      });
      sourcesList.appendChild(row);
    }
  }

  addSourceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    addSourceStatus.textContent = "";
    const name = sourceNameInput.value.trim();
    const url = sourceUrlInput.value.trim();
    if (!name || !url) return;
    try {
      await apiFetch("/api/tracking/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
      sourceNameInput.value = "";
      sourceUrlInput.value = "";
      refreshSources();
    } catch (err) {
      addSourceStatus.textContent = err.message;
    }
  });

  tleRefreshBtn.addEventListener("click", async () => {
    tleRefreshBtn.disabled = true;
    try {
      await apiFetch("/api/tracking/satellites/refresh", { method: "POST" });
      await refreshSources();
    } finally {
      tleRefreshBtn.disabled = false;
    }
  });

  refreshSources();
})();
