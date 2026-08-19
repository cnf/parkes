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

  async function refreshGroundTracks() {
    const res = await fetch("/api/tracking/groundtracks");
    const sats = await res.json();

    tracksGroup.innerHTML = "";
    footprintsGroup.innerHTML = "";
    subpointsGroup.innerHTML = "";

    for (const sat of sats) {
      const track = document.createElementNS(svgNS, "path");
      track.setAttribute("class", "wm-track");
      track.setAttribute("d", pathFromLatLon(sat.track, false));
      tracksGroup.appendChild(track);

      if (sat.footprint.length > 0) {
        const footprint = document.createElementNS(svgNS, "path");
        footprint.setAttribute("class", "wm-footprint");
        footprint.setAttribute("d", pathFromLatLon(sat.footprint, true));
        footprintsGroup.appendChild(footprint);
      }

      const p = project(sat.subpoint.lat, sat.subpoint.lon);
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("class", "wm-subpoint");
      dot.setAttribute("r", 1.4);
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);
      subpointsGroup.appendChild(dot);

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("class", "wm-subpoint-label");
      label.setAttribute("x", p.x + 2.2);
      label.setAttribute("y", p.y - 1.5);
      label.textContent = sat.name;
      subpointsGroup.appendChild(label);
    }
  }

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
  loadLand();
  refreshObserver();
  refreshGroundTracks();
  refreshNextPass();
  setInterval(refreshGroundTracks, 20000);
  setInterval(refreshNextPass, 20000);
  setInterval(tickNext, 1000);

  // Same hook tracking.js/pass-plot.js use when the observer location
  // changes on the Settings modal.
  window.addEventListener("parkes:location-changed", refreshObserver);
})();
