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

## Customization
⚙ Settings: five themes (Ops, Night, High-Contrast, Field, Terminal), text size, reduced motion, plus advanced controls: difficulty, pacing, realism vs coaching, hints, image frequency and debrief depth. Settings change style and pacing only; the hard caps and the resolution engine are never relaxed.

## Guardrails
Prompt-dump and jailbreak attempts are caught deterministically server-side (no model call, no credits) and answered with an easter egg; the scenario keeps going.

## Architecture
Cloudflare Worker (`src/worker.js`) + KV · `src/engine.js` (pure resolution and scoring) · `src/prompts.js` · single-page UI (`src/ui-public.html`). About 3 model calls per turn.

## Safety and abuse controls
Secrets are server-side only (`wrangler secret`), and the browser never sees a key. Limits: per-IP burst rate limits (Workers Rate Limiting), per-IP daily session and message caps, a global hourly turn cap, a deployment spend cap, a 16 KB request cap and a 4,000-character input cap, one in-flight turn per session, optional Turnstile, security headers, and escaped UI output. Scenario answers (hidden truth, fundamentals) are never sent to trainees; the dice are shown openly.

## Run it locally
Requires Node 22+ (current Wrangler) and a Cloudflare account (free tier is fine). **Bring your own key:** this repo contains no API keys; you need your own Meta Model API key.
```
npm i
# wrangler.toml ships with placeholders (same as wrangler.example.toml)
npx wrangler kv namespace create SIMTRAIN_KV    # put the id in wrangler.toml
printf 'META_API_KEY=<your key>\nADMIN_TOKEN=<optional>\n' > .dev.vars   # local secrets (gitignored)
npx wrangler dev                                # http://localhost:8787
```
Deploy: `npx wrangler secret put META_API_KEY` (optionally `ADMIN_TOKEN`, `TURNSTILE_SECRET`), then `npx wrangler deploy`.

Offline tests (mock model, no key, no network):
```
node tests/eggs.test.mjs
node tests/short_session.test.mjs
npx esbuild src/worker.js --bundle --format=esm --loader:.html=text --outfile=tests/worker.js   # or wrangler deploy --dry-run --outdir
node tests/mock_e2e.mjs && node tests/hidden_e2e.mjs && node tests/settings_e2e.mjs
```
Re-verify the dice from a session export: `node verify_rolls.mjs export.json`.

## Commands
`simTrain` start · `Continue` advance time · `.s` new scenario · `.file <title>` write a report · `.image <what>` / "show me…" · `.end` score, debrief and roll audit · ⚙ settings.

## About this repo
This is the source of the simTrain Universal build submitted to the Meta Global AI Developer Hackathon (Nov 2026). The application code matches the build deployed to the live demo on Nov 3, 2026, before the Nov 4 9:00 PM ET deadline. The repository itself was published on Nov 4, after the deadline, with a fresh history. The only edits are: secrets moved out, Cloudflare IDs replaced with placeholders, review-tracker labels in code comments renamed, and one test import path fixed. Live playtest logs, recordings and internal test-run transcripts are not included.

## License
MIT. See LICENSE.
