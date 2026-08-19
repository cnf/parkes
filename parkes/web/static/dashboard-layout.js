(() => {
  const grid = document.getElementById("dashboard-grid");
  if (!grid) return;

  const editBtn = document.getElementById("edit-layout-btn");
  const toolbar = document.getElementById("dashboard-edit-toolbar");
  const columnsField = document.getElementById("dashboard-columns-field");
  const columnsSelect = document.getElementById("dashboard-columns-select");
  const widthInput = document.getElementById("width-toggle-input");
  const saveBtn = document.getElementById("layout-editor-save-btn");
  const cancelBtn = document.getElementById("layout-editor-cancel-btn");

  // Widgets that don't make sense at every span: the rotator/pass-plot
  // instruments are compact and look odd stretched full-width, the world
  // map needs room to be legible. Anything not listed has no constraint
  // beyond [1, current column count].
  const SPAN_LIMITS = {
    rotator: { max: 2 },
    "pass-plot": { max: 2 },
    "world-map": { min: 2 },
  };
  const minSpanFor = (id) => SPAN_LIMITS[id]?.min || 1;
  const maxSpanFor = (id, columns) => Math.min(SPAN_LIMITS[id]?.max || columns, columns);

  const cards = new Map();
  for (const el of grid.querySelectorAll(":scope > .card[data-widget-id]")) {
    cards.set(el.dataset.widgetId, el);
  }

  // Below this, cards stack in a single column -- no row to share, so no
  // span choice and no per-widget layout worth saving separately from
  // "narrow". Matches style.css's own breakpoint for the same grid.
  const mql = window.matchMedia("(min-width: 60rem)");
  const currentProfile = () => (mql.matches ? "wide" : "narrow");

  async function apiFetch(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  }

  function labelFor(id) {
    const el = cards.get(id);
    return el.dataset.widgetLabel || el.querySelector(".card-header h2")?.textContent || id;
  }

  function normalizeWide(raw, columns) {
    const known = new Set(cards.keys());
    const seen = new Set();
    const layout = [];
    for (const entry of raw || []) {
      if (!known.has(entry.id) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const min = minSpanFor(entry.id);
      const max = maxSpanFor(entry.id, columns);
      const span = Math.min(Math.max(Number(entry.span) || min, min), max);
      layout.push({ id: entry.id, span, hidden: !!entry.hidden });
    }
    for (const id of known) {
      if (!seen.has(id)) layout.push({ id, span: Math.min(minSpanFor(id), columns), hidden: false });
    }
    return layout;
  }

  function normalizeNarrow(raw) {
    const known = new Set(cards.keys());
    const seen = new Set();
    const layout = [];
    for (const entry of raw || []) {
      if (!known.has(entry.id) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      layout.push({ id: entry.id, hidden: !!entry.hidden });
    }
    for (const id of known) {
      if (!seen.has(id)) layout.push({ id, hidden: false });
    }
    return layout;
  }

  function applyWide(layout, columns) {
    grid.classList.remove("cols-2", "cols-3", "cols-4");
    grid.classList.add(`cols-${columns}`);
    for (const entry of layout) {
      const el = cards.get(entry.id);
      el.classList.remove("span-1", "span-2", "span-3");
      el.classList.add(`span-${entry.span}`);
      el.classList.toggle("widget-hidden", entry.hidden);
      grid.appendChild(el);
    }
  }

  function applyNarrow(layout) {
    grid.classList.remove("cols-2", "cols-3", "cols-4");
    for (const entry of layout) {
      const el = cards.get(entry.id);
      el.classList.remove("span-1", "span-2", "span-3");
      el.classList.toggle("widget-hidden", entry.hidden);
      grid.appendChild(el);
    }
  }

  function applyWidthClass(mode) {
    document.body.classList.toggle("full-width", mode === "full");
  }

  let savedWide = [];
  let savedNarrow = [];
  let savedColumns = 3;
  let savedWidth = "controlled";

  let editing = false;
  let workingWide = [];
  let workingNarrow = [];
  let workingColumns = 3;
  let workingWidth = "controlled";

  function applyForProfile(profile) {
    if (profile === "wide") {
      applyWide(editing ? workingWide : savedWide, editing ? workingColumns : savedColumns);
    } else {
      applyNarrow(editing ? workingNarrow : savedNarrow);
    }
  }

  function clearEditBars() {
    for (const el of cards.values()) {
      el.querySelector(":scope > .card-edit-bar")?.remove();
    }
  }

  function buildEditBar(entry, index, layout, profile) {
    const bar = document.createElement("div");
    bar.className = "card-edit-bar";

    const nameEl = document.createElement("span");
    nameEl.className = "card-edit-name";
    nameEl.textContent = labelFor(entry.id);
    bar.appendChild(nameEl);

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "btn-sm";
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => {
      [layout[index - 1], layout[index]] = [layout[index], layout[index - 1]];
      renderEditUI();
    });
    bar.appendChild(upBtn);

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "btn-sm";
    downBtn.textContent = "↓";
    downBtn.disabled = index === layout.length - 1;
    downBtn.addEventListener("click", () => {
      [layout[index], layout[index + 1]] = [layout[index + 1], layout[index]];
      renderEditUI();
    });
    bar.appendChild(downBtn);

    if (profile === "wide") {
      const min = minSpanFor(entry.id);
      const max = maxSpanFor(entry.id, workingColumns);
      if (min < max) {
        const select = document.createElement("select");
        for (let n = min; n <= max; n++) {
          const opt = document.createElement("option");
          opt.value = String(n);
          opt.textContent = `${n} col${n > 1 ? "s" : ""}`;
          if (n === entry.span) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener("change", () => {
          entry.span = Number(select.value);
          renderEditUI();
        });
        bar.appendChild(select);
      }
    }

    const hiddenLabel = document.createElement("label");
    hiddenLabel.className = "card-edit-hidden";
    const hiddenCheckbox = document.createElement("input");
    hiddenCheckbox.type = "checkbox";
    hiddenCheckbox.checked = entry.hidden;
    hiddenCheckbox.addEventListener("change", () => {
      entry.hidden = hiddenCheckbox.checked;
      renderEditUI();
    });
    hiddenLabel.appendChild(hiddenCheckbox);
    hiddenLabel.append("Hidden");
    bar.appendChild(hiddenLabel);

    return bar;
  }

  function renderEditUI() {
    const profile = currentProfile();
    applyForProfile(profile);
    clearEditBars();
    const layout = profile === "wide" ? workingWide : workingNarrow;
    layout.forEach((entry, index) => {
      cards.get(entry.id).prepend(buildEditBar(entry, index, layout, profile));
    });
    columnsField.style.display = profile === "wide" ? "" : "none";
    columnsSelect.value = String(workingColumns);
  }

  function openEditor() {
    editing = true;
    workingWide = savedWide.map((e) => ({ ...e }));
    workingNarrow = savedNarrow.map((e) => ({ ...e }));
    workingColumns = savedColumns;
    workingWidth = savedWidth;
    widthInput.checked = workingWidth === "full";
    grid.classList.add("editing");
    toolbar.style.display = "";
    editBtn.classList.add("active");
    renderEditUI();
  }

  function closeEditor() {
    editing = false;
    grid.classList.remove("editing");
    toolbar.style.display = "none";
    editBtn.classList.remove("active");
    clearEditBars();
    applyWidthClass(savedWidth);
    applyForProfile(currentProfile());
  }

  editBtn.addEventListener("click", () => (editing ? closeEditor() : openEditor()));
  cancelBtn.addEventListener("click", closeEditor);

  columnsSelect.addEventListener("change", () => {
    workingColumns = Number(columnsSelect.value);
    for (const entry of workingWide) {
      const min = minSpanFor(entry.id);
      const max = maxSpanFor(entry.id, workingColumns);
      entry.span = Math.min(Math.max(entry.span, min), max);
    }
    renderEditUI();
  });

  widthInput.addEventListener("change", () => {
    workingWidth = widthInput.checked ? "full" : "controlled";
    applyWidthClass(workingWidth);
  });

  saveBtn.addEventListener("click", async () => {
    await apiFetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dashboard_layout_wide: workingWide,
        dashboard_layout_narrow: workingNarrow,
        dashboard_columns: workingColumns,
        dashboard_width: workingWidth,
      }),
    });
    savedWide = workingWide;
    savedNarrow = workingNarrow;
    savedColumns = workingColumns;
    savedWidth = workingWidth;
    closeEditor();
  });

  // Crossing the breakpoint mid-edit would otherwise leave the editor open
  // against the wrong profile's data -- simplest correct behaviour is to
  // close it (same as Cancel) rather than try to reconcile two working
  // copies against a UI built for one of them.
  mql.addEventListener("change", () => {
    if (editing) {
      closeEditor();
      return;
    }
    applyForProfile(currentProfile());
  });

  (async () => {
    const data = await apiFetch("/api/settings");
    const p = data.preferences;
    savedColumns = [2, 3, 4].includes(p.dashboard_columns) ? p.dashboard_columns : 3;
    savedWide = normalizeWide(p.dashboard_layout_wide, savedColumns);
    savedNarrow = normalizeNarrow(p.dashboard_layout_narrow);
    savedWidth = p.dashboard_width === "full" ? "full" : "controlled";
    applyWidthClass(savedWidth);
    applyForProfile(currentProfile());
  })();
})();
