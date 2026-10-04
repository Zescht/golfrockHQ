const QUIZ_SECONDS = 10 * 60;

const requestedVariant =
  new URLSearchParams(window.location.search).get("variant") || "2";
if (requestedVariant === "1" || requestedVariant === "2") {
  document.documentElement.classList.add(`quiz-variant-${requestedVariant}`);
}

const EXTRA_ALIASES = {
  Austria: ["österreich", "osterreich"],
  Belgium: ["belgien", "belgique"],
  Bulgaria: ["bulgarien"],
  China: ["china mainland", "mainland china"],
  Croatia: ["kroatien"],
  "Curaçao": ["curacao"],
  "Czech Republic": ["czechia", "tschechien"],
  Denmark: ["dänemark", "danemark"],
  Estonia: ["estland"],
  Finland: ["finnland"],
  France: ["frankreich"],
  "French Polynesia": ["französisch polynesien", "franzoesisch polynesien"],
  Germany: ["deutschland"],
  Greece: ["griechenland"],
  "Hong Kong": ["hongkong"],
  Hungary: ["ungarn"],
  Iceland: ["island"],
  Ireland: ["irland"],
  Italy: ["italien", "italia"],
  Latvia: ["lettland"],
  Lithuania: ["litauen"],
  Luxembourg: ["luxemburg"],
  Macau: ["macao"],
  Moldova: ["moldavia", "moldawien"],
  Netherlands: ["the netherlands", "holland", "niederlande"],
  "New Caledonia": ["neukaledonien"],
  "New Zealand": ["neuseeland"],
  "North Macedonia": ["macedonia", "nordmazedonien"],
  Norway: ["norwegen"],
  Poland: ["polen"],
  Réunion: ["reunion", "la reunion", "la réunion"],
  Romania: ["rumänien", "rumanien"],
  "Saudi Arabia": ["saudi", "saudi arabien", "saudi-arabia"],
  Serbia: ["serbien"],
  Singapore: ["singapur"],
  Slovakia: ["slowakei"],
  Slovenia: ["slowenien"],
  "South Korea": ["korea", "korea south", "republic of korea", "südkorea", "sudkorea"],
  Spain: ["spanien", "españa", "espana"],
  Sweden: ["schweden"],
  Switzerland: ["schweiz", "suisse", "svizzera"],
  Taiwan: ["republic of china"],
  Türkiye: ["turkey", "türkei", "turkei", "turkiye"],
  "United Arab Emirates": ["uae", "emirates", "vereinigte arabische emirate"],
  "United Kingdom": ["uk", "great britain", "britain", "großbritannien", "grossbritannien"],
  "United States": ["usa", "united states of america", "america", "vereinigte staaten"],
  Vietnam: ["viet nam"],
};

const NEUTRAL_STYLE = {
  color: "#737d82",
  weight: 0.7,
  opacity: 0.8,
  fillColor: "#ffffff",
  fillOpacity: 0.055,
};

const FOUND_STYLE = {
  color: "#a82316",
  weight: 1.15,
  opacity: 1,
  fillColor: "#df482d",
  fillOpacity: 0.88,
};

const REVEALED_STYLE = {
  color: "#bd6730",
  weight: 1,
  opacity: 1,
  fillColor: "#f3a45f",
  fillOpacity: 0.8,
};

const CENTER_LABEL_MARKETS = new Set([
  "Argentina",
  "Australia",
  "Brazil",
  "Canada",
  "China",
  "India",
  "Kazakhstan",
  "Mexico",
  "Mongolia",
  "Russia",
  "Saudi Arabia",
  "South Africa",
  "United States",
]);

const EUROPE_INSET_EXTRAS = new Set(["Cyprus", "Türkiye"]);
const EUROPE_WORLD_LABELS = new Set(["Iceland", "Russia"]);

const elements = {
  startButton: document.querySelector("#start-button"),
  startButtonLabel: document.querySelector("#start-button-label"),
  answerForm: document.querySelector("#answer-form"),
  answerInput: document.querySelector("#answer-input"),
  score: document.querySelector("#score"),
  timer: document.querySelector("#timer"),
  giveUpButton: document.querySelector("#give-up-button"),
  mapLoading: document.querySelector("#map-loading"),
  europeInset: document.querySelector("#europe-inset"),
  completionBar: document.querySelector("#completion-bar"),
  completionMessage: document.querySelector("#completion-message"),
  restartButton: document.querySelector("#restart-button"),
  dataSource: document.querySelector("#data-source"),
};

