# DESIGN DRAFT: NUC stat sheets (backlog #2)

Status: **draft for review. Do not merge** until Markus has signed off. No code changes are on this branch yet.
Requested by Markus on 2026-11-04: "NUC stats are important for immersive rolls."

## Problem
Each NUC is `{name, role, disposition}`, written once by the scenario designer. The narrator improvises everything else, so:
- An NUC's attitude toward the trainee is narrator fiat and can drift between turns.
- The roll has no idea who the action targets. Persuading a hostile supervisor and a cooperative coworker use the same DC.
- Nothing persists. A trainee who was rude three turns ago meets the same NUC as before.

## Principle (unchanged)
**The model writes the sheet once. Code owns every number after that.** The model can propose deltas, but code clamps, applies and records them, and they flow into the roll audit, the way DCs already do.

## Schema (emitted by the SCENARIO DESIGNER, validated by code)
```jsonc
"nucs": [{
  "id": "N1",                         // code assigns this if missing; stable for the scenario
  "name": "Dana Ortiz",
  "role": "waiting customer",
  "disposition": "impatient but polite",   // kept for backward compatibility; seeds the starting mood
  "stats": {                          // integers 0-5, 2 = average for this job
    "composure": 2,                   // resists pressure and escalation
    "cooperation": 3,                 // baseline willingness to help the trainee
    "authority": 1,                   // how much their yes or no gates progress (0 bystander .. 5 decision-maker)
    "expertise": 1,                   // domain knowledge; drives how they react to jargon and bluffing
    "suspicion": 2                    // likelihood they doubt or verify what the trainee says
  },
  "goals": ["get her order before her lunch break ends"],          // 1-3, public-ish
  "hidden_goal": "wants a refund she isn't entitled to",           // optional, NEVER shown to the trainee
  "secrets": [{ "id": "S1", "fact": "she placed the duplicate booking", "reveal_dc": 15 }],   // 0-2, never shown
  "knows": ["the time she placed the order", "the vendor's name"],    // facts they can share when asked well
  "doesnt_know": ["the vendor's cancellation policy"],
  "start": { "trust": 0, "mood": 0 }  // -3..+3 each; code derives these from disposition when omitted
}]
```
- Code validation (`sanitizeNuc`): stats are clamped to 0–5, with a default of 2. Lists are capped (goals 3, secrets 2, knows/doesnt_know 6 each) and strings at 120 characters. The scenario allows at most 6 NUCs.
- **Backward compatibility:** an old-shape NUC gets default stats, with `start` derived from `disposition` by keyword (hostile, uncooperative, wary → trust -1; helpful, cooperative → +1). Sessions already stored in KV load unchanged.

## Live state (code-owned, persisted in session state `st.nuc_state`)
```jsonc
"nuc_state": { "N1": { "trust": -1, "mood": 1, "met": true, "revealed": ["S1"], "history": [{ "turn": 4, "d_trust": -1, "d_mood": 0, "why": "R3 failure: brushed off her question" }] } }
```

## How it feeds rolls (engine.js `resolve`)
1. **Target.** The CLASSIFIER gets a new field, `"target_nuc": "N1"|null`: the NUC this action mainly acts on or through. Code ignores any id that isn't in the scenario.
2. **DC part `nuc`:** `nuc = clamp(round((authority - 2) / 2) - trust_sign(trust) - (mood <= -2 ? -1 : 0), -2, +2)`.
   - High-authority NUCs are harder to move.
   - Positive trust lowers the DC, and negative trust raises it.
   - An NUC with mood -2 or lower (upset) adds +1.
   - `trust_sign` is -1, 0 or +1, so a single relationship never swings the DC by more than 2.
   - The value goes in `dc_parts.nuc`. The DC floor (10 or 12) still holds, so a friendly NUC never makes a consequential action trivial.
