(() => {
  const groupsList = document.getElementById("groups-list");
  const newGroupForm = document.getElementById("new-group-form");
  const newGroupName = document.getElementById("new-group-name");

  const headRow = document.getElementById("satellites-head-row");
  const body = document.getElementById("satellites-body");
  const countEl = document.getElementById("satellites-count");
  const filterInput = document.getElementById("satellites-filter");
  const sourceFilterSelect = document.getElementById("satellites-source-filter");

  let groups = [];
  let satellites = [];
  let membership = new Map(); // norad -> Set(groupName)

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

  function computeMembership() {
    membership = new Map();
    for (const group of groups) {
      for (const sat of group.satellites) {
        if (!membership.has(sat.norad)) membership.set(sat.norad, new Set());
        membership.get(sat.norad).add(group.name);
      }
    }
  }

  async function loadGroups() {
    groups = await apiFetch("/api/tracking/groups");
    computeMembership();
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
    for (const group of groups) {
      const row = document.createElement("div");
      row.className = "group-row";
      row.innerHTML = `
        <label>
          <input type="checkbox" ${group.enabled ? "checked" : ""} />
          ${escapeHtml(group.name)} <span class="count">(${group.satellites.length})</span>
        </label>
        <button type="button" class="btn-sm">Delete</button>
      `;
      row.querySelector("input").addEventListener("change", async (event) => {
        await apiFetch(`/api/tracking/groups/${encodeURIComponent(group.name)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: event.target.checked }),
        });
      });
      row.querySelector("button").addEventListener("click", async () => {
        await apiFetch(`/api/tracking/groups/${encodeURIComponent(group.name)}`, { method: "DELETE" });
        await refreshAll();
      });
      groupsList.appendChild(row);
    }
  }

  function renderTableHead() {
    headRow.innerHTML = `<th>Name</th><th>NORAD</th><th>Source</th><th>TLE age</th>`;
    for (const group of groups) {
      const th = document.createElement("th");
      th.className = "group-col";
      th.textContent = group.name;
      headRow.appendChild(th);
    }
  }

  function ageClass(days) {
    return days > 14 ? "age-stale" : "age-fresh";
  }

  function toggleSatelliteInGroup(norad, name, groupName, checkbox) {
    return async () => {
      checkbox.disabled = true;
      try {
        if (checkbox.checked) {
          await apiFetch(`/api/tracking/groups/${encodeURIComponent(groupName)}/satellites`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ norad, name }),
          });
        } else {
          await apiFetch(`/api/tracking/groups/${encodeURIComponent(groupName)}/satellites/${norad}`, {
            method: "DELETE",
          });
        }
        // Re-render the whole table, not just the compact group list --
        // another tab/session could have added or removed a group since
        // this table was last drawn, and a stale set of columns would
        // silently hide membership in groups that aren't shown yet.
        await loadGroups();
        renderGroupsList();
        renderTableHead();
        renderTableBody();
      } finally {
        checkbox.disabled = false;
      }
    };
  }

  function renderTableBody() {
    body.innerHTML = "";
    countEl.textContent = `${satellites.length} shown`;
    for (const sat of satellites) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(sat.name)}</td>
        <td>${sat.norad}</td>
        <td>${escapeHtml(sat.source)}</td>
        <td class="${ageClass(sat.epoch_days_old)}">${sat.epoch_days_old.toFixed(1)}d</td>
      `;
      const memberOf = membership.get(sat.norad) || new Set();
      for (const group of groups) {
        const td = document.createElement("td");
        td.className = "group-col";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = memberOf.has(group.name);
        checkbox.addEventListener("change", toggleSatelliteInGroup(sat.norad, sat.name, group.name, checkbox));
        td.appendChild(checkbox);
        row.appendChild(td);
      }
      body.appendChild(row);
    }
  }

  async function refreshAll() {
    await Promise.all([loadGroups(), loadSources(), loadSatellites()]);
    renderGroupsList();
    renderTableHead();
    renderTableBody();
  }

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
