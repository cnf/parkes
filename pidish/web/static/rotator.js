const azEl = document.getElementById("rotator-az");
const elEl = document.getElementById("rotator-el");
const statusEl = document.getElementById("rotator-status");

function setStatus(text) {
  statusEl.textContent = text;
}

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/rotator/ws`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
      setStatus(`error: ${data.error}`);
      return;
    }
    azEl.textContent = data.az.toFixed(1);
    elEl.textContent = data.el.toFixed(1);
    setStatus("connected");
  };
  ws.onclose = () => {
    setStatus("disconnected, retrying...");
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
    setStatus(`error: ${await res.text()}`);
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
