(() => {
  // Renders whatever GET /api/dish/config reports -- Parkes doesn't know
  // the ESP's specific setting names, it just renders namespaces/entries
  // generically by type.
  const dotEl = document.getElementById("dish-esp-dot");
  const statusEl = document.getElementById("dish-esp-status");
  const container = document.getElementById("dish-esp-namespaces");
  const homeAzBtn = document.getElementById("dish-esp-home-az-btn");
  const homeElBtn = document.getElementById("dish-esp-home-el-btn");
  const homeStatusEl = document.getElementById("dish-esp-home-status");
  const azHomedDot = document.getElementById("dish-esp-az-homed-dot");
  const azHomedStatus = document.getElementById("dish-esp-az-homed-status");
  const elHomedDot = document.getElementById("dish-esp-el-homed-dot");
  const elHomedStatus = document.getElementById("dish-esp-el-homed-status");

  function setDot(ok, onText, offText) {
    dotEl.classList.toggle("on", ok === true);
    dotEl.classList.toggle("error", ok === false);
    statusEl.textContent = ok === true ? onText : offText;
  }

  // GE's error bitfield (EasyComm III spec) -- only shown when "homed" is
  // unknown, since that's the only case the firmware itself flags as
  // possibly explained by one of these.
  const ERROR_BITS = [
    [1, "sensor error"],
    [2, "jam"],
    [4, "homing error"],
  ];

  function renderHomed(dotEl2, textEl2, data) {
    dotEl2.classList.remove("on", "error");
    if (!data.connected) {
      textEl2.textContent = "--";
    } else if (data.homed === true) {
      dotEl2.classList.add("on");
      textEl2.textContent = "homed";
    } else if (data.homed === false) {
      textEl2.textContent = "not homed";
    } else {
      dotEl2.classList.add("error");
      const errors = ERROR_BITS.filter(([bit]) => data.error & bit).map(([, label]) => label);
      textEl2.textContent = errors.length ? `unknown (${errors.join(", ")})` : "unknown";
    }
  }

  async function postJson(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  function vectorItems(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value) return value.split(".");
    return [];
  }

  function renderVectorEntry(namespace, entry, labelText, unitHint) {
    const row = document.createElement("div");
    row.className = "dish-esp-entry";
    const wrap = document.createElement("label");
    wrap.textContent = labelText;

    const list = document.createElement("div");
    list.className = "dish-esp-vector-items";
    for (const item of vectorItems(entry.value)) {
      const itemRow = document.createElement("div");
      itemRow.className = "dish-esp-vector-item";
      const span = document.createElement("span");
      span.textContent = item;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-sm";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", async () => {
        try {
          await postJson("/api/dish/config/vector", {
            namespace, key: entry.key, action: "remove", item,
          });
          refresh();
        } catch (err) {
          alert(`failed to remove: ${err.message}`);
        }
      });
      itemRow.append(span, removeBtn);
      list.appendChild(itemRow);
    }

    const addRow = document.createElement("div");
    addRow.className = "dish-esp-vector-add";
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.placeholder = "add item";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-sm";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", async () => {
      if (!addInput.value.trim()) return;
      try {
        await postJson("/api/dish/config/vector", {
          namespace, key: entry.key, action: "add", item: addInput.value.trim(),
        });
        refresh();
      } catch (err) {
        alert(`failed to add: ${err.message}`);
      }
    });
    addRow.append(addInput, addBtn);
    list.appendChild(addRow);
    wrap.appendChild(list);
    row.appendChild(wrap);
    if (unitHint) row.appendChild(hintEl(unitHint));
    return row;
  }

  function hintEl(text) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = text;
    return hint;
  }

  function renderScalarEntry(namespace, entry, type, labelText, unitHint) {
    const row = document.createElement("div");
    row.className = "dish-esp-entry";
    const label = document.createElement("label");
    label.textContent = labelText;

    const input = document.createElement("input");
    if (type === "bool") {
      input.type = "checkbox";
      input.checked = Boolean(entry.value);
      input.style.width = "auto";
    } else if (type === "int" || type === "double") {
      input.type = "number";
      if (type === "double") input.step = "any";
      input.value = entry.value ?? "";
    } else {
      input.type = "text";
      input.value = entry.value ?? "";
    }
    label.appendChild(input);
    row.appendChild(label);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-sm";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const value =
        type === "bool" ? input.checked
        : type === "int" ? parseInt(input.value, 10)
        : type === "double" ? parseFloat(input.value)
        : input.value;
      try {
        await postJson("/api/dish/config", {
          namespace, key: entry.key, type: entry.type, value,
        });
        saveBtn.textContent = "Saved";
        setTimeout(() => { saveBtn.textContent = "Save"; }, 1500);
      } catch (err) {
        alert(`failed to save: ${err.message}`);
      }
    });
    row.appendChild(saveBtn);
    if (unitHint) row.appendChild(hintEl(unitHint));
    return row;
  }

  function renderEntry(namespace, entry) {
    const type = (entry.type || "").toLowerCase();
    const labelText = entry.description || entry.key;
    const unitHint = [entry.format, entry.unit].filter(Boolean).join(" ");
    return type === "vector"
      ? renderVectorEntry(namespace, entry, labelText, unitHint)
      : renderScalarEntry(namespace, entry, type, labelText, unitHint);
  }

  function render(data, version) {
    const connectedText = version ? `connected -- ${version}` : "connected";
    setDot(data.connected ? true : null, connectedText, "not connected yet");
    container.innerHTML = "";
    for (const ns of data.namespaces) {
      const section = document.createElement("div");
      section.className = "dish-esp-namespace";
      const heading = document.createElement("div");
      heading.className = "dish-esp-namespace-name";
      heading.textContent = ns.namespace;
      section.appendChild(heading);
      for (const entry of ns.entries) {
        section.appendChild(renderEntry(ns.namespace, entry));
      }
      container.appendChild(section);
    }
  }

  async function refreshHomed() {
    try {
      const [azRes, elRes] = await Promise.all([
        fetch("/api/dish/home/azimuth"),
        fetch("/api/dish/home/elevation"),
      ]);
      renderHomed(azHomedDot, azHomedStatus, await azRes.json());
      renderHomed(elHomedDot, elHomedStatus, await elRes.json());
    } catch {
      // leave whatever was last shown -- a transient fetch error here
      // isn't worth blanking a status the user might still find useful
    }
  }

  async function refresh() {
    try {
      const [configRes, versionRes] = await Promise.all([
        fetch("/api/dish/config"),
        fetch("/api/dish/version"),
      ]);
      const data = await configRes.json();
      const versionData = await versionRes.json();
      render(data, versionData.version);
    } catch {
      setDot(false, "", "unreachable");
    }
    await refreshHomed();
  }

  function wireHomeButton(btn, path) {
    btn.addEventListener("click", async () => {
      homeStatusEl.textContent = "";
      try {
        await postJson(path, {});
        homeStatusEl.textContent = "sent";
        setTimeout(() => { homeStatusEl.textContent = ""; }, 2000);
        await refreshHomed();
      } catch (err) {
        homeStatusEl.textContent = `error: ${err.message}`;
      }
    });
  }
  wireHomeButton(homeAzBtn, "/api/dish/home/azimuth");
  wireHomeButton(homeElBtn, "/api/dish/home/elevation");

  refresh();
})();
