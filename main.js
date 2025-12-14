mapboxgl.accessToken = "pk.eyJ1IjoibGFrc2htaS1kYmYxNSIsImEiOiJjbWdnYWM4cTYwZ2czMmtzY3k0cHlrZTA0In0.AwWDdoOtmRZNAXz1s4yQxw";

// Barcelona Center - Plaça Catalunya
const CENTER = [2.1734, 41.3851];
let points = null;
let activeFields = [];
let stats = {};
let cadastralData = null;
let climateShelters = null;
let climateIsochrones = null;
let userLocation = null;
let animationMarker = null;
// Removed: let pathFinder = null;
// Removed: let roadNetwork = null;

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
    const resp = await fetch("data/data.geojson");
    const text = await resp.text();
    points = JSON.parse(text);
  } catch (err) {
    alert("ERROR: data/viz.geojson not found.");
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
     LOAD Climate Shelters (FIX: Ensured visibility)
  -------------------------- */
  try {
    const shelterResp = await fetch("data/climate_shelters.geojson");
    const shelterText = await shelterResp.text();
    climateShelters = JSON.parse(shelterText);

    map.addSource("climate-shelters", {
      type: "geojson",
      data: climateShelters
    });

    // Add shelter points ABOVE all other layers - Visibility set to 'visible'
    map.addLayer({
      id: "shelter-points",
      type: "circle",
      source: "climate-shelters",
      paint: {
        "circle-radius": 10,
        "circle-color": "#ffa500",
        "circle-stroke-width": 3,
        "circle-stroke-color": "#fff",
        "circle-opacity": 0.9
      },
      layout: {
        "visibility": "visible" // Explicitly visible
      }
    });

    // Add shelter labels - Visibility set to 'visible'
    map.addLayer({
      id: "shelter-labels",
      type: "symbol",
      source: "climate-shelters",
      layout: {
        "text-field": "🏠",
        "text-size": 18,
        "visibility": "visible", // Explicitly visible
        "text-offset": [0, -1.5]
      },
      paint: {
        "text-color": "#ffa500",
        "text-halo-color": "#000",
        "text-halo-width": 2
      }
    });
  } catch (err) {
    console.error("Could not load climate shelters:", err);
  }

  /* -------------------------
     LOAD Climate Isochrones
  -------------------------- */
  try {
    const isoResp = await fetch("data/climate_isochrone.geojson");
    const isoText = await isoResp.text();
    climateIsochrones = JSON.parse(isoText);
    console.log("Loaded isochrones:", climateIsochrones);
  } catch (err) {
    console.error("Could not load climate isochrones:", err);
  }
  /* Removed: BUILD ROAD NETWORK GRAPH block (used undefined PathFinder) */


  /* -------------------------
     Click handlers
  -------------------------- */
  map.on("mouseenter", "glow-core", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "glow-core", () => map.getCanvas().style.cursor = "");

  // Click on shelter points
  map.on("click", "shelter-points", (e) => {
    const f = e.features[0];
    const p = f.properties;

    let html = `<div style="font-weight:700;color:#ffa500">Climate Shelter</div>`;

    // Display name, neighborhood, and district
    const name = p.name || p.Name || "N/A";
    const neighborhood = p.addresses_neighborhood_name || "N/A";
    const district = p.addresses_district_name || "N/A";

    html += `<div style="color:#ccc;margin-top:4px;"><strong>Name:</strong> ${name}</div>`;
    html += `<div style="color:#ccc;margin-top:4px;"><strong>Neighborhood:</strong> ${neighborhood}</div>`;
    html += `<div style="color:#ccc;margin-top:4px;"><strong>District:</strong> ${district}</div>`;

    new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  map.on("mouseenter", "shelter-points", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "shelter-points", () => map.getCanvas().style.cursor = "");

  // Click on map to set user location when shelter modal is open
  map.on("click", (e) => {
    const modal = document.getElementById("shelter-modal");
    if (modal.style.display === "block") {
      userLocation = [e.lngLat.lng, e.lngLat.lat];
      document.getElementById("location-input").value = `${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`;
    }
  });

  setupButtons();
  setupRadiusControl();
  setupInfoModal();
  setupShelterModal();
  updateVisualization();
});

/* -------------------------
   Stats + Normalization
-------------------------- */

function computeStats() {
  const fields = { heat: [], SPEI: [], pop_sex3: [], immigrant1: [], income1: [] };

  points.features.forEach(f => {
    const p = f.properties;
    const heatVal = computeRaw(p, "heat");
    const incomeVal = p.income1 || 0;

    fields.heat.push(heatVal);
    fields.SPEI.push(p.SPEI || 0);
    fields.pop_sex3.push(p.pop_sex3 || 0);
    fields.immigrant1.push(p.immigrant1 || 0);
    fields.income1.push(incomeVal);
  });

  Object.keys(fields).forEach(k => {
    const a = fields[k].filter(x => x != null && isFinite(x)).sort((x,y)=>x-y);
    const n = a.length;
    if (n === 0) {
      stats[k] = { min: 0, max: 1, range: 1 };
      return;
    }
    stats[k] = {
      min: a[Math.floor(n*0.05)] || 0,
      max: a[Math.floor(n*0.95)] || 1
    };
    stats[k].range = Math.max(1e-6, stats[k].max - stats[k].min);
  });

  console.log("Stats computed:", stats);
}

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

function normalize(raw, f) {
  const s = stats[f];
  if (!s || s.range === 0) return 0;

  if (f === "income1") {
    const normalized = (raw - s.min) / s.range;
    return Math.min(1, Math.max(0, 1 - normalized));
  }

  return Math.min(1, Math.max(0, (raw - s.min) / s.range));
}

function formatValue(v) {
  return isFinite(v) ? Math.round(v * 100) / 100 : "N/A";
}

/* -------------------------
   UI Buttons + Updates
-------------------------- */

function setupButtons() {
  // Ensure shelter button is active on load
  const shelterBtn = document.querySelector('#panel button[data-field="climate_shelter"]');
  if (shelterBtn) {
    shelterBtn.classList.add("active");
  }

  document.querySelectorAll("#panel button[data-field]").forEach(btn => {
    btn.onclick = () => {
      const f = btn.dataset.field;

      if (f === "climate_shelter") {
        const visibility = map.getLayoutProperty("shelter-points", "visibility");
        if (visibility === "visible") {
          map.setLayoutProperty("shelter-points", "visibility", "none");
          map.setLayoutProperty("shelter-labels", "visibility", "none");
          btn.classList.remove("active");
        } else {
          map.setLayoutProperty("shelter-points", "visibility", "visible");
          map.setLayoutProperty("shelter-labels", "visibility", "visible");
          btn.classList.add("active");
        }
        return;
      }

      if (activeFields.includes(f)) {
        activeFields = activeFields.filter(x => x !== f);
        btn.classList.remove("active");
      } else {
        activeFields.push(f);
        btn.classList.add("active");
      }
      // Clean up the activeFields array in case the shelter field was erroneously added
      activeFields = activeFields.filter(x => x !== "climate_shelter");

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

  window.onclick = (event) => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  };
}

function setupShelterModal() {
  const btn = document.getElementById("shelter-btn");
  const modal = document.getElementById("shelter-modal");
  const closeBtn = document.getElementById("close-shelter-panel");

  btn.onclick = () => {
    modal.style.display = "block";
    document.getElementById("shelter-status").textContent = "Click on the map or enter an address to begin.";
    document.getElementById("shelter-status").style.color = "#aaa";
  };

  closeBtn.onclick = () => {
    document.getElementById("shelter-info-panel").style.display = "none";
    clearShelterVisualization();
  };
}

function updateVisualization() {
  const vulnerabilityFields = activeFields.filter(f => f !== "climate_shelter");

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

function updateRanking() {
  rankContainer.innerHTML = "";

  const vulnerabilityFields = activeFields.filter(f => f !== "climate_shelter");

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
      map.flyTo({center:c, zoom:18, pitch:65, speed:1.1});
    };

    rankContainer.appendChild(card);
  });
}

function flyToTop() {
  const vulnerabilityFields = activeFields.filter(f => f !== "climate_shelter");
  if (!vulnerabilityFields.length) return;

  const top = points.features
    .filter(f => f.properties._inFocus)
    .sort((a,b)=>b.properties._value - a.properties._value)[0];

  if (!top) return;

  const c = top.geometry.coordinates;

  map.flyTo({
    center: c,
    zoom: 18,
    pitch: 65,
    speed: 1.2
  });
}

/* -------------------------
   Climate Shelter Functions
-------------------------- */

async function findNearestShelter() {
  const input = document.getElementById("location-input").value.trim();
  const statusDiv = document.getElementById("shelter-status");

  if (!input) {
    statusDiv.textContent = "Please enter a location or click on the map.";
    statusDiv.style.color = "#ff0055";
    return;
  }

  statusDiv.textContent = "Searching for nearest shelter...";
  statusDiv.style.color = "#ffa500";

  let coords = null;

  const coordMatch = input.match(/^([-\d.]+),\s*([-\d.]+)$/);
  if (coordMatch) {
    coords = [parseFloat(coordMatch[2]), parseFloat(coordMatch[1])];
  } else {
    try {
      const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(input)}.json?access_token=${mapboxgl.accessToken}&proximity=${CENTER[0]},${CENTER[1]}&limit=1`;
      const response = await fetch(geocodeUrl);
      const data = await response.json();

      if (data.features && data.features.length > 0) {
        coords = data.features[0].center;
      }
    } catch (err) {
      console.error("Geocoding error:", err);
    }
  }

  if (!coords) {
    statusDiv.textContent = "Could not find location. Please try coordinates (lat, lng) or a valid Barcelona address.";
    statusDiv.style.color = "#ff0055";
    return;
  }

  userLocation = coords;

  if (!climateShelters || !climateShelters.features || climateShelters.features.length === 0) {
    handleRoutingError("No climate shelters found in the database.");
    return;
  }

  let nearestShelter = null;
  let minDistance = Infinity;

  climateShelters.features.forEach(shelter => {
    const shelterCoords = shelter.geometry.coordinates;
    const distance = getDistance(coords, shelterCoords);

    if (distance < minDistance) {
      minDistance = distance;
      nearestShelter = shelter;
    }
  });

  if (!nearestShelter) {
    handleRoutingError("There is no nearest climate shelter available.");
    return;
  }

  statusDiv.textContent = `Found shelter ${(minDistance).toFixed(2)} km away. Animating route...`;
  statusDiv.style.color = "#00ff00";

  document.getElementById("shelter-modal").style.display = "none";

  displayShelterInfo(nearestShelter, minDistance);

  animateRouteToShelter(coords, nearestShelter.geometry.coordinates);
}

function displayShelterInfo(shelter, distance) {
  const panel = document.getElementById("shelter-info-panel");
  const content = document.getElementById("shelter-info-content");

  const props = shelter.properties;

  const name = props.name || props.Name || "N/A";
  const neighborhood = props.addresses_neighborhood_name || "N/A";
  const district = props.addresses_district_name || "N/A";

  let html = `
    <div class="info-row">
      <div class="info-label">Distance</div>
      <div class="info-value">${distance.toFixed(2)} km</div>
    </div>
    <div class="info-row">
      <div class="info-label">Name</div>
      <div class="info-value">${name}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Neighborhood</div>
      <div class="info-value">${neighborhood}</div>
    </div>
    <div class="info-row">
      <div class="info-label">District</div>
      <div class="info-value">${district}</div>
    </div>
  `;

  content.innerHTML = html;
  panel.style.display = "block";
}

function animateRouteToShelter(start, end) {
  clearShelterVisualization();

  let routeCoordinates = findRouteInIsochrones(start, end);

  // Check for pathfinding failure signaled by findRouteInIsochrones
  if (!routeCoordinates) {
      // Re-open the modal to give the user a chance to input a new location or click the map
      document.getElementById("shelter-modal").style.display = "block";
      handleRoutingError("Could not find a walkable path from your location on the available road network.");
      return;
  }

  map.addSource("shelter-route", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: routeCoordinates
      }
    }
  });

  map.addLayer({
    id: "shelter-route-line",
    type: "line",
    source: "shelter-route",
    paint: {
      "line-color": "#ffa500",
      "line-width": 4,
      "line-opacity": 0.8
    }
  });

  const startMarker = new mapboxgl.Marker({ color: "#00ff00" })
    .setLngLat(start)
    .addTo(map);

  const endMarker = new mapboxgl.Marker({ color: "#ff0055" })
    .setLngLat(end)
    .addTo(map);

  const animationDuration = 3000;
  const steps = 100;
  let currentStep = 0;

  const el = document.createElement("div");
  el.style.backgroundColor = "#fff";
  el.style.width = "12px";
  el.style.height = "12px";
  el.style.borderRadius = "50%";
  el.style.border = "2px solid #ffa500";
  el.style.boxShadow = "0 0 10px rgba(255, 165, 0, 0.8)";

  animationMarker = new mapboxgl.Marker(el)
    .setLngLat(start)
    .addTo(map);

  const bounds = new mapboxgl.LngLatBounds();
  routeCoordinates.forEach(coord => bounds.extend(coord));
  map.fitBounds(bounds, { padding: 100, duration: 1000 });

  const animate = () => {
    if (currentStep >= steps) {
      return;
    }

    const progress = currentStep / steps;

    // Use turf.length and turf.along for smoother animation along the actual path
    if (typeof turf !== 'undefined' && turf.lineString) {
      const line = turf.lineString(routeCoordinates);
      const lengthKm = turf.length(line, {units: 'kilometers'});
      const alongPoint = turf.along(line, lengthKm * progress, {units: 'kilometers'});
      animationMarker.setLngLat(alongPoint.geometry.coordinates);
    } else {
        // Fallback to simpler linear interpolation
        const totalLength = routeCoordinates.length - 1;
        const segmentIndex = Math.floor(progress * totalLength);
        const segmentProgress = (progress * totalLength) - segmentIndex;

        if (segmentIndex < totalLength) {
          const startCoord = routeCoordinates[segmentIndex];
          const endCoord = routeCoordinates[segmentIndex + 1];

          const lng = startCoord[0] + (endCoord[0] - startCoord[0]) * segmentProgress;
          const lat = startCoord[1] + (endCoord[1] - startCoord[1]) * segmentProgress;

          animationMarker.setLngLat([lng, lat]);
        }
    }

    currentStep++;
    setTimeout(animate, animationDuration / steps);
  };

  animate();

  window.shelterMarkers = [startMarker, endMarker];
}

/* -------------------------
   FIXED ROUTING LOGIC (Using Turf.js for Road Snapping)
-------------------------- */
function findRouteInIsochrones(start, end) {
  // Check if Turf.js is loaded and isochrone data is available
  if (typeof turf === 'undefined' || !climateIsochrones) {
    console.warn("Turf.js not loaded or isochrone data is missing. Returning null.");
    return null;
  }

  // Define a maximum acceptable distance (e.g., 100 meters) for a point to snap to the road network
  const MAX_SNAPPING_DISTANCE_KM = 0.1;

  // 1. Extract all LineString features (roads) from the GeoJSON
  let roadFeatures = climateIsochrones.features.filter(f => f.geometry.type === "LineString");

  // Flatten if the GeoJSON is complex (MultiLineString, GeometryCollection)
  if (roadFeatures.length === 0) {
      try {
          const flattened = turf.flatten(climateIsochrones);
          roadFeatures = flattened.features.filter(f => f.geometry.type === "LineString");
      } catch (e) {
          console.error("Error flattening isochrones GeoJSON:", e);
      }
  }

  if (roadFeatures.length === 0) {
      console.warn("No LineString features found in isochrone data. Returning null.");
      return null;
  }

  const roadSegments = turf.featureCollection(roadFeatures);

  const startPoint = turf.point(start);
  const endPoint = turf.point(end);

  // 2. Snap start and end points to the nearest road network point
  const snappedStartFeature = turf.nearestPointOnLine(roadSegments, startPoint);
  const snappedEndFeature = turf.nearestPointOnLine(roadSegments, endPoint);

  const snappedStart = snappedStartFeature.geometry.coordinates;
  const snappedEnd = snappedEndFeature.geometry.coordinates;

  // CRITICAL CHECK: Ensure start point is close enough to the road network
  const startSnapDistance = getDistance(start, snappedStart);
  if (startSnapDistance > MAX_SNAPPING_DISTANCE_KM) {
      console.warn(`Start location is too far from the road network (${startSnapDistance.toFixed(2)} km). Returning null.`);
      return null;
  }

  // 3. Generate intermediate points and snap them to the road network
  const intermediateCoordinates = [];
  const totalSteps = 20; // Number of intermediate points to calculate

  for (let i = 1; i < totalSteps; i++) {
    const progress = i / totalSteps;
    // Interpolate the straight-line position (Lng, Lat)
    const intermediateTarget = [
        snappedStart[0] + (snappedEnd[0] - snappedStart[0]) * progress,
        snappedStart[1] + (snappedEnd[1] - snappedStart[1]) * progress,
    ];

    const intermediatePoint = turf.point(intermediateTarget);

    // Find the nearest point *on* the road network line to the interpolated point
    const nearestRoadPointFeature = turf.nearestPointOnLine(roadSegments, intermediatePoint);
    const nearestRoadPoint = nearestRoadPointFeature.geometry.coordinates;

    // Only add if the nearest road point is reasonably close (e.g., within 50 meters or 0.05 km)
    if (turf.distance(intermediatePoint, nearestRoadPoint, {units: 'kilometers'}) < 0.05) {
      intermediateCoordinates.push(nearestRoadPoint);
    }
  }

  // 4. Combine points to form the route
  const finalRoute = [
    start,
    snappedStart,
    ...intermediateCoordinates,
    snappedEnd,
    end
  ];

  // 5. Clean up redundant consecutive points (e.g., if snapping found the same point multiple times)
  const cleanedRoute = [];
  finalRoute.forEach(coord => {
    // Only add if the current point is far enough from the last point added (> 5 meters)
    if (cleanedRoute.length === 0 || getDistance(cleanedRoute[cleanedRoute.length - 1], coord) > 0.005) {
        cleanedRoute.push(coord);
    }
  });

  if (cleanedRoute.length < 2) {
      console.warn("Cleaned route has fewer than 2 points. Returning null.");
      return null;
  }

  return cleanedRoute;
}


function clearShelterVisualization() {
  if (map.getLayer("shelter-route-line")) {
    map.removeLayer("shelter-route-line");
  }
  if (map.getSource("shelter-route")) {
    map.removeSource("shelter-route");
  }

  if (window.shelterMarkers) {
    window.shelterMarkers.forEach(marker => marker.remove());
    window.shelterMarkers = null;
  }

  if (animationMarker) {
    animationMarker.remove();
    animationMarker = null;
  }
}

/**
 * Handles errors during the shelter finding or routing process by updating the status message.
 * @param {string} message - The error message to display.
 */
function handleRoutingError(message) {
  const statusDiv = document.getElementById("shelter-status");
  statusDiv.textContent = message;
  statusDiv.style.color = "#ff0055"; // Error color

  // Ensure the shelter info panel is hidden
  document.getElementById("shelter-info-panel").style.display = "none";
  clearShelterVisualization();
}