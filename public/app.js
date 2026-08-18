// Initialize Firebase (config injected via firebase-config.js)
firebase.initializeApp(window.FIREBASE_CONFIG);
const functions = firebase.functions();

const runTribunal = functions.httpsCallable("runTribunal");
const listCharges = functions.httpsCallable("listCharges");
const listJudges = functions.httpsCallable("listJudges");
const seedJudges = functions.httpsCallable("seedJudges");

const seedBanner = document.getElementById("seed-banner");
const seedBtn = document.getElementById("seed-btn");
const filingSection = document.getElementById("filing-section");
const loadingSection = document.getElementById("loading-section");
const resultsSection = document.getElementById("results-section");
const chargeInput = document.getElementById("charge-input");
const chargeSelect = document.getElementById("charge-select");
const judgeCheckboxes = document.getElementById("judge-checkboxes");
const submitBtn = document.getElementById("submit-btn");
const newTrialBtn = document.getElementById("new-trial-btn");
const errorMsg = document.getElementById("error-msg");
const loadingText = document.getElementById("loading-text");

const LOADING_MESSAGES = [
  "The advocates are preparing their arguments\u2026",
  "Both sides are making their case\u2026",
  "The bench is deliberating\u2026",
];

let loadingInterval;

// ---------------------------------------------------------------------------
// Initial load: judges + past charges
// ---------------------------------------------------------------------------

async function loadJudges() {
  const result = await listJudges();
  const judges = result.data;

  if (judges.length === 0) {
    seedBanner.hidden = false;
    judgeCheckboxes.innerHTML = "<p class='empty-note'>No judges yet.</p>";
    return;
  }

  seedBanner.hidden = true;
  judgeCheckboxes.innerHTML = "";
  judges.forEach((judge) => {
    const label = document.createElement("label");
    label.className = "judge-checkbox";
    label.innerHTML = `
      <input type="checkbox" value="${judge.id}" checked>
      <span>
        <strong>${escapeHtml(judge.name)}</strong>
        <em>${escapeHtml(judge.inspiration)}</em>
      </span>
    `;
    judgeCheckboxes.appendChild(label);
  });
}

async function loadCharges() {
  const result = await listCharges();
  const charges = result.data;
  charges.forEach((charge) => {
    const opt = document.createElement("option");
    opt.value = charge.id;
    opt.textContent = charge.text.length > 80 ? charge.text.slice(0, 77) + "\u2026" : charge.text;
    chargeSelect.appendChild(opt);
  });
}

chargeSelect.addEventListener("change", () => {
  if (chargeSelect.value) {
    chargeInput.disabled = true;
    chargeInput.placeholder = "Using the selected past charge above.";
    chargeInput.value = "";
  } else {
    chargeInput.disabled = false;
    chargeInput.placeholder = "e.g. Should Jon Snow be executed for the killing of Daenerys Targaryen?";
  }
});

seedBtn.addEventListener("click", async () => {
  seedBtn.disabled = true;
  seedBtn.textContent = "Seeding\u2026";
  try {
    await seedJudges();
    await loadJudges();
  } catch (err) {
    errorMsg.textContent = "Could not seed judges: " + (err.message || "unknown error.");
    errorMsg.hidden = false;
  } finally {
    seedBtn.disabled = false;
    seedBtn.textContent = "Seed Default Judges";
  }
});

loadJudges();
loadCharges();

// ---------------------------------------------------------------------------
// Submit a trial
// ---------------------------------------------------------------------------

submitBtn.addEventListener("click", async () => {
  errorMsg.hidden = true;

  const selectedJudgeIds = Array.from(
    judgeCheckboxes.querySelectorAll("input[type=checkbox]:checked")
  ).map((el) => el.value);

  if (selectedJudgeIds.length === 0) {
    errorMsg.textContent = "Select at least one judge to preside.";
    errorMsg.hidden = false;
    return;
  }

  const chargeId = chargeSelect.value || null;
  const chargeText = chargeInput.value.trim();

  if (!chargeId && !chargeText) {
    errorMsg.textContent = "Enter a charge, or pick a past one to reuse.";
    errorMsg.hidden = false;
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked').value;

  filingSection.hidden = true;
  loadingSection.hidden = false;
  resultsSection.hidden = true;

  let msgIndex = 0;
  loadingText.textContent = LOADING_MESSAGES[0];
  loadingInterval = setInterval(() => {
    msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
    loadingText.textContent = LOADING_MESSAGES[msgIndex];
  }, 2800);

  try {
    const payload = chargeId
      ? { chargeId, mode, judgeIds: selectedJudgeIds }
      : { chargeText, mode, judgeIds: selectedJudgeIds };

    const result = await runTribunal(payload);
    renderResults(result.data);
    loadingSection.hidden = true;
    resultsSection.hidden = false;

    // Refresh the charge list in case a new one was just created.
    if (!chargeId) {
      chargeSelect.innerHTML = '<option value="">— Write a new charge below —</option>';
      await loadCharges();
    }
  } catch (err) {
    clearInterval(loadingInterval);
    loadingSection.hidden = true;
    filingSection.hidden = false;
    errorMsg.textContent = "The tribunal could not convene: " + (err.message || "unknown error.");
    errorMsg.hidden = false;
  } finally {
    clearInterval(loadingInterval);
  }
});

newTrialBtn.addEventListener("click", () => {
  resultsSection.hidden = true;
  filingSection.hidden = false;
  chargeInput.value = "";
  chargeInput.disabled = false;
  chargeSelect.value = "";
  chargeInput.focus();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderResults(data) {
  document.getElementById("result-charge").textContent = data.charge;

  const forContainer = document.getElementById("for-arguments");
  const againstContainer = document.getElementById("against-arguments");
  forContainer.innerHTML = "";
  againstContainer.innerHTML = "";

  data.arguments.for.forEach((text) => forContainer.appendChild(argumentCard(text)));
  data.arguments.against.forEach((text) => againstContainer.appendChild(argumentCard(text)));

  const verdictsContainer = document.getElementById("verdicts");
  verdictsContainer.innerHTML = "";
  data.verdicts.forEach((v, i) => {
    const card = document.createElement("div");
    card.className = "verdict-card";
    card.style.animationDelay = `${i * 0.15}s`;
    const precedentNote =
      v.precedentCount > 0
        ? `<p class="precedent-note">Drawing on ${v.precedentCount} past ruling${v.precedentCount === 1 ? "" : "s"} of their own</p>`
        : "";
    card.innerHTML = `
      <div class="verdict-seal">VERDICT<br/>RENDERED</div>
      <p class="judge-name">${escapeHtml(v.judgeName)}</p>
      <p class="judge-inspiration">${escapeHtml(v.inspiration)}</p>
      <p class="verdict-text">${escapeHtml(v.verdict)}</p>
      <p class="reasoning-text">${escapeHtml(v.reasoning)}</p>
      ${precedentNote}
    `;
    verdictsContainer.appendChild(card);
  });
}

function argumentCard(text) {
  const div = document.createElement("div");
  div.className = "argument-card";
  div.innerHTML = `<p>${escapeHtml(text)}</p>`;
  return div;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