const L = window.L;

let quizData = null;
let markets = [];
let answerLookup = new Map();
let map = null;
let boundaryLayer = null;
let layersByGeometryId = new Map();
let europeMap = null;
let europeBoundaryLayer = null;
let europeLayersByGeometryId = new Map();
let revealDecorations = [];
let labelRecords = [];
let labelLayoutHandle = null;
let guessed = new Set();
let secondsLeft = QUIZ_SECONDS;
let timerHandle = null;
let isPlaying = false;

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function buildAnswerLookup() {
  answerLookup = new Map();
  for (const market of markets) {
    for (const answer of [market.name, ...(EXTRA_ALIASES[market.name] || [])]) {
      const key = normalize(answer);
      const existing = answerLookup.get(key);
      if (existing && existing.id !== market.id) {
        throw new Error(`Ambiguous answer alias: ${answer}`);
      }
      answerLookup.set(key, market);
    }
  }
}

function addFeatureLayer(geometryId, layer) {
  const current = layersByGeometryId.get(geometryId) || [];
  current.push(layer);
  layersByGeometryId.set(geometryId, current);
}

function addEuropeFeatureLayer(geometryId, layer) {
  const current = europeLayersByGeometryId.get(geometryId) || [];
  current.push(layer);
  europeLayersByGeometryId.set(geometryId, current);
}

function fitWorld() {
  if (!map) return;
  map.invalidateSize(false);
  map.fitBounds(
    [
      [-90, -180],
      [90, 180],
    ],
    { animate: false, padding: [0, 0] }
  );
  scheduleLabelLayout();
}

function fitEurope() {
  if (!europeMap || elements.europeInset.hidden) return;
  europeMap.invalidateSize(false);
  europeMap.fitBounds(
    [
      [35, -12],
      [68, 42],
    ],
    { animate: false, padding: [0, 0] }
  );
  scheduleLabelLayout();
}

function isEuropeMarket(market) {
  if (EUROPE_WORLD_LABELS.has(market.name)) return false;
  return market.continent === "Europe" || EUROPE_INSET_EXTRAS.has(market.name);
}

function overlapArea(first, second, padding = 2) {
  const width = Math.max(
    0,
    Math.min(first.right + padding, second.right + padding) -
      Math.max(first.left - padding, second.left - padding)
  );
  const height = Math.max(
    0,
    Math.min(first.bottom + padding, second.bottom + padding) -
      Math.max(first.top - padding, second.top - padding)
  );
  return width * height;
}

function labelCandidateOffsets(fixed, dense, size) {
  if (fixed) return [[0, 0]];

  if (dense) {
    const offsets = [];
    const step = 6;
    for (let offsetY = -size.y; offsetY <= size.y; offsetY += step) {
      for (let offsetX = -size.x; offsetX <= size.x; offsetX += step) {
        const distance = Math.hypot(offsetX, offsetY);
        if (distance >= 16) offsets.push([offsetX, offsetY]);
      }
    }
    offsets.sort(
      (first, second) =>
        Math.hypot(first[0], first[1]) - Math.hypot(second[0], second[1]) ||
        Math.abs(first[1]) - Math.abs(second[1])
    );
    offsets.push([0, 0]);
    return offsets;
  }

  const offsets = [];
  const angles = [0, 180, -90, 90, -45, 45, -135, 135, -22.5, 22.5, -67.5, 67.5];
  for (const radius of [16, 26, 38, 52, 68, 86, 104]) {
    for (const angle of angles) {
      const radians = (angle * Math.PI) / 180;
      offsets.push([
        Math.round(Math.cos(radians) * radius),
        Math.round(Math.sin(radians) * radius),
      ]);
    }
  }
  offsets.push([0, 0]);
  return offsets;
}

