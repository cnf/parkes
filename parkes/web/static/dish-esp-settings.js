(() => {
  // Renders whatever GET /api/dish/config reports -- Parkes doesn't know
  // the ESP's specific setting names, it just renders namespaces/entries
  // generically by type. Untestable against a real device until a
  // transport exists (see parkes/dish_esp/client.py) -- built carefully
  // against the documented /api/config contract, but the exact wire
  // values for "type" (int/double/bool/string/vector?) and how vector
  // values are actually JSON-encoded haven't been observed live yet, so
  // this is defensive about both.
  const dotEl = document.getElementById("dish-esp-dot");
  const statusEl = document.getElementById("dish-esp-status");
  const container = document.getElementById("dish-esp-namespaces");

  function setDot(ok, onText, offText) {
    dotEl.classList.toggle("on", ok === true);
    dotEl.classList.toggle("error", ok === false);
    statusEl.textContent = ok === true ? onText : offText;
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

  function render(data) {
    setDot(data.connected ? true : null, "connected", "not connected yet");
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

  async function refresh() {
    try {
      const res = await fetch("/api/dish/config");
      const data = await res.json();
      render(data);
    } catch {
      setDot(false, "", "unreachable");
    }
  }

  refresh();
})();
