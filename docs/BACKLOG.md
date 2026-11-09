# simTrain post-hackathon backlog

Started 2026-11-09, after the Meta hackathon results (simTrain Universal did not place). Judging is over, so the submitted build is no longer frozen.

Sources: Markus's requests (10/29, 10/31, 11/4), the post-mortem on the submission, Muse's review passes (10/29 to 11/2), and a read of this repo.

**Priority:** P0 = blocks anyone running it · P1 = next up · P2 = planned · P3 = nice to have.
**Size:** S ≤ half a day · M = 1–2 days · L = 3–5 days · XL = more than a week, or an epic.

| # | Item | Pri | Size | Status |
|---|---|---|---|---|
| 1 | Fresh-clone runnability (keyless demo, env example, test paths, README) | P0 | S | **Done** on `fix/fresh-clone` |
| 2 | NUC stat sheets that feed rolls and persist mood/trust | P1 | L | **Phase 1 done** (`feat/nuc-stat-sheets`); phases 2–3 open (see design doc) |
| 3 | CI: `npm test` on every push and PR | P1 | S | Open |
| 4 | Deploy from the repo (one source of truth for the live worker) | P1 | S | Open |
| 5 | Multiple model providers (bring your own key) | P1 | M | Open |
| 6 | Injection gap: role-description smuggling across sessions | P1 | S | Open (Muse 10/29 marked it NOT TESTED) |
| 7 | Continue-spam guard regression test | P1 | S | **Done** on `fix/fresh-clone` (the guard shipped 10/30) |
| 8 | Latency and cost per turn | P2 | M | Open |
| 9 | Customization polish (themes and advanced controls) | P3 | S | Mostly shipped; polish only |
| 10 | Share link for a finished run | P3 | S–M | Open (skipped before the freeze) |
| 11 | Richer mock mode (several canned scenarios) | P3 | S | Open |
| 12 | Org admin dashboard | P2 | XL | **Revelare roadmap epic** |

---

### 1. Fresh-clone runnability: P0 · S · DONE (`fix/fresh-clone`)
Post-mortem findings: there was no `.env.example`, live play needed `META_API_KEY` in `.dev.vars`, there was no keyless path, `tests/mock_e2e.mjs` wrote to a hardcoded `/tmp/stb/`, and the README steps had not been tested from a fresh clone.

**Acceptance criteria (all met):**
- Committed `.dev.vars.example` and `.env.example`, listing every variable with a comment.
- `MOCK_LLM=1` runs a full session with no key, no network and zero spend. Dice, caps, scorecard and roll audit stay real. Mock mode is off unless set explicitly.
- With no key and no `MOCK_LLM`, each turn returns a clear "set META_API_KEY or MOCK_LLM=1" message instead of a generic error.
- `mock_e2e` writes its export to `mkdtemp` (or `SIMTRAIN_EXPORT`).
- `npm test` bundles the worker and runs every test from a fresh clone.
- `verify_rolls.mjs` exits non-zero on a mismatch.
- The README quickstart (`git clone`, `npm install`, `cp .dev.vars.example .dev.vars`, `npm run dev`) works. Verified from a fresh clone, with an HTTP smoke test through `.end` and export verification.

### 2. NUC stat sheets: P1 · L
Markus (11/4): NUCs need real stat sheets for immersive rolls. That means stats that feed rolls, plus goals, secrets, what each NUC knows, and mood and trust toward the trainee that update every turn and persist in session state. Today a NUC has only `name`, `role` and `disposition`.

**Acceptance criteria:**
- The scenario designer emits a validated sheet per NUC (schema in the design doc). Code clamps and sanitizes it, and NUCs from old sessions still load.
- When an action targets a NUC, code derives a bounded DC modifier and advantage or disadvantage from that NUC's sheet. The modifier is recorded in `dc_parts`, so the roll audit and `verify_rolls` still reproduce every roll.
- Code applies trust and mood deltas each turn within caps, from the tier and the classifier's tags, never from free model text. The values persist in the session and appear in the export.
- Secrets and hidden goals never reach the trainee view. The hidden-mechanics test is extended to cover them.
- The debrief can cite relationship effects ("Dana's trust fell after you…") in decision-vs-luck terms.
- Tests: deterministic modifier math, the persistence round-trip, the leak test, and a mock-mode e2e that shows trust changing.

### 3. CI: P1 · S
**Acceptance criteria:** a GitHub Actions workflow runs `npm ci && npm test` on Node 22 for every push and PR, with no secrets. A README badge shows the status.

### 4. Deploy from the repo: P1 · S
Today the live worker is deployed from a separate local working copy that holds the real KV ID, and that copy has drifted from this repo (comment labels, test fixtures).

