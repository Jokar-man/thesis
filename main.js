mapboxgl.accessToken = "pk.eyJ1IjoibGFrc2htaS1kYmYxNSIsImEiOiJjbWdnYWM4cTYwZ2czMmtzY3k0cHlrZTA0In0.AwWDdoOtmRZNAXz1s4yQxw";

// Barcelona Center
const CENTER = [2.1734, 41.3851];
let points = null;
let activeFields = [];
let stats = {};
let cadastralData = null;

const rankContainer = document.getElementById("rank-popup");
let centerFocusKm = 5;

/* -------------------------
   UTILITY: Haversine Distance (km)
-------------------------- */
function getDistance(coord1, coord2) {
  const R = 6371; // Radius of Earth in kilometers
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
  const distance = R * c; // Distance in km
  return distance;
}


/* -------------------------
   Initialize MAP
-------------------------- */

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: CENTER,
  zoom: 13.5,
  pitch: 60,
  bearing: -20,
  antialias: true,
  // NEW: Zoom constraints
  minZoom: 10,
  maxZoom: 18
});

map.on("load", async () => {

  /* -------------------------
     LOAD Cadastral Buildings GeoJSON
  -------------------------- */
  try {
    cadastralData = await fetch("data/barcelona_buildings.geojson").then(r => r.json());
  } catch (err) {
    console.error("Could not load cadastral buildings:", err);
  }

  // Add as source
  map.addSource("cadastral-buildings-source", {
    type: "geojson",
    data: cadastralData
  });

  // CUSTOM 3D EXTRUSION (your code maintained)
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


  /* -------------------------
     MAPBOX DEFAULT 3D BUILDINGS
  -------------------------- */
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


  /* -------------------------
     LOAD Vulnerability Points
  -------------------------- */
  try {
    const resp = await fetch("data/viz.geojson");
    points = await resp.json();
  } catch (err) {
    alert("ERROR: data/Viz.geojson not found.");
    return;
  }

  computeStats();

  map.addSource("points", {
    type: "geojson",
    data: points
  });

  /* -------------------------
     Glow Halo Layer (under 3D)
  -------------------------- */
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


  /* -------------------------
     Glow Core Layer (bright point)
  -------------------------- */
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

  /* -------------------------
     Click popup
  -------------------------- */
  map.on("click", "glow-core", (e) => {
    const f = e.features[0];
    const p = f.properties;

    const html = `
      <div style="font-weight:700;color:#fff">${p.N_Barri || "Unknown"}</div>

      <div style="color:#ccc;margin-top:6px;"><strong>Familia:</strong> ${p.FAMILIA || "N/A"}</div>
      <div style="color:#ccc;margin-top:6px;"><strong>Descripció:</strong> ${p.Descripcio || "N/A"}</div>

      <div style="color:#ddd;margin-top:8px;font-size:13px;">
        <b>Heat:</b> ${formatValue(computeRaw(p, "heat"))}<br>
        <b>Drought (SPEI):</b> ${formatValue(p.SPEI)}<br>
        <b>Vulnerable Pop:</b> ${formatValue(p.pop_sex3)}
      </div>
    `;

    new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  map.on("mouseenter", "glow-core", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "glow-core", () => map.getCanvas().style.cursor = "");

  setupButtons();
  setupRadiusControl();
  setupInfoModal();
  updateVisualization();
});

/* -------------------------
   Stats + Normalization
-------------------------- */

function computeStats() {
  const fields = { heat: [], SPEI: [], pop_sex3: [] };

  points.features.forEach(f => {
    const p = f.properties;
    fields.heat.push(computeRaw(p, "heat"));
    fields.SPEI.push(p.SPEI || 0);
    fields.pop_sex3.push(p.pop_sex3 || 0);
  });

  Object.keys(fields).forEach(k => {
    const a = fields[k].filter(x => x != null).sort((x,y)=>x-y);
    const n = a.length;
    stats[k] = {
      min: a[Math.floor(n*0.05)] || 0,
      max: a[Math.floor(n*0.95)] || 1
    };
    stats[k].range = Math.max(1e-6, stats[k].max - stats[k].min);
  });
}

function computeRaw(p, f) {
  if (f === "heat") return ((+p.LST1 || 0) + (+p.uhi2 || 0)) / 2;
  return +p[f] || 0;
}

function normalize(raw, f) {
  const s = stats[f];
  return Math.min(1, Math.max(0, (raw - s.min) / s.range));
}

function formatValue(v) {
  return isFinite(v) ? Math.round(v * 100) / 100 : "N/A";
}

/* -------------------------
   UI Buttons + Updates
-------------------------- */

function setupButtons() {
  document.querySelectorAll("#panel button").forEach(btn => {
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
      flyToTop();
    };
  });
}

function setupRadiusControl() {
  const slider = document.getElementById("radius-slider");
  const label = document.getElementById("radius-val");

  slider.oninput = () => {
    centerFocusKm = Number(slider.value);
    label.textContent = `${centerFocusKm} km`;
    updateVisualization();
  };
}

function setupInfoModal() {
  const icon = document.getElementById("info-icon");
  const modal = document.getElementById("info-modal");
  const close = document.querySelector(".close-modal");

  icon.onclick = () => {
    modal.style.display = "block";
  };

  close.onclick = () => {
    modal.style.display = "none";
  };

  // Close when clicking outside the modal
  window.onclick = (event) => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  };
}


function updateVisualization() {
  points.features.forEach(f => {
    let sum = 0;
    const coords = f.geometry.coordinates;
    const distanceToCenter = getDistance(CENTER, coords);

    // Set focus property based on the slider value
    f.properties._inFocus = distanceToCenter <= centerFocusKm;

    if (activeFields.length === 0) {
      f.properties._value = 0;
      return;
    }

    activeFields.forEach(k => {
      sum += normalize(computeRaw(f.properties, k === "heat" ? "heat" : k), k === "heat" ? "heat" : k);
    });

    f.properties._value = sum / activeFields.length;
  });

  map.getSource("points").setData(points);
  updateRanking();
}

function updateRanking() {
  rankContainer.innerHTML = "";

  if (!activeFields.length) {
    rankContainer.innerHTML =
      `<div style="color:#666;font-style:italic;padding:10px;">Select a layer...</div>`;
    return;
  }

  // 1. Filter points that are within the Center Focus Radius
  const focusPoints = points.features.filter(f => f.properties._inFocus);

  // 2. Sort by vulnerability score (highest first)
  const sortedFocusPoints = focusPoints
    .sort((a,b)=>b.properties._value - a.properties._value);

  // 3. Apply 2km buffer logic while selecting top 5
  const topRanked = [];
  const minDistanceKm = 2; // Required buffer distance

  for (const feature of sortedFocusPoints) {
    if (topRanked.length >= 5) break; // Stop after selecting 5

    const currentCoords = feature.geometry.coordinates;
    let isTooClose = false;

    // Check distance against already selected (ranked) neighborhoods
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
      map.flyTo({center:c, zoom:18, pitch:65, speed:1.1});
    };

    rankContainer.appendChild(card);
  });
}

function flyToTop() {
  if (!activeFields.length) return;

  // Find the highest ranked point after filtering for focus and buffer
  const top = points.features
    .filter(f => f.properties._inFocus)
    .sort((a,b)=>b.properties._value - a.properties._value)[0];

  // Only fly if a top point exists
  if (!top) return;

  const c = top.geometry.coordinates;

  map.flyTo({
    center: c,
    zoom: 18,
    pitch: 65,
    speed: 1.2
  });
}