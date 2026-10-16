const QUIZ_SECONDS = 5 * 60;

const queryParameters = new URLSearchParams(window.location.search);
const requestedLanguage = queryParameters.get("lang") === "de" ? "de" : "en";
const quizType = document.body.dataset.quiz === "oldest" ? "oldest" : "largest";
document.documentElement.lang = requestedLanguage;

const UI_TEXT = {
  en: {
    languageLabel: "Language",
    quizNavLabel: "Quiz selection",
    nav: { porsche: "Porsche Centre", italy: "Italian Regions", merged: "Merged US States", largest: "Largest Opera Houses", oldest: "Oldest Opera Houses" },
    largest: { pageTitle: "Largest Opera Houses — Quiz", title: "Largest Opera Houses", intro: "Name the ten largest opera-first houses by fixed seats in their main opera auditorium.", boardAria: "Largest opera houses answer table", valueHeading: "Seats", perfect: "Perfect — you found all ten largest opera houses.", revealed: (found) => `You found ${found} of 10. The remaining opera houses are now revealed.` },
    oldest: { pageTitle: "Oldest Opera Houses — Quiz", title: "Oldest Operating Opera Houses", intro: "Name the ten oldest surviving historic opera houses that still present opera.", boardAria: "Oldest opera houses answer table", valueHeading: "Opened", perfect: "Perfect — you found all ten historic opera houses.", revealed: (found) => `You found ${found} of 10. The remaining opera houses are now revealed.` },
    answerLabel: "Enter Opera Houses:", answerHelp: "Correct opera-house names are accepted automatically. Incorrect or repeated answers receive no response.", scoreLabel: "POINTS", timerLabel: "TIMER", giveUp: "Give up", pause: "Pause", resume: "Resume", pauseMessage: "Pause", loading: "Loading quiz…", loadFailed: "The quiz could not be loaded.", startQuiz: "PLAY QUIZ", playAgain: "Play again", rankHeading: "Rank", locationHeading: "Location", answerHeading: "Opera House",
  },
  de: {
    languageLabel: "Sprache",
    quizNavLabel: "Quizauswahl",
    nav: { porsche: "Porsche Zentrum", italy: "Italienische Regionen", merged: "Merged US States", largest: "Größte Opernhäuser", oldest: "Älteste Opernhäuser" },
    largest: { pageTitle: "Größte Opernhäuser — Quiz", title: "Größte Opernhäuser", intro: "Nenne die zehn größten Opernhäuser nach festen Sitzplätzen im Hauptsaal für Opernaufführungen.", boardAria: "Antworttabelle der größten Opernhäuser", valueHeading: "Sitzplätze", perfect: "Perfekt — du hast alle zehn größten Opernhäuser gefunden.", revealed: (found) => `Du hast ${found} von 10 gefunden. Die übrigen Opernhäuser werden jetzt angezeigt.` },
    oldest: { pageTitle: "Älteste Opernhäuser — Quiz", title: "Älteste noch betriebene Opernhäuser", intro: "Nenne die zehn ältesten erhaltenen historischen Opernhäuser, in denen weiterhin Opern aufgeführt werden.", boardAria: "Antworttabelle der ältesten Opernhäuser", valueHeading: "Eröffnet", perfect: "Perfekt — du hast alle zehn historischen Opernhäuser gefunden.", revealed: (found) => `Du hast ${found} von 10 gefunden. Die übrigen Opernhäuser werden jetzt angezeigt.` },
    answerLabel: "Opernhäuser eingeben:", answerHelp: "Korrekte Namen werden automatisch angenommen. Bei falschen oder wiederholten Antworten erfolgt keine Reaktion.", scoreLabel: "PUNKTE", timerLabel: "ZEIT", giveUp: "Aufgeben", pause: "Pause", resume: "Fortsetzen", pauseMessage: "Pause", loading: "Quiz wird geladen…", loadFailed: "Das Quiz konnte nicht geladen werden.", startQuiz: "QUIZ SPIELEN", playAgain: "Nochmal spielen", rankHeading: "Rang", locationHeading: "Ort", answerHeading: "Opernhaus",
  },
};

