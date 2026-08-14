(() => {
  const statusEl = document.getElementById("orch-status");
  const dotEl = document.getElementById("orch-dot");
  const startBtn = document.getElementById("orch-start-btn");
  const stopBtn = document.getElementById("orch-stop-btn");
  const currentEl = document.getElementById("orch-current");
  const profilesList = document.getElementById("profiles-list");
  const addProfileBtn = document.getElementById("add-profile-btn");
  const saveProfilesBtn = document.getElementById("save-profiles-btn");
  const profilesStatus = document.getElementById("profiles-status");

  // In-memory as a name-carrying array rather than the {name: {...}} shape
  // the API uses -- easier to render/edit while a name is mid-rename or
  // temporarily blank than juggling object keys.
  let profiles = [];

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

  function renderProfiles() {
    profilesList.innerHTML = "";
    profiles.forEach((profile, profileIndex) => {
      const card = document.createElement("div");
      card.className = "group-block";

      const header = document.createElement("div");
      header.className = "group-header";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "profile name";
      nameInput.value = profile.name;
      nameInput.addEventListener("input", () => {
        profile.name = nameInput.value;
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-sm";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        profiles.splice(profileIndex, 1);
        renderProfiles();
      });
      header.append(nameInput, deleteBtn);
      card.appendChild(header);

      const chipList = document.createElement("div");
      chipList.className = "chip-list";
      profile.command.forEach((arg, argIndex) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.append(document.createTextNode(arg));
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          profile.command.splice(argIndex, 1);
          renderProfiles();
        });
        chip.appendChild(removeBtn);
        chipList.appendChild(chip);
      });
      card.appendChild(chipList);

      const searchWrap = document.createElement("div");
      searchWrap.className = "group-search";
      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.placeholder = "Add a command arg, press Enter (e.g. --frequency or {frequency})";
      addInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const value = addInput.value.trim();
        if (value) {
          profile.command.push(value);
          renderProfiles();
        }
      });
      searchWrap.appendChild(addInput);
      card.appendChild(searchWrap);

      profilesList.appendChild(card);
    });
  }

  addProfileBtn.addEventListener("click", () => {
    profiles.push({ name: "", command: [] });
    renderProfiles();
  });

  async function loadProfiles() {
    const data = await apiFetch("/api/orchestrator/app_profiles");
    profiles = Object.entries(data).map(([name, profile]) => ({
      name,
      command: [...(profile.command || [])],
    }));
    renderProfiles();
  }

  saveProfilesBtn.addEventListener("click", async () => {
    profilesStatus.textContent = "";
    const names = profiles.map((p) => p.name.trim());
    if (names.some((n) => !n)) {
      profilesStatus.textContent = "every profile needs a name";
      return;
    }
    if (new Set(names).size !== names.length) {
      profilesStatus.textContent = "profile names must be unique";
      return;
    }
    if (profiles.some((p) => p.command.length === 0)) {
      profilesStatus.textContent = "every profile needs at least one command arg";
      return;
    }
    const payload = {};
    for (const profile of profiles) {
      payload[profile.name.trim()] = { command: profile.command };
    }
    try {
      await apiFetch("/api/orchestrator/app_profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      profilesStatus.textContent = "saved";
      setTimeout(() => {
        profilesStatus.textContent = "";
      }, 2000);
    } catch (err) {
      profilesStatus.textContent = `error: ${err.message}`;
    }
  });

  loadProfiles();
  refreshStatus();
  setInterval(refreshStatus, 5000);
})();
