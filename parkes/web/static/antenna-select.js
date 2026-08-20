(() => {
  const antennaBtn = document.getElementById("antenna-btn");
  const overlay = document.getElementById("antenna-modal-overlay");
  const closeBtn = document.getElementById("antenna-modal-close");
  const cancelBtn = document.getElementById("antenna-modal-cancel-btn");
  const saveBtn = document.getElementById("antenna-modal-save-btn");
  const optionsEl = document.getElementById("antenna-modal-options");
  const statusEl = document.getElementById("antenna-modal-status");

  async function apiFetch(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? "var(--danger)" : "var(--text-muted)";
  }

  async function refreshButtonLabel() {
    const [antennas, settings] = await Promise.all([
      apiFetch("/api/orchestrator/antennas"),
      apiFetch("/api/settings"),
    ]);
    const activeId = settings.preferences.active_antenna_id;
    const active = activeId ? antennas[activeId] : null;
    antennaBtn.textContent = `\u{1F4E1} ${active ? active.name : "None"}`;
  }

  async function openModal() {
    setStatus("", false);
    const [antennas, settings] = await Promise.all([
      apiFetch("/api/orchestrator/antennas"),
      apiFetch("/api/settings"),
    ]);
    const activeId = settings.preferences.active_antenna_id || "";
    optionsEl.innerHTML = "";
    const entries = [["", "None connected"], ...Object.entries(antennas).map(([id, a]) => [id, a.name])];
    for (const [id, name] of entries) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "antenna-select";
      radio.value = id;
      radio.checked = id === activeId;
      label.append(radio, document.createTextNode(` ${name}`));
      optionsEl.appendChild(label);
    }
    overlay.style.display = "flex";
  }

  function closeModal() {
    overlay.style.display = "none";
  }

  antennaBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });

  saveBtn.addEventListener("click", async () => {
    const checked = optionsEl.querySelector("input[name='antenna-select']:checked");
    const value = checked && checked.value ? checked.value : null;
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_antenna_id: value }),
      });
    } catch (err) {
      setStatus(`error: ${err.message}`, true);
      return;
    }
    closeModal();
    refreshButtonLabel();
  });

  refreshButtonLabel();
})();
