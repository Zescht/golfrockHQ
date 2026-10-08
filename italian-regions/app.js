const QUIZ_SECONDS = 5 * 60;

const queryParameters = new URLSearchParams(window.location.search);
const requestedLanguage = queryParameters.get("lang") === "de" ? "de" : "en";
document.documentElement.lang = requestedLanguage;

const UI_TEXT = {
  en: {
    languageLabel: "Language",
    quizNavLabel: "Quiz selection",
    porscheQuiz: "Porsche Centre",
    italyQuiz: "Italian Regions",
    pageTitle: "Italian Regions — Map Quiz",
    title: "Italian Regions",
    intro: "Name all 20 regions of Italy. Each region counts once.",
    answerLabel: "Enter Regions:",
    answerHelp: "Correct region names are accepted automatically. Incorrect answers receive no response.",
    scoreLabel: "POINTS",
    timerLabel: "TIMER",
    giveUp: "Give up",
    mapAria: "Map of Italy divided into its 20 regions. Correct answers are highlighted.",
    loadingMap: "Loading Italy map…",
    startQuiz: "PLAY QUIZ",
    playAgain: "Play again",
    mapLoadFailed: "The Italy map could not be loaded.",
    attribution: "Regional boundaries:",
    perfect: "Perfect — you found all 20 Italian regions.",
    revealed: (found) => `You found ${found} of 20. The remaining regions are now revealed.`,
  },
  de: {
    languageLabel: "Sprache",
    quizNavLabel: "Quizauswahl",
    porscheQuiz: "Porsche Zentrum",
    italyQuiz: "Italienische Regionen",
    pageTitle: "Italienische Regionen — Kartenquiz",
    title: "Italienische Regionen",
    intro: "Nenne alle 20 Regionen Italiens. Jede Region zählt einmal.",
    answerLabel: "Regionen eingeben:",
    answerHelp: "Korrekte Regionsnamen werden automatisch angenommen. Bei falschen Antworten erfolgt keine Reaktion.",
    scoreLabel: "PUNKTE",
    timerLabel: "ZEIT",
    giveUp: "Aufgeben",
    mapAria: "Karte Italiens mit seinen 20 Regionen. Richtige Antworten werden hervorgehoben.",
    loadingMap: "Italienkarte wird geladen…",
    startQuiz: "QUIZ SPIELEN",
    playAgain: "Nochmal spielen",
    mapLoadFailed: "Die Italienkarte konnte nicht geladen werden.",
    attribution: "Regionsgrenzen:",
    perfect: "Perfekt — du hast alle 20 italienischen Regionen gefunden.",
    revealed: (found) => `Du hast ${found} von 20 gefunden. Die übrigen Regionen werden jetzt angezeigt.`,
  },
};

const copy = UI_TEXT[requestedLanguage];

const CONTEXT_STYLE = {
  color: "#666d72",
  weight: 1.05,
  opacity: 0.9,
  fillColor: "#dedede",
  fillOpacity: 0.94,
};

const NEUTRAL_STYLE = {
  color: "#707980",
  weight: 1.15,
  opacity: 0.95,
  fillColor: "#f4f1e6",
  fillOpacity: 0.92,
};

const FOUND_STYLE = {
  color: "#a82316",
  weight: 1.4,
  opacity: 1,
  fillColor: "#df482d",
  fillOpacity: 0.9,
};

const REVEALED_STYLE = {
  color: "#bd6730",
  weight: 1.25,
  opacity: 1,
  fillColor: "#f3a45f",
  fillOpacity: 0.84,
};

