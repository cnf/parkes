(() => {
  const groupsList = document.getElementById("groups-list");
  const fixedTargetsList = document.getElementById("fixed-targets-list");
  const newGroupForm = document.getElementById("new-group-form");
  const newGroupName = document.getElementById("new-group-name");

  const body = document.getElementById("satellites-body");
  const countEl = document.getElementById("satellites-count");
  const filterInput = document.getElementById("satellites-filter");
  const sourceFilterSelect = document.getElementById("satellites-source-filter");

  const modalOverlay = document.getElementById("group-modal-overlay");
  const modalTitle = document.getElementById("group-modal-title");
  const modalClose = document.getElementById("group-modal-close");
  const modalMembers = document.getElementById("group-modal-members");
  const modalSearchInput = document.getElementById("group-modal-search-input");
  const modalSearchResults = document.getElementById("group-modal-search-results");

  let groups = [];
  let fixedTargets = [];
  let satellites = [];
  let openGroupName = null;

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

  async function loadGroups() {
    groups = await apiFetch("/api/tracking/groups");
  }

  async function loadFixedTargets() {
    fixedTargets = await apiFetch("/api/tracking/fixed_targets");
  }

  async function loadSources() {
    const sources = await apiFetch("/api/tracking/sources");
    const current = sourceFilterSelect.value;
    sourceFilterSelect.innerHTML = `<option value="">All sources</option>`;
    for (const source of sources) {
      const opt = document.createElement("option");
      opt.value = source.name;
      opt.textContent = source.name;
      sourceFilterSelect.appendChild(opt);
    }
    sourceFilterSelect.value = current;
  }

  async function loadSatellites() {
    const params = new URLSearchParams();
    const q = filterInput.value.trim();
    if (q) params.set("q", q);
    if (sourceFilterSelect.value) params.set("source", sourceFilterSelect.value);
    satellites = await apiFetch(`/api/tracking/satellites/search?${params.toString()}`);
  }

  function renderGroupsList() {
    groupsList.innerHTML = "";
    if (groups.length === 0) {
      groupsList.innerHTML = `<p class="hint">No groups yet -- add one below.</p>`;
      return;
    }
    for (const group of groups) {
      const row = document.createElement("div");
      row.className = "group-row";
      row.innerHTML = `
        <label>
          <input type="checkbox" ${group.enabled ? "checked" : ""} />
          ${escapeHtml(group.name)} <span class="count">(${group.satellites.length})</span>
        </label>
        <div class="row" style="margin: 0;">
          <button type="button" class="btn-sm" data-action="manage">Manage</button>
          <button type="button" class="btn-sm" data-action="delete">Delete</button>
        </div>
      `;
      row.querySelector("input").addEventListener("change", async (event) => {
        await apiFetch(`/api/tracking/groups/${encodeURIComponent(group.name)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: event.target.checked }),
        });
      });
      row.querySelector('[data-action="manage"]').addEventListener("click", () => openGroupModal(group.name));
      row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        await apiFetch(`/api/tracking/groups/${encodeURIComponent(group.name)}`, { method: "DELETE" });
        await refreshAll();
      });
      groupsList.appendChild(row);
    }
  }

  function renderFixedTargetsList() {
    fixedTargetsList.innerHTML = "";
    for (const target of fixedTargets) {
      const row = document.createElement("div");
      row.className = "group-row";
      row.innerHTML = `
        <label>
          <input type="checkbox" ${target.enabled ? "checked" : ""} />
          ${escapeHtml(target.name)}
        </label>
      `;
      row.querySelector("input").addEventListener("change", async (event) => {
        await apiFetch(`/api/tracking/fixed_targets/${encodeURIComponent(target.name)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: event.target.checked }),
        });
      });
      fixedTargetsList.appendChild(row);
    }
  }

  function ageClass(days) {
    return days > 14 ? "age-stale" : "age-fresh";
  }

  function renderTableBody() {
    body.innerHTML = "";
    countEl.textContent = `${satellites.length} shown`;
    for (const sat of satellites) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td data-satnogs-norad="${sat.norad}">${escapeHtml(sat.name)}</td>
        <td>${sat.norad}</td>
        <td>${escapeHtml(sat.source)}</td>
        <td class="${ageClass(sat.epoch_days_old)}">${sat.epoch_days_old.toFixed(1)}d</td>
      `;
      body.appendChild(row);
    }
  }

  async function refreshAll() {
    await Promise.all([loadGroups(), loadFixedTargets(), loadSources(), loadSatellites()]);
    renderGroupsList();
    renderFixedTargetsList();
    renderTableBody();
  }

  // ---------------------------------------------------------------------
  // Group modal -- add/remove satellites for whichever group is open.
  // ---------------------------------------------------------------------

  function hideModalSearchResults() {
    modalSearchResults.style.display = "none";
    modalSearchResults.innerHTML = "";
  }

  function currentGroup() {
    return groups.find((g) => g.name === openGroupName) || null;
  }

  function renderModalMembers() {
    const group = currentGroup();
    modalMembers.innerHTML = "";
    if (!group || group.satellites.length === 0) {
      modalMembers.innerHTML = `<p class="hint">No satellites yet -- search below to add one.</p>`;
      return;
    }
    for (const sat of group.satellites) {
      const row = document.createElement("div");
      row.className = "search-result-row";
      row.innerHTML = `
        <span data-satnogs-norad="${sat.norad}">${escapeHtml(sat.name)} <span class="tracked-norad">(${sat.norad})</span></span>
        <button type="button" class="btn-sm">Remove</button>
      `;
      row.querySelector("button").addEventListener("click", async () => {
        await apiFetch(
          `/api/tracking/groups/${encodeURIComponent(openGroupName)}/satellites/${sat.norad}`,
          { method: "DELETE" }
        );
        await loadGroups();
        renderGroupsList();
        renderModalMembers();
      });
      modalMembers.appendChild(row);
    }
  }

  function openGroupModal(groupName) {
    openGroupName = groupName;
    modalTitle.textContent = groupName;
    modalSearchInput.value = "";
    hideModalSearchResults();
    renderModalMembers();
    modalOverlay.style.display = "flex";
    modalSearchInput.focus();
  }

  function closeGroupModal() {
    modalOverlay.style.display = "none";
    openGroupName = null;
  }

  modalClose.addEventListener("click", closeGroupModal);
  modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) closeGroupModal();
  });

  let modalSearchDebounce;
  modalSearchInput.addEventListener("input", () => {
    clearTimeout(modalSearchDebounce);
    const q = modalSearchInput.value.trim();
    if (!q) {
      hideModalSearchResults();
      return;
    }
    modalSearchDebounce = setTimeout(async () => {
      const results = await apiFetch(`/api/tracking/satellites/search?q=${encodeURIComponent(q)}`);
      const group = currentGroup();
      const memberNorads = new Set((group ? group.satellites : []).map((s) => s.norad));
      modalSearchResults.innerHTML = "";
      for (const sat of results.slice(0, 20)) {
        const row = document.createElement("div");
        row.className = "search-result-row";
        row.setAttribute("data-satnogs-norad", sat.norad);
        const already = memberNorads.has(sat.norad);
        row.innerHTML = `
          <span>${escapeHtml(sat.name)}</span>
          <span style="color: var(--text-muted);">${already ? "already added" : sat.norad}</span>
        `;
        if (!already) {
          row.style.cursor = "pointer";
          row.addEventListener("click", async () => {
            await apiFetch(`/api/tracking/groups/${encodeURIComponent(openGroupName)}/satellites`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ norad: sat.norad, name: sat.name }),
            });
            modalSearchInput.value = "";
            hideModalSearchResults();
            await loadGroups();
            renderGroupsList();
            renderModalMembers();
          });
        }
        modalSearchResults.appendChild(row);
      }
      modalSearchResults.style.display = results.length ? "block" : "none";
    }, 250);
  });

  document.addEventListener("click", (event) => {
    if (event.target !== modalSearchInput && !modalSearchResults.contains(event.target)) {
      hideModalSearchResults();
    }
  });

  newGroupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = newGroupName.value.trim();
    if (!name) return;
    await apiFetch("/api/tracking/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    newGroupName.value = "";
    await refreshAll();
  });

  let filterDebounce;
  filterInput.addEventListener("input", () => {
    clearTimeout(filterDebounce);
    filterDebounce = setTimeout(async () => {
      await loadSatellites();
      renderTableBody();
    }, 250);
  });
  sourceFilterSelect.addEventListener("change", async () => {
    await loadSatellites();
    renderTableBody();
  });

  refreshAll();
})();
