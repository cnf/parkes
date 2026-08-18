(() => {
  const rotatorEl = document.getElementById("header-rotator-status");
  const gpsdEl = document.getElementById("header-gpsd-status");
  if (!rotatorEl || !gpsdEl) return; // header markup not present on this page for some reason

  function setState(wrapperEl, label, ok) {
    const icon = wrapperEl.querySelector(".header-status-icon");
    icon.classList.toggle("ok", ok === true);
    icon.classList.toggle("error", ok === false);
    wrapperEl.title = `${label}: ${ok === true ? "connected" : ok === false ? "unreachable" : "checking..."}`;
  }

  async function poll() {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setState(rotatorEl, "Rotator", data.rotctld);
      setState(gpsdEl, "GPS", data.gpsd);
    } catch {
      setState(rotatorEl, "Rotator", null);
      setState(gpsdEl, "GPS", null);
    }
  }

  poll();
  setInterval(poll, 7000);
})();
