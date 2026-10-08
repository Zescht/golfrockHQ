const QUIZ_SECONDS = 4 * 60;
const PAIR_COUNT = 5;
const SLOT_COUNT = PAIR_COUNT * 2;

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
  const removedBorderIds = new Set(selectedPairs.map((pair) => pair.id));

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
