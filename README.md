# simTrain Universal — a job-training simulator for any profession

**Live demo:** https://simtrain-universal.liberatorgeminorum.workers.dev (works on phones)
**Track:** Indie · **Theme:** Build for Your World
**Built with:** Meta Model API — `muse-spark-1.3` (text: profile extraction, scenario design, action classifier, narrator, grader, feedback) and `muse-image-1.0` (job-tailored scene/evidence/instrument images).

## What it does
Describe your job in plain words ("I run shifts at a Wendy's", "ER doctor", "firefighter, 3 years in"). simTrain builds a realistic training scenario for that job, with partial information, red tape, a running clock and real decision points, and it holds you to that job's real frameworks (OSHA/NFPA, Food Code, HIPAA, 4th Amendment/ECPA, FAA, NIMS/ICS…). It hands you job-specific documents (A-001…), you can write your own reports, and "show me…" renders images.

## Why it is not just role-play
The model cannot simply tell you a nice story about how you did:
- A Muse Spark **classifier** scores each action against a rubric. **Deterministic code** sets the difficulty and rolls a seeded d20. The seed is committed by hash at the start and revealed at the end, so every roll can be re-verified (`node verify_rolls.mjs export.json`).
- The **narrator** must render the outcome the code chose, and it is re-prompted if it doesn't.
- A separate **grader** keeps timestamped, evidence-quoted notes, and the **final 4×25 scorecard is computed in code** from that ledger.
- Unlawful or unsafe acts are flagged and capped, and they always carry a consequence.

