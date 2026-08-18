// Shared frequency -> band lookup, used both for the live badge shown next
// to editable Hz inputs and for the hover tooltip on read-only frequency
// text (see freq-tooltip.js). Deliberately approximate -- real-world
// allocations vary by region and licence, this is a quick-glance label, not
// a regulatory reference. When multiple ranges match (e.g. an ISM band
// sitting inside a broader amateur segment), the narrowest one wins, same
// idea as picking the most specific match.
(() => {
  // [minMHz, maxMHz, band, tag|null]
  const RANGES = [
    [3, 30, "HF", null],
    [30, 300, "VHF", null],
    [87.5, 108, "VHF", "broadcast"],
    [108, 137, "VHF", "airband"],
    [137, 138, "VHF", "weather sat"],
    [144, 148, "VHF", "2m"],
    [156, 162, "VHF", "marine"],
    [300, 1000, "UHF", null],
    [400, 403, "UHF", "weather sat"],
    [420, 450, "UHF", "70cm"],
    [433.05, 434.79, "UHF", "ISM"],
    [868, 868.6, "UHF", "ISM"],
    [902, 928, "UHF", "ISM"],
    [960, 1215, "UHF", "aero nav"],
    [1000, 2000, "L-band", null],
    [1176, 1300, "L-band", "GNSS"],
    [1240, 1300, "L-band", "23cm"],
    [1565, 1585, "L-band", "GNSS"],
    [1616, 1626.5, "L-band", "Iridium"],
    [1690, 1710, "L-band", "weather sat"],
    [2000, 4000, "S-band", null],
    [2300, 2450, "S-band", "13cm"],
    [2400, 2483.5, "S-band", "ISM"],
    [4000, 8000, "C-band", null],
    [8000, 12000, "X-band", null],
    [12000, 18000, "Ku-band", null],
    [18000, 27000, "K-band", null],
    [26500, 40000, "Ka-band", null],
  ];

  // Roughly groups the general bands into a handful of hues -- families
  // that behave similarly (satellite comms bands vs. terrestrial VHF/UHF
  // vs. GNSS-and-below) share a color rather than every band getting its
  // own, which would be more colors than are worth telling apart at a
  // glance.
  const COLORS = {
    HF: "gray",
    VHF: "amber",
    UHF: "amber",
    "L-band": "blue",
    "S-band": "blue",
    "C-band": "teal",
    "X-band": "teal",
    "Ku-band": "purple",
    "K-band": "purple",
    "Ka-band": "purple",
  };

  function detect(hz) {
    if (!Number.isFinite(hz) || hz <= 0) return null;
    const mhz = hz / 1e6;
    const matches = RANGES.filter(([min, max]) => mhz >= min && mhz <= max);
    if (matches.length === 0) return null;
    matches.sort((a, b) => a[1] - a[0] - (b[1] - b[0]));
    const [, , band, tag] = matches[0];
    return { band, tag, color: COLORS[band] || "gray" };
  }

  function label(match) {
    return match.tag ? `${match.band} · ${match.tag}` : match.band;
  }

  function formatMHz(hz) {
    return (hz / 1e6).toFixed(3).replace(/\.?0+$/, "") + " MHz";
  }

  // The general (untagged) ranges only -- for a band reference table, not
  // for detection, so the ISM/amateur/etc. sub-ranges that overlap them
  // don't show up twice.
  function generalBands() {
    return RANGES.filter(([, , , tag]) => tag === null).map(([min, max, band]) => ({
      band,
      min,
      max,
      color: COLORS[band] || "gray",
    }));
  }

  window.ParkesBands = { detect, label, formatMHz, generalBands };
})();