const elements = {
  languageLabel: document.querySelector("#language-label"),
  languageSelect: document.querySelector("#language-select"),
  quizSelector: document.querySelector("#quiz-selector"),
  porscheQuizLink: document.querySelector("#porsche-quiz-link"),
  italyQuizLink: document.querySelector("#italy-quiz-link"),
  title: document.querySelector("#title-line-1"),
  intro: document.querySelector("#intro-text"),
  startButton: document.querySelector("#start-button"),
  startButtonLabel: document.querySelector("#start-button-label"),
  answerForm: document.querySelector("#answer-form"),
  answerLabel: document.querySelector("#answer-label"),
  answerHelp: document.querySelector("#answer-help"),
  answerInput: document.querySelector("#answer-input"),
  scoreLabel: document.querySelector("#score-label"),
  score: document.querySelector("#score"),
  timerLabel: document.querySelector("#timer-label"),
  timer: document.querySelector("#timer"),
  giveUpButton: document.querySelector("#give-up-button"),
  map: document.querySelector("#world-map"),
  mapLoading: document.querySelector("#map-loading"),
  completionBar: document.querySelector("#completion-bar"),
  completionMessage: document.querySelector("#completion-message"),
  restartButton: document.querySelector("#restart-button"),
};

const L = window.L;

let regions = [];
let answerLookup = new Map();
let map = null;
let contextLayer = null;
let boundaryLayer = null;
let layersByCode = new Map();
let labels = [];
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

function displayName(region) {
  return region[requestedLanguage];
}

function applyLanguage() {
  document.title = copy.pageTitle;
  elements.languageLabel.textContent = copy.languageLabel;
  elements.languageSelect.setAttribute("aria-label", copy.languageLabel);
  elements.languageSelect.value = requestedLanguage;
  elements.quizSelector.setAttribute("aria-label", copy.quizNavLabel);
  elements.porscheQuizLink.textContent = copy.porscheQuiz;
  elements.italyQuizLink.textContent = copy.italyQuiz;
  elements.porscheQuizLink.href = `../porsche/?lang=${requestedLanguage}`;
  elements.italyQuizLink.href = `../italian-regions/?lang=${requestedLanguage}`;
  elements.title.textContent = copy.title;
  elements.intro.textContent = copy.intro;
  elements.answerLabel.textContent = copy.answerLabel;
  elements.answerHelp.textContent = copy.answerHelp;
  elements.scoreLabel.textContent = copy.scoreLabel;
  elements.timerLabel.textContent = copy.timerLabel;
  elements.giveUpButton.textContent = copy.giveUp;
  elements.map.setAttribute("aria-label", copy.mapAria);
  elements.mapLoading.textContent = copy.loadingMap;
  elements.restartButton.textContent = copy.playAgain;
}

function buildAnswerLookup() {
  answerLookup = new Map();
  for (const region of regions) {
    for (const answer of [region.en, region.de, region.it, ...region.aliases]) {
      const key = normalize(answer);
      const existing = answerLookup.get(key);
      if (existing && existing.id !== region.id) {
        throw new Error(`Ambiguous region answer: ${answer}`);
      }
      answerLookup.set(key, region);
    }
  }
}

function fitItaly() {
  if (!map || !boundaryLayer) return;
  map.invalidateSize(false);
  map.fitBounds(boundaryLayer.getBounds(), { animate: false, padding: [24, 24] });
}

function initializeMap(regionalGeojson, worldGeojson) {
  if (!L) throw new Error("Leaflet did not load.");

  map = L.map("world-map", {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false,
    worldCopyJump: false,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    minZoom: 4,
    maxZoom: 9,
    maxBounds: [
      [32, -2],
      [50, 25],
    ],
    maxBoundsViscosity: 1,
  });

  contextLayer = L.geoJSON(worldGeojson, {
    interactive: false,
    style: () => ({ ...CONTEXT_STYLE }),
  }).addTo(map);

  layersByCode = new Map();
  boundaryLayer = L.geoJSON(regionalGeojson, {
    style: () => ({ ...NEUTRAL_STYLE }),
    onEachFeature(feature, layer) {
      const code = String(feature.properties?.reg_istat_code || "").padStart(2, "0");
      if (code) layersByCode.set(code, layer);
    },
  }).addTo(map);

  map.attributionControl.addAttribution(
    `${copy.attribution} <a href="https://github.com/guglielmo/geojson-italy">ISTAT / geojson-italy</a> · <a href="https://www.naturalearthdata.com/">Natural Earth</a>`
  );
  fitItaly();

  let resizeHandle = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeHandle);
    resizeHandle = window.setTimeout(fitItaly, 80);
  });
}