function layoutLabelsForMap(targetMap) {
  if (!targetMap) return;
  const records = labelRecords
    .filter((record) => record.map === targetMap && record.label.getElement());
  if (!records.length) return;

  const size = targetMap.getSize();
  const denseCandidates =
    targetMap === europeMap ? labelCandidateOffsets(false, true, size) : null;
  const placed = [];
  if (targetMap === europeMap) {
    placed.push({ left: 4, top: 4, right: 74, bottom: 24 });
  }

  const dimensions = (record) => {
    const element = record.label.getElement();
    const elementBounds = element.getBoundingClientRect();
    return {
      width: Math.max(elementBounds.width, 20),
      height: Math.max(elementBounds.height, 12),
    };
  };
  const rectangleAt = (centerX, centerY, width, height) => ({
    left: centerX - width / 2,
    right: centerX + width / 2,
    top: centerY - height / 2,
    bottom: centerY + height / 2,
  });

  for (const record of records.filter((item) => item.offset !== null)) {
    const { width, height } = dimensions(record);
    const anchor = targetMap.latLngToLayerPoint(record.anchor);
    const centerX = anchor.x + record.offset[0];
    const centerY = anchor.y + record.offset[1];
    record.label.setLatLng(targetMap.layerPointToLatLng(L.point(centerX, centerY)));
    placed.push(rectangleAt(centerX, centerY, width, height));
  }

  const pendingRecords = records
    .filter((record) => record.offset === null)
    .sort(
      (first, second) =>
        Number(second.fixed) - Number(first.fixed) ||
        Number(second.state === "found") - Number(first.state === "found") ||
        second.label.getElement().offsetWidth - first.label.getElement().offsetWidth
    );

  for (const record of pendingRecords) {
    const { width, height } = dimensions(record);
    const anchor = targetMap.latLngToLayerPoint(record.anchor);
    let best = null;

    const candidates = record.fixed
      ? labelCandidateOffsets(true, false, size)
      : denseCandidates || labelCandidateOffsets(false, false, size);
    for (const [offsetX, offsetY] of candidates) {
      const centerX = anchor.x + offsetX;
      const centerY = anchor.y + offsetY;
      const rectangle = rectangleAt(centerX, centerY, width, height);
      const outside =
        rectangle.left < 3 ||
        rectangle.top < 3 ||
        rectangle.right > size.x - 3 ||
        rectangle.bottom > size.y - 3;
      if (outside) continue;

      const overlap = placed.reduce(
        (total, other) => total + overlapArea(rectangle, other),
        0
      );
      const distance = Math.hypot(offsetX, offsetY);
      const candidate = { rectangle, centerX, centerY, score: overlap * 50 + distance };
      if (!best || candidate.score < best.score) best = candidate;
      if (overlap === 0) break;
    }

    if (!best) {
      const centerX = Math.max(width / 2 + 3, Math.min(size.x - width / 2 - 3, anchor.x));
      const centerY = Math.max(height / 2 + 3, Math.min(size.y - height / 2 - 3, anchor.y));
      best = {
        centerX,
        centerY,
        rectangle: rectangleAt(centerX, centerY, width, height),
      };
    }

    record.offset = [best.centerX - anchor.x, best.centerY - anchor.y];
    record.label.setLatLng(
      targetMap.layerPointToLatLng(L.point(best.centerX, best.centerY))
    );
    placed.push(best.rectangle);
  }
}

function scheduleLabelLayout() {
  if (labelLayoutHandle !== null) return;
  labelLayoutHandle = window.requestAnimationFrame(() => {
    labelLayoutHandle = window.requestAnimationFrame(() => {
      labelLayoutHandle = null;
      layoutLabelsForMap(map);
      if (!elements.europeInset.hidden) layoutLabelsForMap(europeMap);
    });
  });
}

