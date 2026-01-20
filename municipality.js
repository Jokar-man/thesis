mapboxgl.accessToken = "pk.eyJ1IjoibGFrc2htaS1kYmYxNSIsImEiOiJjbWdnYWM4cTYwZ2czMmtzY3k0cHlrZTA0In0.AwWDdoOtmRZNAXz1s4yQxw";

// ---------------- CONSTANTS ----------------
const CENTER = [2.1734, 41.3851]; // Plaça Catalunya
let points = null;
let stats = {};
let activeFields = [];
let centerFocusKm = 10;
let cadastralData = null;

const rankContainer = document.getElementById("rank-popup");

// ---------------- DISTANCE ----------------
function getDistance(coord1, coord2) {
  const R = 6371;
  const lat1 = coord1[1];
  const lon1 = coord1[0];
  const lat2 = coord2[1];
  const lon2 = coord2[0];

  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
}

// ---------------- MAP INIT ----------------
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: CENTER,
  zoom: 12.8,
  pitch: 60,
  bearing: -20,
  antialias: true,
  minZoom: 10,
  maxZoom: 18
});

map.on("load", async () => {

  // ---------- CADASTRAL 3D ----------
  try {
    cadastralData = await fetch("data/barcelona_buildings.geojson").then(r => r.json());
    map.addSource("cadastral-buildings-source", {
      type: "geojson",
      data: cadastralData
    });

    map.addLayer({
      id: "3d-cadastral",
      type: "fill-extrusion",
      source: "cadastral-buildings-source",
      paint: {
        "fill-extrusion-color": "#00eaff",
        "fill-extrusion-height": ["*", ["get", "numberOfFloorsAboveGround"], 3.5],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.28
      }
    }, "waterway-label");
  } catch (err) {
    console.error("Could not load cadastral buildings:", err);
  }

  // ---------- MAPBOX DEFAULT 3D ----------
  map.addLayer({
    id: "3d-mapbox-default",
    source: "composite",
    "source-layer": "building",
    filter: ["all", ["has", "height"], ["has", "min_height"]],
    type: "fill-extrusion",
    minzoom: 13,
    paint: {
      "fill-extrusion-color": "#00eaff",
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": ["get", "min_height"],
      "fill-extrusion-opacity": 0.1
    }
  }, "waterway-label");

  map.getStyle().layers.forEach(layer => {
    if (layer.type === "symbol") {
      map.removeLayer(layer.id);
    }
  });

  // ---------- LOAD MUNICIPALITY POINTS ----------
  try {
    points = await fetch("data/data.geojson").then(r => r.json());
  } catch (err) {
    console.error("Could not load data.geojson:", err);
    alert("ERROR: data/data.geojson not found.");
    return;
  }

  computeStats();

  map.addSource("points", { type: "geojson", data: points });

  // ---------- GLOW HALO ----------
  map.addLayer({
    id: "glow-halo",
    type: "circle",
    source: "points",
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 5,
        16, 25
      ],
      "circle-color": [
        "interpolate", ["linear"], ["get", "_value"],
        0, "rgba(0,120,255,0)",
        0.1, "rgba(0,120,255,0.12)",
        0.5, "rgba(0,255,180,0.18)",
        0.8, "rgba(255,220,0,0.24)",
        1, "rgba(255,0,80,0.32)"
      ],
      "circle-blur": 0.8,
      "circle-opacity": 1
    }
  });

  // ---------- GLOW CORE ----------
  map.addLayer({
    id: "glow-core",
    type: "circle",
    source: "points",
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 2,
        16, 8
      ],
      "circle-color": [
        "interpolate", ["linear"], ["get", "_value"],
        0.0, "rgba(50,50,50,0)",
        0.2, "rgb(0,120,255)",
        0.5, "rgb(0,255,180)",
        0.8, "rgb(255,220,0)",
        1.0, "rgb(255,0,80)"
      ],
      "circle-opacity": 0.7
    }
  });

  setupButtons();
  setupInfoModal();
  updateVisualization();
});