const copy = UI_TEXT[requestedLanguage];
const quizCopy = copy[quizType];
const elements = {
  languageLabel: document.querySelector("#language-label"), languageSelect: document.querySelector("#language-select"), quizSelector: document.querySelector("#quiz-selector"),
  porscheLink: document.querySelector("#porsche-quiz-link"), italyLink: document.querySelector("#italy-quiz-link"), mergedLink: document.querySelector("#merged-states-quiz-link"), largestLink: document.querySelector("#largest-opera-link"), oldestLink: document.querySelector("#oldest-opera-link"),
  title: document.querySelector("#page-title"), intro: document.querySelector("#intro-text"), startButton: document.querySelector("#start-button"), startButtonLabel: document.querySelector("#start-button-label"), answerForm: document.querySelector("#answer-form"), answerLabel: document.querySelector("#answer-label"), answerHelp: document.querySelector("#answer-help"), answerInput: document.querySelector("#answer-input"),
  scoreLabel: document.querySelector("#score-label"), score: document.querySelector("#score"), timerLabel: document.querySelector("#timer-label"), timer: document.querySelector("#timer"), giveUpButton: document.querySelector("#give-up-button"), pauseButton: document.querySelector("#pause-button"), surface: document.querySelector(".quiz-surface"), board: document.querySelector("#answer-board"), boardLoading: document.querySelector("#board-loading"), pauseOverlay: document.querySelector("#pause-overlay"), pauseMessage: document.querySelector("#pause-message"), completionBar: document.querySelector("#completion-bar"), completionMessage: document.querySelector("#completion-message"), restartButton: document.querySelector("#restart-button"),
};

let entries = [], answerLookup = new Map(), rowsById = new Map(), guessed = new Set();
let secondsLeft = QUIZ_SECONDS, timerHandle = null, isPlaying = false, isPaused = false;

