(() => {
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

  function flashStatus(el, text, isError) {
    el.textContent = text;
    el.style.color = isError ? "var(--danger)" : "var(--text-muted)";
    if (!isError) {
      setTimeout(() => {
        if (el.textContent === text) el.textContent = "";
      }, 2000);
    }
  }

  function slugify(text) {
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
  }

  function uniqueId(base, taken) {
    let id = base;
    let n = 2;
    while (taken.has(id)) {
      id = `${base}-${n}`;
      n++;
    }
    return id;
  }

  // ---------------------------------------------------------------------
  // Pass Orchestrator status/start/stop
  // ---------------------------------------------------------------------

  const orchStatusEl = document.getElementById("orch-status");
  const orchDotEl = document.getElementById("orch-dot");
  const orchStartBtn = document.getElementById("orch-start-btn");
  const orchStopBtn = document.getElementById("orch-stop-btn");
  const orchCurrentEl = document.getElementById("orch-current");
  const orchCommandEl = document.getElementById("orch-command");
  const orchAppErrorEl = document.getElementById("orch-app-error");

  async function refreshOrchStatus() {
    const status = await apiFetch("/api/orchestrator/status");
    orchStatusEl.textContent = status.running ? status.status : "stopped";
    orchDotEl.classList.toggle("on", status.running);
    orchStartBtn.disabled = status.running;
    orchStopBtn.disabled = !status.running;
    orchCurrentEl.textContent = status.current_target ? `tracking: ${status.current_target}` : " ";
    orchCommandEl.textContent = status.current_command || "";
    orchAppErrorEl.textContent = status.current_app_error || "";
  }

  orchStartBtn.addEventListener("click", async () => {
    try {
      await apiFetch("/api/orchestrator/start", { method: "POST" });
    } catch (err) {
      orchStatusEl.textContent = `error: ${err.message}`;
      orchDotEl.classList.add("error");
      return;
    }
    refreshOrchStatus();
  });

  orchStopBtn.addEventListener("click", async () => {
    await apiFetch("/api/orchestrator/stop", { method: "POST" });
    refreshOrchStatus();
  });

  // ---------------------------------------------------------------------
  // App Profiles -- loaded first since Tracked Satellites' downlink "app"
  // dropdown needs the current list of pass-mode profiles.
  //
  // Each profile has a stable `id` (the JSON key, generated once from its
  // name on first save and never changed again) separate from its
  // editable `name` -- downlinks reference the id, so renaming a profile
  // doesn't orphan every satellite pointed at it.
  // ---------------------------------------------------------------------

  const profilesListView = document.getElementById("profiles-list-view");
  const profilesEditView = document.getElementById("profiles-edit-view");
  const profilesTableBody = document.getElementById("profiles-table-body");
  const addProfileBtn = document.getElementById("add-profile-btn");
  const profilesStatus = document.getElementById("profiles-status");

  let profiles = [];
  let standaloneStatus = {};
  let profilesEditIndex = null;
  let profilesEditSnapshot = null;
  let satdumpPipelines = [];

  async function loadSatdumpPipelines() {
    try {
      satdumpPipelines = await apiFetch("/api/orchestrator/satdump_pipelines");
    } catch {
      satdumpPipelines = [];
    }
  }

  function passModeProfiles() {
    return profiles.filter((p) => p.mode !== "standalone");
  }

  function applyStandaloneStatus(row, id) {
    const statusSpan = row.querySelector('[data-role="status"]');
    if (!statusSpan) return;
    const info = standaloneStatus[id];
    const state = info ? info.state : "stopped";
    const running = state === "running";
    if (state === "crashed") {
      statusSpan.textContent = `crashed (exit ${info.exit_code})`;
      statusSpan.style.color = "var(--danger)";
    } else {
      statusSpan.textContent = state;
      statusSpan.style.color = "";
    }
    const startBtn = row.querySelector('[data-action="start"]');
    const stopBtn = row.querySelector('[data-action="stop"]');
    if (startBtn) startBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
  }

  async function refreshStandaloneStatus() {
    standaloneStatus = await apiFetch("/api/orchestrator/standalone/status");
    for (const row of profilesTableBody.querySelectorAll("tr[data-profile-id]")) {
      applyStandaloneStatus(row, row.dataset.profileId);
    }
  }

  function assignProfileId(profile) {
    if (profile.id) return profile.id;
    const taken = new Set(profiles.filter((p) => p.id).map((p) => p.id));
    profile.id = uniqueId(slugify(profile.name), taken);
    return profile.id;
  }

  // PUTs/DELETEs by id, one profile at a time -- never the whole
  // collection, so a bug in this flow can only ever touch the profile
  // being edited, not every other one too.
  async function saveProfile(profile) {
    assignProfileId(profile);
    const payload = {
      name: profile.name.trim(),
      command: profile.command,
      mode: profile.mode,
      uses_sdr: profile.usesSdr,
      ...(profile.mode === "standalone" && profile.scheduleMinutes
        ? { schedule_seconds: profile.scheduleMinutes * 60 }
        : {}),
    };
    await apiFetch(`/api/orchestrator/app_profiles/${encodeURIComponent(profile.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    flashStatus(profilesStatus, "saved", false);
    // Name/mode may have changed; leave an in-progress satellite edit
    // alone rather than yanking the view out from under it.
    if (trackedEditIndex === null) renderTrackedList();
  }

  async function deleteProfile(id) {
    await apiFetch(`/api/orchestrator/app_profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  function validateProfile(profile) {
    if (!profile.name.trim()) return "every profile needs a name";
    if (profile.command.length === 0) return "every profile needs at least one command arg";
    return null;
  }

  function renderProfilesList() {
    profilesListView.style.display = "";
    profilesEditView.style.display = "none";
    profilesEditView.innerHTML = "";
    profilesTableBody.innerHTML = "";

    if (profiles.length === 0) {
      profilesTableBody.innerHTML = `<tr><td colspan="4" class="hint">No app profiles yet.</td></tr>`;
      return;
    }

    profiles.forEach((profile, index) => {
      const row = document.createElement("tr");
      row.dataset.profileId = profile.id;

      const nameTd = document.createElement("td");
      nameTd.textContent = profile.name;

      const modeTd = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "badge " + (profile.mode === "standalone" ? "down" : "up");
      badge.textContent = profile.mode === "standalone" ? "Standalone" : "Pass-triggered";
      modeTd.appendChild(badge);

      const statusTd = document.createElement("td");
      if (profile.mode === "standalone") {
        const statusSpan = document.createElement("span");
        statusSpan.className = "profile-standalone-status";
        statusSpan.dataset.role = "status";
        const startBtn = document.createElement("button");
        startBtn.type = "button";
        startBtn.className = "btn-sm";
        startBtn.textContent = "Start";
        startBtn.dataset.action = "start";
        startBtn.addEventListener("click", async () => {
          try {
            await apiFetch(`/api/orchestrator/standalone/${encodeURIComponent(profile.id)}/start`, {
              method: "POST",
            });
          } catch (err) {
            statusSpan.textContent = `error: ${err.message}`;
            return;
          }
          refreshStandaloneStatus();
        });
        const stopBtn = document.createElement("button");
        stopBtn.type = "button";
        stopBtn.className = "btn-sm";
        stopBtn.textContent = "Stop";
        stopBtn.dataset.action = "stop";
        stopBtn.addEventListener("click", async () => {
          await apiFetch(`/api/orchestrator/standalone/${encodeURIComponent(profile.id)}/stop`, {
            method: "POST",
          });
          refreshStandaloneStatus();
        });
        statusTd.append(statusSpan, document.createTextNode(" "), startBtn, stopBtn);
      }

      const editTd = document.createElement("td");
      editTd.className = "actions-col";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => enterProfileEdit(index));
      editTd.appendChild(editBtn);

      row.append(nameTd, modeTd, statusTd, editTd);
      profilesTableBody.appendChild(row);
      applyStandaloneStatus(row, profile.id);
    });
  }

  function enterProfileEdit(index) {
    profilesEditIndex = index;
    profilesEditSnapshot = JSON.parse(JSON.stringify(profiles[index]));
    renderProfileEdit();
  }

  function exitProfileEdit(keepChanges) {
    if (!keepChanges) {
      profiles[profilesEditIndex] = profilesEditSnapshot;
    }
    profilesEditIndex = null;
    profilesEditSnapshot = null;
    renderProfilesList();
  }

  function renderProfileEdit() {
    profilesListView.style.display = "none";
    profilesEditView.style.display = "";
    profilesEditView.innerHTML = "";
    const profile = profiles[profilesEditIndex];

    const topRow = document.createElement("div");
    topRow.className = "row";
    topRow.style.marginBottom = "0";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn-sm";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", () => exitProfileEdit(false));
    topRow.appendChild(backBtn);
    profilesEditView.appendChild(topRow);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "edit-name-input";
    nameInput.placeholder = "profile name";
    nameInput.value = profile.name;
    nameInput.addEventListener("input", () => {
      profile.name = nameInput.value;
    });
    profilesEditView.appendChild(nameInput);

    const modeRow = document.createElement("div");
    modeRow.className = "profile-mode-row";
    for (const [value, text] of [["pass", "Pass-triggered"], ["standalone", "Standalone"]]) {
      const modeLabel = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "profile-edit-mode";
      radio.value = value;
      radio.checked = profile.mode === value;
      radio.addEventListener("change", () => {
        if (radio.checked) {
          profile.mode = value;
          renderProfileEdit();
        }
      });
      modeLabel.append(radio, document.createTextNode(text));
      modeRow.appendChild(modeLabel);
    }
    profilesEditView.appendChild(modeRow);

    const usesSdrLabel = document.createElement("label");
    usesSdrLabel.style.cssText = "display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: normal; margin-bottom: 0.8rem;";
    const usesSdrCheckbox = document.createElement("input");
    usesSdrCheckbox.type = "checkbox";
    usesSdrCheckbox.style.cssText = "width: auto; accent-color: var(--accent);";
    usesSdrCheckbox.checked = profile.usesSdr;
    usesSdrCheckbox.addEventListener("change", () => {
      profile.usesSdr = usesSdrCheckbox.checked;
    });
    usesSdrLabel.append(
      usesSdrCheckbox,
      document.createTextNode(
        "Uses the SDR -- claims it while running, so auto-managed SDR Network Sharing releases for it"
      )
    );
    profilesEditView.appendChild(usesSdrLabel);

    // Each command arg gets its own editable row -- reorder with ↑/↓
    // (there's no drag-and-drop; this is simpler and works on touch too),
    // edit its text directly, or remove it. Flags (-x/--xxx) and
    // {placeholder} tokens get a distinct color so the shape of the
    // command is readable at a glance instead of a wall of plain text.
    function argClass(value) {
      if (value.startsWith("{") && value.endsWith("}")) return "command-arg-input is-placeholder";
      if (value.startsWith("-")) return "command-arg-input is-flag";
      return "command-arg-input";
    }

    const argsList = document.createElement("div");
    argsList.className = "command-args-list";
    profile.command.forEach((arg, argIndex) => {
      const row = document.createElement("div");
      row.className = "command-arg-row";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "btn-sm";
      upBtn.textContent = "↑";
      upBtn.title = "Move earlier";
      upBtn.disabled = argIndex === 0;
      upBtn.addEventListener("click", () => {
        const c = profile.command;
        [c[argIndex - 1], c[argIndex]] = [c[argIndex], c[argIndex - 1]];
        renderProfileEdit();
      });

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "btn-sm";
      downBtn.textContent = "↓";
      downBtn.title = "Move later";
      downBtn.disabled = argIndex === profile.command.length - 1;
      downBtn.addEventListener("click", () => {
        const c = profile.command;
        [c[argIndex + 1], c[argIndex]] = [c[argIndex], c[argIndex + 1]];
        renderProfileEdit();
      });

      const argInput = document.createElement("input");
      argInput.type = "text";
      argInput.value = arg;
      argInput.className = argClass(arg);
      argInput.addEventListener("input", () => {
        profile.command[argIndex] = argInput.value;
        argInput.className = argClass(argInput.value);
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-sm";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove";
      removeBtn.addEventListener("click", () => {
        profile.command.splice(argIndex, 1);
        renderProfileEdit();
      });

      row.append(upBtn, downBtn, argInput, removeBtn);
      argsList.appendChild(row);
    });
    profilesEditView.appendChild(argsList);

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
        renderProfileEdit();
      }
    });
    searchWrap.appendChild(addInput);
    profilesEditView.appendChild(searchWrap);

    const placeholderRow = document.createElement("div");
    placeholderRow.className = "placeholder-quick-row";
    placeholderRow.appendChild(document.createTextNode("Insert:"));
    const availablePlaceholders = ["{output_dir}", "{source}", "{source_id}", "{samplerate}"];
    if (profile.mode === "pass") availablePlaceholders.unshift("{frequency}");
    for (const ph of availablePlaceholders) {
      const phBtn = document.createElement("button");
      phBtn.type = "button";
      phBtn.className = "btn-sm";
      phBtn.textContent = ph;
      phBtn.addEventListener("click", () => {
        profile.command.push(ph);
        renderProfileEdit();
      });
      placeholderRow.appendChild(phBtn);
    }
    profilesEditView.appendChild(placeholderRow);

    // Templates read straight from the installed satdump's own pipeline
    // definitions (see api/orchestrator.py's /satdump_pipelines), so the
    // command skeleton they produce stays accurate across satdump versions
    // instead of us guessing at flags. Absent entirely if satdump isn't
    // installed -- see loadSatdumpPipelines().
    if (satdumpPipelines.length > 0) {
      const templateWrap = document.createElement("div");
      templateWrap.className = "group-search";
      templateWrap.style.marginTop = "0.8rem";

      const templateInput = document.createElement("input");
      templateInput.type = "text";
      templateInput.placeholder = "Start from a satdump pipeline... (e.g. noaa, meteor)";
      const templateResultsEl = document.createElement("div");
      templateResultsEl.className = "search-results";
      templateResultsEl.style.display = "none";

      templateInput.addEventListener("input", () => {
        const q = templateInput.value.trim().toLowerCase();
        templateResultsEl.innerHTML = "";
        if (!q) {
          templateResultsEl.style.display = "none";
          return;
        }
        const matches = satdumpPipelines
          .filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.id.toLowerCase().includes(q) ||
              p.family.toLowerCase().includes(q)
          )
          .slice(0, 20);
        for (const p of matches) {
          const row = document.createElement("div");
          row.className = "search-result-row";
          row.innerHTML = `<span>${escapeHtml(p.name)} <span style="color: var(--text-muted);">(${escapeHtml(p.family)})</span></span><span style="color: var(--text-muted);">${escapeHtml(p.id)}</span>`;
          row.addEventListener("click", () => {
            profile.command = [
              "satdump",
              "live",
              p.id,
              "{output_dir}",
              "--source",
              "{source}",
              "--samplerate",
              "{samplerate}",
              ...(profile.mode === "pass" ? ["--frequency", "{frequency}"] : []),
            ];
            profile._pipelineHint = p.frequencies.length
              ? `Typical frequencies for ${p.name}: ` +
                p.frequencies
                  .slice(0, 4)
                  .map(([label, hz]) => `${label} ${(hz / 1e6).toFixed(3)} MHz`)
                  .join(", ")
              : null;
            renderProfileEdit();
          });
          templateResultsEl.appendChild(row);
        }
        templateResultsEl.style.display = matches.length ? "block" : "none";
      });

      templateWrap.append(templateInput, templateResultsEl);
      profilesEditView.appendChild(templateWrap);

      if (profile._pipelineHint) {
        const hintP = document.createElement("p");
        hintP.className = "hint";
        hintP.style.marginTop = "0.4rem";
        hintP.textContent = profile._pipelineHint;
        profilesEditView.appendChild(hintP);
      }
    }

    if (profile.mode === "standalone") {
      const scheduleRow = document.createElement("div");
      scheduleRow.className = "profile-standalone-row";
      scheduleRow.style.marginTop = "0.8rem";
      const scheduleInput = document.createElement("input");
      scheduleInput.type = "number";
      scheduleInput.min = "1";
      scheduleInput.placeholder = "manual only";
      scheduleInput.value = profile.scheduleMinutes ?? "";
      scheduleInput.addEventListener("input", () => {
        profile.scheduleMinutes = scheduleInput.value ? Number(scheduleInput.value) : null;
      });
      scheduleRow.append(document.createTextNode("Auto-repeat every"), scheduleInput, document.createTextNode("minutes"));
      profilesEditView.appendChild(scheduleRow);
    }

    const actionsRow = document.createElement("div");
    actionsRow.className = "row";
    actionsRow.style.marginTop = "1rem";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const error = validateProfile(profile);
      if (error) {
        flashStatus(profilesStatus, error, true);
        return;
      }
      try {
        await saveProfile(profile);
      } catch (err) {
        flashStatus(profilesStatus, `error: ${err.message}`, true);
        return;
      }
      exitProfileEdit(true);
    });
    actionsRow.appendChild(saveBtn);
    profilesEditView.appendChild(actionsRow);

    // Kept apart from Save/Back, deliberately not front-and-center --
    // deletes should be rare and a little deliberate to reach.
    const dangerRow = document.createElement("div");
    dangerRow.className = "row";
    dangerRow.style.marginTop = "1.5rem";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-sm";
    deleteBtn.textContent = "Delete this profile";
    deleteBtn.addEventListener("click", async () => {
      try {
        // A never-saved "+ New profile" has no id yet -- nothing to
        // delete server-side, just drop it locally.
        if (profile.id) await deleteProfile(profile.id);
      } catch (err) {
        flashStatus(profilesStatus, `error: ${err.message}`, true);
        return;
      }
      profiles.splice(profilesEditIndex, 1);
      profilesEditIndex = null;
      profilesEditSnapshot = null;
      renderProfilesList();
    });
    dangerRow.appendChild(deleteBtn);
    profilesEditView.appendChild(dangerRow);
  }

  addProfileBtn.addEventListener("click", () => {
    profiles.push({ id: null, name: "", command: [], mode: "pass", usesSdr: true, scheduleMinutes: null });
    enterProfileEdit(profiles.length - 1);
  });

  async function loadProfiles() {
    const data = await apiFetch("/api/orchestrator/app_profiles");
    profiles = Object.entries(data).map(([id, profile]) => ({
      id,
      name: profile.name || id,
      command: [...(profile.command || [])],
      mode: profile.mode === "standalone" ? "standalone" : "pass",
      usesSdr: profile.uses_sdr !== false,
      scheduleMinutes: profile.schedule_seconds ? Math.round(profile.schedule_seconds / 60) : null,
    }));
  }

  // ---------------------------------------------------------------------
  // Tracked Satellites
  // ---------------------------------------------------------------------

  const trackedListView = document.getElementById("tracked-list-view");
  const trackedEditView = document.getElementById("tracked-edit-view");
  const trackedTableBody = document.getElementById("tracked-table-body");
  const searchInput = document.getElementById("tracked-search-input");
  const searchResults = document.getElementById("tracked-search-results");
  const trackedStatus = document.getElementById("tracked-status");

  let trackedObjects = [];
  let trackedEditIndex = null;
  let trackedEditSnapshot = null;

  function profileName(id) {
    const profile = profiles.find((p) => p.id === id);
    return profile ? profile.name : id;
  }

  function downlinkSummary(obj) {
    if (obj.downlinks.length === 0) return "no downlinks";
    if (obj.downlinks.length === 1) {
      const d = obj.downlinks[0];
      const freq = (d.frequency / 1e6).toFixed(3) + " MHz";
      return d.app ? `${freq} → ${profileName(d.app)}` : freq;
    }
    return `${obj.downlinks.length} downlinks`;
  }

  // PUTs/DELETEs by norad, one satellite at a time -- never the whole
  // list, so a bug in this flow can only ever touch the satellite being
  // edited, not every other one too.
  async function saveTrackedObject(obj) {
    const payload = {
      name: obj.name,
      enabled: obj.enabled,
      downlinks: obj.downlinks.map((downlink) => ({
        frequency: downlink.frequency,
        app: downlink.app,
      })),
    };
    await apiFetch(`/api/orchestrator/objects/${obj.norad}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    flashStatus(trackedStatus, "saved", false);
  }

  async function deleteTrackedObject(norad) {
    await apiFetch(`/api/orchestrator/objects/${norad}`, { method: "DELETE" });
  }

  async function moveTrackedObject(norad, direction) {
    try {
      await apiFetch(`/api/orchestrator/objects/${norad}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
    } catch (err) {
      flashStatus(trackedStatus, `error: ${err.message}`, true);
      return;
    }
    await loadObjects();
    renderTrackedList();
  }

  function renderTrackedList() {
    trackedListView.style.display = "";
    trackedEditView.style.display = "none";
    trackedEditView.innerHTML = "";
    trackedTableBody.innerHTML = "";

    if (trackedObjects.length === 0) {
      trackedTableBody.innerHTML = `<tr><td colspan="5" class="hint">No satellites tracked yet -- search below to add one.</td></tr>`;
      return;
    }

    trackedObjects.forEach((obj, index) => {
      const row = document.createElement("tr");

      const cbTd = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = obj.enabled;
      cb.addEventListener("change", async () => {
        obj.enabled = cb.checked;
        try {
          await saveTrackedObject(obj);
        } catch (err) {
          flashStatus(trackedStatus, `error: ${err.message}`, true);
        }
      });
      cbTd.appendChild(cb);

      const nameTd = document.createElement("td");
      nameTd.innerHTML = `${escapeHtml(obj.name)} <span class="tracked-norad">(${obj.norad})</span>`;

      const downlinkTd = document.createElement("td");
      downlinkTd.textContent = downlinkSummary(obj);

      const priorityTd = document.createElement("td");
      priorityTd.style.whiteSpace = "nowrap";
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "btn-sm";
      upBtn.textContent = "↑";
      upBtn.title = "Higher priority";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => moveTrackedObject(obj.norad, "up"));
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "btn-sm";
      downBtn.textContent = "↓";
      downBtn.title = "Lower priority";
      downBtn.disabled = index === trackedObjects.length - 1;
      downBtn.addEventListener("click", () => moveTrackedObject(obj.norad, "down"));
      priorityTd.append(upBtn, downBtn);

      const editTd = document.createElement("td");
      editTd.className = "actions-col";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => enterTrackedEdit(index));
      editTd.appendChild(editBtn);

      row.append(cbTd, nameTd, downlinkTd, priorityTd, editTd);
      trackedTableBody.appendChild(row);
    });
  }

  function enterTrackedEdit(index) {
    trackedEditIndex = index;
    trackedEditSnapshot = JSON.parse(JSON.stringify(trackedObjects[index]));
    renderTrackedEdit();
  }

  function exitTrackedEdit(keepChanges) {
    if (!keepChanges) {
      trackedObjects[trackedEditIndex] = trackedEditSnapshot;
    }
    trackedEditIndex = null;
    trackedEditSnapshot = null;
    renderTrackedList();
  }

  function renderTrackedEdit() {
    trackedListView.style.display = "none";
    trackedEditView.style.display = "";
    trackedEditView.innerHTML = "";
    const obj = trackedObjects[trackedEditIndex];

    const topRow = document.createElement("div");
    topRow.className = "row";
    topRow.style.marginBottom = "0";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn-sm";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", () => exitTrackedEdit(false));
    topRow.appendChild(backBtn);
    trackedEditView.appendChild(topRow);

    const heading = document.createElement("div");
    heading.className = "edit-name-input";
    heading.style.cssText = "border: none; padding-left: 0; font-weight: 600;";
    heading.textContent = `${obj.name} (NORAD ${obj.norad})`;
    trackedEditView.appendChild(heading);

    if (obj.downlinks.length > 0) {
      const head = document.createElement("div");
      head.className = "downlink-row downlink-row-head";
      head.innerHTML = `<span class="field-label">Freq (Hz)</span><span class="field-label">app</span>`;
      trackedEditView.appendChild(head);
    }

    const passProfiles = passModeProfiles();
    obj.downlinks.forEach((downlink, downlinkIndex) => {
      const row = document.createElement("div");
      row.className = "downlink-row";

      const freqInput = document.createElement("input");
      freqInput.type = "number";
      freqInput.step = "1";
      freqInput.value = downlink.frequency;
      freqInput.title = "Frequency (Hz)";
      freqInput.addEventListener("input", () => {
        downlink.frequency = Number(freqInput.value);
      });

      const appSelect = document.createElement("select");
      appSelect.title = "Pass Orchestrator app profile";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "(no app)";
      appSelect.appendChild(noneOpt);
      for (const p of passProfiles) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        appSelect.appendChild(opt);
      }
      if (downlink.app && !passProfiles.some((p) => p.id === downlink.app)) {
        const existing = profiles.find((p) => p.id === downlink.app);
        const opt = document.createElement("option");
        opt.value = downlink.app;
        opt.textContent = existing ? `${existing.name} (standalone)` : `${downlink.app} (missing)`;
        appSelect.appendChild(opt);
      }
      appSelect.value = downlink.app;
      appSelect.addEventListener("change", () => {
        downlink.app = appSelect.value;
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-sm";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        obj.downlinks.splice(downlinkIndex, 1);
        renderTrackedEdit();
      });

      row.append(freqInput, appSelect, removeBtn);
      trackedEditView.appendChild(row);
    });

    const addDownlinkBtn = document.createElement("button");
    addDownlinkBtn.type = "button";
    addDownlinkBtn.className = "btn-sm";
    addDownlinkBtn.textContent = "+ Add downlink";
    addDownlinkBtn.addEventListener("click", () => {
      obj.downlinks.push({ frequency: 137500000, app: "" });
      renderTrackedEdit();
    });
    trackedEditView.appendChild(addDownlinkBtn);

    const actionsRow = document.createElement("div");
    actionsRow.className = "row";
    actionsRow.style.marginTop = "1rem";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      try {
        await saveTrackedObject(obj);
      } catch (err) {
        flashStatus(trackedStatus, `error: ${err.message}`, true);
        return;
      }
      exitTrackedEdit(true);
    });
    actionsRow.appendChild(saveBtn);
    trackedEditView.appendChild(actionsRow);

    // Kept apart from Save/Back, deliberately not front-and-center --
    // deletes should be rare and a little deliberate to reach.
    const dangerRow = document.createElement("div");
    dangerRow.className = "row";
    dangerRow.style.marginTop = "1.5rem";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-sm";
    deleteBtn.textContent = "Delete this satellite";
    deleteBtn.addEventListener("click", async () => {
      try {
        await deleteTrackedObject(obj.norad);
      } catch (err) {
        flashStatus(trackedStatus, `error: ${err.message}`, true);
        return;
      }
      trackedObjects.splice(trackedEditIndex, 1);
      trackedEditIndex = null;
      trackedEditSnapshot = null;
      renderTrackedList();
    });
    dangerRow.appendChild(deleteBtn);
    trackedEditView.appendChild(dangerRow);
  }

  async function loadObjects() {
    const data = await apiFetch("/api/orchestrator/objects");
    trackedObjects = data.map((obj) => ({
      norad: obj.norad,
      name: obj.name || "",
      enabled: obj.enabled !== false,
      downlinks: (obj.downlinks || []).map((downlink) => ({
        frequency: downlink.frequency ?? 137500000,
        app: downlink.app || "",
      })),
    }));
    // Older saved files predate the "name" field -- backfill display names
    // from the TLE catalog rather than showing a bare NORAD id for them.
    await Promise.all(
      trackedObjects
        .filter((obj) => !obj.name)
        .map(async (obj) => {
          try {
            const results = await apiFetch(`/api/tracking/satellites/search?q=${obj.norad}`);
            const match = results.find((sat) => sat.norad === obj.norad);
            obj.name = match ? match.name : `NORAD ${obj.norad}`;
          } catch {
            obj.name = `NORAD ${obj.norad}`;
          }
        })
    );
  }

  function hideSearchResults() {
    searchResults.style.display = "none";
    searchResults.innerHTML = "";
  }

  let searchDebounce;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (!q) {
      hideSearchResults();
      return;
    }
    searchDebounce = setTimeout(async () => {
      const results = await apiFetch(`/api/tracking/satellites/search?q=${encodeURIComponent(q)}`);
      searchResults.innerHTML = "";
      for (const sat of results.slice(0, 20)) {
        const row = document.createElement("div");
        row.className = "search-result-row";
        row.innerHTML = `<span>${escapeHtml(sat.name)}</span><span style="color: var(--text-muted);">${sat.norad}</span>`;
        row.addEventListener("click", () => {
          searchInput.value = "";
          hideSearchResults();
          if (trackedObjects.some((obj) => obj.norad === sat.norad)) {
            flashStatus(trackedStatus, `${sat.name} is already tracked`, true);
            return;
          }
          trackedObjects.push({
            norad: sat.norad,
            name: sat.name,
            enabled: true,
            downlinks: [{ frequency: 137500000, app: "" }],
          });
          enterTrackedEdit(trackedObjects.length - 1);
        });
        searchResults.appendChild(row);
      }
      searchResults.style.display = results.length ? "block" : "none";
    }, 250);
  });

  document.addEventListener("click", (event) => {
    if (event.target !== searchInput && !searchResults.contains(event.target)) {
      hideSearchResults();
    }
  });

  // ---------------------------------------------------------------------
  // Pass Overlaps -- a read-only forecast, doesn't feed back into
  // scheduling. Refreshed on load and by hand (passes shift as TLEs
  // refresh/time passes, not worth polling continuously for).
  // ---------------------------------------------------------------------

  const overlapsList = document.getElementById("overlaps-list");
  const overlapsRefreshBtn = document.getElementById("overlaps-refresh-btn");
  const overlapsStatus = document.getElementById("overlaps-status");

  function formatRelative(iso) {
    const mins = Math.round((new Date(iso) - Date.now()) / 60000);
    if (mins <= 0) return "now";
    if (mins < 60) return `${mins}m`;
    return `${(mins / 60).toFixed(1)}h`;
  }

  async function loadOverlaps() {
    overlapsList.textContent = "checking...";
    let overlaps;
    try {
      overlaps = await apiFetch("/api/orchestrator/overlaps");
    } catch (err) {
      overlapsList.textContent = `error: ${err.message}`;
      return;
    }
    if (overlaps.length === 0) {
      overlapsList.textContent = "no overlaps in the next 48 hours";
      return;
    }
    overlapsList.innerHTML = "";
    for (const o of overlaps) {
      const overlapMins = Math.max(
        1,
        Math.round((new Date(o.overlap_end) - new Date(o.overlap_start)) / 60000)
      );
      const row = document.createElement("div");
      row.style.marginBottom = "0.4rem";
      row.innerHTML = `<strong>${escapeHtml(o.a.name)}</strong> vs <strong>${escapeHtml(o.b.name)}</strong> -- overlap in ${formatRelative(o.overlap_start)}, lasts ~${overlapMins}m`;
      overlapsList.appendChild(row);
    }
  }

  overlapsRefreshBtn.addEventListener("click", async () => {
    try {
      await loadOverlaps();
      flashStatus(overlapsStatus, "refreshed", false);
    } catch (err) {
      flashStatus(overlapsStatus, `error: ${err.message}`, true);
    }
  });

  // ---------------------------------------------------------------------

  async function init() {
    await Promise.all([loadProfiles(), loadObjects(), loadOverlaps(), loadSatdumpPipelines()]);
    renderProfilesList();
    renderTrackedList();
    await refreshStandaloneStatus();
  }

  init();
  refreshOrchStatus();
  setInterval(refreshOrchStatus, 5000);
  setInterval(refreshStandaloneStatus, 5000);
})();
