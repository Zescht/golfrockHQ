const QUIZ_SECONDS = 4 * 60;
const PAIR_COUNT = 5;
const SLOT_COUNT = PAIR_COUNT * 2;
const MAX_JUNCTION_STUB_KM = 80;
const MAX_JUNCTION_STUB_RATIO = 0.2;

const NEUTRAL_STYLE = {
  stroke: false,
  fillColor: "#fff98a",
  fillOpacity: 1,
};

const FOUND_STYLE = {
  stroke: false,
  fillColor: "#59ef62",
  fillOpacity: 1,
};

const REVEALED_STYLE = {
  stroke: false,
  fillColor: "#f3a45f",
  fillOpacity: 1,
};

const BORDER_STYLE = {
  color: "#6b7278",
  weight: 1.1,
  opacity: 0.95,
  fill: false,
  interactive: false,
};

const OUTLINE_STYLE = {
  color: "#596168",
  weight: 1.8,
  opacity: 1,
  fill: false,
  interactive: false,
};

const MERGED_BORDER_MASK_STYLE = {
  weight: 4,
  opacity: 1,
  lineCap: "round",
  lineJoin: "round",
  fill: false,
  interactive: false,
};

const elements = {
  startButton: document.querySelector("#start-button"),
  startButtonLabel: document.querySelector("#start-button-label"),
  answerForm: document.querySelector("#answer-form"),
  answerInput: document.querySelector("#answer-input"),
  score: document.querySelector("#score"),
  timer: document.querySelector("#timer"),
  giveUpButton: document.querySelector("#give-up-button"),
  pauseButton: document.querySelector("#pause-button"),
  mapFrame: document.querySelector(".map-frame"),
  pauseOverlay: document.querySelector("#pause-overlay"),
  mapLoading: document.querySelector("#map-loading"),
  mergeGrid: document.querySelector("#merge-grid"),
  completionBar: document.querySelector("#completion-bar"),
  completionMessage: document.querySelector("#completion-message"),
  restartButton: document.querySelector("#restart-button"),
};

const L = window.L;

let mapData = null;
let statesByCode = new Map();
let stateLayersByCode = new Map();
let allBorders = [];
let selectedPairs = [];
let answerLookup = new Map();
let slotElementsByCode = new Map();
let guessedStates = new Set();
let map = null;
let stateLayer = null;
let borderLayer = null;
let mergedBorderMaskLayer = null;
let junctionStubIds = new Set();
let secondsLeft = QUIZ_SECONDS;
let timerHandle = null;
let isPlaying = false;
let isPaused = false;
let revealedStates = new Set();

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

