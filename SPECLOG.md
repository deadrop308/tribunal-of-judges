# SPECLOG.md — Decision History

A chronological record of how Tribunal of Judges' spec evolved and why.
Each entry is a decision point, not a code diff — see git history for
the actual code changes.

## 1. Stack selection
Course requires OpenRouter for all Gen AI calls (hard requirement).
Firebase (Hosting + Cloud Functions) chosen as the substitute for the
course's default Netlify + Supabase pairing, primarily because of prior
Flutter/Firebase experience. GitHub for version control.

## 2. Core mechanic
Decided on: 2 advocates for, 2 against, argued in a single round (no
rebuttals — deliberately bounded to control per-trial token cost). 3
judges rule independently; the app never merges their verdicts into one
outcome — the user is meant to weigh the panel themselves. Two run
modes: Same Model (uniform, cheaper to reason about) and Mixed Bench
(a different model per role, exercising the "provider-agnostic via
OpenRouter" requirement more fully).

## 3. Backend minimization
Initial question: does this need Firebase Hosting/Functions at all if
the project won't be publicly shared? Resolved: Firebase deployment is
a course requirement regardless of hosting visibility, so the minimal
architecture is Hosting (static frontend) + one Cloud Function (the
OpenRouter proxy) — no Auth, no Firestore at this stage.

## 4. Firestore added — charges, judges, verdicts as data
Requirement changed: charges needed to be reusable, judge personas
needed to be data (not hardcoded) so they're pickable, and verdicts
needed to persist, linked to the judge that gave them. This is the
point judges stopped being a fixed panel and became a stored, pickable
roster.

## 5. Precedent mechanic
Extension of #4: verdicts linked to a judge become genuinely useful if
they feed back into that judge's future reasoning. Decided each judge
sees their own last 10 past verdicts (not all-time — token cost grows
with judge "seniority" as-is; unbounded history would grow it
unboundedly) as context before ruling on a new charge — precedent by
design, not just verdict logging.

## 6. Deployment + testing-cost tooling
Live-deployed to Firebase. Established a convention for cheap/free model
testing: swap `DEFAULT_MODEL` / lineup entries to free or cheapest-paid
OpenRouter models, with the real production values kept as adjacent
comments, explicitly to avoid accidentally demoing on downgraded models.

## 7. Charge model: Title (required) + Text (optional)
Real-world case material (a long, structured case dossier — background,
agreed facts, and a specific legal question) didn't fit a single
free-text charge field, and a long charge is unreadable in a dropdown.
Split into a required short `title` (shown in the reuse dropdown) and an
optional longer `text` for full context. If `text` is empty, `title`
alone is the effective charge — keeps the simple case (e.g. "pineapple
on pizza") just as fast as before while supporting complex cases.

## 8. Advocates: optional per-trial name + personality
Advocates were previously anonymous "For"/"Against" voices. Added
optional `name` + `personality` per advocate, entered fresh each trial
and never persisted (deliberately — this is flavor for a single run, not
a roster to maintain). When only a name is given, the model does a
"low-effort" inference: draw lightly on general knowledge for well-known
names, but explicitly avoid inventing biographical detail for ambiguous
or private names — this is a prompting instruction, not a real search
capability.

## 9. Judge roster expansion: 3 new judges from documented real profiles
Added 3 judges modeled on real, documented judicial reasoning (Aharon
Barak, Menachem Elon, Meir Shamgar — three Israeli Supreme Court
justices), sourced from actual published opinions, alongside the
original 3 (Learned Hand, Blackstone, Roy Bean).

Key decision: one of the three (Barak) is a living, currently prominent
public figure — unlike every other judge in the roster, who are
deceased. Resolved to keep his name (rather than genericizing it), but
scope his persona strictly to documented interpretive methodology
(purposive interpretation, proportionality analysis) and explicitly
instruct the model to avoid any real-world political commentary in his
voice. Added a `methodologyNote` field to every judge (including the
original 3, backfilled) to make the "this adapts reasoning method, it
does not predict or impersonate" framing visible in the UI itself, not
just in code comments.

Also changed `seedJudges` from an all-or-nothing "seed if collection is
empty" check to a per-judge-ID idempotent check, since the roster is now
expected to grow over time rather than being seeded once and left fixed.

## 10. Advocate default names: "For"/"Against" → "Defense"/"Prosecution"
Generic advocate labels changed from "General For" / "General Against" to
"General Defense" / "General Prosecution". The app is framed as a tribunal
(charge, bench, verdict, precedent) throughout, so debate-style "for/against"
labels read as an inconsistent register next to that legal vocabulary —
"Defense"/"Prosecution" matches it. Applies to `GENERIC_ADVOCATE_NAMES` and
`DEFAULT_ADVOCATE_NAMES` in `functions/index.js`, the advocate name-input
placeholders in `public/index.html`, and SPEC.md §3.

## 11. Bug: "Seed Default Judges" banner had no way to reappear once seeded
The seed banner (and its button) only unhid itself when the `judges`
collection was completely empty. Once the original 3 judges existed, there
was no UI path left to re-run `seedJudges` — including right after #9 added
3 more entries to `SEED_JUDGES`, which made `seedJudges` newly meant to be
re-run but left no way to trigger it. Fixed by having the banner always
render in `public/app.js`'s `loadJudges()`, with copy and button label that
adapt: "Seed Default Judges" when the bench is empty, "Sync Default Judges"
once it's already populated. General lesson: idempotent-and-safe-to-re-run
backend functions need a UI entry point that's reachable in every state they
might legitimately be re-run from, not just the first-run state.

## 12. Mixed Bench: switched from cheap testing models to the production lineup
`ADVOCATE_MODEL_LINEUP` / `JUDGE_MODEL_LINEUP` (Mixed Bench / "different"
mode) were swapped from the cheapest-paid-per-provider testing models to the
medium-cost production values that had been sitting in code comments since
#6: Claude Sonnet 5, GPT-5.6 Sol, Gemini 3.1 Pro Preview, Llama 4 Maverick.
These land at roughly the same ~$2/M-input price point across Claude, GPT,
and Gemini — deliberate cross-provider price parity — while Llama 4 Maverick
is simply the priciest Llama tier OpenRouter currently offers (Meta has no
tier on OpenRouter that would match the other three). `DEFAULT_MODEL`
(Single Model mode) was deliberately left on its cheap testing value; this
change was scoped to Mixed Bench only.

All 4 slugs were verified directly against the live
`https://openrouter.ai/api/v1/models` catalog (not the docs page) on
2026-08-24 to confirm none were stale, renamed, or retired — all 4
confirmed current. `gemini-3.1-pro-preview` remains a `-preview` slug
(Google still hasn't shipped a non-preview Gemini 3 pro-tier model) and so
remains the one most likely to need re-checking first if a Mixed Bench run
starts failing on the AGAINST_1 role.

## 13. Hardening: input limits, prompt-injection framing, output cap, App Check wiring
Charge text and advocate personality are free text the user controls, sent
straight into system/user prompts — an obvious injection surface ("ignore
previous instructions", "reveal your system prompt", etc.) and an
unbounded-cost surface (nothing capped input or output length). Addressed
in `functions/index.js`:
- Server-side length limits (charge title 300 / text 3000 / advocate name
  100 / personality 2000 chars), checked in `runTribunal` before any
  OpenRouter call, rejecting with `HttpsError('invalid-argument', ...)`.
- `INJECTION_NOTICE` — a fixed line prepended to every prompt built by
  `advocatePrompt`, `judgeSystemPrompt`, and `judgeUserPrompt` — frames all
  user-supplied content (charge, advocate name/personality, and a judge's
  own past verdicts pulled back in as precedent) as case material only,
  never as instructions. Verified live: an adversarial charge + advocate
  personality both explicitly instructing the model to reveal its system
  prompt and output a marker string produced neither — every role stayed
  in character and refused.
- `max_tokens: 600` added to every `callOpenRouter` call, bounding
  per-call cost regardless of input size.

Also added Firebase App Check, so `runTribunal`, `listCharges`,
`listJudges`, and `seedJudges` only accept calls that carry a valid App
Check token — i.e. calls actually originating from the deployed web app,
not a bare script hitting the callable HTTP endpoint directly (as the
length-limit and injection tests above did, deliberately, to test).
Provider is reCAPTCHA Enterprise (not the plain reCAPTCHA v3 provider —
the site was registered as an Enterprise key in Google Cloud's reCAPTCHA
console), so the client uses `firebase.appCheck.ReCaptchaEnterpriseProvider`
in `public/app.js`, keyed off `window.APP_CHECK_SITE_KEY` in
`public/firebase-config.js`. Rollout was staged deliberately, since
flipping server-side enforcement before the client can attach a token
would lock out the real web app with no recovery path short of a
redeploy:
1. Ship the client-side activation code first, with `APP_CHECK_ENFORCED`
   still `false` server-side — harmless no-op until enforcement is on.
2. Register the app for App Check in the Firebase console (App Check >
   Apps > register with reCAPTCHA Enterprise, using the same site key).
3. Confirm the deployed client actually mints a token — verified directly
   via `firebase.appCheck().getToken(true)` in a real browser session
   against the live site, which returned a token successfully.
4. Only then flip `APP_CHECK_ENFORCED` to `true` and redeploy functions.

Verified after enabling: a direct curl POST to the `listJudges` callable
endpoint with no token now gets `401 UNAUTHENTICATED`; the real deployed
web app (which attaches a token automatically via the SDK) still
completes a full trial end-to-end.
