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
  // beyond [1, current column count]. A merged card's limits are the
  // intersection of its members' -- see groupMinSpan/groupMaxSpan.
  const SPAN_LIMITS = {
    rotator: { max: 2 },
    "pass-plot": { max: 2 },
    "world-map": { min: 2 },
  };
  const minSpanFor = (id) => SPAN_LIMITS[id]?.min || 1;
  const maxSpanFor = (id, columns) => Math.min(SPAN_LIMITS[id]?.max || columns, columns);
  const groupMinSpan = (members) => Math.max(...members.map(minSpanFor));
  const groupMaxSpan = (members, columns) => Math.min(...members.map((id) => maxSpanFor(id, columns)));

  // widgetEls never changes after load -- a widget's own <section> is a
  // fixed piece of markup that only ever moves between group wrapper
  // divs, never gets recreated. groupWrapperEls does change: a wrapper is
  // created the first time its leader appears, and removed once nothing
  // groups under that leader any more (see applyGroupsToDOM).
  const widgetEls = new Map();
  for (const el of grid.querySelectorAll("[data-widget-id]")) {
    widgetEls.set(el.dataset.widgetId, el);
  }
  const groupWrapperEls = new Map();
  for (const el of grid.querySelectorAll(":scope > [data-group-id]")) {
    groupWrapperEls.set(el.dataset.groupId, el);
  }

  // Below this, cards stack in a single column -- no row to share, so no
  // span choice and no per-widget layout worth saving separately from
  // "narrow". Matches style.css's own breakpoint for the same grid.
  // Grouping itself (dashboard_groups) is NOT profile-specific -- which
  // widgets share a card is a structural choice, not a viewport one.
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
    const el = widgetEls.get(id);
    return el.dataset.widgetLabel || el.querySelector(".card-header h2")?.textContent || id;
  }

  function normalizeGroups(raw) {
    const known = new Set(widgetEls.keys());
    const seen = new Set();
    const groups = [];
    for (const members of raw || []) {
      const filtered = (members || []).filter((id) => known.has(id) && !seen.has(id));
      for (const id of filtered) seen.add(id);
      if (filtered.length) groups.push(filtered);
    }
    for (const id of known) {
      if (!seen.has(id)) groups.push([id]);
    }
    return groups;
  }

  function normalizeWide(raw, groups, columns) {
    const groupByLeader = new Map(groups.map((g) => [g[0], g]));
    const known = new Set(groupByLeader.keys());
    const seen = new Set();
    const layout = [];
    for (const entry of raw || []) {
      if (!known.has(entry.id) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const members = groupByLeader.get(entry.id);
      const min = groupMinSpan(members);
      const max = groupMaxSpan(members, columns);
      const span = Math.min(Math.max(Number(entry.span) || min, min), max);
      layout.push({ id: entry.id, span, hidden: !!entry.hidden });
    }
    for (const leader of known) {
      if (!seen.has(leader)) {
        const members = groupByLeader.get(leader);
        layout.push({ id: leader, span: Math.min(groupMinSpan(members), columns), hidden: false });
      }
    }
    return layout;
  }

  function normalizeNarrow(raw, groups) {
    const leaders = new Set(groups.map((g) => g[0]));
    const seen = new Set();
    const layout = [];
    for (const entry of raw || []) {
      if (!leaders.has(entry.id) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      layout.push({ id: entry.id, hidden: !!entry.hidden });
    }
    for (const leader of leaders) {
      if (!seen.has(leader)) layout.push({ id: leader, hidden: false });
    }
    return layout;
  }

  // Creates/reuses a wrapper div per group leader and moves each member's
  // <section> into it in the group's own order, then drops any wrapper
  // whose leader no longer groups anything (its sole member moved
  // elsewhere on a merge). Wrapper divs are the grid's direct children --
  // applyWide/applyNarrow position *them*, never raw widget sections.
  function applyGroupsToDOM(groups) {
    const usedLeaders = new Set();
    for (const members of groups) {
      const leader = members[0];
      let wrapper = groupWrapperEls.get(leader);
      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "card";
        wrapper.dataset.groupId = leader;
        groupWrapperEls.set(leader, wrapper);
      }
      for (const id of members) {
        wrapper.appendChild(widgetEls.get(id));
      }
      usedLeaders.add(leader);
    }
    for (const [leader, wrapper] of [...groupWrapperEls.entries()]) {
      if (!usedLeaders.has(leader)) {
        wrapper.remove();
        groupWrapperEls.delete(leader);
      }
    }
  }

  function applyWide(layout, groups, columns) {
    applyGroupsToDOM(groups);
    grid.classList.remove("cols-2", "cols-3", "cols-4");
    grid.classList.add(`cols-${columns}`);
    for (const entry of layout) {
      const el = groupWrapperEls.get(entry.id);
      el.classList.remove("span-1", "span-2", "span-3", "span-4");
      el.classList.add(`span-${entry.span}`);
      el.classList.toggle("widget-hidden", entry.hidden);
      grid.appendChild(el);
    }
  }

  function applyNarrow(layout, groups) {
    applyGroupsToDOM(groups);
    grid.classList.remove("cols-2", "cols-3", "cols-4");
    for (const entry of layout) {
      const el = groupWrapperEls.get(entry.id);
      el.classList.remove("span-1", "span-2", "span-3", "span-4");
      el.classList.toggle("widget-hidden", entry.hidden);
      grid.appendChild(el);
    }
  }

  function applyWidthClass(mode) {
    document.body.classList.toggle("full-width", mode === "full");
  }

  let savedGroups = [];
  let savedWide = [];
  let savedNarrow = [];
  let savedColumns = 3;
  let savedWidth = "controlled";

  let editing = false;
  let workingGroups = [];
  let workingWide = [];
  let workingNarrow = [];
  let workingColumns = 3;
  let workingWidth = "controlled";

  function applyForProfile(profile) {
    if (profile === "wide") {
      applyWide(
        editing ? workingWide : savedWide,
        editing ? workingGroups : savedGroups,
        editing ? workingColumns : savedColumns
      );
    } else {
      applyNarrow(editing ? workingNarrow : savedNarrow, editing ? workingGroups : savedGroups);
    }
  }

  function clearEditBars() {
    for (const el of groupWrapperEls.values()) {
      el.querySelector(":scope > .card-edit")?.remove();
    }
  }

  function groupOf(leaderId) {
    return workingGroups.find((g) => g[0] === leaderId);
  }

  function reconcileWorkingLayouts() {
    workingWide = normalizeWide(workingWide, workingGroups, workingColumns);
    workingNarrow = normalizeNarrow(workingNarrow, workingGroups);
  }

  function mergeWithNext(layout, index) {
    const g1 = groupOf(layout[index].id);
    const g2 = groupOf(layout[index + 1].id);
    if (!g1 || !g2) return;
    workingGroups = workingGroups.filter((g) => g !== g1 && g !== g2);
    workingGroups.push(g1.concat(g2));
    reconcileWorkingLayouts();
    renderEditUI();
  }

  function splitOut(leaderId, widgetId) {
    const g = groupOf(leaderId);
    const idx = g.indexOf(widgetId);
    if (idx <= 0) return; // leader (index 0) can't be split off itself
    g.splice(idx, 1);
    workingGroups.push([widgetId]);
    reconcileWorkingLayouts();
    renderEditUI();
  }

  function buildEditPanel(entry, index, layout, profile) {
    const members = groupOf(entry.id);
    const container = document.createElement("div");
    container.className = "card-edit";

    const bar = document.createElement("div");
    bar.className = "card-edit-bar";

    const nameEl = document.createElement("span");
    nameEl.className = "card-edit-name";
    nameEl.textContent = members.map(labelFor).join(" + ");
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
      const min = groupMinSpan(members);
      const max = groupMaxSpan(members, workingColumns);
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

    const nextEntry = layout[index + 1];
    const mergeBtn = document.createElement("button");
    mergeBtn.type = "button";
    mergeBtn.className = "btn-sm";
    mergeBtn.textContent = "⤵ Merge";
    if (nextEntry) {
      const nextMembers = groupOf(nextEntry.id);
      const combined = members.concat(nextMembers);
      const feasible = groupMinSpan(combined) <= groupMaxSpan(combined, workingColumns);
      mergeBtn.disabled = !feasible;
      mergeBtn.title = feasible
        ? `Merge with ${nextMembers.map(labelFor).join(" + ")}`
        : "Span limits don't overlap";
      mergeBtn.addEventListener("click", () => mergeWithNext(layout, index));
    } else {
      mergeBtn.disabled = true;
    }
    bar.appendChild(mergeBtn);

    container.appendChild(bar);

    if (members.length > 1) {
      const list = document.createElement("div");
      list.className = "card-edit-members";
      for (const widgetId of members.slice(1)) {
        const row = document.createElement("div");
        row.className = "card-edit-member";
        const label = document.createElement("span");
        label.textContent = labelFor(widgetId);
        row.appendChild(label);
        const splitBtn = document.createElement("button");
        splitBtn.type = "button";
        splitBtn.className = "btn-sm";
        splitBtn.textContent = "Split out";
        splitBtn.addEventListener("click", () => splitOut(entry.id, widgetId));
        row.appendChild(splitBtn);
        list.appendChild(row);
      }
      container.appendChild(list);
    }

    return container;
  }

  function renderEditUI() {
    const profile = currentProfile();
    applyForProfile(profile);
    clearEditBars();
    const layout = profile === "wide" ? workingWide : workingNarrow;
    layout.forEach((entry, index) => {
      groupWrapperEls.get(entry.id).prepend(buildEditPanel(entry, index, layout, profile));
    });
    columnsField.style.display = profile === "wide" ? "" : "none";
    columnsSelect.value = String(workingColumns);
  }

  function openEditor() {
    editing = true;
    workingGroups = savedGroups.map((g) => [...g]);
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
    workingWide = normalizeWide(workingWide, workingGroups, workingColumns);
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
        dashboard_groups: workingGroups,
        dashboard_layout_wide: workingWide,
        dashboard_layout_narrow: workingNarrow,
        dashboard_columns: workingColumns,
        dashboard_width: workingWidth,
      }),
    });
    savedGroups = workingGroups;
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
    savedGroups = normalizeGroups(p.dashboard_groups);
    savedColumns = [2, 3, 4].includes(p.dashboard_columns) ? p.dashboard_columns : 3;
    savedWide = normalizeWide(p.dashboard_layout_wide, savedGroups, savedColumns);
    savedNarrow = normalizeNarrow(p.dashboard_layout_narrow, savedGroups);
    savedWidth = p.dashboard_width === "full" ? "full" : "controlled";
    applyWidthClass(savedWidth);
    applyForProfile(currentProfile());
  })();
})();