function secureRandomIndex(maximum) {
  if (maximum <= 1) return 0;
  const maximumUint = 0x100000000;
  const limit = maximumUint - (maximumUint % maximum);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % maximum;
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomIndex(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function stateName(code) {
  return statesByCode.get(code)?.properties?.name || code;
}

function buildRoundAnswers() {
  answerLookup = new Map();
  const selectedCodes = new Set(selectedPairs.flatMap((pair) => [pair.a, pair.b]));
  for (const code of selectedCodes) {
    answerLookup.set(normalize(stateName(code)), code);
    answerLookup.set(normalize(code), code);
  }
}

function buildMergeGrid() {
  elements.mergeGrid.replaceChildren();
  slotElementsByCode = new Map();

  for (const pair of selectedPairs) {
    const card = document.createElement("article");
    card.className = "merge-card";

    const heading = document.createElement("h2");
    heading.textContent = "Merged States";
    card.append(heading);

    for (const code of [pair.a, pair.b]) {
      const row = document.createElement("div");
      row.className = "merge-answer";
      row.dataset.code = code;
      row.setAttribute("aria-label", "Unanswered state");
      card.append(row);

      if (!slotElementsByCode.has(code)) slotElementsByCode.set(code, []);
      slotElementsByCode.get(code).push(row);
    }

    elements.mergeGrid.append(card);
  }
}

function borderSegments(feature) {
  if (feature.geometry.type === "LineString") return [feature.geometry.coordinates];
  return feature.geometry.coordinates;
}

function borderEndpoints(feature) {
  const segments = borderSegments(feature);
  return [segments[0][0], segments.at(-1).at(-1)];
}

function coordinatesMatch(first, second) {
  return Math.abs(first[0] - second[0]) < 0.0001
    && Math.abs(first[1] - second[1]) < 0.0001;
}

function segmentLengthKm(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(second[1] - first[1]);
  const longitudeDelta = radians(second[0] - first[0]);
  const latitudeA = radians(first[1]);
  const latitudeB = radians(second[1]);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function borderLengthKm(feature) {
  return borderSegments(feature).reduce((total, segment) => (
    total + segment.slice(1).reduce(
      (segmentTotal, coordinate, index) => segmentTotal + segmentLengthKm(segment[index], coordinate),
      0,
    )
  ), 0);
}

function selectedAnswerCodes() {
  return new Set(selectedPairs.flatMap((pair) => [pair.a, pair.b]));
}

function connectedSelectedBorders() {
  const selectedCodes = selectedAnswerCodes();
  return allBorders.filter((feature) => (
    selectedCodes.has(feature.properties.a) && selectedCodes.has(feature.properties.b)
  ));
}

function findJunctionStubIds() {
  // A very short third-state border can become an isolated tick when the long
  // border beside it is removed (for example NM-OK beside a NM-TX merge).
  // Mask only those tiny endpoint-connected fragments so they cannot reveal a merge.
  const selectedFeatures = connectedSelectedBorders();
  const selectedIds = new Set(selectedFeatures.map((feature) => feature.properties.id));
  const stubIds = new Set();

  for (const selectedFeature of selectedFeatures) {
    const selectedEndpoints = borderEndpoints(selectedFeature);
    const selectedLength = borderLengthKm(selectedFeature);
    const selectedStates = new Set([
      selectedFeature.properties.a,
      selectedFeature.properties.b,
    ]);

    for (const candidate of allBorders) {
      if (selectedIds.has(candidate.properties.id)) continue;
      const sharedStateCount = [candidate.properties.a, candidate.properties.b]
        .filter((code) => selectedStates.has(code)).length;
      if (sharedStateCount !== 1) continue;

      const touchesSelectedEndpoint = borderEndpoints(candidate).some((candidateEndpoint) => (
        selectedEndpoints.some((selectedEndpoint) => coordinatesMatch(candidateEndpoint, selectedEndpoint))
      ));
      if (!touchesSelectedEndpoint) continue;

      const candidateLength = borderLengthKm(candidate);
      if (
        candidateLength <= MAX_JUNCTION_STUB_KM
        && candidateLength <= selectedLength * MAX_JUNCTION_STUB_RATIO
      ) {
        stubIds.add(candidate.properties.id);
      }
    }
  }

  return stubIds;
}

function stateFillColor(code) {
  if (guessedStates.has(code)) return FOUND_STYLE.fillColor;
  if (revealedStates.has(code)) return REVEALED_STYLE.fillColor;
  return NEUTRAL_STYLE.fillColor;
}

function mergedBorderMaskStyle(feature) {
  const colorA = stateFillColor(feature.properties.a);
  const colorB = stateFillColor(feature.properties.b);

  if (colorA === colorB) {
    return {
      ...MERGED_BORDER_MASK_STYLE,
      color: colorA,
      className: `merged-border-mask mask-${feature.properties.id}`,
    };
  }

  return {
    ...BORDER_STYLE,
    weight: 2.2,
    opacity: 1,
    className: `answered-merged-border border-${feature.properties.id}`,
  };
}

function renderBorders() {
  if (borderLayer) borderLayer.remove();
  if (mergedBorderMaskLayer) mergedBorderMaskLayer.remove();
  const matchingHighlightedBorderIds = allBorders
    .filter((feature) => {
      const colorA = stateFillColor(feature.properties.a);
      const colorB = stateFillColor(feature.properties.b);
      return colorA !== NEUTRAL_STYLE.fillColor && colorA === colorB;
    })
    .map((feature) => feature.properties.id);
  const connectedSelectedBorderIds = connectedSelectedBorders()
    .map((feature) => feature.properties.id);
  const removedBorderIds = new Set([
    ...connectedSelectedBorderIds,
    ...junctionStubIds,
    ...matchingHighlightedBorderIds,
  ]);

  mergedBorderMaskLayer = L.geoJSON(
    {
      type: "FeatureCollection",
      features: allBorders.filter((feature) => removedBorderIds.has(feature.properties.id)),
    },
    { style: mergedBorderMaskStyle },
  ).addTo(map);

  borderLayer = L.geoJSON(
    {
      type: "FeatureCollection",
      features: allBorders.filter((feature) => !removedBorderIds.has(feature.properties.id)),
    },
    {
      style: (feature) => ({
        ...BORDER_STYLE,
        className: `state-border border-${feature.properties.id}`,
      }),
    },
  ).addTo(map);

  // Keep every non-merged border above the wider masks so junctions remain crisp.
  borderLayer.bringToFront();
}

function resetStateStyles() {
  for (const layer of stateLayersByCode.values()) layer.setStyle(NEUTRAL_STYLE);
}

function prepareRound() {
  selectedPairs = shuffled(allBorders)
    .slice(0, PAIR_COUNT)
    .map((feature) => ({ ...feature.properties }));
  guessedStates = new Set();
  revealedStates = new Set();
  junctionStubIds = findJunctionStubIds();
  buildRoundAnswers();
  buildMergeGrid();
  resetStateStyles();
  renderBorders();
  updateScore();
}

function initializeMap() {
  if (!L) throw new Error("Leaflet did not load.");

  map = L.map("world-map", {
    zoomControl: true,
    attributionControl: false,
    scrollWheelZoom: false,
    worldCopyJump: false,
    zoomSnap: 0.25,
    minZoom: 3,
    maxZoom: 8,
  });

  stateLayer = L.geoJSON(mapData.states, {
    style: (feature) => ({
      ...NEUTRAL_STYLE,
      className: `state-shape state-${feature.properties.code}`,
    }),
    onEachFeature(feature, layer) {
      stateLayersByCode.set(feature.properties.code, layer);
    },
  }).addTo(map);

  L.geoJSON(mapData.outline, { style: OUTLINE_STYLE }).addTo(map);
  map.fitBounds(stateLayer.getBounds(), { padding: [14, 14], animate: false });
}

function filledSlotCount() {
  return selectedPairs.reduce(
    (count, pair) => count + Number(guessedStates.has(pair.a)) + Number(guessedStates.has(pair.b)),
    0,
  );
}

function updateScore() {
  elements.score.textContent = `${filledSlotCount()}/${SLOT_COUNT}`;
}

function fillAnswerSlots(code, state) {
  for (const row of slotElementsByCode.get(code) || []) {
    row.textContent = stateName(code);
    row.classList.add(state);
    row.setAttribute("aria-label", `${stateName(code)}, ${state}`);
  }
}

function acceptAnswer(code) {
  if (guessedStates.has(code)) return;
  elements.answerInput.value = "";
  guessedStates.add(code);
  fillAnswerSlots(code, "found");
  stateLayersByCode.get(code)?.setStyle(FOUND_STYLE);
  renderBorders();
  updateScore();
  if (filledSlotCount() === SLOT_COUNT) finishQuiz("complete");
}

function tryAnswer() {
  if (!isPlaying || isPaused) return;
  const code = answerLookup.get(normalize(elements.answerInput.value));
  if (code) acceptAnswer(code);
}

function updatePauseButton() {
  const label = isPaused ? "Resume" : "Pause";
  elements.pauseButton.classList.toggle("is-paused", isPaused);
  elements.pauseButton.setAttribute("aria-label", label);
  elements.pauseButton.title = label;
}

function setMapPaused(paused) {
  elements.mapFrame.classList.toggle("is-paused", paused);
  elements.pauseOverlay.setAttribute("aria-hidden", String(!paused));
}

function startTimer() {
  window.clearInterval(timerHandle);
  timerHandle = window.setInterval(() => {
    secondsLeft -= 1;
    elements.timer.textContent = formatTime(Math.max(secondsLeft, 0));
    if (secondsLeft <= 0) finishQuiz("time");
  }, 1000);
}

function pauseQuiz() {
  if (!isPlaying || isPaused) return;
  window.clearInterval(timerHandle);
  isPaused = true;
  elements.answerInput.disabled = true;
  elements.giveUpButton.disabled = true;
  setMapPaused(true);
  updatePauseButton();
}

function resumeQuiz() {
  if (!isPlaying || !isPaused) return;
  isPaused = false;
  setMapPaused(false);
  updatePauseButton();
  elements.answerInput.disabled = false;
  elements.giveUpButton.disabled = false;
  elements.pauseButton.disabled = false;
  elements.answerInput.focus();
  startTimer();
}

function togglePause() {
  if (isPaused) resumeQuiz();
  else pauseQuiz();
}

function setPlayingControls(playing) {
  elements.startButton.hidden = playing;
  elements.answerForm.hidden = !playing;
  elements.answerInput.disabled = !playing;
  elements.giveUpButton.hidden = !playing;
  elements.giveUpButton.disabled = !playing;
  elements.pauseButton.hidden = !playing;
  elements.pauseButton.disabled = !playing;
}

function resetRoundAnswers() {
  guessedStates = new Set();
  revealedStates = new Set();
  for (const rows of slotElementsByCode.values()) {
    for (const row of rows) {
      row.textContent = "";
      row.className = "merge-answer";
      row.setAttribute("aria-label", "Unanswered state");
    }
  }
  resetStateStyles();
  renderBorders();
  updateScore();
}

function startQuiz() {
  window.clearInterval(timerHandle);
  secondsLeft = QUIZ_SECONDS;
  isPlaying = true;
  isPaused = false;
  setMapPaused(false);
  updatePauseButton();
  resetRoundAnswers();

  elements.timer.textContent = formatTime(secondsLeft);
  elements.answerInput.value = "";
  elements.completionBar.hidden = true;
  setPlayingControls(true);
  elements.answerInput.focus();
  startTimer();
}

function finishQuiz(reason) {
  if (!isPlaying) return;
  const foundBeforeReveal = filledSlotCount();
  isPlaying = false;
  window.clearInterval(timerHandle);
  isPaused = false;
  setMapPaused(false);
  updatePauseButton();
  elements.answerInput.disabled = true;
  elements.giveUpButton.disabled = true;
  elements.giveUpButton.hidden = true;
  elements.pauseButton.disabled = true;
  elements.pauseButton.hidden = true;

  if (reason !== "complete") {
    for (const code of new Set(selectedPairs.flatMap((pair) => [pair.a, pair.b]))) {
      if (guessedStates.has(code)) continue;
      revealedStates.add(code);
      fillAnswerSlots(code, "revealed");
      stateLayersByCode.get(code)?.setStyle(REVEALED_STYLE);
    }
  }

  renderBorders();

  elements.completionMessage.textContent = reason === "complete"
    ? "Perfect — you found all ten answer slots."
    : `You found ${foundBeforeReveal} of ${SLOT_COUNT} answer slots. The remaining states are now revealed.`;
  elements.completionBar.hidden = false;
}

async function loadQuiz() {
  const response = await fetch("./assets/map_data.json");
  if (!response.ok) throw new Error(`Could not load map data (${response.status}).`);
  mapData = await response.json();
  statesByCode = new Map(mapData.states.features.map((feature) => [feature.properties.code, feature]));
  allBorders = mapData.borders.features;

  if (statesByCode.size !== 48 || allBorders.length !== 105) {
    throw new Error("The contiguous-state map data is incomplete.");
  }

  initializeMap();
  prepareRound();
  elements.mapLoading.hidden = true;
  elements.startButtonLabel.textContent = "PLAY QUIZ";
  elements.startButton.disabled = false;
}

elements.startButton.addEventListener("click", startQuiz);
elements.restartButton.addEventListener("click", () => {
  prepareRound();
  startQuiz();
});
elements.answerInput.addEventListener("input", tryAnswer);
elements.answerForm.addEventListener("submit", (event) => event.preventDefault());
elements.giveUpButton.addEventListener("click", () => finishQuiz("giveup"));
elements.pauseButton.addEventListener("click", togglePause);

loadQuiz().catch((error) => {
  console.error(error);
  elements.mapLoading.textContent = "The US states map could not be loaded.";
  elements.startButtonLabel.textContent = "MAP LOAD FAILED";
  elements.startButton.disabled = true;
});
