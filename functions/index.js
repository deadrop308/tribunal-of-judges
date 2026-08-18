/**
 * Tribunal of Judges — Cloud Functions
 *
 * Firestore collections:
 *   charges  { text, createdAt }
 *   judges   { name, inspiration, persona, createdAt }
 *   verdicts { chargeId, chargeText, judgeId, verdict, reasoning, mode, createdAt }
 *
 * Flow of runTribunal:
 *   1. Resolve the charge — either reuse a stored one (chargeId) or create a
 *      new one (chargeText), stored as-is for future reuse.
 *   2. 4 advocates argue (2 for, 2 against) in parallel, independently.
 *   3. For each *selected* judge: pull their last 10 own past verdicts from
 *      Firestore as precedent context, then have them rule. Each new verdict
 *      is saved back to Firestore, linked to that judge — so the judge's
 *      "case law" grows over time.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const openrouterKey = defineSecret("OPENROUTER_API_KEY");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const PRECEDENT_LIMIT = 10;

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

// "same" mode: everyone uses this one model.
// *** TESTING MODE *** — cheapest Claude on OpenRouter, swapped in to keep
// test-run costs near zero. REAL/DEMO VALUE (restore before demo):
//   const DEFAULT_MODEL = "anthropic/claude-sonnet-5";
const DEFAULT_MODEL = "anthropic/claude-3-haiku";

// "different" mode: fixed lineup for advocates.
// NOTE: verify these slugs are still current at https://openrouter.ai/models
// before your demo. AGAINST_1's real value uses a "-preview" slug (Google
// hasn't shipped a non-preview Gemini 3 pro-tier model yet) — preview slugs
// can be renamed or retired without notice, so double-check it especially.
//
// *** TESTING MODE *** — every entry below is the cheapest PAID (non-:free)
// model OpenRouter currently offers for that role's provider. Deliberately
// NOT flagship models (no Sonnet/GPT-5.x/Gemini Pro-tier here) — this is the
// bottom tier only, picked to keep test-run costs near zero while avoiding
// the free-tier shared-pool rate limiting (429s) that :free models hit
// under load. REAL/DEMO VALUES (restore before demo):
//   const ADVOCATE_MODEL_LINEUP = {
//     FOR_1: "anthropic/claude-sonnet-5",
//     FOR_2: "openai/gpt-5.6-sol",
//     AGAINST_1: "google/gemini-3.1-pro-preview",
//     AGAINST_2: "meta-llama/llama-4-maverick",
//   };
const ADVOCATE_MODEL_LINEUP = {
  FOR_1: "anthropic/claude-3-haiku",     // cheapest paid Anthropic (non-batch)
  FOR_2: "openai/gpt-oss-20b",           // cheapest paid OpenAI (paid tier of the same model; the :free version was persistently 429 upstream-rate-limited during testing)
  AGAINST_1: "google/gemma-3-4b-it",     // cheapest paid Google (the free google/gemma-4-31b-it:free was also persistently 429 upstream-rate-limited during testing)
  AGAINST_2: "meta-llama/llama-3.1-8b-instruct", // cheapest paid Meta (no free tier currently exists for meta-llama on OpenRouter)
};

// "different" mode: fixed lineup for the 3 seeded judges. If a judge is
// added later without an entry here, it falls back to DEFAULT_MODEL.
//
// *** TESTING MODE *** — same cheapest-paid-per-provider swap as
// ADVOCATE_MODEL_LINEUP above. REAL/DEMO VALUES (restore before demo):
//   const JUDGE_MODEL_LINEUP = {
//     "judge-learned-hand": "anthropic/claude-sonnet-5",
//     "judge-blackstone": "openai/gpt-5.6-sol",
//     "judge-roy-bean": "google/gemini-3.1-pro-preview",
//   };
const JUDGE_MODEL_LINEUP = {
  "judge-learned-hand": "anthropic/claude-3-haiku",
  "judge-blackstone": "openai/gpt-oss-20b",
  "judge-roy-bean": "google/gemma-3-4b-it",
};

// ---------------------------------------------------------------------------
// Seed data for the default judge roster
// ---------------------------------------------------------------------------

const SEED_JUDGES = [
  {
    id: "judge-learned-hand",
    name: "The Hand Bench",
    inspiration: "Judge Learned Hand (1872–1961)",
    persona: `You are role-playing as a judge whose reasoning style is
inspired by Judge Learned Hand, the influential US federal appeals judge
known for careful, pragmatic balancing of competing interests (as in his
famous negligence formula weighing burden against probability and gravity
of harm), procedural fairness, and a preference for reasoned middle ground
over rigid absolutism. Rule in that spirit: weigh costs, benefits, and
practical consequences explicitly in your reasoning.`,
  },
  {
    id: "judge-blackstone",
    name: "The Blackstone Bench",
    inspiration: "Sir William Blackstone (1723–1780)",
    persona: `You are role-playing as a judge whose reasoning style is
inspired by Sir William Blackstone, the English jurist famous for his
"Blackstone's ratio" ("better that ten guilty persons escape than that one
innocent suffer") and for grounding judgments in established legal
principle, precedent, and the protection of individual rights against
overreach. Rule in that spirit: be cautious about punishing without clear,
solid justification, and reason from principle and precedent.`,
  },
  {
    id: "judge-roy-bean",
    name: "The Pecos Bench",
    inspiration: 'Judge Roy Bean, "The Law West of the Pecos" (c. 1825–1903)',
    persona: `You are role-playing as a judge whose reasoning style is
inspired by the folk-historical Judge Roy Bean, the Old West justice of the
peace famous for blunt, informal, common-sense rulings delivered with dry
humor and little patience for technicalities. Rule in that spirit: favor
plain, practical justice over procedural nuance, and don't be afraid of a
colorful, opinionated verdict — while still being fair to the actual facts
argued.`,
  },
];

// ---------------------------------------------------------------------------
// OpenRouter call helper
// ---------------------------------------------------------------------------

async function callOpenRouter(apiKey, model, systemPrompt, userPrompt) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no content");
  }
  return content.trim();
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function advocatePrompt(stance) {
  return `You are an advocate in a tribunal. You must argue strictly
${stance} the charge below, as persuasively and concisely as possible.
Give your strongest reasoning in 3-5 sentences. Do not hedge or present
both sides — argue only your assigned position.`;
}

function judgeSystemPrompt(basePersona, pastVerdicts) {
  if (!pastVerdicts.length) return basePersona;

  const precedentText = pastVerdicts
    .map((v, i) => `${i + 1}. Charge: "${v.chargeText}" → Your verdict: "${v.verdict}"`)
    .join("\n");

  return `${basePersona}

For continuity, here are your own past rulings, oldest first. Let them
inform your reasoning today the way a real judge builds on their own
precedent — you may reaffirm a past position or explicitly distinguish
this case from an earlier one, but stay recognizably consistent with your
own track record unless the facts genuinely warrant a different outcome:

${precedentText}`;
}

function judgeUserPrompt(charge, argumentsForAgainst) {
  return `CHARGE / QUESTION BEFORE THE TRIBUNAL:
"${charge}"

ARGUMENTS FOR:
1) ${argumentsForAgainst.for[0]}
2) ${argumentsForAgainst.for[1]}

ARGUMENTS AGAINST:
1) ${argumentsForAgainst.against[0]}
2) ${argumentsForAgainst.against[1]}

Having heard both sides, deliver your ruling. Respond in exactly this
format:

VERDICT: <one short, decisive sentence stating your ruling>
REASONING: <2-4 sentences explaining why, in your own judicial voice>`;
}

function parseVerdict(raw) {
  const verdictMatch = raw.match(/VERDICT:\s*([\s\S]*?)(?:\nREASONING:|$)/i);
  const reasoningMatch = raw.match(/REASONING:\s*([\s\S]*)$/i);
  return {
    verdict: verdictMatch ? verdictMatch[1].trim() : raw.trim(),
    reasoning: reasoningMatch ? reasoningMatch[1].trim() : "",
  };
}

// ---------------------------------------------------------------------------
// listCharges — for the "reuse a past charge" picker
// ---------------------------------------------------------------------------

exports.listCharges = onCall(async () => {
  const snap = await db.collection("charges").orderBy("createdAt", "desc").limit(50).get();
  return snap.docs.map((d) => ({ id: d.id, text: d.data().text }));
});

// ---------------------------------------------------------------------------
// listJudges — for the judge picker
// ---------------------------------------------------------------------------

exports.listJudges = onCall(async () => {
  const snap = await db.collection("judges").orderBy("createdAt", "asc").get();
  return snap.docs.map((d) => ({
    id: d.id,
    name: d.data().name,
    inspiration: d.data().inspiration,
  }));
});

// ---------------------------------------------------------------------------
// seedJudges — one-time setup: populate the default 3-judge roster if empty
// ---------------------------------------------------------------------------

exports.seedJudges = onCall(async () => {
  const existing = await db.collection("judges").limit(1).get();
  if (!existing.empty) {
    return { seeded: false, message: "Judges already exist." };
  }

  const batch = db.batch();
  SEED_JUDGES.forEach((judge) => {
    const ref = db.collection("judges").doc(judge.id);
    batch.set(ref, {
      name: judge.name,
      inspiration: judge.inspiration,
      persona: judge.persona,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  return { seeded: true, count: SEED_JUDGES.length };
});

// ---------------------------------------------------------------------------
// runTribunal — the main event
// ---------------------------------------------------------------------------

exports.runTribunal = onCall({ secrets: [openrouterKey] }, async (request) => {
  const { chargeId, chargeText, judgeIds } = request.data || {};
  const mode = request.data?.mode === "different" ? "different" : "same";

  if (!Array.isArray(judgeIds) || judgeIds.length === 0) {
    throw new HttpsError("invalid-argument", "Select at least one judge to preside.");
  }

  const apiKey = openrouterKey.value();

  // --- Resolve the charge: reuse stored, or create + store a new one ---
  let resolvedChargeId = chargeId || null;
  let charge;

  if (chargeId) {
    const doc = await db.collection("charges").doc(chargeId).get();
    if (!doc.exists) throw new HttpsError("not-found", "Charge not found.");
    charge = doc.data().text;
  } else {
    charge = (chargeText || "").trim();
    if (!charge) throw new HttpsError("invalid-argument", "A charge is required.");
    const ref = await db.collection("charges").add({
      text: charge,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    resolvedChargeId = ref.id;
  }

  // --- Fetch the selected judges ---
  const judgeDocs = await Promise.all(
    judgeIds.map((id) => db.collection("judges").doc(id).get())
  );
  const judges = judgeDocs.map((doc, i) => {
    if (!doc.exists) throw new HttpsError("not-found", `Judge ${judgeIds[i]} not found.`);
    return { id: doc.id, ...doc.data() };
  });

  const modelForAdvocate = (role) =>
    mode === "different" ? ADVOCATE_MODEL_LINEUP[role] : DEFAULT_MODEL;
  const modelForJudge = (judgeId) =>
    mode === "different" ? JUDGE_MODEL_LINEUP[judgeId] || DEFAULT_MODEL : DEFAULT_MODEL;

  try {
    // --- Step 1: 4 advocates argue in parallel ---
    const [for1, for2, against1, against2] = await Promise.all([
      callOpenRouter(apiKey, modelForAdvocate("FOR_1"), advocatePrompt("FOR"), charge),
      callOpenRouter(apiKey, modelForAdvocate("FOR_2"), advocatePrompt("FOR"), charge),
      callOpenRouter(apiKey, modelForAdvocate("AGAINST_1"), advocatePrompt("AGAINST"), charge),
      callOpenRouter(apiKey, modelForAdvocate("AGAINST_2"), advocatePrompt("AGAINST"), charge),
    ]);

    const argumentsForAgainst = { for: [for1, for2], against: [against1, against2] };
    const userPrompt = judgeUserPrompt(charge, argumentsForAgainst);

    // --- Step 2: each selected judge rules, informed by their own precedent ---
    const verdictResults = await Promise.all(
      judges.map(async (judge) => {
        const precedentSnap = await db
          .collection("verdicts")
          .where("judgeId", "==", judge.id)
          .orderBy("createdAt", "desc")
          .limit(PRECEDENT_LIMIT)
          .get();
        const pastVerdicts = precedentSnap.docs.map((d) => d.data()).reverse();

        const systemPrompt = judgeSystemPrompt(judge.persona, pastVerdicts);
        const raw = await callOpenRouter(apiKey, modelForJudge(judge.id), systemPrompt, userPrompt);
        const { verdict, reasoning } = parseVerdict(raw);

        await db.collection("verdicts").add({
          chargeId: resolvedChargeId,
          chargeText: charge,
          judgeId: judge.id,
          verdict,
          reasoning,
          mode,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          judgeId: judge.id,
          judgeName: judge.name,
          inspiration: judge.inspiration,
          verdict,
          reasoning,
          precedentCount: pastVerdicts.length,
        };
      })
    );

    return {
      chargeId: resolvedChargeId,
      charge,
      mode,
      arguments: argumentsForAgainst,
      verdicts: verdictResults,
    };
  } catch (err) {
    console.error("Tribunal run failed:", err);
    throw new HttpsError("internal", err.message || "Tribunal run failed.");
  }
});