3. **Advantage or disadvantage.** Trust of +2 or more gives advantage. Trust of -2 or less gives disadvantage, as does `suspicion` of 4 or more when the classifier flags `unverified_claim: true` (the trainee asserted something without backing). These stack with the existing rules and cancel like 5e.
4. **Secrets.** When the action tries to elicit information from the target and the roll total reaches `reveal_dc`, code marks the secret revealed and passes it to the narrator in `ENGINE OUTCOME.reveal`, which the narrator must render. The narrator never sees unrevealed secrets as revealable.
5. **Determinism.** Nothing new is random. The d20 derivation is unchanged, so `verify_rolls.mjs` and `/verify` keep working. Old exports, which have no `dc_parts.nuc`, verify exactly as before.

## Per-turn updates (worker.js, after resolve)
- Each tier maps to a base delta for the target NUC:

  | Tier | Δ trust | Δ mood |
  |---|---|---|
  | critical_success | +1 | +1 |
  | success | +1 | 0 |
  | friction | 0 | -1 |
  | failure | -1 | -1 |
  | critical_failure | -2 | -2 |

- Classifier tags adjust the deltas:
  - `respectful_communication: true` adds +1 mood. It is capped at once per NUC per 3 turns, so a trainee can't farm politeness.
  - `prohibited` or `egregious` adds -1 trust with every NUC present.
  - A broken promise gives -2 trust. This needs a small promise ledger, planned for phase 2.
- Clamps:
  - Values stay in -3..+3.
  - Each NUC can change by at most ±2 per turn.
  - Mood decays one step toward the NUC's start value per `Continue`, so people calm down over time. Trust does not decay.
- Freeform turns (dialogue) can give at most a ±1 mood change, and only from the grader's communication delta sign.

## Prompt surface
- **Narrator context:** for each NUC on scene it gets name, role, a mood/trust *label* (wary, warming, hostile, cooperative), `knows` and `goals`. It never gets numbers.
  - It gets `hidden_goal` and unrevealed `secrets` only as "behave consistently with this; never state it".
  - The LEAK filter is extended to cover secret texts.
- **Trainee view (`publicView`):** names, roles and a coarse label at most (for example "Dana: impatient"), and only when the hints setting is `guided`. Stats, trust numbers, secrets and hidden goals are never shown.
- **Debrief and roll audit (after `.end`):**
  - A relationship table: start → end trust and mood per NUC, with the turns that moved them.
  - `dc_parts.nuc` per roll.
  - Decision-vs-luck tags can say "harder because Dana's trust was low after R2".
  - Hidden secrets are revealed in the debrief as learning points.

## Grading
The grader gets the trust trajectory as context for the communication domain. A trainee who lost trust and then repaired it gets credit. The four-domain math stays code-computed, and nothing in NUC state changes a score directly.

## Settings interaction
- `difficulty` scales starting trust: gentle +1, hard -1.
- `realism` vs `coaching`: coaching may surface the coarse label without `guided` hints.
- No setting relaxes the hard caps or the DC floor.

## Tests to add
- `tests/nuc_engine.test.mjs`: modifier math, clamps, the ±2 per-turn cap, mood decay, and that an old-shape NUC still loads.
- Hidden-mechanics test: no stat numbers, secrets or hidden goals appear in any trainee-visible text across a full session.
- Mock mode: the mock designer emits sheets, and the mock e2e shows trust dropping after a failure and recovering after successes. The audit shows `dc_parts.nuc`, and `verify_rolls` still passes.
- Export round-trip: `nuc_state` survives save and load, and appears in the admin export but not in the public export until `.end`.

## Rollout
1. Schema, sanitizer and persistence, with no roll effects yet. Ship and observe. (S)
2. Roll coupling (DC part and advantage) plus audit and debrief output. (M)
3. Secrets and reveal, the promise ledger, and grader context. (M)

Estimate: L in total (about 3–5 days), plus a Muse playtest pass on 3 roles to check that NUCs feel consistent and that rolls feel earned.

## Open questions for Markus
- Should trainees ever see a relationship hint during play (coarse labels behind `guided` hints), or only in the debrief?
- Should rapport carry across `.s` within a session (recurring characters), or should every scenario start fresh? The proposal is fresh, with an option for later.