function validateCoverage() {
  const missing = regions.filter((region) => !layersByCode.has(region.code));
  if (missing.length) throw new Error(`Missing regional geometry: ${missing.map((region) => region.en).join(", ")}`);
}

function clearLabels() {
  for (const label of labels) label.remove();
  labels = [];
}

function resetMap() {
  clearLabels();
  if (boundaryLayer) boundaryLayer.setStyle(() => ({ ...NEUTRAL_STYLE }));
}

function revealRegion(region, state) {
  const layer = layersByCode.get(region.code);
  if (!layer) return;
  layer.setStyle(state === "found" ? { ...FOUND_STYLE } : { ...REVEALED_STYLE });
  layer.bringToFront();

  const labelNode = document.createElement("span");
  labelNode.textContent = displayName(region);
  const label = L.tooltip({
    permanent: true,
    direction: "center",
    className: `country-label ${state}`,
    interactive: false,
    opacity: 1,
  })
    .setLatLng(region.labelPoint)
    .setContent(labelNode)
    .addTo(map);
  labels.push(label);
}

function updateScore() {
  elements.score.textContent = `${guessed.size}/${regions.length}`;
}

function acceptAnswer(region) {
  if (guessed.has(region.id)) return;
  elements.answerInput.value = "";
  guessed.add(region.id);
  revealRegion(region, "found");
  updateScore();
  if (guessed.size === regions.length) finishQuiz("complete");
}

function tryAnswer() {
  if (!isPlaying) return;
  const region = answerLookup.get(normalize(elements.answerInput.value));
  if (region) acceptAnswer(region);
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
  resetMap();
  updateScore();
  fitItaly();

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
    for (const region of regions) {
      if (!guessed.has(region.id)) revealRegion(region, "revealed");
    }
  }

  elements.completionMessage.textContent = reason === "complete" ? copy.perfect : copy.revealed(guessed.size);
  elements.completionBar.hidden = false;
}

async function loadQuiz() {
  const [quizResponse, geometryResponse, contextResponse] = await Promise.all([
    fetch("./quiz_data.json", { cache: "no-store" }),
    fetch("./assets/italy-regions.geojson"),
    fetch("../assets/ne_50m_admin_0_map_units.geojson"),
  ]);

  if (!quizResponse.ok) throw new Error(`Could not load quiz data (${quizResponse.status}).`);
  if (!geometryResponse.ok) throw new Error(`Could not load map data (${geometryResponse.status}).`);
  if (!contextResponse.ok) throw new Error(`Could not load context map (${contextResponse.status}).`);

  const quizData = await quizResponse.json();
  const geography = await geometryResponse.json();
  const worldGeography = await contextResponse.json();
  regions = quizData.regions;
  if (quizData.answerCount !== regions.length || regions.length !== 20) {
    throw new Error("The Italian regions answer count is inconsistent.");
  }

  buildAnswerLookup();
  initializeMap(geography, worldGeography);
  validateCoverage();

  elements.score.textContent = `0/${regions.length}`;
  elements.timer.textContent = formatTime(QUIZ_SECONDS);
  elements.mapLoading.hidden = true;
  elements.startButtonLabel.textContent = copy.startQuiz;
  elements.startButton.disabled = false;
}

applyLanguage();

elements.startButton.addEventListener("click", startQuiz);
elements.restartButton.addEventListener("click", startQuiz);
elements.answerInput.addEventListener("input", tryAnswer);
elements.answerForm.addEventListener("submit", (event) => event.preventDefault());
elements.giveUpButton.addEventListener("click", () => finishQuiz("giveup"));
elements.languageSelect.addEventListener("change", () => {
  const url = new URL(window.location.href);
  url.searchParams.set("lang", elements.languageSelect.value);
  window.location.assign(url);
});

loadQuiz().catch((error) => {
  console.error(error);
  elements.mapLoading.textContent = copy.mapLoadFailed;
  elements.startButtonLabel.textContent = copy.mapLoadFailed.toUpperCase();
  elements.startButton.disabled = true;
});
