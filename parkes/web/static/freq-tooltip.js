// Shared across every page: hover over any element carrying data-freq-hz="<hz>"
// to show a small popover with the frequency's band (see bands.js). Event
// delegated on `document`, mirrors satnogs-tooltip.js's approach -- pages
// just tag the element when rendering it, nothing else to wire up.
(() => {
  let tooltipEl = null;
  let showTimer = null;
  let hideTimer = null;

  function ensureTooltipEl() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "freq-tooltip";
    tooltipEl.style.display = "none";
    tooltipEl.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    tooltipEl.addEventListener("mouseleave", scheduleHide);
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function render(hz, match) {
    const el = ensureTooltipEl();
    const freqLine = `<div class="freq-tooltip-freq">${window.ParkesBands.formatMHz(hz)}</div>`;
    const bandLine = match
      ? `<span class="freq-badge c-${match.color}">${window.ParkesBands.label(match)}</span>`
      : `<div class="freq-tooltip-hint">no known allocation</div>`;
    el.innerHTML = freqLine + bandLine;
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

  function show(target) {
    const hz = Number(target.dataset.freqHz);
    if (!Number.isFinite(hz) || hz <= 0) return;
    render(hz, window.ParkesBands.detect(hz));
    position(target);
  }

  function hide() {
    if (tooltipEl) tooltipEl.style.display = "none";
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 150);
  }

  document.addEventListener("mouseover", (event) => {
    const target = event.target.closest("[data-freq-hz]");
    if (!target) return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(target), 350);
  });

  document.addEventListener("mouseout", (event) => {
    const target = event.target.closest("[data-freq-hz]");
    if (!target) return;
    if (target.contains(event.relatedTarget)) return;
    clearTimeout(showTimer);
    scheduleHide();
  });

  document.addEventListener("scroll", hide, true);
})();
