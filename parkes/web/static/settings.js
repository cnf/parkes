(() => {
  const form = document.getElementById("settings-form");
  const statusEl = document.getElementById("settings-status");
  const infraList = document.getElementById("infra-list");

  const NUMERIC_FIELDS = new Set([
    "observer_lat",
    "observer_lon",
    "observer_elevation_m",
    "tracking_interval_seconds",
    "satdump_samplerate",
    "satdump_initial_frequency",
    "satdump_autotrack_min_elevation",
  ]);

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

  async function load() {
    const data = await apiFetch("/api/settings");
    for (const [key, value] of Object.entries(data.preferences)) {
      const input = form.elements.namedItem(key);
      if (input) input.value = value ?? "";
    }
    infraList.innerHTML = "";
    for (const [key, value] of Object.entries(data.infra)) {
      const row = document.createElement("div");
      row.className = "infra-row";
      row.innerHTML = `<span>${escapeHtml(key)}</span><span class="val">${escapeHtml(String(value))}</span>`;
      infraList.appendChild(row);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusEl.textContent = "";
    const formData = new FormData(form);
    const values = {};
    for (const [key, raw] of formData.entries()) {
      if (NUMERIC_FIELDS.has(key)) {
        if (raw.trim() === "") continue; // don't coerce a blank field to 0
        values[key] = Number(raw);
      } else {
        values[key] = raw; // allow "" for optional text fields like source id
      }
    }
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      statusEl.textContent = "saved";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    } catch (err) {
      statusEl.textContent = `error: ${err.message}`;
    }
  });

  load();
})();
