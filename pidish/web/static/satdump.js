const satdumpStatus = document.getElementById("satdump-status");
const startBtn = document.getElementById("satdump-start-btn");
const stopBtn = document.getElementById("satdump-stop-btn");
const objectsTextarea = document.getElementById("satdump-objects");
const saveObjectsBtn = document.getElementById("satdump-save-objects-btn");
const objectsSaveStatus = document.getElementById("satdump-objects-status");
const logPre = document.getElementById("satdump-log");

async function post(path) {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) {
    satdumpStatus.textContent = `error: ${await res.text()}`;
  }
}

startBtn.addEventListener("click", () => post("/api/satdump/start"));
stopBtn.addEventListener("click", () => post("/api/satdump/stop"));

async function loadObjects() {
  const res = await fetch("/api/satdump/objects");
  objectsTextarea.value = JSON.stringify(await res.json(), null, 2);
}

saveObjectsBtn.addEventListener("click", async () => {
  let parsed;
  try {
    parsed = JSON.parse(objectsTextarea.value);
  } catch (err) {
    objectsSaveStatus.textContent = `invalid JSON: ${err.message}`;
    return;
  }
  const res = await fetch("/api/satdump/objects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed),
  });
  objectsSaveStatus.textContent = res.ok ? "saved" : `error: ${await res.text()}`;
});

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/satdump/ws`);
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.line !== undefined) {
      logPre.textContent += data.line + "\n";
      logPre.scrollTop = logPre.scrollHeight;
    }
    if (data.running !== undefined) {
      satdumpStatus.textContent = data.running ? "running" : "stopped";
      startBtn.disabled = data.running;
      stopBtn.disabled = !data.running;
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => ws.close();
}

loadObjects();
connect();
