# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Tribunal of Judges — a webapp where a user submits a charge (a precise
question), 2 AI advocates argue for it and 2 argue against it, then a
user-selected panel of AI judges (each with a distinct persona) rules
independently. Judges accumulate "precedent" — their own past verdicts —
which feeds into future rulings for continuity.

Course project (Vibe Coding). OpenRouter is a hard course requirement for
all Gen AI calls — never call a model provider's API directly, always
route through OpenRouter.

## Tech stack

- **Frontend**: static HTML/CSS/JS in `public/`, no build step, no framework
- **Backend**: Firebase Cloud Functions (`functions/index.js`), Node 22,
  `firebase-functions` v7+ (must stay current relative to `firebase-tools`
  or deploys hang with a "Cannot determine backend specification" error)
- **Database**: Firestore, region `me-west1` (Tel Aviv)
- **Hosting**: Firebase Hosting
- **Gen AI**: OpenRouter (`https://openrouter.ai/api/v1/chat/completions`),
  key stored as a Firebase secret (`OPENROUTER_API_KEY`), never in code

## Key commands

```
firebase deploy                          # deploy everything
firebase deploy --only hosting           # frontend only
firebase deploy --only functions         # backend only
firebase functions:log --only <name>     # real server-side errors —
                                          # client only ever sees a
                                          # generic "internal" message
firebase functions:secrets:set OPENROUTER_API_KEY
```

## Conventions

- **Model lineup pattern**: `DEFAULT_MODEL` (Single Model mode) and
  `ADVOCATE_MODEL_LINEUP` / `JUDGE_MODEL_LINEUP` (Mixed Bench mode) are
  defined near the top of `functions/index.js`. Whichever set (cheap
  testing vs. production) isn't active gets commented out immediately
  above the live block, clearly labeled — never delete either version
  outright, just swap which one is live. As of 2026-08-24, Mixed Bench
  (`ADVOCATE_MODEL_LINEUP` / `JUDGE_MODEL_LINEUP`) runs the production
  medium-cost lineup; `DEFAULT_MODEL` (Single Model mode) is still on the
  cheap testing value. Before trusting a model slug, verify it against the
  live catalog at `https://openrouter.ai/api/v1/models` — it's authoritative
  and current; the `/models` docs page is not a reliable substitute.
- **Judges live in Firestore, not code.** `SEED_JUDGES` in
  `functions/index.js` is only the seed data for `seedJudges`. Once
  seeded, Firestore is the source of truth. `seedJudges` is idempotent
  per judge ID — safe to re-run after adding new entries to `SEED_JUDGES`.
- **Judge personas** are framed as "reasoning style inspired by [person],"
  never literal impersonation, especially for real people. Each judge has
  a `methodologyNote` explaining the research basis and stating this is a
  hypothetical exercise. Treat this framing as load-bearing, not
  decorative — don't loosen it when adding judges.
- **Advocates** (the 4 for/against roles) accept an optional per-trial
  `name` + `personality`, sent in the `runTribunal` request. These are
  NOT persisted to Firestore — fresh every trial, by design. Generic
  defaults are "General Defense" / "General Prosecution" (`GENERIC_ADVOCATE_NAMES`,
  `DEFAULT_ADVOCATE_NAMES` in `functions/index.js`).
- **The "Seed/Sync Default Judges" banner must always be reachable in the
  UI**, not just when the judges collection is empty. It hid itself
  whenever any judge already existed until a 2026-08-24 fix — a dead end,
  since `seedJudges` is meant to be safely re-run as `SEED_JUDGES` grows.
  It now always renders, with copy/button label switching between
  "Seed Default Judges" (empty bench) and "Sync Default Judges" (already
  populated). Don't reintroduce empty-only visibility.

## Never do

- Never put the OpenRouter key in any file, comment, or log statement
- Never loosen `firestore.rules` — the frontend must never read/write
  Firestore directly, only through callable functions
- Never commit `firebase-debug.log` or `.env` files

## For the full feature spec, see SPEC.md. For the history of design
## decisions and why things are the way they are, see SPECLOG.md.
