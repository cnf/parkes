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

  // Live band badge for an editable Hz frequency input -- call update()
  // after any change to the input's value. Empty/non-numeric/placeholder
  // ({frequency}) values just clear the badge rather than showing an
  // "unrecognized" state, since those aren't really frequencies yet.
  //
  // Shows just the band name (e.g. "UHF") rather than the full "UHF · ISM"
  // -- a real, always-visible pill wide enough to read comfortably, but
  // short enough not to shove every later column in a tight row (like the
  // downlink editor) out from under its header label. The tag, if any,
  // is still there on hover via the native title tooltip.
  function createFreqBadge(getHz) {
    const el = document.createElement("span");
    function update() {
      const hz = getHz();
      const match = Number.isFinite(hz) && hz > 0 ? window.ParkesBands.detect(hz) : null;
      if (!match) {
        el.style.display = "none";
        return;
      }
      el.className = `freq-badge c-${match.color}`;
      el.textContent = match.band;
      el.title = window.ParkesBands.label(match);
      el.style.display = "";
    }
    update();
    return { el, update };
  }

  // General band for a downlink's stored frequency (e.g. "VHF"/"Ku-band"),
  // computed fresh at save time -- sent to the backend so
  // PassOrchestrator._candidate_passes() can filter against the active
  // antenna's coverage without duplicating ParkesBands' range table
  // server-side. null for an unrecognized/invalid frequency.
  function bandForDownlink(frequencyHz) {
    return window.ParkesBands.detect(Number(frequencyHz))?.band ?? null;
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
  let commandModules = [];
  const remoteSearchCache = {};

  async function loadSatdumpPipelines() {
    try {
      satdumpPipelines = await apiFetch("/api/orchestrator/satdump_pipelines");
    } catch {
      satdumpPipelines = [];
    }
  }

  async function loadCommandModules() {
    try {
      commandModules = await apiFetch("/api/orchestrator/command_modules");
    } catch {
      commandModules = [];
    }
  }

  async function loadRemoteSearchOptions(url) {
    if (!(url in remoteSearchCache)) {
      try {
        remoteSearchCache[url] = await apiFetch(url);
      } catch {
        remoteSearchCache[url] = [];
      }
    }
    return remoteSearchCache[url];
  }

  function fillTemplate(template, obj) {
    return template.replace(/\{(\w+)\}/g, (_, key) => obj[key] ?? "");
  }

  // ---------------------------------------------------------------------
  // Command modules -- structured, per-command editors driven entirely by
  // the schema api/orchestrator.py's /command_modules serves (see
  // sdr/command_modules.py). Adding a new known command later means
  // adding a schema there; nothing here is satdump-specific.
  // ---------------------------------------------------------------------

  function moduleFieldVisible(field, fields) {
    if (!field.show_if) return true;
    return fields[field.show_if.field] === field.show_if.equals;
  }

  function applyModuleFieldDefaults(mode, profile) {
    for (const field of mode.fields) {
      let value = field.default;
      if (field.default_by_profile_mode && field.default_by_profile_mode[profile.mode] !== undefined) {
        value = field.default_by_profile_mode[profile.mode];
      }
      const current = profile.moduleFields[field.key];
      // Field keys are shared across a module's modes on purpose (e.g.
      // switching live -> record keeps the source/samplerate you already
      // set) -- but that means a field left blank by one mode (its
      // default is empty/unset) can otherwise "lock in" before a
      // *different* mode, sharing the same key, gets a chance to apply
      // its own real default. Only skip applying this mode's default when
      // the field already has a real value, or this mode has nothing
      // more useful to offer than what's already there.
      if (current !== undefined && current !== "" ) continue;
      if (current === "" && (value === undefined || value === "")) continue;
      profile.moduleFields[field.key] = value ?? (field.type === "checkbox" ? false : "");
    }
  }

  function buildModuleCommand(mode, fields, extraArgs) {
    const command = [...mode.prefix];
    for (const field of mode.fields) {
      if (!field.positional || !moduleFieldVisible(field, fields)) continue;
      command.push(String(fields[field.key] ?? ""));
    }
    for (const field of mode.fields) {
      if (field.positional || !moduleFieldVisible(field, fields)) continue;
      const value = fields[field.key];
      if (field.type === "checkbox") {
        if (value) command.push(field.flag);
      } else if (value !== undefined && value !== null && String(value).trim() !== "") {
        // No "flag" -- the field's whole value is one raw token (e.g.
        // "bias", whose value is the "{bias}" placeholder itself), instead
        // of the usual "--flag value" pair.
        if (field.flag) command.push(field.flag, String(value));
        else command.push(String(value));
      }
    }
    command.push(...extraArgs);
    return command;
  }

  function rebuildModuleCommand(profile) {
    const module = commandModules.find((m) => m.id === profile.module);
    const mode = module && module.modes.find((m) => m.id === profile.moduleMode);
    if (!mode) return;
    profile.command = buildModuleCommand(mode, profile.moduleFields, profile.moduleExtraArgs);
  }

  function previewTokenHtml(token) {
    const escaped = escapeHtml(token);
    if (token.startsWith("{") && token.endsWith("}")) return `<span class="tok-placeholder">${escaped}</span>`;
    if (token.startsWith("-")) return `<span class="tok-flag">${escaped}</span>`;
    return escaped;
  }

  function refreshModulePreview(profile) {
    rebuildModuleCommand(profile);
    const previewEl = document.getElementById("module-command-preview");
    if (previewEl) previewEl.innerHTML = profile.command.map(previewTokenHtml).join(" ");
  }

  function renderModuleFieldRow(field, profile, rerender) {
    const fields = profile.moduleFields;
    const value = fields[field.key];

    if (field.type === "checkbox") {
      const label = document.createElement("label");
      label.className = "module-checkbox";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!value;
      cb.addEventListener("change", () => {
        fields[field.key] = cb.checked;
        rerender();
      });
      label.append(cb, document.createTextNode(" " + field.label));
      return label;
    }

    const label = document.createElement("label");
    let labelText = field.label;
    if (field.unit) labelText += ` (${field.unit})`;
    if (field.optional) labelText += " -- optional";
    label.appendChild(document.createTextNode(labelText));

    if (field.type === "select") {
      const select = document.createElement("select");
      for (const opt of field.options) {
        const optionEl = document.createElement("option");
        optionEl.value = opt;
        optionEl.textContent = opt === "" ? "(none)" : opt;
        optionEl.selected = opt === value;
        select.appendChild(optionEl);
      }
      select.addEventListener("change", () => {
        fields[field.key] = select.value;
        rerender();
      });
      label.appendChild(select);
      return label;
    }

    if (field.type === "remote_search") {
      const wrap = document.createElement("div");
      wrap.className = "group-search";
      const input = document.createElement("input");
      input.type = "text";
      input.value = value || "";
      input.placeholder = "Search...";
      const resultsEl = document.createElement("div");
      resultsEl.className = "search-results";
      resultsEl.style.display = "none";

      if (value) {
        loadRemoteSearchOptions(field.source_url).then((options) => {
          const match = options.find((o) => o[field.value_key] === value);
          if (match && input.value === value) input.value = fillTemplate(field.display_template, match);
        });
      }

      input.addEventListener("input", async () => {
        const q = input.value.trim().toLowerCase();
        resultsEl.innerHTML = "";
        if (!q) {
          resultsEl.style.display = "none";
          return;
        }
        const options = await loadRemoteSearchOptions(field.source_url);
        const matches = options
          .filter((opt) => field.search_keys.some((k) => String(opt[k] || "").toLowerCase().includes(q)))
          .slice(0, 20);
        resultsEl.innerHTML = "";
        for (const opt of matches) {
          const resultRow = document.createElement("div");
          resultRow.className = "search-result-row";
          resultRow.textContent = fillTemplate(field.display_template, opt);
          resultRow.addEventListener("click", () => {
            fields[field.key] = opt[field.value_key];
            rerender();
          });
          resultsEl.appendChild(resultRow);
        }
        resultsEl.style.display = matches.length ? "block" : "none";
      });

      wrap.append(input, resultsEl);
      label.appendChild(wrap);
      return label;
    }

    // text
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.className = value && String(value).startsWith("{") && String(value).endsWith("}") ? "is-placeholder" : "";
    label.appendChild(input);
    // Only the "frequency" field's raw value is worth band-detecting --
    // it's plain text (not type="number") since it can also hold the
    // {frequency} placeholder token, which Number() correctly turns into
    // NaN and the badge just hides itself for.
    let freqBadge = null;
    if (field.key === "frequency") {
      freqBadge = createFreqBadge(() => Number(input.value));
      label.appendChild(freqBadge.el);
    }
    input.addEventListener("input", () => {
      fields[field.key] = input.value;
      input.className = input.value.startsWith("{") && input.value.endsWith("}") ? "is-placeholder" : "";
      if (freqBadge) freqBadge.update();
      refreshModulePreview(profile);
    });
    return label;
  }

  function renderModuleEditor(container, profile) {
    const module = commandModules.find((m) => m.id === profile.module);
    if (!module) return;
    const mode = module.modes.find((m) => m.id === profile.moduleMode) || module.modes[0];
    applyModuleFieldDefaults(mode, profile);

    const modeLabel = document.createElement("div");
    modeLabel.className = "field-label";
    modeLabel.textContent = "Mode";
    container.appendChild(modeLabel);

    const modeSeg = document.createElement("div");
    modeSeg.className = "seg-row";
    for (const m of module.modes) {
      const modeBtn = document.createElement("button");
      modeBtn.type = "button";
      modeBtn.className = "btn-sm" + (m.id === mode.id ? " active" : "");
      modeBtn.textContent = m.label;
      modeBtn.addEventListener("click", () => {
        profile.moduleMode = m.id;
        applyModuleFieldDefaults(m, profile);
        rebuildModuleCommand(profile);
        renderProfileEdit();
      });
      modeSeg.appendChild(modeBtn);
    }
    container.appendChild(modeSeg);

    const rerender = () => {
      rebuildModuleCommand(profile);
      renderProfileEdit();
    };

    const fullWidthFields = mode.fields.filter(
      (f) => moduleFieldVisible(f, profile.moduleFields) && (f.positional || f.type === "remote_search")
    );
    const checkboxFields = mode.fields.filter(
      (f) => moduleFieldVisible(f, profile.moduleFields) && !f.positional && f.type === "checkbox"
    );
    const gridFields = mode.fields.filter(
      (f) =>
        moduleFieldVisible(f, profile.moduleFields) &&
        !f.positional &&
        f.type !== "checkbox" &&
        f.type !== "remote_search"
    );

    for (const field of fullWidthFields) {
      const row = document.createElement("div");
      row.className = "module-field-row";
      row.appendChild(renderModuleFieldRow(field, profile, rerender));
      container.appendChild(row);
    }

    if (gridFields.length > 0) {
      const grid = document.createElement("div");
      grid.className = "module-fields-grid";
      for (const field of gridFields) grid.appendChild(renderModuleFieldRow(field, profile, rerender));
      container.appendChild(grid);
    }

    if (checkboxFields.length > 0) {
      const checksRow = document.createElement("div");
      checksRow.className = "module-checks-row";
      for (const field of checkboxFields) checksRow.appendChild(renderModuleFieldRow(field, profile, rerender));
      container.appendChild(checksRow);
    }

    rebuildModuleCommand(profile);
    const previewLabel = document.createElement("div");
    previewLabel.className = "module-preview-label";
    previewLabel.textContent = "Command preview";
    container.appendChild(previewLabel);
    const preview = document.createElement("div");
    preview.id = "module-command-preview";
    preview.className = "command-preview-box";
    preview.innerHTML = profile.command.map(previewTokenHtml).join(" ");
    container.appendChild(preview);

    const advanced = document.createElement("details");
    advanced.className = "module-advanced";
    // Editing an extra arg re-renders the whole form (same as everything
    // else here) -- remember whether this was open so that doesn't look
    // like the section slamming shut on you mid-edit.
    advanced.open = !!profile._advancedOpen;
    advanced.addEventListener("toggle", () => {
      profile._advancedOpen = advanced.open;
    });
    const summary = document.createElement("summary");
    summary.textContent = "Advanced -- extra command-line args";
    advanced.appendChild(summary);
    renderRawCommandEditor(advanced, profile.moduleExtraArgs, profile.mode, {
      onChange: rerender,
      includeSatdumpTemplatePicker: false,
    });
    container.appendChild(advanced);
  }

  function renderRawCommandEditor(container, commandArray, profileMode, options) {
    function argClass(value) {
      if (value.startsWith("{") && value.endsWith("}")) return "command-arg-input is-placeholder";
      if (value.startsWith("-")) return "command-arg-input is-flag";
      return "command-arg-input";
    }

    const argsList = document.createElement("div");
    argsList.className = "command-args-list";
    commandArray.forEach((arg, argIndex) => {
      const row = document.createElement("div");
      row.className = "command-arg-row";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "btn-sm";
      upBtn.textContent = "↑";
      upBtn.title = "Move earlier";
      upBtn.disabled = argIndex === 0;
      upBtn.addEventListener("click", () => {
        [commandArray[argIndex - 1], commandArray[argIndex]] = [commandArray[argIndex], commandArray[argIndex - 1]];
        options.onChange();
      });

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "btn-sm";
      downBtn.textContent = "↓";
      downBtn.title = "Move later";
      downBtn.disabled = argIndex === commandArray.length - 1;
      downBtn.addEventListener("click", () => {
        [commandArray[argIndex + 1], commandArray[argIndex]] = [commandArray[argIndex], commandArray[argIndex + 1]];
        options.onChange();
      });

      const argInput = document.createElement("input");
      argInput.type = "text";
      argInput.value = arg;
      argInput.className = argClass(arg);
      argInput.addEventListener("input", () => {
        commandArray[argIndex] = argInput.value;
        argInput.className = argClass(argInput.value);
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-sm";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove";
      removeBtn.addEventListener("click", () => {
        commandArray.splice(argIndex, 1);
        options.onChange();
      });

      row.append(upBtn, downBtn, argInput, removeBtn);
      argsList.appendChild(row);
    });
    container.appendChild(argsList);

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
        commandArray.push(value);
        options.onChange();
      }
    });
    searchWrap.appendChild(addInput);
    container.appendChild(searchWrap);

    const placeholderRow = document.createElement("div");
    placeholderRow.className = "placeholder-quick-row";
    placeholderRow.appendChild(document.createTextNode("Insert:"));
    const availablePlaceholders = ["{output_dir}", "{source}", "{source_id}", "{samplerate}", "{timestamp}"];
    if (profileMode === "pass") availablePlaceholders.unshift("{frequency}");
    for (const ph of availablePlaceholders) {
      const phBtn = document.createElement("button");
      phBtn.type = "button";
      phBtn.className = "btn-sm";
      phBtn.textContent = ph;
      phBtn.addEventListener("click", () => {
        commandArray.push(ph);
        options.onChange();
      });
      placeholderRow.appendChild(phBtn);
    }
    container.appendChild(placeholderRow);

    // Templates read straight from the installed satdump's own pipeline
    // definitions (see api/orchestrator.py's /satdump_pipelines), so the
    // command skeleton they produce stays accurate across satdump versions
    // instead of us guessing at flags. Absent if satdump isn't installed
    // (see loadSatdumpPipelines()) or this editor is scoped to a module's
    // "extra args" (which already has its own pipeline field).
    if (options.includeSatdumpTemplatePicker && satdumpPipelines.length > 0) {
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
            commandArray.length = 0;
            commandArray.push(
              "satdump",
              "live",
              p.id,
              "{output_dir}",
              "--source",
              "{source}",
              "--samplerate",
              "{samplerate}",
              ...(profileMode === "pass" ? ["--frequency", "{frequency}"] : [])
            );
            if (options.onSelectPipeline) options.onSelectPipeline(p);
            options.onChange();
          });
          templateResultsEl.appendChild(row);
        }
        templateResultsEl.style.display = matches.length ? "block" : "none";
      });

      templateWrap.append(templateInput, templateResultsEl);
      container.appendChild(templateWrap);
    }
  }

  function passModeProfiles() {
    return profiles.filter((p) => p.mode !== "standalone");
  }

  function standaloneProfiles() {
    return profiles.filter((p) => p.mode === "standalone");
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
    refreshPositionsStatus();
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
      ...(profile.module
        ? {
            module: profile.module,
            module_mode: profile.moduleMode,
            module_fields: profile.moduleFields,
            module_extra_args: profile.moduleExtraArgs,
          }
        : {}),
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

    // Command type: a known command module (structured form) or the raw,
    // freeform arg-list editor -- always available as an escape hatch,
    // even for a command a module also covers, for the one case that
    // doesn't fit the structured form.
    const typeLabel = document.createElement("div");
    typeLabel.className = "field-label";
    typeLabel.textContent = "Command type";
    profilesEditView.appendChild(typeLabel);

    const typeSeg = document.createElement("div");
    typeSeg.className = "seg-row";
    const customTypeBtn = document.createElement("button");
    customTypeBtn.type = "button";
    customTypeBtn.className = "btn-sm" + (profile.module ? "" : " active");
    customTypeBtn.textContent = "Custom command";
    customTypeBtn.addEventListener("click", () => {
      profile.module = null;
      profile.moduleMode = null;
      renderProfileEdit();
    });
    typeSeg.appendChild(customTypeBtn);
    for (const module of commandModules) {
      const moduleBtn = document.createElement("button");
      moduleBtn.type = "button";
      moduleBtn.className = "btn-sm" + (profile.module === module.id ? " active" : "");
      moduleBtn.textContent = module.label;
      moduleBtn.addEventListener("click", () => {
        const modeStillValid =
          profile.module === module.id && module.modes.some((m) => m.id === profile.moduleMode);
        profile.module = module.id;
        if (!modeStillValid) profile.moduleMode = module.modes[0].id;
        profile.moduleFields = profile.moduleFields || {};
        profile.moduleExtraArgs = profile.moduleExtraArgs || [];
        const mode = module.modes.find((m) => m.id === profile.moduleMode);
        applyModuleFieldDefaults(mode, profile);
        rebuildModuleCommand(profile);
        renderProfileEdit();
      });
      typeSeg.appendChild(moduleBtn);
    }
    profilesEditView.appendChild(typeSeg);

    if (profile.module) {
      renderModuleEditor(profilesEditView, profile);
    } else {
      renderRawCommandEditor(profilesEditView, profile.command, profile.mode, {
        onChange: renderProfileEdit,
        includeSatdumpTemplatePicker: true,
        onSelectPipeline: (p) => {
          profile._pipelineHint = p.frequencies.length
            ? `Typical frequencies for ${p.name}: ` +
              p.frequencies
                .slice(0, 4)
                .map(([label, hz]) => `${label} ${(hz / 1e6).toFixed(3)} MHz`)
                .join(", ")
            : null;
        },
      });
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
    profiles.push({
      id: null,
      name: "",
      command: [],
      mode: "pass",
      usesSdr: true,
      scheduleMinutes: null,
      module: null,
      moduleMode: null,
      moduleFields: {},
      moduleExtraArgs: [],
    });
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
      module: profile.module || null,
      moduleMode: profile.module_mode || null,
      moduleFields: profile.module_fields ? { ...profile.module_fields } : {},
      moduleExtraArgs: profile.module_extra_args ? [...profile.module_extra_args] : [],
    }));
  }

  // ---------------------------------------------------------------------
  // Antennas -- which physical receive chain is connected right now, and
  // what general bands (see bands.js) each one can receive. The active
  // one filters which Tracked Satellites downlinks the Pass Orchestrator
  // will even consider -- see tracking/antennas.py's active_bands() and
  // PassOrchestrator._candidate_passes().
  // ---------------------------------------------------------------------

  const antennasListView = document.getElementById("antennas-list-view");
  const antennasEditView = document.getElementById("antennas-edit-view");
  const antennasTableBody = document.getElementById("antennas-table-body");
  const addAntennaBtn = document.getElementById("add-antenna-btn");
  const antennasStatus = document.getElementById("antennas-status");
  const activeAntennaSelect = document.getElementById("active-antenna-select");

  let antennas = [];
  let antennasEditIndex = null;
  let antennasEditSnapshot = null;
  let activeAntennaId = null;

  async function loadAntennas() {
    const data = await apiFetch("/api/orchestrator/antennas");
    antennas = Object.entries(data).map(([id, a]) => ({
      id,
      name: a.name || id,
      coverageMode: a.coverage_mode === "range" ? "range" : "band",
      bands: a.bands || [],
      freqMinMhz: a.freq_min_mhz ?? null,
      freqMaxMhz: a.freq_max_mhz ?? null,
    }));
  }

  async function loadActiveAntenna() {
    const data = await apiFetch("/api/settings");
    activeAntennaId = data.preferences.active_antenna_id || null;
  }

  function renderActiveAntennaSelect() {
    activeAntennaSelect.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "None connected -- no band filtering";
    activeAntennaSelect.appendChild(noneOpt);
    for (const a of antennas) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name;
      activeAntennaSelect.appendChild(opt);
    }
    activeAntennaSelect.value = activeAntennaId && antennas.some((a) => a.id === activeAntennaId) ? activeAntennaId : "";
  }

  // Tracked Satellites/Static Positions' downlink summaries depend on the
  // active antenna (see effectiveDownlink()/downlinkReceivable()), but
  // their tables are only rebuilt when something explicitly re-renders
  // them -- without this, switching antennas (or editing/deleting the one
  // currently active) looks like it did nothing until the next unrelated
  // action happens to rebuild those rows. Skips a list mid-edit rather
  // than yanking the editor out from under an in-progress change.
  function refreshDownlinkFilteredViews() {
    if (trackedEditIndex === null) renderTrackedList();
    if (positionsEditIndex === null) renderPositionsList();
  }

  activeAntennaSelect.addEventListener("change", async () => {
    const value = activeAntennaSelect.value || null;
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_antenna_id: value }),
      });
      activeAntennaId = value;
      flashStatus(antennasStatus, "active antenna updated", false);
      refreshDownlinkFilteredViews();
    } catch (err) {
      flashStatus(antennasStatus, `error: ${err.message}`, true);
      renderActiveAntennaSelect();
    }
  });

  function assignAntennaId(antenna) {
    if (antenna.id) return antenna.id;
    const taken = new Set(antennas.filter((a) => a.id).map((a) => a.id));
    antenna.id = uniqueId(slugify(antenna.name), taken);
    return antenna.id;
  }

  async function saveAntenna(antenna) {
    assignAntennaId(antenna);
    const payload = {
      name: antenna.name.trim(),
      coverage_mode: antenna.coverageMode,
      ...(antenna.coverageMode === "range"
        ? { bands: [], freq_min_mhz: antenna.freqMinMhz, freq_max_mhz: antenna.freqMaxMhz }
        : { bands: antenna.bands, freq_min_mhz: null, freq_max_mhz: null }),
    };
    await apiFetch(`/api/orchestrator/antennas/${encodeURIComponent(antenna.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    flashStatus(antennasStatus, "saved", false);
  }

  async function deleteAntenna(id) {
    await apiFetch(`/api/orchestrator/antennas/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  function validateAntenna(antenna) {
    if (!antenna.name.trim()) return "every antenna needs a name";
    if (antenna.coverageMode === "range") {
      if (!Number.isFinite(antenna.freqMinMhz) || !Number.isFinite(antenna.freqMaxMhz)) {
        return "frequency range needs both a min and max (MHz)";
      }
      if (antenna.freqMinMhz >= antenna.freqMaxMhz) return "min frequency must be less than max";
    }
    return null;
  }

  function renderAntennasList() {
    antennasListView.style.display = "";
    antennasEditView.style.display = "none";
    antennasEditView.innerHTML = "";
    antennasTableBody.innerHTML = "";
    renderActiveAntennaSelect();

    if (antennas.length === 0) {
      antennasTableBody.innerHTML =
        '<tr><td colspan="3" class="hint">No antennas defined yet -- without one selected, every downlink is considered reachable.</td></tr>';
      return;
    }

    antennas.forEach((antenna, index) => {
      const row = document.createElement("tr");

      const nameTd = document.createElement("td");
      nameTd.textContent = antenna.name;

      const bandsTd = document.createElement("td");
      if (antenna.coverageMode === "range") {
        if (Number.isFinite(antenna.freqMinMhz) && Number.isFinite(antenna.freqMaxMhz)) {
          bandsTd.textContent = `${antenna.freqMinMhz}–${antenna.freqMaxMhz} MHz`;
        } else {
          bandsTd.className = "hint";
          bandsTd.textContent = "no range set";
        }
      } else if (antenna.bands.length === 0) {
        bandsTd.className = "hint";
        bandsTd.textContent = "no bands set";
      } else {
        const known = window.ParkesBands.generalBands();
        for (const band of antenna.bands) {
          const info = known.find((b) => b.band === band);
          const badge = document.createElement("span");
          badge.className = `freq-badge c-${info ? info.color : "gray"}`;
          badge.style.marginRight = "0.3rem";
          badge.textContent = band;
          bandsTd.appendChild(badge);
        }
      }

      const editTd = document.createElement("td");
      editTd.className = "actions-col";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => enterAntennaEdit(index));
      editTd.appendChild(editBtn);

      row.append(nameTd, bandsTd, editTd);
      antennasTableBody.appendChild(row);
    });
  }

  function enterAntennaEdit(index) {
    antennasEditIndex = index;
    antennasEditSnapshot = JSON.parse(JSON.stringify(antennas[index]));
    renderAntennaEdit();
  }

  function exitAntennaEdit(keepChanges) {
    if (!keepChanges) {
      antennas[antennasEditIndex] = antennasEditSnapshot;
    }
    antennasEditIndex = null;
    antennasEditSnapshot = null;
    renderAntennasList();
  }

  function renderAntennaEdit() {
    antennasListView.style.display = "none";
    antennasEditView.style.display = "";
    antennasEditView.innerHTML = "";
    const antenna = antennas[antennasEditIndex];

    const topRow = document.createElement("div");
    topRow.className = "row";
    topRow.style.marginBottom = "0";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn-sm";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", () => exitAntennaEdit(false));
    topRow.appendChild(backBtn);
    antennasEditView.appendChild(topRow);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "edit-name-input";
    nameInput.placeholder = "antenna/LNB name";
    nameInput.value = antenna.name;
    nameInput.addEventListener("input", () => {
      antenna.name = nameInput.value;
    });
    antennasEditView.appendChild(nameInput);

    const modeLabel = document.createElement("div");
    modeLabel.className = "field-label";
    modeLabel.textContent = "Coverage";
    antennasEditView.appendChild(modeLabel);

    const modeSeg = document.createElement("div");
    modeSeg.className = "seg-row";
    for (const [value, text] of [["band", "General band"], ["range", "Frequency range"]]) {
      const modeBtn = document.createElement("button");
      modeBtn.type = "button";
      modeBtn.className = "btn-sm" + (antenna.coverageMode === value ? " active" : "");
      modeBtn.textContent = text;
      modeBtn.addEventListener("click", () => {
        antenna.coverageMode = value;
        renderAntennaEdit();
      });
      modeSeg.appendChild(modeBtn);
    }
    antennasEditView.appendChild(modeSeg);

    if (antenna.coverageMode === "range") {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent =
        "For narrowband/resonant antennas where the coarse bands below would be wrong -- e.g. a " +
        "868MHz ISM antenna checking off \"UHF\" would also claim it can receive a 437MHz downlink.";
      antennasEditView.appendChild(hint);

      const rangeRow = document.createElement("div");
      rangeRow.className = "antenna-range-row";

      const minInput = document.createElement("input");
      minInput.type = "number";
      minInput.step = "any";
      minInput.placeholder = "min";
      minInput.value = antenna.freqMinMhz ?? "";
      minInput.addEventListener("input", () => {
        const parsed = Number(minInput.value);
        antenna.freqMinMhz = minInput.value === "" || !Number.isFinite(parsed) ? null : parsed;
      });
      rangeRow.appendChild(labeledField("Min (MHz)", minInput, "antenna-range-field"));

      const maxInput = document.createElement("input");
      maxInput.type = "number";
      maxInput.step = "any";
      maxInput.placeholder = "max";
      maxInput.value = antenna.freqMaxMhz ?? "";
      maxInput.addEventListener("input", () => {
        const parsed = Number(maxInput.value);
        antenna.freqMaxMhz = maxInput.value === "" || !Number.isFinite(parsed) ? null : parsed;
      });
      rangeRow.appendChild(labeledField("Max (MHz)", maxInput, "antenna-range-field"));

      antennasEditView.appendChild(rangeRow);
    } else {
      const bandsLabel = document.createElement("div");
      bandsLabel.className = "field-label";
      bandsLabel.textContent = "Receivable bands";
      antennasEditView.appendChild(bandsLabel);

      const bandsRow = document.createElement("div");
      bandsRow.className = "antenna-bands-row";
      for (const b of window.ParkesBands.generalBands()) {
        const label = document.createElement("label");
        label.className = "antenna-band-checkbox";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = antenna.bands.includes(b.band);
        cb.addEventListener("change", () => {
          antenna.bands = cb.checked ? [...antenna.bands, b.band] : antenna.bands.filter((x) => x !== b.band);
        });
        const badge = document.createElement("span");
        badge.className = `freq-badge c-${b.color}`;
        badge.textContent = b.band;
        label.append(cb, badge);
        bandsRow.appendChild(label);
      }
      antennasEditView.appendChild(bandsRow);
    }

    const actionsRow = document.createElement("div");
    actionsRow.className = "row";
    actionsRow.style.marginTop = "1rem";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const error = validateAntenna(antenna);
      if (error) {
        flashStatus(antennasStatus, error, true);
        return;
      }
      try {
        await saveAntenna(antenna);
      } catch (err) {
        flashStatus(antennasStatus, `error: ${err.message}`, true);
        return;
      }
      exitAntennaEdit(true);
      // Editing the currently-active antenna's own coverage should
      // refresh what it filters, same as switching which one's active.
      refreshDownlinkFilteredViews();
    });
    actionsRow.appendChild(saveBtn);
    antennasEditView.appendChild(actionsRow);

    // Kept apart from Save/Back, deliberately not front-and-center --
    // deletes should be rare and a little deliberate to reach.
    const dangerRow = document.createElement("div");
    dangerRow.className = "row";
    dangerRow.style.marginTop = "1.5rem";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-sm";
    deleteBtn.textContent = "Delete this antenna";
    deleteBtn.addEventListener("click", async () => {
      try {
        if (antenna.id) await deleteAntenna(antenna.id);
      } catch (err) {
        flashStatus(antennasStatus, `error: ${err.message}`, true);
        return;
      }
      antennas.splice(antennasEditIndex, 1);
      if (activeAntennaId === antenna.id) activeAntennaId = null;
      antennasEditIndex = null;
      antennasEditSnapshot = null;
      renderAntennasList();
      refreshDownlinkFilteredViews();
    });
    dangerRow.appendChild(deleteBtn);
    antennasEditView.appendChild(dangerRow);
  }

  addAntennaBtn.addEventListener("click", () => {
    antennas.push({ id: null, name: "", coverageMode: "band", bands: [], freqMinMhz: null, freqMaxMhz: null });
    enterAntennaEdit(antennas.length - 1);
  });

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
  // Which row (by norad) has its downlink-detail row expanded -- at most
  // one at a time, see renderTrackedList()'s row click handler.
  let expandedTrackedNorad = null;

  function profileName(id) {
    const profile = profiles.find((p) => p.id === id);
    return profile ? profile.name : id;
  }

  // General band for a downlink, preferring its stored value but falling
  // back to deriving it from frequency -- same fallback reasoning as
  // tracking/antennas.py's downlink_band() (a downlink saved before the
  // "band" field existed shouldn't look unrecognized here either).
  function effectiveBand(downlink) {
    return downlink.band || bandForDownlink(downlink.frequency);
  }

  // Mirrors tracking/antennas.py's active_antenna() -- the raw selected
  // antenna, or null if nothing's selected (or its id no longer exists).
  function currentActiveAntenna() {
    if (!activeAntennaId) return null;
    return antennas.find((a) => a.id === activeAntennaId) || null;
  }

  // Mirrors tracking/antennas.py's downlink_receivable() -- "range" mode
  // compares the downlink's actual frequency against the antenna's
  // min/max MHz directly; "band" mode (or an antenna saved before
  // coverage_mode existed) checks its general band instead. An
  // unconfigured antenna (nothing checked, or an incomplete range) fails
  // open, same as no antenna being selected at all.
  function downlinkReceivable(downlink, antenna) {
    if (antenna.coverageMode === "range") {
      if (!Number.isFinite(antenna.freqMinMhz) || !Number.isFinite(antenna.freqMaxMhz)) return true;
      const mhz = Number(downlink.frequency) / 1e6;
      return Number.isFinite(mhz) && mhz >= antenna.freqMinMhz && mhz <= antenna.freqMaxMhz;
    }
    if (!antenna.bands || antenna.bands.length === 0) return true;
    return antenna.bands.includes(effectiveBand(downlink));
  }

  // The one downlink PassOrchestrator._candidate_passes() would actually
  // pick for a pass right now: the first enabled one, narrowed to the
  // first the active antenna can receive if one's selected. null when
  // every enabled downlink is filtered out by the current antenna (not
  // the same as "no enabled downlinks" -- callers that care about the
  // distinction check obj.downlinks themselves).
  function effectiveDownlink(downlinks) {
    const enabled = downlinks.filter((d) => d.enabled !== false);
    if (enabled.length === 0) return null;
    const antenna = currentActiveAntenna();
    if (!antenna) return enabled[0];
    return enabled.find((d) => downlinkReceivable(d, antenna)) || null;
  }

  function describeDownlink(d) {
    const freq = (d.frequency / 1e6).toFixed(3) + " MHz";
    const upFreq = d.up_frequency ? ` / ↑${(d.up_frequency / 1e6).toFixed(3)} MHz` : "";
    const label = d.mode ? `${freq}${upFreq} (${d.mode})` : `${freq}${upFreq}`;
    const withApp = d.app ? `${label} → ${profileName(d.app)}` : label;
    return d.enabled === false ? `${withApp} (disabled)` : withApp;
  }

  // Shared expand/collapse detail row for Tracked Satellites and Static
  // Positions -- clicking a row (see wiring in renderTrackedList()/
  // renderPositionsList()) shows this pinned below it instead of only
  // being reachable via the hover popover. Same per-downlink content/
  // active-highlighting as that popover (reuses its CSS classes), plus
  // whatever basic-info HTML the caller wants above the list.
  function buildDownlinkDetailRow(colspan, downlinks, basicInfoHtml) {
    const tr = document.createElement("tr");
    tr.className = "downlink-detail-row";
    const td = document.createElement("td");
    td.colSpan = colspan;
    const panel = document.createElement("div");
    panel.className = "downlink-detail-panel";
    if (basicInfoHtml) panel.insertAdjacentHTML("beforeend", basicInfoHtml);
    if (downlinks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "no downlinks configured";
      panel.appendChild(empty);
    } else {
      const active = effectiveDownlink(downlinks);
      for (const d of downlinks) {
        const match = window.ParkesBands.detect(Number(d.frequency));
        const row = document.createElement("div");
        row.className = "downlink-tooltip-row" + (d === active ? " is-active" : "");
        if (match) {
          const badge = document.createElement("span");
          badge.className = `freq-badge c-${match.color}`;
          badge.textContent = match.band;
          row.appendChild(badge);
        }
        row.appendChild(document.createTextNode(describeDownlink(d)));
        panel.appendChild(row);
      }
    }
    td.appendChild(panel);
    tr.appendChild(td);
    return tr;
  }

  // Hz to hang a band badge/tooltip off of, when the summary boils down to
  // a single unambiguous frequency. Under preferActive this always goes
  // through effectiveDownlink() -- even a lone downlink can be filtered
  // out by the active antenna, same as PassOrchestrator/_active_downlink()
  // would treat it, so "one downlink" isn't automatically "the shown one"
  // the way it is when preferActive is off.
  function primaryFrequencyHz(obj, { preferActive } = {}) {
    if (preferActive) return effectiveDownlink(obj.downlinks)?.frequency ?? null;
    return obj.downlinks.length === 1 ? obj.downlinks[0].frequency : null;
  }

  // Fills a table cell with the downlink summary text plus, when there's a
  // single unambiguous frequency, a visible band badge (not just a hover
  // tooltip -- a tiny hover-only indicator turned out to be easy to miss
  // entirely) and a data-freq-hz for freq-tooltip.js's precise-MHz popover.
  //
  // preferActive (both Tracked Satellites and Static Positions -- see
  // _active_downlink()/_candidate_passes(), both apply the same active-
  // antenna band filter) shows the one downlink that would actually be
  // used instead of just listing/counting them, and sets a
  // data-downlink-list for the hover popover below to show the rest (or,
  // for a single downlink that got filtered out, to show what it actually
  // is). The total count itself is a separate table column now (see
  // renderTrackedList()/renderPositionsList()), not part of this text.
  function renderDownlinkCell(td, obj, { preferActive } = {}) {
    td.textContent = downlinkSummary(obj, { preferActive });
    if (preferActive && obj.downlinks.length > 0) {
      const active = effectiveDownlink(obj.downlinks);
      td.dataset.downlinkList = JSON.stringify(
        obj.downlinks.map((d) => {
          const match = window.ParkesBands.detect(Number(d.frequency));
          return {
            text: describeDownlink(d),
            active: d === active,
            band: match ? match.band : null,
            color: match ? match.color : "gray",
          };
        })
      );
    }
    const hz = primaryFrequencyHz(obj, { preferActive });
    if (!hz) return;
    td.dataset.freqHz = hz;
    const badge = createFreqBadge(() => hz);
    if (badge.el.style.display !== "none") {
      badge.el.style.marginLeft = "0.4rem";
      td.appendChild(badge.el);
    }
  }

  // The total-downlink-count column carries the count now, so this only
  // needs the one line that's actually in play.
  function downlinkSummary(obj, { preferActive } = {}) {
    if (obj.downlinks.length === 0) return "no downlinks";
    if (!preferActive) {
      return obj.downlinks.length === 1 ? describeDownlink(obj.downlinks[0]) : `${obj.downlinks.length} downlinks`;
    }
    const active = effectiveDownlink(obj.downlinks);
    return active ? describeDownlink(active) : "none matching";
  }

  // Hover-reveal for the collapsed "(N total)" summary above -- mirrors
  // freq-tooltip.js's delegated, single-shared-popover approach, but the
  // content here is a whole downlink list rather than one frequency's
  // band, so it's simplest kept local to this page instead of
  // generalizing freq-tooltip.js for a one-off caller.
  let downlinkTooltipEl = null;
  let downlinkTooltipShowTimer = null;
  let downlinkTooltipHideTimer = null;

  function ensureDownlinkTooltipEl() {
    if (downlinkTooltipEl) return downlinkTooltipEl;
    downlinkTooltipEl = document.createElement("div");
    downlinkTooltipEl.className = "freq-tooltip downlink-tooltip";
    downlinkTooltipEl.style.display = "none";
    downlinkTooltipEl.addEventListener("mouseenter", () => clearTimeout(downlinkTooltipHideTimer));
    downlinkTooltipEl.addEventListener("mouseleave", scheduleDownlinkTooltipHide);
    document.body.appendChild(downlinkTooltipEl);
    return downlinkTooltipEl;
  }

  function showDownlinkTooltip(target) {
    let entries;
    try {
      entries = JSON.parse(target.dataset.downlinkList);
    } catch {
      return;
    }
    const el = ensureDownlinkTooltipEl();
    el.innerHTML = entries
      .map((e) => {
        const badge = e.band ? `<span class="freq-badge c-${e.color}">${escapeHtml(e.band)}</span> ` : "";
        return `<div class="downlink-tooltip-row${e.active ? " is-active" : ""}">${badge}${escapeHtml(e.text)}</div>`;
      })
      .join("");
    el.style.display = "block";
    const rect = target.getBoundingClientRect();
    const tipRect = el.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;
    if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
    if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 6;
    el.style.top = `${Math.max(8, top)}px`;
    el.style.left = `${Math.max(8, left)}px`;
  }

  function hideDownlinkTooltip() {
    if (downlinkTooltipEl) downlinkTooltipEl.style.display = "none";
  }

  function scheduleDownlinkTooltipHide() {
    clearTimeout(downlinkTooltipHideTimer);
    downlinkTooltipHideTimer = setTimeout(hideDownlinkTooltip, 150);
  }

  document.addEventListener("mouseover", (event) => {
    const target = event.target.closest("[data-downlink-list]");
    if (!target) return;
    clearTimeout(downlinkTooltipHideTimer);
    clearTimeout(downlinkTooltipShowTimer);
    downlinkTooltipShowTimer = setTimeout(() => showDownlinkTooltip(target), 350);
  });

  document.addEventListener("mouseout", (event) => {
    const target = event.target.closest("[data-downlink-list]");
    if (!target) return;
    if (target.contains(event.relatedTarget)) return;
    clearTimeout(downlinkTooltipShowTimer);
    scheduleDownlinkTooltipHide();
  });

  document.addEventListener("scroll", hideDownlinkTooltip, true);

  // PUTs/DELETEs by norad, one satellite at a time -- never the whole
  // list, so a bug in this flow can only ever touch the satellite being
  // edited, not every other one too.
  async function saveTrackedObject(obj) {
    const payload = {
      name: obj.name,
      enabled: obj.enabled,
      downlinks: obj.downlinks.map((downlink) => ({
        frequency: downlink.frequency,
        up_frequency: downlink.up_frequency ?? null,
        app: downlink.app,
        description: downlink.description || null,
        mode: downlink.mode || null,
        baud: downlink.baud ?? null,
        gain: downlink.gain ?? null,
        bias: downlink.bias === true,
        band: bandForDownlink(downlink.frequency),
        enabled: downlink.enabled !== false,
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
      trackedTableBody.innerHTML = `<tr><td colspan="6" class="hint">No satellites tracked yet -- search below to add one.</td></tr>`;
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
      nameTd.setAttribute("data-satnogs-norad", obj.norad);
      nameTd.innerHTML = `${escapeHtml(obj.name)} <span class="tracked-norad">(${obj.norad})</span>`;

      const downlinkTd = document.createElement("td");
      renderDownlinkCell(downlinkTd, obj, { preferActive: true });

      const totalTd = document.createElement("td");
      totalTd.className = "downlink-total-col";
      totalTd.textContent = obj.downlinks.length || "";

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

      row.append(cbTd, nameTd, downlinkTd, totalTd, priorityTd, editTd);

      // Click anywhere on the row that isn't already an interactive
      // control (checkbox/priority/edit) to expand its downlink detail
      // panel below it -- collapses whichever other row was expanded,
      // since expandedTrackedNorad only ever holds one at a time.
      row.className = "clickable-row";
      row.addEventListener("click", (event) => {
        if (event.target.closest("button, input, a")) return;
        expandedTrackedNorad = expandedTrackedNorad === obj.norad ? null : obj.norad;
        renderTrackedList();
      });
      trackedTableBody.appendChild(row);

      if (expandedTrackedNorad === obj.norad) {
        const satnogsLink = `<a href="https://db.satnogs.org/satellite/${obj.norad}/" target="_blank" rel="noopener">View on SatNOGS DB &#8599;</a>`;
        trackedTableBody.appendChild(buildDownlinkDetailRow(6, obj.downlinks, satnogsLink));
      }
    });
  }

  function enterTrackedEdit(index) {
    trackedEditIndex = index;
    trackedEditSnapshot = JSON.parse(JSON.stringify(trackedObjects[index]));
    satnogsTransmitters = null;
    satnogsLoading = false;
    satnogsError = false;
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

  // One row per downlink -- an uplink isn't a separate thing to track, it's
  // an optional second frequency on the same entry (e.g. a transponder or
  // repeater's up/down pair). Parkes doesn't care whether the launched app
  // receives, transmits, or both; {frequency}/{down_frequency} always alias
  // this downlink's frequency, and {up_frequency} is available to the
  // command template whenever up_frequency is set (see
  // PassOrchestrator._run_pass and StandaloneAppRunner.start).
  //
  // Shared by both the Tracked Satellites and Static Positions editors --
  // `profileList()` picks which app profiles are offered ("pass"-mode for
  // a satellite downlink, "standalone"-mode for a position, since that's
  // who actually launches it), `rerender()` is called after an in-place
  // edit that needs the whole view rebuilt (add/remove a row). The
  // per-row SatNOGS link only appears when `obj.norad` is set -- static
  // positions aren't satellites, so they don't get one.
  // Builds a labeled "<label>Text<input/><badge?/></label>" -- the shared
  // shape for every field in a downlink block now that there's no header
  // row to align against.
  //
  // Width/flex-basis sizing has to go on the *label* (labelClass), not the
  // input -- the label is column-direction (text stacked over field), so a
  // `flex` on the input itself resolves against that column's main axis
  // (vertical) rather than the row's, and grows the input to fill the
  // block's whole height instead of its width.
  function labeledField(labelText, input, labelClass) {
    const label = document.createElement("label");
    if (labelClass) label.className = labelClass;
    label.appendChild(document.createTextNode(labelText));
    label.appendChild(input);
    return label;
  }

  function renderDownlinkRows(container, obj, { profileList, rerender }) {
    const links = obj.downlinks;
    const availableProfiles = profileList();

    links.forEach((link, index) => {
      const block = document.createElement("div");
      block.className = "group-block downlink-block";

      const topRow = document.createElement("div");
      topRow.className = "downlink-block-top";

      const enabledLabel = document.createElement("label");
      enabledLabel.className = "downlink-enabled-label";
      const enabledInput = document.createElement("input");
      enabledInput.type = "checkbox";
      enabledInput.checked = link.enabled !== false;
      enabledInput.title = "Enabled -- unchecked downlinks are skipped by the Pass Orchestrator";
      enabledInput.addEventListener("change", () => {
        link.enabled = enabledInput.checked;
      });
      enabledLabel.append(enabledInput, document.createTextNode(" Enabled"));
      topRow.appendChild(enabledLabel);

      const topActions = document.createElement("div");
      topActions.className = "row";
      if (obj.norad) {
        const satnogsLink = document.createElement("a");
        satnogsLink.className = "downlink-satnogs-link";
        satnogsLink.href = `https://db.satnogs.org/satellite/${obj.norad}/`;
        satnogsLink.target = "_blank";
        satnogsLink.rel = "noopener";
        satnogsLink.title = `View ${obj.name} on SatNOGS DB`;
        satnogsLink.textContent = "↗";
        topActions.appendChild(satnogsLink);
      }
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-sm";
      removeBtn.textContent = "× Remove downlink";
      removeBtn.addEventListener("click", () => {
        links.splice(index, 1);
        rerender();
      });
      topActions.appendChild(removeBtn);
      topRow.appendChild(topActions);
      block.appendChild(topRow);

      const freqInput = document.createElement("input");
      freqInput.type = "number";
      freqInput.step = "1";
      freqInput.className = "downlink-freq";
      freqInput.value = link.frequency;
      freqInput.title = "Downlink frequency (Hz) -- {frequency}/{down_frequency}";
      const freqBadge = createFreqBadge(() => Number(freqInput.value));
      freqInput.addEventListener("input", () => {
        link.frequency = Number(freqInput.value);
        freqBadge.update();
      });
      const freqWrap = document.createElement("div");
      freqWrap.className = "freq-input-wrap";
      freqWrap.append(freqInput, freqBadge.el);

      const downRow = document.createElement("div");
      downRow.className = "freq-field-row";
      downRow.appendChild(labeledField("Down (Hz)", freqWrap));

      // The uplink is a toggle, not always-shown -- most downlinks don't
      // have one, and a second frequency row only earns its vertical space
      // when there's actually something to put in it.
      if (link.up_frequency != null) {
        downRow.appendChild(buildUplinkRow());
      } else {
        const addUplinkBtn = document.createElement("button");
        addUplinkBtn.type = "button";
        addUplinkBtn.className = "btn-sm";
        addUplinkBtn.textContent = "+ Add uplink";
        addUplinkBtn.addEventListener("click", () => {
          link.up_frequency = link.frequency;
          rerender();
        });
        downRow.appendChild(addUplinkBtn);
      }
      block.appendChild(downRow);

      function buildUplinkRow() {
        const row = document.createElement("div");
        row.className = "freq-field-row";

        const upFreqInput = document.createElement("input");
        upFreqInput.type = "number";
        upFreqInput.step = "1";
        upFreqInput.className = "downlink-freq";
        upFreqInput.value = link.up_frequency ?? "";
        upFreqInput.title = "Associated uplink frequency (Hz) -- {up_frequency}";
        const upFreqBadge = createFreqBadge(() => Number(upFreqInput.value));
        upFreqInput.addEventListener("input", () => {
          link.up_frequency = upFreqInput.value === "" ? null : Number(upFreqInput.value);
          upFreqBadge.update();
        });
        const upFreqWrap = document.createElement("div");
        upFreqWrap.className = "freq-input-wrap";
        upFreqWrap.append(upFreqInput, upFreqBadge.el);
        row.appendChild(labeledField("Up (Hz)", upFreqWrap));

        const removeUpBtn = document.createElement("button");
        removeUpBtn.type = "button";
        removeUpBtn.className = "btn-sm";
        removeUpBtn.textContent = "Remove uplink";
        removeUpBtn.addEventListener("click", () => {
          link.up_frequency = null;
          rerender();
        });
        row.appendChild(removeUpBtn);
        return row;
      }

      const detailsRow = document.createElement("div");
      detailsRow.className = "downlink-details-row";

      const descInput = document.createElement("input");
      descInput.type = "text";
      descInput.className = "downlink-desc";
      descInput.value = link.description || "";
      descInput.placeholder = "description / full name";
      descInput.addEventListener("input", () => {
        link.description = descInput.value;
      });
      detailsRow.appendChild(labeledField("Description", descInput, "downlink-desc-field"));

      const modeInput = document.createElement("input");
      modeInput.type = "text";
      modeInput.className = "downlink-mode";
      modeInput.value = link.mode || "";
      modeInput.placeholder = "mode";
      modeInput.title = "Modulation/mode (e.g. FM, HRPT, GMSK)";
      modeInput.addEventListener("input", () => {
        link.mode = modeInput.value;
      });
      detailsRow.appendChild(labeledField("Mode", modeInput, "downlink-mode-field"));

      const baudInput = document.createElement("input");
      baudInput.type = "number";
      baudInput.step = "any";
      baudInput.className = "downlink-baud";
      baudInput.value = link.baud ?? "";
      baudInput.placeholder = "baud";
      baudInput.addEventListener("input", () => {
        link.baud = baudInput.value === "" ? null : Number(baudInput.value);
      });
      detailsRow.appendChild(labeledField("Baud", baudInput, "downlink-baud-field"));

      const gainInput = document.createElement("input");
      gainInput.type = "number";
      gainInput.step = "any";
      gainInput.className = "downlink-gain";
      gainInput.value = link.gain ?? "";
      gainInput.placeholder = "gain";
      gainInput.title = "SDR gain override for this downlink -- {gain} (only takes effect if the app profile's command references it)";
      gainInput.addEventListener("input", () => {
        // A partial/invalid number while typing (e.g. a bare "-" before the
        // digits, or mid-exponent) shouldn't leave link.gain holding NaN.
        const parsed = Number(gainInput.value);
        link.gain = gainInput.value === "" || !Number.isFinite(parsed) ? null : parsed;
      });
      detailsRow.appendChild(labeledField("Gain", gainInput, "downlink-gain-field"));

      const biasLabel = document.createElement("label");
      biasLabel.className = "downlink-bias-field";
      const biasInput = document.createElement("input");
      biasInput.type = "checkbox";
      biasInput.checked = link.bias === true;
      biasInput.title = "Power the SDR's bias tee (e.g. for an LNA) while this downlink is active -- {bias}";
      biasInput.addEventListener("change", () => {
        link.bias = biasInput.checked;
      });
      biasLabel.append(biasInput, document.createTextNode(" Bias tee"));
      detailsRow.appendChild(biasLabel);

      const appSelect = document.createElement("select");
      appSelect.title = "App profile to launch";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "(no app)";
      appSelect.appendChild(noneOpt);
      for (const p of availableProfiles) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        appSelect.appendChild(opt);
      }
      if (link.app && !availableProfiles.some((p) => p.id === link.app)) {
        const existing = profiles.find((p) => p.id === link.app);
        const opt = document.createElement("option");
        opt.value = link.app;
        const modeLabel = existing ? (existing.mode === "standalone" ? "standalone" : "pass") : null;
        opt.textContent = existing ? `${existing.name} (${modeLabel})` : `${link.app} (missing)`;
        appSelect.appendChild(opt);
      }
      appSelect.value = link.app;
      appSelect.addEventListener("change", () => {
        link.app = appSelect.value;
      });
      detailsRow.appendChild(labeledField("App", appSelect, "downlink-app-field"));

      block.appendChild(detailsRow);
      container.appendChild(block);
    });
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
    heading.setAttribute("data-satnogs-norad", obj.norad);
    heading.textContent = `${obj.name} (NORAD ${obj.norad})`;
    trackedEditView.appendChild(heading);

    const downlinksHeading = document.createElement("div");
    downlinksHeading.className = "field-label";
    downlinksHeading.style.cssText = "margin-top: 0.6rem;";
    downlinksHeading.textContent = "Downlinks";
    trackedEditView.appendChild(downlinksHeading);
    renderDownlinkRows(trackedEditView, obj, { profileList: passModeProfiles, rerender: renderTrackedEdit });

    const addDownlinkBtn = document.createElement("button");
    addDownlinkBtn.type = "button";
    addDownlinkBtn.className = "btn-sm";
    addDownlinkBtn.textContent = "+ Add downlink";
    addDownlinkBtn.addEventListener("click", () => {
      obj.downlinks.push({
        frequency: 137500000,
        up_frequency: null,
        app: "",
        description: "",
        mode: "",
        baud: null,
        gain: null,
        bias: false,
        enabled: true,
      });
      renderTrackedEdit();
    });
    trackedEditView.appendChild(addDownlinkBtn);

    trackedEditView.appendChild(renderSatnogsSection(obj));

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

  // ---------------------------------------------------------------------
  // SatNOGS DB (https://db.satnogs.org/) lookup -- an optional shortcut for
  // finding a satellite's NORAD id and real downlink frequencies instead of
  // typing them in by hand. Every call here is best-effort and degrades to
  // "no results"/"unavailable" without touching the local search or manual
  // downlink editing above.
  // ---------------------------------------------------------------------

  const satnogsSearchInput = document.getElementById("tracked-satnogs-search-input");
  const satnogsSearchResults = document.getElementById("tracked-satnogs-search-results");

  let satnogsTransmitters = null;
  let satnogsLoading = false;
  let satnogsError = false;

  function hideSatnogsSearchResults() {
    satnogsSearchResults.style.display = "none";
    satnogsSearchResults.innerHTML = "";
  }

  async function loadSatnogsTransmitters(norad, forceRefresh) {
    satnogsLoading = true;
    satnogsError = false;
    renderTrackedEdit();
    try {
      const refreshParam = forceRefresh ? "&refresh=true" : "";
      satnogsTransmitters = await apiFetch(`/api/satnogs/transmitters?norad=${norad}${refreshParam}`);
    } catch {
      satnogsTransmitters = null;
      satnogsError = true;
    }
    satnogsLoading = false;
    renderTrackedEdit();
  }

  function renderSatnogsSection(obj) {
    const section = document.createElement("div");
    section.style.cssText = "display: flex; flex-direction: column; align-items: flex-start; margin: 0.75rem 0; gap: 0.3rem;";

    const header = document.createElement("div");
    header.style.cssText = "display: flex; align-items: center; gap: 0.5rem;";
    const title = document.createElement("span");
    title.className = "field-label";
    title.style.marginBottom = "0";
    title.textContent = "SatNOGS transmitters";
    header.appendChild(title);

    if (satnogsTransmitters === null) {
      const lookupBtn = document.createElement("button");
      lookupBtn.type = "button";
      lookupBtn.className = "btn-sm";
      lookupBtn.textContent = "Look up on SatNOGS";
      lookupBtn.disabled = satnogsLoading;
      lookupBtn.addEventListener("click", () => loadSatnogsTransmitters(obj.norad, false));
      header.appendChild(lookupBtn);
    } else {
      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.className = "btn-sm";
      refreshBtn.textContent = "↻ Refresh";
      refreshBtn.disabled = satnogsLoading;
      refreshBtn.addEventListener("click", () => loadSatnogsTransmitters(obj.norad, true));
      header.appendChild(refreshBtn);
    }
    section.appendChild(header);

    if (satnogsLoading) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "Looking up transmitters...";
      section.appendChild(hint);
    } else if (satnogsError) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "SatNOGS unavailable -- add downlinks manually above.";
      section.appendChild(hint);
    } else if (satnogsTransmitters !== null) {
      if (satnogsTransmitters.length === 0) {
        const hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = "No transmitters found on SatNOGS for this satellite.";
        section.appendChild(hint);
      }
      for (const t of satnogsTransmitters) {
        const row = document.createElement("div");
        row.className = "row";
        if (!t.alive) row.style.opacity = "0.55";
        const freqLabel = t.frequency ? (t.frequency / 1e6).toFixed(3) + " MHz down" : "";
        const uplinkLabel = t.uplink ? (t.uplink / 1e6).toFixed(3) + " MHz up" : "";
        const bothLabel = [freqLabel, uplinkLabel].filter(Boolean).join(" / ") || "unknown freq";
        const modeLabel = t.mode ? escapeHtml(t.mode) : "unknown mode";
        const baudLabel = t.baud ? `, ${t.baud} baud` : "";
        const aliveLabel = t.alive ? "alive" : "dead";
        const label = document.createElement("span");
        label.textContent = `${t.description || modeLabel} — ${bothLabel} (${modeLabel}${baudLabel}, ${aliveLabel})`;
        row.appendChild(label);
        if (t.frequency) {
          label.dataset.freqHz = t.frequency;
          const badge = createFreqBadge(() => t.frequency);
          badge.el.style.marginLeft = "0.4rem";
          row.appendChild(badge.el);
        }

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn-sm";
        addBtn.textContent = "+ Add";
        addBtn.disabled = !t.frequency;
        addBtn.title = !t.frequency ? "No downlink frequency to add" : "";
        addBtn.addEventListener("click", () => {
          obj.downlinks.push({
            frequency: t.frequency,
            up_frequency: t.uplink ?? null,
            app: "",
            description: t.description || "",
            mode: t.mode || "",
            baud: t.baud ?? null,
            enabled: true,
          });
          renderTrackedEdit();
        });
        row.appendChild(addBtn);

        section.appendChild(row);
      }
    }

    return section;
  }

  let satnogsSearchDebounce;
  satnogsSearchInput.addEventListener("input", () => {
    clearTimeout(satnogsSearchDebounce);
    const q = satnogsSearchInput.value.trim();
    if (!q) {
      hideSatnogsSearchResults();
      return;
    }
    satnogsSearchDebounce = setTimeout(async () => {
      let results;
      try {
        results = await apiFetch(`/api/satnogs/satellites?q=${encodeURIComponent(q)}`);
      } catch {
        results = [];
      }
      satnogsSearchResults.innerHTML = "";
      for (const sat of results.slice(0, 20)) {
        if (!sat.norad) continue;
        const row = document.createElement("div");
        row.className = "search-result-row";
        row.setAttribute("data-satnogs-norad", sat.norad);
        const statusLabel = sat.status ? ` <span style="color: var(--text-muted);">(${escapeHtml(sat.status)})</span>` : "";
        row.innerHTML = `<span>${escapeHtml(sat.name || "unnamed")}${statusLabel}</span><span style="color: var(--text-muted);">${sat.norad}</span>`;
        row.addEventListener("click", () => {
          satnogsSearchInput.value = "";
          hideSatnogsSearchResults();
          if (trackedObjects.some((existing) => existing.norad === sat.norad)) {
            flashStatus(trackedStatus, `${sat.name} is already tracked`, true);
            return;
          }
          trackedObjects.push({
            norad: sat.norad,
            name: sat.name || `NORAD ${sat.norad}`,
            enabled: true,
            downlinks: [],
          });
          enterTrackedEdit(trackedObjects.length - 1);
          loadSatnogsTransmitters(sat.norad, false);
        });
        satnogsSearchResults.appendChild(row);
      }
      satnogsSearchResults.style.display = results.length ? "block" : "none";
    }, 250);
  });

  document.addEventListener("click", (event) => {
    if (event.target !== satnogsSearchInput && !satnogsSearchResults.contains(event.target)) {
      hideSatnogsSearchResults();
    }
  });

  async function loadObjects() {
    const data = await apiFetch("/api/orchestrator/objects");
    trackedObjects = data.map((obj) => ({
      norad: obj.norad,
      name: obj.name || "",
      enabled: obj.enabled !== false,
      downlinks: (obj.downlinks || []).map((downlink) => ({
        frequency: downlink.frequency ?? 137500000,
        up_frequency: downlink.up_frequency ?? null,
        app: downlink.app || "",
        description: downlink.description || "",
        mode: downlink.mode || "",
        baud: downlink.baud ?? null,
        gain: downlink.gain ?? null,
        bias: downlink.bias === true,
        band: downlink.band ?? null,
        enabled: downlink.enabled !== false,
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
        row.setAttribute("data-satnogs-norad", sat.norad);
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
            downlinks: [{ frequency: 137500000, up_frequency: null, app: "", enabled: true }],
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
  // Static Positions -- named, fixed az/el shortcuts. Manual-only: never
  // read by the Pass Orchestrator, so there's no scheduling/priority
  // concept here, just a list.
  // ---------------------------------------------------------------------

  const positionsListView = document.getElementById("positions-list-view");
  const positionsEditView = document.getElementById("positions-edit-view");
  const positionsTableBody = document.getElementById("positions-table-body");
  const addPositionBtn = document.getElementById("add-position-btn");
  const positionsStatus = document.getElementById("positions-status");

  let staticPositions = [];
  let positionsEditIndex = null;
  let positionsEditSnapshot = null;
  // Which row (by id) has its downlink-detail row expanded -- at most one
  // at a time, see renderPositionsList()'s row click handler.
  let expandedPositionId = null;

  async function loadStaticPositions() {
    const data = await apiFetch("/api/orchestrator/static_positions");
    staticPositions = Object.entries(data).map(([id, position]) => ({
      id,
      name: position.name || id,
      positionMode: position.position_mode === "latlon" ? "latlon" : "azel",
      az: position.az,
      el: position.el,
      lat: position.lat ?? null,
      lon: position.lon ?? null,
      altM: position.alt_m ?? 0,
      downlinks: (position.downlinks || []).map((d) => ({
        frequency: d.frequency,
        up_frequency: d.up_frequency ?? null,
        app: d.app || "",
        description: d.description || "",
        mode: d.mode || "",
        baud: d.baud ?? null,
        gain: d.gain ?? null,
        bias: d.bias === true,
        band: d.band ?? null,
        enabled: d.enabled !== false,
      })),
    }));
  }

  function assignPositionId(position) {
    if (position.id) return position.id;
    const taken = new Set(staticPositions.filter((p) => p.id).map((p) => p.id));
    position.id = uniqueId(slugify(position.name), taken);
    return position.id;
  }

  // Same selection as the Pass Orchestrator's own (see
  // PassOrchestrator._candidate_passes/_rank and api/orchestrator.py's
  // _active_downlink) -- first enabled, further narrowed by the active
  // antenna's band if one's selected. Kept in sync with effectiveDownlink()
  // so what this shows (Stop button visibility, the downlink summary) is
  // always what "Go" would actually launch.
  function activePositionDownlink(position) {
    return effectiveDownlink(position.downlinks || []);
  }

  async function savePosition(position) {
    assignPositionId(position);
    const payload = {
      name: position.name.trim(),
      position_mode: position.positionMode,
      downlinks: position.downlinks.map((d) => ({
        frequency: d.frequency,
        up_frequency: d.up_frequency ?? null,
        app: d.app || null,
        description: d.description || null,
        mode: d.mode || null,
        baud: d.baud ?? null,
        gain: d.gain ?? null,
        bias: d.bias === true,
        band: bandForDownlink(d.frequency),
        enabled: d.enabled !== false,
      })),
      ...(position.positionMode === "latlon"
        ? { lat: position.lat, lon: position.lon, alt_m: position.altM || 0 }
        : { az: position.az, el: position.el }),
    };
    await apiFetch(`/api/orchestrator/static_positions/${encodeURIComponent(position.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    flashStatus(positionsStatus, "saved", false);
  }

  async function deletePosition(id) {
    await apiFetch(`/api/orchestrator/static_positions/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  function validatePosition(position) {
    if (!position.name.trim()) return "every position needs a name";
    if (position.positionMode === "latlon") {
      if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) {
        return "lat and lon must be numbers";
      }
    } else if (!Number.isFinite(position.az) || !Number.isFinite(position.el)) {
      return "az and el must be numbers";
    }
    return null;
  }

  function applyPositionStatus(row, appId) {
    const goBtn = row.querySelector('[data-action="go"]');
    const stopBtn = row.querySelector('[data-action="stop"]');
    if (!stopBtn) return;
    const running = appId ? !!(standaloneStatus[appId] && standaloneStatus[appId].state === "running") : false;
    stopBtn.disabled = !running;
    if (goBtn) goBtn.disabled = false;
  }

  function refreshPositionsStatus() {
    for (const row of positionsTableBody.querySelectorAll("tr[data-position-id]")) {
      const position = staticPositions.find((p) => p.id === row.dataset.positionId);
      const active = position && activePositionDownlink(position);
      applyPositionStatus(row, active && active.app);
    }
  }

  function renderPositionsList() {
    positionsListView.style.display = "";
    positionsEditView.style.display = "none";
    positionsEditView.innerHTML = "";
    positionsTableBody.innerHTML = "";

    if (staticPositions.length === 0) {
      positionsTableBody.innerHTML = `<tr><td colspan="6" class="hint">No static positions yet.</td></tr>`;
      return;
    }

    staticPositions.forEach((position, index) => {
      const row = document.createElement("tr");
      row.dataset.positionId = position.id;

      const nameTd = document.createElement("td");
      nameTd.textContent = position.name;

      const azElTd = document.createElement("td");
      azElTd.className = "position-az-el";
      azElTd.textContent = `${position.az.toFixed(1)}° / ${position.el.toFixed(1)}°`;

      const downlinkTd = document.createElement("td");
      renderDownlinkCell(downlinkTd, position, { preferActive: true });

      const totalTd = document.createElement("td");
      totalTd.className = "downlink-total-col";
      totalTd.textContent = position.downlinks.length || "";

      const active = activePositionDownlink(position);

      const actionsTd = document.createElement("td");
      const goBtn = document.createElement("button");
      goBtn.type = "button";
      goBtn.className = "btn-sm";
      goBtn.textContent = "Go";
      goBtn.dataset.action = "go";
      goBtn.addEventListener("click", async () => {
        goBtn.disabled = true;
        try {
          await apiFetch(`/api/orchestrator/static_positions/${encodeURIComponent(position.id)}/go`, {
            method: "POST",
          });
          flashStatus(positionsStatus, `${position.name}: on the way`, false);
        } catch (err) {
          flashStatus(positionsStatus, `error: ${err.message}`, true);
        }
        goBtn.disabled = false;
        refreshStandaloneStatus();
      });
      actionsTd.appendChild(goBtn);
      if (active && active.app) {
        const stopBtn = document.createElement("button");
        stopBtn.type = "button";
        stopBtn.className = "btn-sm";
        stopBtn.textContent = "Stop";
        stopBtn.dataset.action = "stop";
        stopBtn.style.marginLeft = "0.3rem";
        stopBtn.addEventListener("click", async () => {
          await apiFetch(`/api/orchestrator/static_positions/${encodeURIComponent(position.id)}/stop`, {
            method: "POST",
          });
          refreshStandaloneStatus();
        });
        actionsTd.appendChild(stopBtn);
      }

      const editTd = document.createElement("td");
      editTd.className = "actions-col";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => enterPositionEdit(index));
      editTd.appendChild(editBtn);

      row.append(nameTd, azElTd, downlinkTd, totalTd, actionsTd, editTd);

      // Same row-click-to-expand convention as Tracked Satellites -- see
      // its comment in renderTrackedList().
      row.className = "clickable-row";
      row.addEventListener("click", (event) => {
        if (event.target.closest("button, input, a")) return;
        expandedPositionId = expandedPositionId === position.id ? null : position.id;
        renderPositionsList();
      });
      positionsTableBody.appendChild(row);
      applyPositionStatus(row, active && active.app);

      if (expandedPositionId === position.id) {
        const basicInfo =
          position.positionMode === "latlon"
            ? `<div class="downlink-detail-basic">Lat/Lon: ${position.lat != null ? position.lat.toFixed(4) : "?"}, ${
                position.lon != null ? position.lon.toFixed(4) : "?"
              } &middot; Alt: ${position.altM ?? 0}m</div>`
            : "";
        positionsTableBody.appendChild(buildDownlinkDetailRow(6, position.downlinks, basicInfo));
      }
    });
  }

  function enterPositionEdit(index) {
    positionsEditIndex = index;
    positionsEditSnapshot = JSON.parse(JSON.stringify(staticPositions[index]));
    renderPositionEdit();
  }

  function exitPositionEdit(keepChanges) {
    if (!keepChanges) {
      staticPositions[positionsEditIndex] = positionsEditSnapshot;
    }
    positionsEditIndex = null;
    positionsEditSnapshot = null;
    renderPositionsList();
  }

  function renderPositionEdit() {
    positionsListView.style.display = "none";
    positionsEditView.style.display = "";
    positionsEditView.innerHTML = "";
    const position = staticPositions[positionsEditIndex];

    const topRow = document.createElement("div");
    topRow.className = "row";
    topRow.style.marginBottom = "0";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn-sm";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", () => exitPositionEdit(false));
    topRow.appendChild(backBtn);
    positionsEditView.appendChild(topRow);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "edit-name-input";
    nameInput.placeholder = "position name";
    nameInput.value = position.name;
    nameInput.addEventListener("input", () => {
      position.name = nameInput.value;
    });
    positionsEditView.appendChild(nameInput);

    const modeLabel = document.createElement("div");
    modeLabel.className = "field-label";
    modeLabel.textContent = "Position";
    positionsEditView.appendChild(modeLabel);

    const modeSeg = document.createElement("div");
    modeSeg.className = "seg-row";
    for (const [value, text] of [["azel", "Az / El"], ["latlon", "Lat / Lon / Alt"]]) {
      const modeBtn = document.createElement("button");
      modeBtn.type = "button";
      modeBtn.className = "btn-sm" + (position.positionMode === value ? " active" : "");
      modeBtn.textContent = text;
      modeBtn.addEventListener("click", () => {
        position.positionMode = value;
        renderPositionEdit();
      });
      modeSeg.appendChild(modeBtn);
    }
    positionsEditView.appendChild(modeSeg);

    const fieldsRow = document.createElement("div");
    fieldsRow.className = "position-fields";

    if (position.positionMode === "latlon") {
      const latLabel = document.createElement("label");
      latLabel.appendChild(document.createTextNode("Latitude"));
      const latInput = document.createElement("input");
      latInput.type = "number";
      latInput.step = "0.0001";
      latInput.min = "-90";
      latInput.max = "90";
      latInput.value = position.lat ?? "";
      latLabel.appendChild(latInput);
      fieldsRow.appendChild(latLabel);

      const lonLabel = document.createElement("label");
      lonLabel.appendChild(document.createTextNode("Longitude"));
      const lonInput = document.createElement("input");
      lonInput.type = "number";
      lonInput.step = "0.0001";
      lonInput.min = "-180";
      lonInput.max = "180";
      lonInput.value = position.lon ?? "";
      lonLabel.appendChild(lonInput);
      fieldsRow.appendChild(lonLabel);

      const altLabel = document.createElement("label");
      altLabel.appendChild(document.createTextNode("Altitude (m)"));
      const altInput = document.createElement("input");
      altInput.type = "number";
      altInput.step = "1";
      altInput.value = position.altM ?? 0;
      altLabel.appendChild(altInput);
      fieldsRow.appendChild(altLabel);

      const azelPreview = document.createElement("p");
      azelPreview.className = "hint";
      azelPreview.style.gridColumn = "1 / -1";
      azelPreview.textContent = " ";

      let previewDebounce;
      function updatePreview() {
        position.lat = latInput.value === "" ? NaN : Number(latInput.value);
        position.lon = lonInput.value === "" ? NaN : Number(lonInput.value);
        position.altM = altInput.value === "" ? 0 : Number(altInput.value);
        clearTimeout(previewDebounce);
        if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) {
          azelPreview.textContent = " ";
          return;
        }
        previewDebounce = setTimeout(async () => {
          try {
            const result = await apiFetch(
              `/api/orchestrator/static_positions/compute_azel?lat=${position.lat}&lon=${position.lon}&alt_m=${position.altM}`
            );
            azelPreview.textContent = `→ az ${result.az.toFixed(1)}°, el ${result.el.toFixed(1)}° from here right now`;
          } catch (err) {
            azelPreview.textContent = `error: ${err.message}`;
          }
        }, 400);
      }
      for (const input of [latInput, lonInput, altInput]) {
        input.addEventListener("input", updatePreview);
      }
      updatePreview();
      fieldsRow.appendChild(azelPreview);
    } else {
      const azLabel = document.createElement("label");
      azLabel.appendChild(document.createTextNode("Azimuth"));
      const azInput = document.createElement("input");
      azInput.type = "number";
      azInput.step = "0.1";
      azInput.min = "0";
      azInput.max = "360";
      azInput.value = position.az;
      azInput.addEventListener("input", () => {
        position.az = azInput.value === "" ? NaN : Number(azInput.value);
      });
      azLabel.appendChild(azInput);
      fieldsRow.appendChild(azLabel);

      const elLabel = document.createElement("label");
      elLabel.appendChild(document.createTextNode("Elevation"));
      const elInput = document.createElement("input");
      elInput.type = "number";
      elInput.step = "0.1";
      elInput.min = "0";
      elInput.max = "90";
      elInput.value = position.el;
      elInput.addEventListener("input", () => {
        position.el = elInput.value === "" ? NaN : Number(elInput.value);
      });
      elLabel.appendChild(elInput);
      fieldsRow.appendChild(elLabel);
    }

    positionsEditView.appendChild(fieldsRow);

    // Same downlink shape/editor as Tracked Satellites (frequency, optional
    // paired uplink, description/mode/baud, an app to launch, an enable
    // flag) minus the SatNOGS lookup -- a fixed position isn't a satellite,
    // so there's nothing to look up. "Go" moves the rotator once and
    // launches the first enabled entry's app, if any (same first-enabled-
    // wins convention as the Pass Orchestrator; see activePositionDownlink
    // and api/orchestrator.py's go_static_position). The app must be
    // "standalone"-mode, since nothing here is pass-triggered.
    const downlinksHeading = document.createElement("div");
    downlinksHeading.className = "field-label";
    downlinksHeading.style.cssText = "margin-top: 0.6rem;";
    downlinksHeading.textContent = "Downlinks";
    positionsEditView.appendChild(downlinksHeading);
    renderDownlinkRows(positionsEditView, position, {
      profileList: standaloneProfiles,
      rerender: renderPositionEdit,
    });

    const addDownlinkBtn = document.createElement("button");
    addDownlinkBtn.type = "button";
    addDownlinkBtn.className = "btn-sm";
    addDownlinkBtn.textContent = "+ Add downlink";
    addDownlinkBtn.addEventListener("click", () => {
      position.downlinks.push({
        frequency: 137500000,
        up_frequency: null,
        app: "",
        description: "",
        mode: "",
        baud: null,
        gain: null,
        bias: false,
        enabled: true,
      });
      renderPositionEdit();
    });
    positionsEditView.appendChild(addDownlinkBtn);

    const actionsRow = document.createElement("div");
    actionsRow.className = "row";
    actionsRow.style.marginTop = "1rem";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const error = validatePosition(position);
      if (error) {
        flashStatus(positionsStatus, error, true);
        return;
      }
      try {
        await savePosition(position);
      } catch (err) {
        flashStatus(positionsStatus, `error: ${err.message}`, true);
        return;
      }
      exitPositionEdit(true);
    });
    actionsRow.appendChild(saveBtn);
    positionsEditView.appendChild(actionsRow);

    // Kept apart from Save/Back, deliberately not front-and-center --
    // deletes should be rare and a little deliberate to reach.
    const dangerRow = document.createElement("div");
    dangerRow.className = "row";
    dangerRow.style.marginTop = "1.5rem";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-sm";
    deleteBtn.textContent = "Delete this position";
    deleteBtn.addEventListener("click", async () => {
      try {
        if (position.id) await deletePosition(position.id);
      } catch (err) {
        flashStatus(positionsStatus, `error: ${err.message}`, true);
        return;
      }
      staticPositions.splice(positionsEditIndex, 1);
      positionsEditIndex = null;
      positionsEditSnapshot = null;
      renderPositionsList();
    });
    dangerRow.appendChild(deleteBtn);
    positionsEditView.appendChild(dangerRow);
  }

  addPositionBtn.addEventListener("click", () => {
    staticPositions.push({
      id: null,
      name: "",
      positionMode: "azel",
      az: 0,
      el: 0,
      lat: null,
      lon: null,
      altM: 0,
      downlinks: [],
    });
    enterPositionEdit(staticPositions.length - 1);
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
  // Band Reference -- a standalone lookup, not tied to any downlink.
  // ---------------------------------------------------------------------

  const bandLookupInput = document.getElementById("band-lookup-input");
  const bandLookupBadge = document.getElementById("band-lookup-badge");
  const bandLookupChips = document.getElementById("band-lookup-chips");
  const bandReferenceTable = document.getElementById("band-reference-table");

  function refreshBandLookup() {
    const mhz = parseFloat(bandLookupInput.value);
    const match = Number.isFinite(mhz) && mhz > 0 ? window.ParkesBands.detect(mhz * 1e6) : null;
    if (!match) {
      bandLookupBadge.style.display = "none";
      return;
    }
    bandLookupBadge.className = `freq-badge c-${match.color}`;
    bandLookupBadge.textContent = window.ParkesBands.label(match);
    bandLookupBadge.style.display = "";
  }
  bandLookupInput.addEventListener("input", refreshBandLookup);

  [
    ["108", "FM/air"],
    ["137.5", "APT"],
    ["401.5", "LRPT"],
    ["433.5", "ISM"],
    ["868", "ISM"],
    ["1700", "HRPT"],
    ["2400", "ISM"],
    ["12000", "Ku-band"],
  ].forEach(([mhz, label]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = `${mhz} (${label})`;
    chip.addEventListener("click", () => {
      bandLookupInput.value = mhz;
      refreshBandLookup();
    });
    bandLookupChips.appendChild(chip);
  });

  for (const b of window.ParkesBands.generalBands()) {
    const row = document.createElement("div");
    const badge = document.createElement("span");
    badge.className = `freq-badge c-${b.color}`;
    badge.textContent = b.band;
    row.appendChild(badge);
    row.appendChild(document.createTextNode(`${b.min}–${b.max} MHz`));
    bandReferenceTable.appendChild(row);
  }

  // ---------------------------------------------------------------------

  async function init() {
    await Promise.all([
      loadProfiles(),
      loadObjects(),
      loadOverlaps(),
      loadSatdumpPipelines(),
      loadCommandModules(),
      loadStaticPositions(),
      loadAntennas(),
      loadActiveAntenna(),
    ]);
    renderProfilesList();
    renderTrackedList();
    renderPositionsList();
    renderAntennasList();
    await refreshStandaloneStatus();
  }

  init();
  refreshOrchStatus();
  setInterval(refreshOrchStatus, 5000);
  setInterval(refreshStandaloneStatus, 5000);
})();
