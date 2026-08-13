(() => {
  const headingEl = document.getElementById("rotator-heading");
  const elEl = document.getElementById("rotator-el");
  const statusEl = document.getElementById("rotator-status");
  const dotEl = document.getElementById("rotator-dot");
  const ticksEl = document.getElementById("compass-ticks");
  const dishGroupEl = document.getElementById("elevation-dish-group");
  const ELEVATION_PIVOT = "60 140";

  const CARDINALS = { 0: "N", 90: "E", 180: "S", 270: "W" };
  const PX_PER_DEG = 6;
  const TICK_STEP = 10;
  const HALF_RANGE = 70;

  function renderCompass(heading) {
    ticksEl.innerHTML = "";
    const start = Math.ceil((heading - HALF_RANGE) / TICK_STEP) * TICK_STEP;
    const end = heading + HALF_RANGE;
    for (let deg = start; deg <= end; deg += TICK_STEP) {
      const normalized = ((deg % 360) + 360) % 360;
      const isCardinal = normalized % 90 === 0;
      const isMajor = normalized % 30 === 0;

      const tick = document.createElement("div");
      tick.className = "compass-tick" + (isCardinal ? " cardinal" : isMajor ? " major" : "");
      tick.style.left = `calc(50% + ${(deg - heading) * PX_PER_DEG}px)`;

      const line = document.createElement("div");
      line.className = "line";
      tick.appendChild(line);

      if (isMajor) {
        const label = document.createElement("div");
        label.className = "label";
        label.textContent = isCardinal ? CARDINALS[normalized] : String(normalized).padStart(3, "0");
        tick.appendChild(label);
      }

      ticksEl.appendChild(tick);
    }
  }

  function setStatus(text, dotState) {
    statusEl.textContent = text;
    dotEl.classList.toggle("on", dotState === "on");
    dotEl.classList.toggle("error", dotState === "error");
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/rotator/ws`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        setStatus(`error: ${data.error}`, "error");
        return;
      }
      headingEl.textContent = data.az.toFixed(1);
      elEl.textContent = data.el.toFixed(1);
      renderCompass(data.az);
      dishGroupEl.setAttribute("transform", `rotate(${-data.el} ${ELEVATION_PIVOT})`);
      setStatus("connected", "on");
    };
    ws.onclose = () => {
      setStatus("disconnected, retrying...", "error");
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
  }

  async function post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      setStatus(`error: ${await res.text()}`, "error");
    }
  }

  document.getElementById("goto-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const az = parseFloat(document.getElementById("goto-az").value);
    const el = parseFloat(document.getElementById("goto-el").value);
    post("/api/rotator/goto", { az, el });
  });

  document.getElementById("park-btn").addEventListener("click", () => {
    post("/api/rotator/park");
  });

  for (const btn of document.querySelectorAll("[data-jog]")) {
    const direction = btn.dataset.jog;
    const start = (event) => {
      event.preventDefault();
      post("/api/rotator/move", { direction });
    };
    const stop = () => post("/api/rotator/stop");
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointerleave", stop);
  }

  connect();
})();