## What the trainee sees (hidden mechanics)
The trainee never sees dice, DCs or scores during play, the same way a real shift doesn't show you odds. Outcomes show up only as in-world consequences: a records request comes back partial, a crew member pushes back, the clock runs.
- **Code decides, the model narrates.** Each consequential action is classified by Muse Spark, resolved by a seeded d20 in code (mastery floor: textbook actions can't be failed by luck; a natural 1 lands on Friction, not catastrophe), and the narrator must render that exact tier.
- **Unlawful or unsafe acts** are auto-failed in code and always carry a consequence.
- **Running local clock** at the job's own pace; `Continue` jumps to the next meaningful beat.
- **Continue-spam guard:** if a decision is pending, or Continue is pressed repeatedly, time does not skip ("The scene is waiting on you").
- **Job artifacts** (A-001…): logs, forms, temp sheets, radio transcripts, lab panels; the trainee writes their own with `.file`. Stateful jobs get a 📋 state tracker; investigations get a Case state panel.
- **Images on request:** "show me…" or `.image <what>` renders a job-specific scene with Muse Image.
- **At `.end`:** a 4×25 scorecard computed in code from the grader's evidence-quoted ledger, a **decision-vs-luck** debrief (which outcomes were your call and which were a bad break), and a **roll audit with the seed revealed**. The export re-verifies with `node verify_rolls.mjs export.json`.
- Operators/judges: `?builder=1` shows rolls and cost counters live (`?builder=0` hides them).

## People with stat sheets (NUCs)
Every person in a scenario has a stat sheet written once by the scenario designer: composure, cooperation, authority, expertise and suspicion (0–5), plus goals, a private motive, secrets, what they know and don't know, and a starting trust and mood toward you (−3..+3). After that, **code owns every number**:
- When an action is aimed at a person, their authority, trust and mood add between −2 and +2 to the DC (the DC floor still holds). Trust of +2 or more gives advantage. Trust of −2 or less gives disadvantage, as does a suspicious person hearing an unbacked claim.
- Trust and mood update every turn from the outcome, capped at ±2 per turn. Improper acts cost trust with everyone, and mood settles over time.
- Relationships **reset with every new scenario**, and are **never shown during play**. People only act accordingly. The debrief adds a **Relationships** table (start → end, and what moved it) and reveals what they weren't telling you. The roll audit shows each roll's NUC part, and every die still re-verifies from the seed. Design: `docs/design/NUC-STAT-SHEETS.md`.

## Customization
⚙ Settings: five themes (Ops, Night, High-Contrast, Field, Terminal), text size, reduced motion, plus advanced controls: difficulty, pacing, realism vs coaching, hints, image frequency and debrief depth. Settings change style and pacing only; the hard caps and the resolution engine are never relaxed.

## Guardrails
Prompt-dump and jailbreak attempts are caught deterministically server-side (no model call, no credits) and answered with an easter egg; the scenario keeps going.

## Architecture
Cloudflare Worker (`src/worker.js`) + KV · `src/engine.js` (pure resolution and scoring) · `src/prompts.js` · single-page UI (`src/ui-public.html`). About 3 model calls per turn.

## Safety and abuse controls
Secrets are server-side only (`wrangler secret`), and the browser never sees a key. Limits: per-IP burst rate limits (Workers Rate Limiting), per-IP daily session and message caps, a global hourly turn cap, a deployment spend cap, a 16 KB request cap and a 4,000-character input cap, one in-flight turn per session, optional Turnstile, security headers, and escaped UI output. Scenario answers (hidden truth, fundamentals) are never sent to trainees; the dice are shown openly.

## Run it locally
Requires **Node 22+** and npm. No Cloudflare account and no API key are needed for the keyless demo; `wrangler dev` simulates KV and rate limits locally.

### Quickstart: keyless demo (from a fresh clone, about 2 minutes)
```
git clone https://github.com/GeminoLibi/simtrain && cd simtrain
npm install
cp .dev.vars.example .dev.vars      # ships with MOCK_LLM=1 (keyless demo)
npm run dev                         # http://localhost:8787, type "simTrain" to start
```
`npm run dev:mock` does the same without a `.dev.vars` file.

**What mock mode is:** with `MOCK_LLM=1` every model call (profile, scenario designer, classifier, narrator, grader, debrief) is answered by canned, deterministic replies from `src/mock.js`: one generic "double-booked delivery" scenario, adapted to the job you type. There are no network calls and no spend, and image requests return "image unavailable". Everything the code decides is real: the seeded d20s, DCs, tiers, caps, the 4×25 scorecard, the decision-vs-luck debrief and the seed-revealed roll audit. It's meant for checking that the app runs and for following the turn loop, not for judging scenario quality.

### Real play (Meta Model API)
```
# in .dev.vars: remove MOCK_LLM=1 and set your own key
META_API_KEY=<your key>
npm run dev
```
**Bring your own key:** this repo contains no API keys. If neither a key nor `MOCK_LLM=1` is set, the app starts but each turn replies with a message telling you to set one.

### Tests (offline, no key, no network)
```
npm test     # bundles the worker with esbuild, then runs every test in tests/ (including the keyless mock-mode e2e)
```
`tests/mock_e2e.mjs` writes a session export to a fresh temp directory and prints its path (set `SIMTRAIN_EXPORT=path` to choose one). Re-verify its dice with `npm run verify -- <path>` (or `node verify_rolls.mjs <path>`); it exits non-zero on any mismatch.

### Deploy to your own Cloudflare account
```
npx wrangler login
npx wrangler kv namespace create SIMTRAIN_KV        # put the id in wrangler.toml (see wrangler.example.toml)
npx wrangler secret put META_API_KEY                # optional: ADMIN_TOKEN, TURNSTILE_SECRET
npm run deploy
```
Never set `MOCK_LLM` on a real deployment. It is off unless set explicitly.

To keep your real IDs out of git, copy `wrangler.toml` to `wrangler.prod.toml` (gitignored), fill in the IDs there and deploy with `npx wrangler deploy -c wrangler.prod.toml`.

Environment variables are documented in `.dev.vars.example` (`.env.example` is the same list).

## Commands
`simTrain` start · `Continue` advance time · `.s` new scenario · `.file <title>` write a report · `.image <what>` / "show me…" · `.end` score, debrief and roll audit · ⚙ settings.

## About this repo
This is the source of the simTrain Universal build submitted to the Meta Global AI Developer Hackathon (Nov 2026). The application code matches the build deployed to the live demo on Nov 3, 2026, before the Nov 4 9:00 PM ET deadline. The repository itself was published on Nov 4, after the deadline, with a fresh history. The only edits are: secrets moved out, Cloudflare IDs replaced with placeholders, review-tracker labels in code comments renamed, and one test import path fixed. Live playtest logs, recordings and internal test-run transcripts are not included.

## License
MIT. See LICENSE.
