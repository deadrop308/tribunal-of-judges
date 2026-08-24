# Tribunal of Judges

A webapp where you submit a charge (a precise, decidable question — a
required short title, plus optional longer details for complex cases), 2 AI
advocates argue for it, 2 argue against it, and the AI judges you pick from
the bench deliver a verdict each, for you to weigh yourself.

Built with GitHub + Firebase (Hosting + Cloud Functions) + OpenRouter.

## How it works

- **Frontend** (`public/`): pick past judges and/or a past charge (or write
  a new one — a Title, and optionally longer Charge Details), optionally
  give the 4 advocates a name and/or personality for the trial, choose a
  mode, run the trial, see results.
- **Backend** (`functions/index.js`): 4 Cloud Functions:
  - `runTribunal` — the main event. Resolves/creates the charge, calls
    OpenRouter for the 4 advocates and the judges you selected, and returns
    the full transcript + verdicts.
  - `listJudges` / `listCharges` — populate the picker dropdowns from
    Firestore.
  - `seedJudges` — populates the default judge roster. Idempotent per judge
    ID, so it's safe to click any time (e.g. after the roster grows in
    code) — it only inserts judges that don't already exist, never
    duplicates.
  Your OpenRouter API key lives only here, never in the frontend.
- **Firestore** stores three things:
  - `charges` — `{ title, text? }`. Every charge you've submitted, reusable
    from the dropdown (which shows the title only). If `text` is present,
    that — not the title — is the actual charge sent to advocates and
    judges.
  - `judges` — judge personas as data (not hardcoded), so you can add more
    later without touching code. Each has a `methodologyNote` (shown in the
    UI) stating the research basis and that it's a hypothetical
    reasoning-style exercise, not a prediction of the real person's views.
  - `verdicts` — every verdict, linked to the judge who gave it. Each time
    a judge rules again, their last 10 past verdicts are fed back to them
    as precedent context — so a judge's reasoning builds on their own past
    rulings over time, the way real judicial precedent works.
- **Advocate names/personalities** are optional, per-trial only, and never
  saved to Firestore — collected fresh in the UI each run and discarded.
- **Two modes**:
  - *Same model* — everyone uses Claude, via `DEFAULT_MODEL` in
    `functions/index.js`.
  - *Mixed bench* — a fixed lineup of different models per role (Claude,
    GPT, Gemini, Llama), configured in `ADVOCATE_MODEL_LINEUP` /
    `JUDGE_MODEL_LINEUP` in `functions/index.js`.
- **Firestore access**: the frontend never talks to Firestore directly —
  everything goes through the callable functions above. `firestore.rules`
  denies all direct client access accordingly (Cloud Functions use the
  Admin SDK, which bypasses these rules).

## One-time setup

1. **Create/select a Firebase project**
   ```
   firebase login
   firebase projects:list
   ```
   Put your project ID in `.firebaserc` (replace `YOUR_PROJECT_ID`).

2. **Get an OpenRouter API key**
   Sign up at https://openrouter.ai, create a key, add a small amount of
   credit (or start with free models to test for $0).

3. **Store the key as a Firebase secret** (never commit it to GitHub)
   ```
   firebase functions:secrets:set OPENROUTER_API_KEY
   ```
   Paste your OpenRouter key when prompted.

4. **Fill in your Firebase web config**
   In `public/firebase-config.js`, replace the placeholder values with your
   actual project's web config (Firebase Console → Project Settings →
   General → Your apps → Web app → SDK setup).

5. **Install function dependencies**
   ```
   cd functions
   npm install
   cd ..
   ```

## Enable Firestore (one-time, in the console)

Before your first deploy, create the Firestore database:
1. Firebase Console → **Firestore Database** → **Create database**
2. Choose a region, and start in **production mode** (the rules file in
   this repo already locks it down — client access is denied by default,
   since everything goes through Cloud Functions).

## Deploy

```
firebase deploy
```

This deploys Hosting (the frontend), Firestore rules/indexes, and all 4
Cloud Functions. Firebase will print the Hosting URL when it's done.

**First-time only**: open the deployed site and click **"Seed Default
Judges"** — this populates the default roster (currently 6 judges: Learned
Hand, Blackstone, Roy Bean, Barak, Elon, Shamgar) into Firestore. After
that, the judge picker is populated for every future visit. The button
sticks around (relabeled **"Sync Default Judges"**) so you can safely
click it again any time the roster in code grows — it never duplicates
judges that already exist — and you can also add judges directly in
Firestore if you want to expand the roster by hand.

## Local testing (optional)

To test the Cloud Function locally before deploying:
```
firebase emulators:start --only functions,hosting
```

## Notes

- The model strings in `ADVOCATE_MODEL_LINEUP` / `JUDGE_MODEL_LINEUP` /
  `DEFAULT_MODEL` in `functions/index.js` are current as of this writing —
  double check them against the live catalog at
  `https://openrouter.ai/api/v1/models` before your demo, since providers
  rename or deprecate model slugs over time (one lineup entry is a
  `-preview` slug, which is especially prone to this).
- Judge personas are framed as "reasoning style inspired by [person],"
  never literal impersonation. Most are long-deceased historical figures
  (Learned Hand, William Blackstone, Roy Bean, Menachem Elon, Meir
  Shamgar); one (Aharon Barak) is a living public figure, whose persona is
  deliberately scoped to documented interpretive methodology only. Every
  judge has a `methodologyNote` in the UI making this framing explicit.
- Each trial makes 4 advocate calls plus one call per judge you select
  (currently up to 6), all routed through OpenRouter.
- Consider setting a spending cap in your OpenRouter account settings
  while testing.
