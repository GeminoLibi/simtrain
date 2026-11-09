// NUC stat sheets end to end in keyless mock mode (bundle the worker to ./worker.js first; npm test does this).
// Checks: sheets generated, rolls aimed at a person carry a bounded DC part, trust/mood move per the code table,
// nothing relationship-related is visible during play (incl. ?builder=1), debrief has the relationship table,
// the export verifies, and .s RESETS relationships (Markus 2026-11-09).
import worker from "./worker.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process"; import { writeFileSync, mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { TIER_DELTA } from "../src/nuc.js";
globalThis.fetch = async () => { throw new Error("no network in mock mode"); };
const kv = new Map();
const KV = { list: async () => ({ keys: [], list_complete: true }), get: async k => kv.get(k)?.v ?? null, put: async (k, v, o) => kv.set(k, { v, m: o?.metadata }), delete: async k => kv.delete(k), getWithMetadata: async k => ({ value: kv.get(k)?.v ?? null, metadata: kv.get(k)?.m }) };
const env = { KV, META_BASE: "x", TEXT_MODEL: "t", IMAGE_MODEL: "i", SPEND_CAP_USD: "15", MOCK_LLM: "1" };
const raw = async (p, b) => worker.fetch(new Request("http://x" + p, { method: b ? "POST" : "GET", headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }), env, { waitUntil() {} });
const call = async (p, b) => (await raw(p, b)).json();
let ok = 0; const t = (n, c) => { assert.ok(c, n); ok++; console.log("PASS", n); };
const SECRETISH = /trust|mood|suspicion|authority|composure|hidden_goal|nuc_state|nuc_sheets|private_motive|refund she is not owed|second booking herself|## Relationships/i;

const { id } = await call("/api/session?builder=1", {});
const T = i => call(`/api/session/${id}/turn?builder=1`, { input: i });
await T("simTrain"); await T("ROLE: front desk agent\nEXPERIENCE_LEVEL: Experienced");
const st0 = JSON.parse(kv.get("s:" + id).v);
t("designer sheets sanitized into nuc_sheets", st0.nuc_sheets.length === 3 && st0.nuc_sheets[0].stats.suspicion === 4);
t("relationships start at the sheet values", st0.nuc_state.N1.trust === -1 && st0.nuc_state.N1.mood === -1 && st0.nuc_state.N2.trust === 1);
const plays = [
  "I walk over to Dana, apologize for the wait and explain I am checking both bookings against the schedule right now.",
  "I ask Dana for the exact time she placed her order so I can match it against the two bookings.",
  "I tell Dana that the duplicate will be cancelled and that her delivery is the one we keep.",
  "I call Pat, my supervisor, and report the duplicate booking and the waiting customer before doing anything else.",
  "Continue"
];
const views = [];
for (const p of plays) views.push(await T(p));
const st1 = JSON.parse(kv.get("s:" + id).v);
const targeted = st1.rolls.filter(r => r.nuc);
t("rolls aimed at a person carry roll.nuc and dc_parts.nuc", targeted.length >= 3 && targeted.every(r => typeof r.dc_parts.nuc === "number"));
t("NUC DC part within ±2 and the DC floor holds", targeted.every(r => Math.abs(r.dc_parts.nuc) <= 2 && r.dc >= (r.difficulty === "routine" ? 10 : 12)));
t("DC = max(floor, sum of parts)", st1.rolls.every(r => { const p = r.dc_parts; return r.dc === Math.max(r.difficulty === "routine" ? 10 : 12, p.base + p.experience + p.pressure + p.setting + (p.nuc || 0)); }));
// Replay Dana's trust from the code table and the logged tiers: the state must match exactly.
{ let tr = st1.nuc_state.N1.start_trust; for (const r of st1.rolls.filter(r => r.nuc?.id === "N1")) { assert.equal(r.nuc.trust, tr, "trust used by " + r.id); tr = Math.max(-3, Math.min(3, tr + TIER_DELTA[r.tier][0])); }
  t("Dana's trust follows the tier table roll by roll", st1.nuc_state.N1.trust === tr && st1.nuc_state.N1.history.length > 0); }
t("history entries record turn, roll and reason", st1.nuc_state.N1.history.every(h => h.turn && "roll" in h && h.why));
// Nothing secret during play: every play-time response (public state, transcript, builder rolls) is clean.
t("nothing relationship-related visible during play (incl. builder view)", views.every(v => !SECRETISH.test(JSON.stringify(v.state))));
t("builder rolls strip nuc parts during play", views.at(-1).state.rolls.every(r => !r.nuc && !("nuc" in (r.dc_parts || {}))));
t("public export before .end has no relationship data", !SECRETISH.test(JSON.stringify(await call(`/api/session/${id}/export`))));

let r = await T(".end"); const tx = r.state.transcript.map(m => m.text).join("\n");
t("debrief has the relationship table with every person", /## Relationships/.test(tx) && /\| Dana Ortiz \|/.test(tx) && /\| Sam Lee \|/.test(tx) && /\| Pat Rivera \|/.test(tx));
t("debrief reveals hidden motives and secrets as learning points", /What they weren't telling you/.test(tx) && /second booking herself/.test(tx));
t("roll audit shows the NUC part per roll", /incl\. Dana Ortiz [+−±]\d; trust/.test(tx) && /NUC part:/.test(tx));
const ex = await call(`/api/session/${id}/export`);
t("ended export carries roll.nuc", ex.rolls.some(r => r.nuc));
{ const f = join(mkdtempSync(join(tmpdir(), "simtrain-nuc-")), "export.json"); writeFileSync(f, JSON.stringify(ex));
  execFileSync(process.execPath, [new URL("../verify_rolls.mjs", import.meta.url).pathname, f], { stdio: "pipe" }); t("new export verifies with verify_rolls (exit 0)", true); }
t("verifier invariants hold (total = natural + mod, margin = total − DC)", ex.rolls.every(r => r.total === r.natural + r.modifier && r.margin === r.total - r.dc));

// .s: relationships RESET for the new scenario, even in the same session.
r = await T(".s"); const st2 = JSON.parse(kv.get("s:" + id).v);
t(".s resets every relationship to its starting values with empty history", Object.values(st2.nuc_state).every(x => x.trust === x.start_trust && x.mood === x.start_mood && x.history.length === 0) && st2.nuc_state.N1.trust === -1);
{ const sTurn = st2.turn; const { transcript, ...rest } = r.state; // earlier scenario's debrief legitimately stays in the session transcript
  t("new scenario after reset still clean during play", !SECRETISH.test(JSON.stringify(rest)) && !SECRETISH.test(JSON.stringify(transcript.filter(m => m.turn >= sTurn)))); }
console.log(`${ok} passed`);
