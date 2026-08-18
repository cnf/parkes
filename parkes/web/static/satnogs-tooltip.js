// Shared across every page: hover over any element carrying
// data-satnogs-norad="<norad>" to show a small popover with SatNOGS DB
// info (name/status/alt names) and a link to the satellite's SatNOGS DB
// page. Event-delegated on `document` so pages don't need to call
// anything -- just tag the element when rendering it.
(() => {
  const cache = new Map(); // norad (string) -> satellite info object, or null if not found
  let tooltipEl = null;
  let showTimer = null;
  let hideTimer = null;
  let activeNorad = null;

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function ensureTooltipEl() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "satnogs-tooltip";
    tooltipEl.style.display = "none";
    tooltipEl.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    tooltipEl.addEventListener("mouseleave", scheduleHide);
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function statusClass(status) {
    if (status === "alive") return "satnogs-status-alive";
    if (status === "dead" || status === "re-entered") return "satnogs-status-dead";
    return "satnogs-status-unknown";
  }

  function render(norad, info) {
    const el = ensureTooltipEl();
    const url = `https://db.satnogs.org/satellite/${encodeURIComponent(norad)}/`;
    let body;
    if (info === undefined) {
      body = `<div class="satnogs-tooltip-hint">looking up...</div>`;
    } else if (info === null) {
      body = `<div class="satnogs-tooltip-hint">not found in SatNOGS DB</div>`;
    } else {
      const namesLine = info.names
        ? `<div class="satnogs-tooltip-names">aka ${escapeHtml(info.names)}</div>`
        : "";
      body = `
        <div class="satnogs-tooltip-name">${escapeHtml(info.name || "")}</div>
        <div class="satnogs-tooltip-status">
          <span class="satnogs-status-dot ${statusClass(info.status)}"></span>${escapeHtml(info.status || "unknown")}
        </div>
        ${namesLine}
      `;
    }
    el.innerHTML = `${body}<a class="satnogs-tooltip-link" href="${url}" target="_blank" rel="noopener">View on SatNOGS DB ↗</a>`;
  }

  function position(target) {
    const el = ensureTooltipEl();
    el.style.display = "block";
    const rect = target.getBoundingClientRect();
    const tipRect = el.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.left;
    if (left + tipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tipRect.width - 8;
    }
    if (top + tipRect.height > window.innerHeight - 8) {
      top = rect.top - tipRect.height - 6;
    }
    el.style.top = `${Math.max(8, top)}px`;
    el.style.left = `${Math.max(8, left)}px`;
  }

  async function show(target) {
    const norad = target.dataset.satnogsNorad;
    if (!norad) return;
    activeNorad = norad;
    render(norad, cache.get(norad));
    position(target);

    if (!cache.has(norad)) {
      let match = null;
      try {
        const res = await fetch(`/api/satnogs/satellites?q=${encodeURIComponent(norad)}`);
        const results = res.ok ? await res.json() : [];
        match = results.find((s) => String(s.norad) === String(norad)) || null;
      } catch {
        match = null;
      }
      cache.set(norad, match);
      if (activeNorad === norad) {
        render(norad, match);
        position(target);
      }
    }
  }

  function hide() {
    activeNorad = null;
    if (tooltipEl) tooltipEl.style.display = "none";
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 150);
  }

  document.addEventListener("mouseover", (event) => {
    const target = event.target.closest("[data-satnogs-norad]");
    if (!target) return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(target), 350);
  });

  document.addEventListener("mouseout", (event) => {
    const target = event.target.closest("[data-satnogs-norad]");
    if (!target) return;
    if (target.contains(event.relatedTarget)) return;
    clearTimeout(showTimer);
    scheduleHide();
  });

  document.addEventListener("scroll", hide, true);
})();