// ---------------- STATS ----------------
function computeStats() {
  const fields = { heat: [], SPEI: [], pop_sex3: [], immigrant1: [], income1: [] };

  points.features.forEach(f => {
    const p = f.properties;
    const heat = (p.LST1 + p.uhi2) / 2;

    fields.heat.push(heat);
    fields.SPEI.push(p.SPEI || 0);
    fields.pop_sex3.push(p.pop_sex3 || 0);
    fields.immigrant1.push(p.immigrant1 || 0);
    fields.income1.push(p.income1 || 0);
  });

  Object.keys(fields).forEach(k => {
    const arr = fields[k].filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
    const n = arr.length;
    if (n === 0) {
      stats[k] = { min: 0, max: 1, range: 1 };
      return;
    }
    stats[k] = {
      min: arr[Math.floor(n * 0.05)] || 0,
      max: arr[Math.floor(n * 0.95)] || 1
    };
    stats[k].range = Math.max(1e-6, stats[k].max - stats[k].min);
  });

  console.log("Stats computed:", stats);
}

// ---------------- NORMALIZE ----------------
function computeRaw(p, f) {
  if (f === "heat") {
    const lst = +p.LST1 || 0;
    const uhi = +p.uhi2 || 0;
    return (lst + uhi) / 2;
  }
  if (f === "income1") {
    const income = +p[f] || 0;
    return income;
  }
  return +p[f] || 0;
}

function normalize(v, f) {
  const s = stats[f];
  if (!s || s.range === 0) return 0;

  let n = (v - s.min) / s.range;
  if (f === "income1") n = 1 - n; // INVERSE income
  return Math.min(1, Math.max(0, n));
}

// ---------------- UPDATE VIS ----------------
function updateVisualization() {
  const vulnerabilityFields = activeFields;

  points.features.forEach(f => {
    let sum = 0;
    const coords = f.geometry.coordinates;
    const distanceToCenter = getDistance(CENTER, coords);

    f.properties._inFocus = distanceToCenter <= centerFocusKm;

    if (vulnerabilityFields.length === 0) {
      f.properties._value = 0;
      return;
    }

    vulnerabilityFields.forEach(k => {
      sum += normalize(computeRaw(f.properties, k), k);
    });

    f.properties._value = sum / vulnerabilityFields.length;
  });

  map.getSource("points").setData(points);
  updateRanking();
}

// ---------------- UI ----------------
function setupButtons() {
  document.querySelectorAll("#panel button[data-field]").forEach(btn => {
    btn.onclick = () => {
      const f = btn.dataset.field;
      if (activeFields.includes(f)) {
        activeFields = activeFields.filter(x => x !== f);
        btn.classList.remove("active");
      } else {
        activeFields.push(f);
        btn.classList.add("active");
      }
      updateVisualization();
    };
  });
}

function setupInfoModal() {
  const icon = document.getElementById("info-icon");
  const modal = document.getElementById("info-modal");

  icon.onclick = () => {
    modal.style.display = "block";
  };

  window.onclick = (event) => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  };
}

// ---------------- RANKING ----------------
function updateRanking() {
  rankContainer.innerHTML = "";

  const vulnerabilityFields = activeFields;

  if (!vulnerabilityFields.length) {
    rankContainer.innerHTML =
      `<div style="color:#666;font-style:italic;padding:10px;">Select a layer...</div>`;
    return;
  }

  const focusPoints = points.features.filter(f => f.properties._inFocus);

  const sortedFocusPoints = focusPoints
    .sort((a,b)=>b.properties._value - a.properties._value);

  const topRanked = [];
  const minDistanceKm = 2;

  for (const feature of sortedFocusPoints) {
    if (topRanked.length >= 5) break;

    const currentCoords = feature.geometry.coordinates;
    let isTooClose = false;

    for (const rankedFeature of topRanked) {
      const rankedCoords = rankedFeature.geometry.coordinates;
      const dist = getDistance(currentCoords, rankedCoords);
      if (dist < minDistanceKm) {
        isTooClose = true;
        break;
      }
    }

    if (!isTooClose) {
      topRanked.push(feature);
    }
  }

  topRanked.forEach((f,i) => {
    const p = f.properties;
    const card = document.createElement("div");
    card.className = "neigh-card";
    card.innerHTML = `
      <div class="neigh-title">${i+1}. ${p.N_Barri}</div>
      <div class="neigh-meta">Score: ${Math.round(p._value*100)}%</div>
      <div style="color:#aaa;font-size:12px;margin-top:6px;">
        <b>${p.FAMILIA || ""}</b><br>${p.Descripcio || ""}
      </div>
    `;

    card.onclick = () => {
      const c = f.geometry.coordinates;
      map.flyTo({center:c, zoom:17, pitch:65, speed:1.1});
    };

    rankContainer.appendChild(card);
  });
}