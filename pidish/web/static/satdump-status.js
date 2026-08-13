(() => {
  const statusEl = document.getElementById("satdump-status");
  const dotEl = document.getElementById("satdump-dot");
  const lastLineEl = document.getElementById("satdump-last-line");

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/satdump/ws`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.line !== undefined) {
        lastLineEl.textContent = data.line;
      }
      if (data.running !== undefined) {
        statusEl.textContent = data.running ? "running" : "stopped";
        dotEl.classList.toggle("on", data.running);
      }
    };
    ws.onclose = () => setTimeout(connect, 2000);
    ws.onerror = () => ws.close();
  }

  connect();
})();
