# SPEC.md — Tribunal of Judges

The application contract: what this app does, its data model, and its
behavior. Code should match this; if it diverges, either the code or this
file is wrong — fix whichever one is out of date.

## 1. Purpose

A tribunal simulation. A user submits a charge (a precise, decidable
question). Two AI advocates argue for it, two argue against it. The user
selects which AI judge(s) preside; each judge rules independently and
gives reasoning. The app never combines verdicts into one final ruling —
the user weighs the panel's opinions themselves.

## 2. Data model (Firestore)

### `charges`
```
{ title: string, text?: string, createdAt: Timestamp }
```
- `title` — required, short, decisive question (e.g. "Should pineapple be
  allowed on pizza?"). Shown in the "reuse a past charge" dropdown.
- `text` — optional, longer background/context (e.g. case facts). Field is
  omitted from the document entirely when not provided (not stored as
  `null`). If present, this — not the title — is the actual charge text
  sent to advocates and judges.
- **Effective charge** = `text?.trim() || title`.
- Charges are reusable via `chargeId`; reused as-is, no editing.

### `judges`
```
{ name: string, inspiration: string, persona: string,
  methodologyNote: string, createdAt: Timestamp }
```
- `name` — display name (a "Bench" name, e.g. "The Hand Bench") — never
  the real person's name directly, to avoid implying literal impersonation
- `persona` — the system prompt defining their reasoning style
- `methodologyNote` — short, shown in the UI, states the research basis
  and that this is a hypothetical exercise, not a prediction of the real
  person's views
- Judges are pickable per trial — the user chooses which subset presides,
  not a fixed panel
- Seeded via `SEED_JUDGES` in `functions/index.js`, but Firestore is the
  live source of truth once seeded — editing a judge means editing the
  Firestore doc, not redeploying code

### `verdicts`
```
{ chargeId: string, chargeText: string, judgeId: string,
  verdict: string, reasoning: string, mode: "same"|"different",
  createdAt: Timestamp }
```
- Every verdict a judge ever gives is stored and linked to that judge
- **Precedent mechanic**: before ruling, a judge is shown their own last
  10 verdicts (oldest-first) as context, so their reasoning can build on
  their own track record across trials — analogous to real judicial
  precedent

## 3. Advocates (NOT persisted)

Each of the 4 advocate roles (`FOR_1`, `FOR_2`, `AGAINST_1`, `AGAINST_2`)
accepts, per-trial only:
```
{ name?: string, personality?: string }
```
- No `name`/`personality` → generic advocate ("General Defense" / "General
  Prosecution")
- `name` only, no `personality` → the model is told to lightly draw on
  what it already knows if the name is a well-known figure, and to avoid
  inventing biographical details if the name is ambiguous or appears to
  be a private individual
- `personality` provided → used directly as the advocate's defining
  characteristics, overriding the low-effort name inference

These are never saved to Firestore — collected fresh in the UI each
trial and discarded after the run.

## 4. Cloud Functions (the API surface)

- **`runTribunal({ chargeId? , chargeTitle?, chargeText?, judgeIds[],
  advocates?, mode })`** — the main orchestrator. Resolves/creates the
  charge, runs the 4 advocates in parallel, then runs the selected judges
  in parallel (each fetching their own precedent first), writes each
  verdict to Firestore, returns the full transcript.
- **`listCharges()`** — returns `{ id, title }` for the reuse dropdown
  (never the full `text`)
- **`listJudges()`** — returns `{ id, name, inspiration, methodologyNote }`
  for the judge picker
- **`seedJudges()`** — idempotent per judge ID; only inserts judges from
  `SEED_JUDGES` that don't already exist in Firestore

## 5. Modes

- **Same model** — every role (advocates + selected judges) uses
  `DEFAULT_MODEL` (Claude, via OpenRouter)
- **Different models** — each role uses a fixed model from
  `ADVOCATE_MODEL_LINEUP` / `JUDGE_MODEL_LINEUP`, spread across providers
  (Claude, GPT, Gemini, Llama)

## 6. Security model

- OpenRouter API key: Firebase secret, read only inside Cloud Functions,
  never reaches the client
- Firestore: `firestore.rules` denies all direct client read/write —
  every access goes through a callable Cloud Function using the Admin SDK
- Frontend: static files only, no secrets, no direct database access
- **Input limits**: `runTribunal` rejects oversized input with
  `HttpsError('invalid-argument', ...)` before any OpenRouter call —
  charge title ≤300 chars, charge text ≤3000 chars, advocate name ≤100
  chars, advocate personality ≤2000 chars
- **Prompt-injection framing**: every system/user prompt sent to
  OpenRouter (advocates and judges alike) is prefixed with a notice that
  frames all user-supplied content (charge, advocate name/personality,
  a judge's own past verdicts) as case material to reason about, never
  as instructions to follow — see `INJECTION_NOTICE` in
  `functions/index.js`
- **Output cap**: every OpenRouter call sets `max_tokens: 600`
- **App Check**: enforced (`APP_CHECK_ENFORCED = true` in
  `functions/index.js`) on all four callables, using reCAPTCHA Enterprise
  (`public/app.js` activates `ReCaptchaEnterpriseProvider` with the site
  key in `public/firebase-config.js`) — calls without a valid App Check
  token are rejected with `UNAUTHENTICATED`. See SPECLOG.md #13.

## 7. Explicitly out of scope

- No authentication/user accounts — single shared instance
- No combined/aggregate verdict across judges — each rules independently
- No multi-round debate/rebuttals — single round only
- No real-time collaboration — one trial runs at a time per request