**Acceptance criteria:**
- The live deploy is built from this repo's `main`. Real IDs come from a gitignored `wrangler.local.toml`, `--env`, or CI variables.
- `wrangler deploy --dry-run` runs in CI.
- After a deploy, a smoke test (`GET /`, a session create, one turn) runs against the live URL.

### 5. Multiple model providers: P1 · M
Markus (10/29): not everyone has Meta API access. Keep a Meta-only build tagged as the hackathon version, and let the general (Revelare-wrapped) build support other providers.

**Acceptance criteria:**
- A provider adapter sits behind `chat()` and `genImage()`, selected by `PROVIDER` with per-provider `*_API_KEY`, `*_BASE` and model vars. It covers OpenAI-compatible APIs (OpenAI, OpenRouter, Together, local vLLM or Ollama), Anthropic and Gemini, and keeps Meta as the default.
- JSON-mode differences are handled per provider, with the existing retry and strip path.
- Images are optional per provider. When no image model is configured, the UI degrades gracefully.
- The `RATES` table is per provider, so the spend cap stays correct.
- The hackathon build stays Meta-only, tagged `meta-hackathon-2026`.
- Mock-mode tests run once per adapter, using a recorded response shape.
- The README documents setup for each provider.

### 6. Injection gap: role-description smuggling: P1 · S
Muse's 10/29 injection pass left "role-description smuggling (second session)" untested. That attack hides instructions in the ROLE or INDUSTRY form text, or carries them into a resumed or second session.

**Acceptance criteria:**
- Egg-detector and e2e tests cover instructions embedded in ROLE, INDUSTRY or SCENARIO_FOCUS, and carried across `.s` and a second session.
- No prompt or rule leak occurs, the scoring caps hold, and a false-positive check confirms ordinary role text still works.

### 7. Continue-spam guard regression test: P1 · S · DONE (`fix/fresh-clone`)
The guard shipped on 10/30 (Markus OK'd it for the submission) but had no test.

**Acceptance criteria (met):** `tests/mock_mode_e2e.mjs` checks that Continue is refused while a decision is pending (the clock doesn't move), and that a third Continue in a row is refused.

### 8. Latency and cost per turn: P2 · M
Muse measured 20–60 s per turn and about $0.03 per turn (image turns cost about 3x).

**Acceptance criteria:**
- Timing for each model call is in the admin log.
- Every independent call runs in parallel.
- The status stream shows real progress.
- The p50 turn takes under 15 s on Muse's replay set, with no drop in grader agreement.

### 9. Customization polish: P3 · S
Markus (10/31) asked for a couple of themes and advanced controls. Both are **already shipped**: five themes, text size, reduced motion, difficulty, pacing, realism vs coaching, hints, image frequency and debrief depth.

**Remaining:**
- A theme preview on the landing page.
- Settings persist across sessions in localStorage.
- Tooltips explain what each advanced control does.

**Acceptance criteria:** `settings_e2e` still passes, and the hard caps are never relaxed.

### 10. Share link: P3 · S–M
**Acceptance criteria:**
- After `.end`, a "share" action creates a read-only, unguessable link to the debrief, scorecard and roll audit, with the seed revealed and a link to `/verify`.
- Hidden truth and prompts are never included.
- The trainee can revoke the link, and it expires after 30 days.

### 11. Richer mock mode: P3 · S
**Acceptance criteria:**
- Three or more canned scenarios (service, investigative, stateful sports), picked by keyword from the role.
- The mock narrator varies its text by tier and NUC.
- Mock output is still clearly labeled as mock.

### 12. Org admin dashboard: Revelare roadmap epic · P2 · XL
Raised by Markus via Muse on 10/29. It was framed as a product gap, not a hackathon blocker, so it lives in the Revelare-wrapped simTrain, not this standalone repo.

**Scope:**
- An org workspace and roster.
- Custom objectives that never lift hard caps.
- Progress per trainee and per cohort, including decision-vs-luck.
- Org reference files with an injection guard.
- Assignments with due dates.
- Cohort CSV and PDF export.

**Acceptance criteria:** track this in the Revelare `ROADMAP.md` with its own milestone breakdown. Its prerequisites are #5 (providers) and #2 (NUC sheets, so cohort analytics can include relationship handling).

---

### Process lessons (for Kiroween and future submissions, not code)
- Put the **public repo** link in the submission form well before the deadline. The GitHub field held a profile URL, and the repo went public about an hour after the deadline.
- Ship a keyless demo path and an env example from day one.
- Do a fresh-clone dry run (clone → install → test → dev) at feature freeze.