function initializeMap(geojson) {
  if (!L) throw new Error("Leaflet did not load.");

  map = L.map("world-map", {
    crs: L.CRS.EPSG4326,
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false,
    worldCopyJump: false,
    maxBounds: [
      [-90, -180],
      [90, 180],
    ],
    maxBoundsViscosity: 1,
    zoomSnap: 0,
    zoomDelta: 0.25,
    minZoom: 0,
    maxZoom: 6,
  });

  L.imageOverlay(
    "./assets/natural-earth-world-blue.jpg",
    [
      [-90, -180],
      [90, 180],
    ],
    { interactive: false, opacity: 1 }
  ).addTo(map);

  layersByGeometryId = new Map();
  boundaryLayer = L.geoJSON(geojson, {
    style: () => ({ ...NEUTRAL_STYLE }),
    onEachFeature(feature, layer) {
      const geometryId = String(feature.properties?.GU_A3 || "");
      if (geometryId) addFeatureLayer(geometryId, layer);
    },
  }).addTo(map);

  elements.europeInset.hidden = false;
  europeMap = L.map("europe-map", {
    crs: L.CRS.EPSG4326,
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    zoomSnap: 0,
  });

  L.imageOverlay(
    "./assets/natural-earth-world-blue.jpg",
    [
      [-90, -180],
      [90, 180],
    ],
    { interactive: false, opacity: 1 }
  ).addTo(europeMap);

  europeLayersByGeometryId = new Map();
  europeBoundaryLayer = L.geoJSON(geojson, {
    style: () => ({ ...NEUTRAL_STYLE }),
    onEachFeature(feature, layer) {
      const geometryId = String(feature.properties?.GU_A3 || "");
      if (geometryId) addEuropeFeatureLayer(geometryId, layer);
    },
  }).addTo(europeMap);
  fitEurope();
  elements.europeInset.hidden = true;

  map.attributionControl.addAttribution(
    'Map and boundaries: <a href="https://www.naturalearthdata.com/">Natural Earth</a>'
  );
  map.on("zoomend moveend", scheduleLabelLayout);
  europeMap.on("zoomend moveend", scheduleLabelLayout);
  fitWorld();
  let resizeHandle = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeHandle);
    resizeHandle = window.setTimeout(() => {
      fitWorld();
      fitEurope();
    }, 80);
  });
}

function validateGeometryCoverage() {
  const missing = markets.flatMap((market) =>
    market.geometryIds
      .filter((geometryId) => !layersByGeometryId.has(geometryId))
      .map((geometryId) => `${market.name} (${geometryId})`)
  );
  if (missing.length) {
    throw new Error(`Missing map geometry: ${missing.join(", ")}`);
  }
}

function clearRevealDecorations() {
  if (labelLayoutHandle !== null) {
    window.cancelAnimationFrame(labelLayoutHandle);
    labelLayoutHandle = null;
  }
  for (const layer of revealDecorations) layer.remove();
  revealDecorations = [];
  labelRecords = [];
}

function resetMapAnswers() {
  clearRevealDecorations();
  if (boundaryLayer) boundaryLayer.setStyle(() => ({ ...NEUTRAL_STYLE }));
  if (europeBoundaryLayer) europeBoundaryLayer.setStyle(() => ({ ...NEUTRAL_STYLE }));
}

function addAnswerLabel(targetMap, point, market, state, fixed) {
  const labelNode = document.createElement("span");
  labelNode.textContent = market.name;
  const label = L.tooltip({
    permanent: true,
    direction: "center",
    className: `country-label ${state}`,
    interactive: false,
    opacity: 1,
  })
    .setLatLng(point)
    .setContent(labelNode)
    .addTo(targetMap);
  labelRecords.push({
    label,
    map: targetMap,
    anchor: L.latLng(point[0], point[1]),
    fixed,
    state,
    offset: null,
  });
  revealDecorations.push(label);
  scheduleLabelLayout();
}

function revealMarket(market, state) {
  const style = state === "found" ? FOUND_STYLE : REVEALED_STYLE;
  const featureLayers = market.geometryIds.flatMap(
    (geometryId) => layersByGeometryId.get(geometryId) || []
  );

  for (const layer of featureLayers) {
    layer.setStyle(style);
    layer.bringToFront();
  }

  const europeFeatureLayers = market.geometryIds.flatMap(
    (geometryId) => europeLayersByGeometryId.get(geometryId) || []
  );
  for (const layer of europeFeatureLayers) {
    layer.setStyle(style);
    layer.bringToFront();
  }

  const anchorPoint = Array.isArray(market.label) ? market.label.map(Number) : [];
  if (anchorPoint.length === 2 && anchorPoint.every(Number.isFinite)) {
    const inEuropeInset = isEuropeMarket(market);
    const targetMap = inEuropeInset ? europeMap : map;
    const fixed = !inEuropeInset && CENTER_LABEL_MARKETS.has(market.name);
    addAnswerLabel(targetMap, anchorPoint, market, state, fixed);

    if (market.tiny) {
      const halo = L.circleMarker(anchorPoint, {
        radius: state === "found" ? 6 : 5,
        color: state === "found" ? FOUND_STYLE.color : REVEALED_STYLE.color,
        weight: 2,
        opacity: 1,
        fillColor: state === "found" ? FOUND_STYLE.fillColor : REVEALED_STYLE.fillColor,
        fillOpacity: 0.9,
        interactive: false,
      }).addTo(targetMap);
      revealDecorations.push(halo);
    }
  }
}

