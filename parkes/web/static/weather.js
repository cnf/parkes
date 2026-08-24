(() => {
  const cloudEl = document.getElementById("weather-cloud");
  const precipEl = document.getElementById("weather-precip");
  const humidityEl = document.getElementById("weather-humidity");
  const windEl = document.getElementById("weather-wind");
  const tempEl = document.getElementById("weather-temp");
  const updatedEl = document.getElementById("weather-updated");
  const errorEl = document.getElementById("weather-error");

  const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // matches the server-side cache TTL

  function fmt(value, digits = 0) {
    return value === null || value === undefined ? "--" : Number(value).toFixed(digits);
  }

  async function refresh() {
    try {
      const res = await fetch("/api/weather");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      cloudEl.textContent = fmt(data.cloud_cover_pct);
      precipEl.textContent = fmt(data.precipitation_mm, 1);
      humidityEl.textContent = fmt(data.humidity_pct);
      windEl.textContent = fmt(data.wind_speed_kmh, 1);
      tempEl.textContent = fmt(data.temperature_c, 1);
      errorEl.style.display = "none";
      if (data.time) {
        const asOf = new Date(data.time);
        updatedEl.textContent = Number.isNaN(asOf.getTime())
          ? ""
          : `as of ${asOf.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      }
    } catch (err) {
      errorEl.textContent = `weather unavailable: ${err.message}`;
      errorEl.style.display = "";
    }
  }

  refresh();
  setInterval(refresh, REFRESH_INTERVAL_MS);
})();
