# Tribunal of Judges

A webapp where you submit a charge (a precise yes/no-style question), 2 AI
advocates argue for it, 2 argue against it, and 3 AI judges — each modeled
on a historical judge's reasoning style — deliver a verdict for you to weigh
yourself.

Built with GitHub + Firebase (Hosting + Cloud Functions) + OpenRouter.

## How it works

- **Frontend** (`public/`): pick past judges and/or a past charge (or write
  a new one), choose a mode, run the trial, see results.
- **Backend** (`functions/index.js`): 4 Cloud Functions:
  - `runTribunal` — the main event. Calls OpenRouter for the 4 advocates
    and the judges you selected, and returns the full transcript + verdicts.
  - `listJudges` / `listCharges` — populate the picker dropdowns from
    Firestore.
  - `seedJudges` — one-time helper to populate the default 3-judge roster.
  Your OpenRouter API key lives only here, never in the frontend.
- **Firestore** stores three things:
  - `charges` — every charge you've ever submitted, reusable from the
    dropdown.
  - `judges` — judge personas as data (not hardcoded), so you can add more
    later without touching code.
  - `verdicts` — every verdict, linked to the judge who gave it. Each time
    a judge rules again, their last 10 past verdicts are fed back to them
    as precedent context — so a judge's reasoning builds on their own past
    rulings over time, the way real judicial precedent works.
- **Two modes**:
  - *Same model* — everyone uses Claude (`anthropic/claude-sonnet-4.6`).
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
Judges"** — this populates the 3 starting judges (Learned Hand, Blackstone,
Roy Bean) into Firestore. After that, the judge picker will be populated
for every future visit, and you can add more judges directly in Firestore
if you want to expand the roster.

Since this is a class project you don't intend to share publicly, you can
leave the Hosting URL undistributed — it still satisfies "deployed via
Firebase" without you needing to promote it anywhere.

## Local testing (optional)

To test the Cloud Function locally before deploying:
```
firebase emulators:start --only functions,hosting
```

## Notes

- The `MODEL_LINEUP` model strings in `functions/index.js` are current as
  of this writing — double check they still exist at
  https://openrouter.ai/models before your demo, since providers rename or
  deprecate model slugs over time.
- Judge personas are framed as "in the style of" historical judges
  (Learned Hand, William Blackstone, Roy Bean) — real documented reasoning
  traditions, not literal impersonation, and all long-deceased figures.
- Consider setting a spending cap in your OpenRouter account settings
  while testing, since each trial run makes 7 model calls.