function updateScore() {
  elements.score.textContent = `${guessed.size}/${markets.length}`;
}

function acceptAnswer(market) {
  elements.answerInput.value = "";
  if (guessed.has(market.id)) return;

  guessed.add(market.id);
  revealMarket(market, "found");
  updateScore();

  if (guessed.size === markets.length) finishQuiz("complete");
}

function tryAnswer() {
  if (!isPlaying) return;
  const market = answerLookup.get(normalize(elements.answerInput.value));
  if (market) acceptAnswer(market);
}

function setPlayingControls(playing) {
  elements.startButton.hidden = playing;
  elements.answerForm.hidden = !playing;
  elements.answerInput.disabled = !playing;
  elements.giveUpButton.hidden = !playing;
  elements.giveUpButton.disabled = !playing;
}

function startQuiz() {
  window.clearInterval(timerHandle);
  guessed = new Set();
  secondsLeft = QUIZ_SECONDS;
  isPlaying = true;
  elements.europeInset.hidden = false;
  fitEurope();
  resetMapAnswers();
  updateScore();

  elements.timer.textContent = formatTime(secondsLeft);
  elements.answerInput.value = "";
  elements.completionBar.hidden = true;
  setPlayingControls(true);
  elements.answerInput.focus();

  timerHandle = window.setInterval(() => {
    secondsLeft -= 1;
    elements.timer.textContent = formatTime(Math.max(secondsLeft, 0));
    if (secondsLeft <= 0) finishQuiz("time");
  }, 1000);
}

function finishQuiz(reason) {
  if (!isPlaying) return;
  isPlaying = false;
  window.clearInterval(timerHandle);
  elements.answerInput.disabled = true;
  elements.giveUpButton.disabled = true;
  elements.giveUpButton.hidden = true;

  if (reason !== "complete") {
    for (const market of markets) {
      if (!guessed.has(market.id)) revealMarket(market, "revealed");
    }
  }

  const message =
    reason === "complete"
      ? `Perfect — you found all ${markets.length} countries and territories.`
      : `You found ${guessed.size} of ${markets.length}. The remaining answers are now revealed.`;
  elements.completionMessage.textContent = message;
  elements.completionBar.hidden = false;
}

async function loadQuiz() {
  const [quizResponse, geometryResponse] = await Promise.all([
    fetch("./quiz_data.json", { cache: "no-store" }),
    fetch("./assets/ne_50m_admin_0_map_units.geojson"),
  ]);

  if (!quizResponse.ok) throw new Error(`Could not load quiz data (${quizResponse.status}).`);
  if (!geometryResponse.ok) throw new Error(`Could not load map data (${geometryResponse.status}).`);

  quizData = await quizResponse.json();
  const geography = await geometryResponse.json();
  markets = quizData.markets;
  if (quizData.answerCount !== markets.length) throw new Error("Quiz answer count is inconsistent.");

  buildAnswerLookup();
  initializeMap(geography);
  validateGeometryCoverage();

  elements.score.textContent = `0/${markets.length}`;
  elements.timer.textContent = formatTime(QUIZ_SECONDS);
  elements.dataSource.textContent = `${quizData.sourceWorkbook} · ${markets.length} country/territory answers`;
  elements.mapLoading.hidden = true;
  elements.startButtonLabel.textContent = "QUIZ SPIELEN";
  elements.startButton.disabled = false;
}

elements.startButton.addEventListener("click", startQuiz);
elements.restartButton.addEventListener("click", startQuiz);
elements.answerInput.addEventListener("input", tryAnswer);
elements.answerForm.addEventListener("submit", (event) => event.preventDefault());
elements.giveUpButton.addEventListener("click", () => finishQuiz("giveup"));

loadQuiz().catch((error) => {
  console.error(error);
  elements.mapLoading.textContent = "The world map could not be loaded.";
  elements.startButtonLabel.textContent = "MAP LOAD FAILED";
  elements.startButton.disabled = true;
});
