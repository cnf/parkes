(() => {
  const satdumpStatus = document.getElementById("satdump-status");
  const startBtn = document.getElementById("satdump-start-btn");
  const stopBtn = document.getElementById("satdump-stop-btn");
  const trackedList = document.getElementById("tracked-list");
  const searchInput = document.getElementById("tracked-search-input");
  const searchResults = document.getElementById("tracked-search-results");
  const saveObjectsBtn = document.getElementById("satdump-save-objects-btn");
  const objectsSaveStatus = document.getElementById("satdump-objects-status");
  const logPre = document.getElementById("satdump-log");
  const satdumpDot = document.getElementById("satdump-dot");

  // Kept as a name-carrying array (not the API's {norad, downlinks} shape
  // directly) purely so rendering/editing doesn't have to juggle indices
  // into a nested structure -- same approach as the App Profiles editor.
  let trackedObjects = [];
  let appProfileNames = [];

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

  async function post(path) {
    const res = await fetch(path, { method: "POST" });
    if (!res.ok) {
      satdumpStatus.textContent = `error: ${await res.text()}`;
      satdumpDot.classList.add("error");
    }
  }

  startBtn.addEventListener("click", () => post("/api/satdump/start"));
  stopBtn.addEventListener("click", () => post("/api/satdump/stop"));

  function renderTrackedList() {
    trackedList.innerHTML = "";
    if (trackedObjects.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No satellites tracked yet -- search below to add one.";
      trackedList.appendChild(empty);
      return;
    }

    trackedObjects.forEach((obj, objIndex) => {
      const card = document.createElement("div");
      card.className = "group-block";

      const header = document.createElement("div");
      header.className = "group-header";
      const label = document.createElement("label");
      const enabledCb = document.createElement("input");
      enabledCb.type = "checkbox";
      enabledCb.checked = obj.enabled;
      enabledCb.addEventListener("change", () => {
        obj.enabled = enabledCb.checked;
      });
      const noradSpan = document.createElement("span");
      noradSpan.className = "tracked-norad";
      noradSpan.textContent = `(NORAD ${obj.norad})`;
      label.append(enabledCb, document.createTextNode(`${obj.name} `), noradSpan);
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-sm";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        trackedObjects.splice(objIndex, 1);
        renderTrackedList();
      });
      header.append(label, deleteBtn);
      card.appendChild(header);

      if (obj.downlinks.length > 0) {
        const head = document.createElement("div");
        head.className = "downlink-row downlink-row-head";
        head.innerHTML = `
          <span class="field-label">Freq (Hz)</span>
          <span class="field-label">satdump pipeline</span>
          <span class="field-label">orchestrator app</span>
        `;
        card.appendChild(head);
      }

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

        const pipelineInput = document.createElement("input");
        pipelineInput.type = "text";
        pipelineInput.placeholder = "e.g. noaa_apt";
        pipelineInput.title = "satdump autotrack pipeline id";
        pipelineInput.value = downlink.pipeline_name;
        pipelineInput.addEventListener("input", () => {
          downlink.pipeline_name = pipelineInput.value;
        });

        const appSelect = document.createElement("select");
        appSelect.title = "Pass Orchestrator app profile";
        const noneOpt = document.createElement("option");
        noneOpt.value = "";
        noneOpt.textContent = "(no app)";
        appSelect.appendChild(noneOpt);
        for (const name of appProfileNames) {
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          appSelect.appendChild(opt);
        }
        if (downlink.app && !appProfileNames.includes(downlink.app)) {
          const opt = document.createElement("option");
          opt.value = downlink.app;
          opt.textContent = `${downlink.app} (missing)`;
          appSelect.appendChild(opt);
        }
        appSelect.value = downlink.app;
        appSelect.addEventListener("change", () => {
          downlink.app = appSelect.value;
        });

        const liveLabel = document.createElement("label");
        liveLabel.className = "downlink-flag";
        const liveCb = document.createElement("input");
        liveCb.type = "checkbox";
        liveCb.checked = downlink.live;
        liveCb.addEventListener("change", () => {
          downlink.live = liveCb.checked;
        });
        liveLabel.append(liveCb, document.createTextNode("live"));

        const recordLabel = document.createElement("label");
        recordLabel.className = "downlink-flag";
        const recordCb = document.createElement("input");
        recordCb.type = "checkbox";
        recordCb.checked = downlink.record;
        recordCb.addEventListener("change", () => {
          downlink.record = recordCb.checked;
        });
        recordLabel.append(recordCb, document.createTextNode("record"));

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn-sm";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          obj.downlinks.splice(downlinkIndex, 1);
          renderTrackedList();
        });

        row.append(freqInput, pipelineInput, appSelect, liveLabel, recordLabel, removeBtn);
        card.appendChild(row);
      });

      const addDownlinkBtn = document.createElement("button");
      addDownlinkBtn.type = "button";
      addDownlinkBtn.className = "btn-sm";
      addDownlinkBtn.textContent = "+ Add downlink";
      addDownlinkBtn.addEventListener("click", () => {
        obj.downlinks.push({
          frequency: 137500000,
          live: true,
          record: false,
          pipeline_name: "",
          app: "",
        });
        renderTrackedList();
      });
      card.appendChild(addDownlinkBtn);

      trackedList.appendChild(card);
    });
  }

  async function loadAppProfiles() {
    const profiles = await apiFetch("/api/orchestrator/app_profiles");
    appProfileNames = Object.keys(profiles);
  }

  async function loadObjects() {
    const data = await apiFetch("/api/satdump/objects");
    trackedObjects = data.map((obj) => ({
      norad: obj.norad,
      name: obj.name || "",
      enabled: obj.enabled !== false,
      downlinks: (obj.downlinks || []).map((downlink) => ({
        frequency: downlink.frequency ?? 137500000,
        live: downlink.live !== false,
        record: !!downlink.record,
        pipeline_name: downlink.pipeline_name || "",
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
          if (trackedObjects.some((obj) => obj.norad === sat.norad)) {
            objectsSaveStatus.textContent = `${sat.name} is already tracked`;
          } else {
            trackedObjects.push({
              norad: sat.norad,
              name: sat.name,
              enabled: true,
              downlinks: [
                { frequency: 137500000, live: true, record: false, pipeline_name: "", app: "" },
              ],
            });
            renderTrackedList();
          }
          searchInput.value = "";
          hideSearchResults();
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

  saveObjectsBtn.addEventListener("click", async () => {
    objectsSaveStatus.textContent = "";
    const payload = trackedObjects.map((obj) => ({
      norad: obj.norad,
      name: obj.name,
      enabled: obj.enabled,
      downlinks: obj.downlinks.map((downlink) => ({
        frequency: downlink.frequency,
        live: downlink.live,
        record: downlink.record,
        pipeline_name: downlink.pipeline_name,
        app: downlink.app,
      })),
    }));
    try {
      await apiFetch("/api/satdump/objects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      objectsSaveStatus.textContent = "saved";
      setTimeout(() => {
        objectsSaveStatus.textContent = "";
      }, 2000);
    } catch (err) {
      objectsSaveStatus.textContent = `error: ${err.message}`;
    }
  });

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/satdump/ws`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.line !== undefined) {
        logPre.textContent += data.line + "\n";
        logPre.scrollTop = logPre.scrollHeight;
      }
      if (data.running !== undefined) {
        satdumpStatus.textContent = data.running ? "running" : "stopped";
        startBtn.disabled = data.running;
        stopBtn.disabled = !data.running;
        satdumpDot.classList.toggle("on", data.running);
      }
    };
    ws.onclose = () => setTimeout(connect, 2000);
    ws.onerror = () => ws.close();
  }

  Promise.all([loadAppProfiles(), loadObjects()]).then(renderTrackedList);
  connect();
})();