function normalize(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim(); }
function formatTime(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

function applyLanguage() {
  document.title = quizCopy.pageTitle; elements.languageLabel.textContent = copy.languageLabel; elements.languageSelect.setAttribute("aria-label", copy.languageLabel); elements.languageSelect.value = requestedLanguage; elements.quizSelector.setAttribute("aria-label", copy.quizNavLabel);
  elements.porscheLink.textContent = copy.nav.porsche; elements.italyLink.textContent = copy.nav.italy; elements.mergedLink.textContent = copy.nav.merged; elements.largestLink.textContent = copy.nav.largest; elements.oldestLink.textContent = copy.nav.oldest;
  elements.porscheLink.href = `../porsche/?lang=${requestedLanguage}`; elements.italyLink.href = `../italian-regions/?lang=${requestedLanguage}`; elements.mergedLink.href = "../randomly-merged-us-states/?lang=en"; elements.largestLink.href = `../largest-opera-houses/?lang=${requestedLanguage}`; elements.oldestLink.href = `../oldest-opera-houses/?lang=${requestedLanguage}`;
  elements.title.textContent = quizCopy.title; elements.intro.textContent = quizCopy.intro; elements.answerLabel.textContent = copy.answerLabel; elements.answerHelp.textContent = copy.answerHelp; elements.scoreLabel.textContent = copy.scoreLabel; elements.timerLabel.textContent = copy.timerLabel; elements.giveUpButton.textContent = copy.giveUp; elements.pauseMessage.textContent = copy.pauseMessage; elements.boardLoading.textContent = copy.loading; elements.board.setAttribute("aria-label", quizCopy.boardAria); elements.restartButton.textContent = copy.playAgain; updatePauseButton();
}

function buildAnswerLookup() {
  answerLookup = new Map();
  for (const entry of entries) for (const answer of [entry.name, ...entry.aliases]) { const key = normalize(answer); const existing = answerLookup.get(key); if (existing && existing.id !== entry.id) throw new Error(`Ambiguous answer: ${answer}`); answerLookup.set(key, entry); }
}

function renderBoard() {
  const table = document.createElement("table"); table.className = "quiz-table";
  const thead = document.createElement("thead"), headerRow = document.createElement("tr");
  for (const [className, label] of [["rank-column", copy.rankHeading], ["value-column", quizCopy.valueHeading], ["location-column", copy.locationHeading], ["answer-column", copy.answerHeading]]) { const th = document.createElement("th"); th.className = className; th.scope = "col"; th.textContent = label; headerRow.append(th); }
  thead.append(headerRow); table.append(thead);
  const tbody = document.createElement("tbody"); rowsById = new Map();
  for (const entry of entries) {
    const row = document.createElement("tr"); row.dataset.entryId = entry.id;
    const rankCell = document.createElement("td"); rankCell.className = "rank-cell"; rankCell.textContent = String(entry.rank);
    const valueCell = document.createElement("td"); valueCell.className = "value-cell"; valueCell.textContent = entry.value;
    const locationCell = document.createElement("td"); locationCell.className = "location-cell"; const city = entry.city[requestedLanguage], country = entry.country[requestedLanguage]; locationCell.innerHTML = `<strong>${city}</strong><span>${country}</span>`;
    const answerCell = document.createElement("td"); answerCell.className = "answer-cell"; const answerBox = document.createElement("span"); answerBox.className = "answer-box"; answerBox.setAttribute("aria-label", `${copy.answerHeading} ${entry.rank}`); answerCell.append(answerBox);
    row.append(rankCell, valueCell, locationCell, answerCell); tbody.append(row); rowsById.set(entry.id, { row, answerBox });
  }
  table.append(tbody); elements.board.replaceChildren(table);
}

function resetBoard() { for (const { row, answerBox } of rowsById.values()) { row.classList.remove("found", "revealed"); answerBox.textContent = ""; } }
function revealEntry(entry, state) { const rowData = rowsById.get(entry.id); if (!rowData) return; rowData.row.classList.remove("found", "revealed"); rowData.row.classList.add(state); rowData.answerBox.textContent = entry.name; }
function updateScore() { elements.score.textContent = `${guessed.size}/${entries.length}`; }
function acceptAnswer(entry) { if (guessed.has(entry.id)) return; guessed.add(entry.id); elements.answerInput.value = ""; revealEntry(entry, "found"); updateScore(); if (guessed.size === entries.length) finishQuiz("complete"); }
function tryAnswer() { if (!isPlaying || isPaused) return; const entry = answerLookup.get(normalize(elements.answerInput.value)); if (entry) acceptAnswer(entry); }
function updatePauseButton() { const label = isPaused ? copy.resume : copy.pause; elements.pauseButton.classList.toggle("is-paused", isPaused); elements.pauseButton.setAttribute("aria-label", label); elements.pauseButton.title = label; }
function setPaused(paused) { elements.surface.classList.toggle("is-paused", paused); elements.pauseOverlay.setAttribute("aria-hidden", String(!paused)); }
function startTimer() { window.clearInterval(timerHandle); timerHandle = window.setInterval(() => { secondsLeft -= 1; elements.timer.textContent = formatTime(Math.max(secondsLeft, 0)); if (secondsLeft <= 0) finishQuiz("time"); }, 1000); }
function pauseQuiz() { if (!isPlaying || isPaused) return; window.clearInterval(timerHandle); isPaused = true; elements.answerInput.disabled = true; elements.giveUpButton.disabled = true; setPaused(true); updatePauseButton(); }
function resumeQuiz() { if (!isPlaying || !isPaused) return; isPaused = false; setPaused(false); updatePauseButton(); elements.answerInput.disabled = false; elements.giveUpButton.disabled = false; elements.pauseButton.disabled = false; elements.answerInput.focus(); startTimer(); }
function togglePause() { if (isPaused) resumeQuiz(); else pauseQuiz(); }
function setPlayingControls(playing) { elements.startButton.hidden = playing; elements.answerForm.hidden = !playing; elements.answerInput.disabled = !playing; elements.giveUpButton.hidden = !playing; elements.giveUpButton.disabled = !playing; elements.pauseButton.hidden = !playing; elements.pauseButton.disabled = !playing; }

function startQuiz() {
  window.clearInterval(timerHandle); guessed = new Set(); secondsLeft = QUIZ_SECONDS; isPlaying = true; isPaused = false; setPaused(false); updatePauseButton(); resetBoard(); updateScore(); elements.timer.textContent = formatTime(secondsLeft); elements.answerInput.value = ""; elements.completionBar.hidden = true; setPlayingControls(true); elements.answerInput.focus(); startTimer();
}

function finishQuiz(reason) {
  if (!isPlaying) return; isPlaying = false; window.clearInterval(timerHandle); isPaused = false; setPaused(false); updatePauseButton(); elements.answerInput.disabled = true; elements.giveUpButton.disabled = true; elements.giveUpButton.hidden = true; elements.pauseButton.disabled = true; elements.pauseButton.hidden = true;
  if (reason !== "complete") for (const entry of entries) if (!guessed.has(entry.id)) revealEntry(entry, "revealed");
  elements.completionMessage.textContent = reason === "complete" ? quizCopy.perfect : quizCopy.revealed(guessed.size); elements.completionBar.hidden = false;
}

async function loadQuiz() {
  const response = await fetch("./quiz_data.json", { cache: "no-store" }); if (!response.ok) throw new Error(`Could not load quiz data (${response.status}).`); const data = await response.json(); entries = data.entries;
  if (data.type !== quizType || data.answerCount !== entries.length || entries.length !== 10) throw new Error("The opera-house answer data is inconsistent.");
  buildAnswerLookup(); renderBoard(); updateScore(); elements.timer.textContent = formatTime(QUIZ_SECONDS); elements.boardLoading.hidden = true; elements.startButtonLabel.textContent = copy.startQuiz; elements.startButton.disabled = false;
}

applyLanguage(); elements.startButton.addEventListener("click", startQuiz); elements.restartButton.addEventListener("click", startQuiz); elements.answerInput.addEventListener("input", tryAnswer); elements.answerForm.addEventListener("submit", (event) => event.preventDefault()); elements.giveUpButton.addEventListener("click", () => finishQuiz("giveup")); elements.pauseButton.addEventListener("click", togglePause);
elements.languageSelect.addEventListener("change", () => { const url = new URL(window.location.href); url.searchParams.set("lang", elements.languageSelect.value); window.location.assign(url); });
loadQuiz().catch((error) => { console.error(error); elements.boardLoading.textContent = copy.loadFailed; elements.startButtonLabel.textContent = copy.loadFailed.toUpperCase(); elements.startButton.disabled = true; });
