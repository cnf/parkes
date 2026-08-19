(() => {
  const RADIUS = 85; // matches the SVG viewBox's ring radii

  // az=0 (north) at the top, clockwise, matching the N/E/S/W labels drawn
  // around the ring. el=90 (zenith) at the center; el=0 on the outer ring;
  // negative el (below horizon) projects past it and gets clipped by the
  // <clipPath> in index.html, the same way the reference plot's pre-AOS
  // trajectory runs off the edge of the frame.
  function projectAzEl(az, el) {
    const r = (RADIUS * (90 - el)) / 90;
    const a = (az * Math.PI) / 180;
    return { x: r * Math.sin(a), y: -r * Math.cos(a) };
  }

  function pathFromPoints(points) {
    if (points.length === 0) return "";
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }

  const els = {
    card: document.getElementById("pass-plot-card"),
    targetLabel: document.getElementById("pass-plot-target"),
    name: document.getElementById("pass-plot-name"),
    az: document.getElementById("pass-plot-az"),
    el: document.getElementById("pass-plot-el"),
    countdownLab: document.getElementById("pass-plot-countdown-lab"),
    countdown: document.getElementById("pass-plot-countdown"),
    note: document.getElementById("pass-plot-note"),
    empty: document.getElementById("pass-plot-empty"),
    trackPast: document.getElementById("pass-plot-track-past"),
    trackFuture: document.getElementById("pass-plot-track-future"),
    aos: document.getElementById("pass-plot-aos"),
    los: document.getElementById("pass-plot-los"),
    nowPulse: document.getElementById("pass-plot-now-pulse"),
    now: document.getElementById("pass-plot-now"),
  };

  if (!els.card) return; // not on this page

  let currentId = null;
  let currentTrack = null; // { aos, los, max_elevation, unbounded, points: [{az, el}] }

  function fmtCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  function showEmpty() {
    els.empty.style.display = "";
    els.name.textContent = "--";
    els.targetLabel.textContent = "--";
    els.az.textContent = "--";
    els.el.textContent = "--";
    els.countdownLab.textContent = "AOS in";
    els.countdown.textContent = "--:--:--";
    els.note.textContent = "";
    for (const marker of [els.aos, els.los, els.now, els.nowPulse]) marker.style.display = "none";
    els.trackPast.setAttribute("d", "");
    els.trackFuture.setAttribute("d", "");
    currentId = null;
    currentTrack = null;
  }

  // Picks the same target the "Track" table would highlight as current --
  // falling back to the soonest genuine (non-synthesized) upcoming pass
  // when nothing is actively being tracked. Mirrors tracking.js's
  // upNextId()/applyHighlights() matching-by-name, since
  // TrackingScheduler.active_target is a display name, not a "sat:NNNNN"
  // id (see tracking.js for why).
  async function pickTarget() {
    const [statusRes, targetsRes, passesRes] = await Promise.all([
      fetch("/api/tracking/status"),
      fetch("/api/tracking/targets"),
      fetch("/api/tracking/passes"),
    ]);
    const status = await statusRes.json();
    const targets = await targetsRes.json();
    const passes = await passesRes.json();
    const passesById = new Map(passes.map((p) => [p.id, p]));

    if (status.active_target) {
      const match = targets.find((t) => t.kind === "satellite" && t.name === status.active_target);
      if (match && passesById.has(match.id)) return { id: match.id, name: match.name };
    }
    for (const pass of passes) {
      if (!pass.synthesized) return { id: pass.id, name: pass.name };
    }
    return null;
  }

  function renderTrack(track) {
    const points = track.points.map((p) => projectAzEl(p.az, p.el));
    const aosPt = points[0];
    const losPt = points[points.length - 1];
    els.aos.style.display = "";
    els.los.style.display = "";
    els.aos.setAttribute("cx", aosPt.x);
    els.aos.setAttribute("cy", aosPt.y);
    els.los.setAttribute("cx", losPt.x);
    els.los.setAttribute("cy", losPt.y);

    const now = Date.now();
    const aosMs = new Date(track.aos).getTime();
    const losMs = new Date(track.los).getTime();
    const frac = Math.max(0, Math.min(1, (now - aosMs) / (losMs - aosMs)));
    const splitIdx = Math.round(frac * (points.length - 1));

    els.trackPast.setAttribute("d", pathFromPoints(points.slice(0, splitIdx + 1)));
    els.trackFuture.setAttribute("d", pathFromPoints(points.slice(splitIdx)));
    els.note.textContent = `Max elevation ${track.max_elevation.toFixed(0)}°`;
  }

  function renderNow(az, el) {
    const p = projectAzEl(az, el);
    els.now.style.display = "";
    els.nowPulse.style.display = "";
    els.now.setAttribute("cx", p.x);
    els.now.setAttribute("cy", p.y);
    els.nowPulse.setAttribute("cx", p.x);
    els.nowPulse.setAttribute("cy", p.y);
    els.az.textContent = az.toFixed(1);
    els.el.textContent = el.toFixed(1);
  }

  function tickCountdown() {
    if (!currentTrack) return;
    const now = Date.now();
    const aosMs = new Date(currentTrack.aos).getTime();
    const losMs = new Date(currentTrack.los).getTime();
    if (now < aosMs) {
      els.countdownLab.textContent = "AOS in";
      els.countdown.textContent = fmtCountdown(aosMs - now);
    } else if (currentTrack.unbounded) {
      els.countdownLab.textContent = "Always visible";
      els.countdown.textContent = "--:--:--";
    } else {
      els.countdownLab.textContent = "LOS in";
      els.countdown.textContent = fmtCountdown(losMs - now);
    }
  }

  async function refreshTarget() {
    const picked = await pickTarget();
    if (!picked) {
      showEmpty();
      return;
    }
    els.empty.style.display = "none";
    els.name.textContent = picked.name;
    els.targetLabel.textContent = picked.name;

    if (picked.id !== currentId) {
      const res = await fetch(`/api/tracking/passes/${encodeURIComponent(picked.id)}/track`);
      if (!res.ok) {
        showEmpty();
        return;
      }
      currentTrack = await res.json();
      currentId = picked.id;
    }
    // Re-render (not just on target change) so the past/future dashed
    // split keeps advancing across a long pass on every refresh tick.
    if (currentTrack) renderTrack(currentTrack);
    tickCountdown();
  }

  async function refreshLivePosition() {
    if (!currentId) return;
    const res = await fetch("/api/tracking/targets");
    const targets = await res.json();
    const match = targets.find((t) => t.id === currentId);
    if (match) renderNow(match.az, match.el);
  }

  refreshTarget();
  setInterval(refreshTarget, 15000);
  setInterval(refreshLivePosition, 5000);
  setInterval(tickCountdown, 1000);

  // Same "recompute now" hook tracking.js uses when the observer location
  // changes -- the sampled track is location-dependent too.
  window.addEventListener("parkes:location-changed", () => {
    currentId = null;
    refreshTarget();
  });
})();
