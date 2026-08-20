(() => {
  const svg = document.getElementById("world-map-svg");
  if (!svg) return;

  const svgNS = "http://www.w3.org/2000/svg";
  const landPath = document.getElementById("world-map-land");
  const graticule = document.getElementById("world-map-graticule");
  const tracksGroup = document.getElementById("world-map-tracks");
  const footprintsGroup = document.getElementById("world-map-footprints");
  const subpointsGroup = document.getElementById("world-map-subpoints");
  const observerDot = document.getElementById("world-map-observer");
  const observerLabel = document.getElementById("world-map-observer-label");
  const nextLabel = document.getElementById("world-map-next");

  // Plain equirectangular: x = longitude, y = -latitude, matching the
  // svg's viewBox="-180 -90 360 180" one-to-one -- no separate projection
  // math needed for this one.
  function project(lat, lon) {
    return { x: lon, y: -lat };
  }

  // Splits into a new subpath wherever consecutive points cross the
  // antimeridian (a >180 degree jump in longitude) instead of drawing a
  // spurious line straight across the map -- the same thing ground-track
  // plots conventionally do at the dateline.
  function pathFromLatLon(points, closed) {
    if (points.length === 0) return "";
    let d = "";
    let prevLon = null;
    for (let i = 0; i < points.length; i++) {
      const { lat, lon } = points[i];
      const p = project(lat, lon);
      const newSubpath = prevLon !== null && Math.abs(lon - prevLon) > 180;
      d += `${i === 0 || newSubpath ? "M" : "L"} ${p.x.toFixed(2)},${p.y.toFixed(2)} `;
      prevLon = lon;
    }
    return closed ? d.trim() + " Z" : d.trim();
  }

  function buildGraticule() {
    for (let lon = -150; lon <= 150; lon += 30) {
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("class", "wm-graticule");
      line.setAttribute("x1", lon);
      line.setAttribute("y1", -90);
      line.setAttribute("x2", lon);
      line.setAttribute("y2", 90);
      graticule.appendChild(line);

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("class", "wm-graticule-label");
      label.setAttribute("x", lon);
      label.setAttribute("y", 87);
      label.setAttribute("text-anchor", "middle");
      label.textContent = `${lon}°`;
      graticule.appendChild(label);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("class", "wm-graticule");
      line.setAttribute("x1", -180);
      line.setAttribute("y1", -lat);
      line.setAttribute("x2", 180);
      line.setAttribute("y2", -lat);
      graticule.appendChild(line);

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("class", "wm-graticule-label");
      label.setAttribute("x", -178);
      label.setAttribute("y", -lat - 1.5);
      label.textContent = `${lat}°`;
      graticule.appendChild(label);
    }
  }

  // Label font-size scales with the SVG's own coordinate system (the
  // viewBox), so a fixed "5px" reads fine at one card width and is either
  // a speck or oversized at another -- the map gets resized a lot, being
  // one of the widgets the dashboard layout editor can span/merge freely.
  // --wm-px is "how many user-units equal one real screen pixel" right
  // now; every label's font-size is that times its target pixel size (see
  // style.css), so the *rendered* size stays constant across widths
  // instead of the user-unit size staying constant.
  function updateTextScale() {
    const width = svg.getBoundingClientRect().width;
    if (width > 0) svg.style.setProperty("--wm-px", (360 / width).toFixed(4));
  }
  // Belt and suspenders: ResizeObserver is the immediate/precise path, a
  // plain window resize listener is a second one, and refreshGroundTracks'
  // 20s interval below also calls this as a floor -- so the dashboard
  // layout editor resizing/merging/spanning this card (which isn't a
  // window resize at all) still self-corrects shortly either way, even in
  // a browser/embedding where ResizeObserver on this element doesn't fire.
  new ResizeObserver(updateTextScale).observe(svg.parentElement);
  window.addEventListener("resize", updateTextScale);

  async function loadLand() {
    const res = await fetch("/static/world-land.svgpath");
    landPath.setAttribute("d", await res.text());
  }

  async function refreshObserver() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const loc = data.effective_location;
    if (!loc) return;
    const p = project(loc.lat, loc.lon);
    observerDot.setAttribute("cx", p.x);
    observerDot.setAttribute("cy", p.y);
    observerDot.style.display = "";
    observerLabel.setAttribute("x", p.x + 2.5);
    observerLabel.setAttribute("y", p.y - 2);
    observerLabel.textContent = "Observer";
    observerLabel.style.display = "";
  }

  // Same target the "Track" table highlights as current, plus whichever
  // satellite is next up -- mirrors pass-plot.js's pickTarget() for the
  // "current" half (see its comment on why active_target needs matching
  // by name, not id). Everything else's track/footprint stays dim by
  // default (see refreshGroundTracks) rather than every enabled
  // satellite's ground track and footprint overlapping at full opacity,
  // which is unreadable once more than two or three are enabled.
  async function resolveFocusIds() {
    const [statusRes, targetsRes, passesRes] = await Promise.all([
      fetch("/api/tracking/status"),
      fetch("/api/tracking/targets"),
      fetch("/api/tracking/passes"),
    ]);
    const status = await statusRes.json();
    const targets = await targetsRes.json();
    const passes = await passesRes.json();

    let currentId = null;
    if (status.active_target) {
      const match = targets.find((t) => t.kind === "satellite" && t.name === status.active_target);
      if (match) currentId = match.id;
    }
    const next = passes.find((p) => !p.synthesized && p.id !== currentId);
    return { currentId, nextId: next ? next.id : null };
  }

  async function refreshGroundTracks() {
    const [res, focus] = await Promise.all([fetch("/api/tracking/groundtracks"), resolveFocusIds()]);
    const sats = await res.json();

    tracksGroup.innerHTML = "";
    footprintsGroup.innerHTML = "";
    subpointsGroup.innerHTML = "";

    for (const sat of sats) {
      const focused = sat.id === focus.currentId || sat.id === focus.nextId;

      const track = document.createElementNS(svgNS, "path");
      track.setAttribute("class", "wm-track" + (focused ? " wm-focused" : ""));
      track.setAttribute("data-sat-id", sat.id);
      track.setAttribute("d", pathFromLatLon(sat.track, false));
      tracksGroup.appendChild(track);

      if (sat.footprint.length > 0) {
        const footprint = document.createElementNS(svgNS, "path");
        footprint.setAttribute("class", "wm-footprint");
        footprint.setAttribute("data-sat-id", sat.id);
        footprint.setAttribute("d", pathFromLatLon(sat.footprint, true));
        footprintsGroup.appendChild(footprint);
      }

      const p = project(sat.subpoint.lat, sat.subpoint.lon);
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("class", "wm-subpoint");
      dot.setAttribute("data-sat-id", sat.id);
      dot.setAttribute("r", 1.4);
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);
      subpointsGroup.appendChild(dot);

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("class", "wm-subpoint-label");
      label.setAttribute("data-sat-id", sat.id);
      label.setAttribute("x", p.x + 2.2);
      label.setAttribute("y", p.y - 1.5);
      label.textContent = sat.name;
      subpointsGroup.appendChild(label);
    }
  }

  // A satellite's track/footprint/subpoint/label are siblings across three
  // separate <g> groups (drawn in that stacking order so tracks sit under
  // footprints sit under subpoints), not nested under one shared parent --
  // so CSS :hover + sibling selectors can't reach across them. Delegating
  // one pair of listeners on the whole SVG and matching by data-sat-id
  // covers all four regardless of which one the pointer is actually over.
  svg.addEventListener("mouseover", (event) => {
    const target = event.target.closest("[data-sat-id]");
    if (!target) return;
    const id = target.dataset.satId;
    for (const el of svg.querySelectorAll(`[data-sat-id="${CSS.escape(id)}"]`)) {
      el.classList.add("wm-hover");
    }
  });
  svg.addEventListener("mouseout", (event) => {
    const target = event.target.closest("[data-sat-id]");
    if (!target) return;
    if (target.contains(event.relatedTarget)) return;
    const id = target.dataset.satId;
    for (const el of svg.querySelectorAll(`[data-sat-id="${CSS.escape(id)}"]`)) {
      el.classList.remove("wm-hover");
    }
  });

  // Fetched occasionally (see setInterval below); tickNext() re-renders
  // the countdown from this cache every second without hammering the
  // passes endpoint, same split as pass-plot.js's countdown.
  let nextPass = null;

  async function refreshNextPass() {
    const res = await fetch("/api/tracking/passes");
    const passes = await res.json();
    const next = passes.find((p) => !p.synthesized);
    nextPass = next ? { name: next.name, aos: next.aos } : null;
    tickNext();
  }

  function tickNext() {
    if (!nextPass) {
      nextLabel.textContent = "--";
      return;
    }
    const totalSec = Math.max(0, Math.floor((new Date(nextPass.aos).getTime() - Date.now()) / 1000));
    const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    nextLabel.textContent = `Next: ${nextPass.name} in ${h}:${m}:${s}`;
  }

  buildGraticule();
  updateTextScale();
  loadLand();
  refreshObserver();
  refreshGroundTracks();
  refreshNextPass();
  setInterval(refreshGroundTracks, 20000);
  setInterval(updateTextScale, 20000);
  setInterval(refreshNextPass, 20000);
  setInterval(tickNext, 1000);

  // Same hook tracking.js/pass-plot.js use when the observer location
  // changes on the Settings modal.
  window.addEventListener("parkes:location-changed", refreshObserver);
})();
