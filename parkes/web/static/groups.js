(() => {
  const groupsList = document.getElementById("groups-list");
  const newGroupForm = document.getElementById("new-group-form");
  const newGroupName = document.getElementById("new-group-name");

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

  async function refreshGroups() {
    const groups = await apiFetch("/api/tracking/groups");
    groupsList.innerHTML = "";
    for (const group of groups) {
      groupsList.appendChild(renderGroup(group));
    }
  }

  function renderGroup(group) {
    const block = document.createElement("div");
    block.className = "group-block";

    const header = document.createElement("div");
    header.className = "group-header";
    header.innerHTML = `
      <label>
        <input type="checkbox" ${group.enabled ? "checked" : ""} />
        ${escapeHtml(group.name)} (${group.satellites.length})
      </label>
      <button type="button" class="btn-sm">Delete</button>
    `;
    header.querySelector("input").addEventListener("change", async (event) => {
      await apiFetch(`/api/tracking/groups/${encodeURIComponent(group.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: event.target.checked }),
      });
    });
    header.querySelector("button").addEventListener("click", async () => {
      await apiFetch(`/api/tracking/groups/${encodeURIComponent(group.name)}`, { method: "DELETE" });
      refreshGroups();
    });
    block.appendChild(header);

    const chips = document.createElement("div");
    chips.className = "chip-list";
    for (const sat of group.satellites) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `${escapeHtml(sat.name)} <button type="button">&times;</button>`;
      chip.querySelector("button").addEventListener("click", async () => {
        await apiFetch(`/api/tracking/groups/${encodeURIComponent(group.name)}/satellites/${sat.norad}`, {
          method: "DELETE",
        });
        refreshGroups();
      });
      chips.appendChild(chip);
    }
    block.appendChild(chips);

    const search = document.createElement("div");
    search.className = "group-search";
    search.innerHTML = `<input type="text" placeholder="Search satellites to add..." />`;
    const input = search.querySelector("input");
    let debounceTimer;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runSearch(input, group.name, search), 300);
    });
    block.appendChild(search);

    return block;
  }

  async function runSearch(input, groupName, container) {
    const existing = container.querySelector(".search-results");
    if (existing) existing.remove();
    const query = input.value.trim();
    if (!query) return;

    const results = await apiFetch(`/api/tracking/satellites/search?q=${encodeURIComponent(query)}`);
    const box = document.createElement("div");
    box.className = "search-results";
    if (results.length === 0) {
      box.innerHTML = `<div class="search-result-row">no matches</div>`;
    }
    for (const sat of results) {
      const row = document.createElement("div");
      row.className = "search-result-row";
      row.innerHTML = `<span>${escapeHtml(sat.name)} (${sat.norad})</span>`;
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn-sm primary";
      addBtn.textContent = "Add";
      addBtn.addEventListener("click", async () => {
        await apiFetch(`/api/tracking/groups/${encodeURIComponent(groupName)}/satellites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ norad: sat.norad, name: sat.name }),
        });
        input.value = "";
        box.remove();
        refreshGroups();
      });
      row.appendChild(addBtn);
      box.appendChild(row);
    }
    container.appendChild(box);
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
    refreshGroups();
  });

  refreshGroups();
})();
