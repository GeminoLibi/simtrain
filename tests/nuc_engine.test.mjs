// NUC stat sheets, phase 1: pure engine math (no worker, no network).
import assert from "node:assert/strict";
import { sanitizeNucs, initNucState, nucDcPart, nucAdvantage, applyNucTurn, relationshipTable, dispositionStart, NUC_DC_CAP } from "../src/nuc.js";
import { resolve } from "../src/engine.js";
let n = 0; const t = (name, fn) => { fn(); n++; console.log("PASS", name); };

t("old-shape NUC gets default stats and a start from disposition", () => {
  const [a] = sanitizeNucs([{ name: "Keller", role: "umpire", disposition: "hostile and impatient" }]);
  assert.equal(a.id, "N1"); assert.deepEqual(a.stats, { composure: 2, cooperation: 2, authority: 2, expertise: 2, suspicion: 2 });
  assert.equal(a.start.trust, -1); assert.equal(a.secrets.length, 0); assert.equal(a.hidden_goal, null);
});
t("sanitizer clamps stats, start, lists, ids, count", () => {
  const raw = Array.from({ length: 9 }, (_, i) => ({ id: i ? "N1" : "bogus", name: "P" + i, stats: { authority: 99, suspicion: -4, composure: "x" }, start: { trust: 9, mood: -9 }, goals: ["a", "b", "c", "d"], secrets: [{ fact: "s1", reveal_dc: 99 }, "s2", "s3"], knows: Array(10).fill("k") }));
  const s = sanitizeNucs(raw);
  assert.equal(s.length, 6); assert.equal(new Set(s.map(x => x.id)).size, 6);
  assert.equal(s[0].stats.authority, 5); assert.equal(s[0].stats.suspicion, 0); assert.equal(s[0].stats.composure, 2);
  assert.deepEqual(s[0].start, { trust: 3, mood: -3 }); assert.equal(s[0].goals.length, 3); assert.equal(s[0].secrets.length, 2); assert.equal(s[0].secrets[0].reveal_dc, 25); assert.equal(s[0].knows.length, 6);
});
t("dispositionStart reads tone", () => { assert.equal(dispositionStart("friendly, helpful").trust, 1); assert.equal(dispositionStart("furious").mood, -2); assert.equal(dispositionStart("").trust, 0); });
t("initNucState: fresh history, difficulty shifts trust, reset ignores prior state", () => {
  const sh = sanitizeNucs([{ name: "A", start: { trust: 0, mood: 1 } }]);
  assert.deepEqual(initNucState(sh, "standard").N1, { trust: 0, mood: 1, start_trust: 0, start_mood: 1, history: [] });
  assert.equal(initNucState(sh, "gentle").N1.trust, 1); assert.equal(initNucState(sh, "hard").N1.trust, -1);
});
t("DC part is always within ±2 across every stat/trust/mood combination", () => {
  for (let au = 0; au <= 5; au++) for (let tr = -3; tr <= 3; tr++) for (let mo = -3; mo <= 3; mo++) {
    const p = nucDcPart({ stats: { authority: au } }, { trust: tr, mood: mo }); assert.ok(Math.abs(p) <= NUC_DC_CAP, `${au},${tr},${mo} -> ${p}`);
  }
  assert.equal(nucDcPart({ stats: { authority: 5 } }, { trust: -3, mood: -3 }), 2);
  assert.equal(nucDcPart({ stats: { authority: 0 } }, { trust: 3, mood: 3 }), -2);
  assert.equal(nucDcPart(null, null), 0);
});
t("advantage at trust ≥2, disadvantage at ≤-2 or suspicious + unbacked claim", () => {
  const sh = { name: "X", stats: { suspicion: 4 } };
  assert.ok(nucAdvantage(sh, { trust: 2 }, {}).adv); assert.ok(nucAdvantage(sh, { trust: -2 }, {}).dis);
  assert.ok(nucAdvantage(sh, { trust: 0 }, { unverified_claim: true }).dis); assert.ok(!nucAdvantage(sh, { trust: 0 }, {}).dis);
});
const mk = (trust, mood, au = 0) => { const sheets = sanitizeNucs([{ id: "N1", name: "Dana", stats: { authority: au } }]); const ns = initNucState(sheets); ns.N1.trust = trust; ns.N1.mood = mood;
  return { turn: 1, rolls: [], traps: [], fundamentals: [], profile: { experience: "Experienced" }, friction_clock: 0, momentum: 0, seed: "abc123", turn_minutes: 5, nuc_sheets: sheets, nuc_state: ns }; };
const cls = (extra = {}) => ({ summary: "talk to Dana", rubric: { procedure: 2, framework: 2, specificity: 2 }, difficulty: "routine", elapsed_minutes: 2, target_nuc: "N1", ...extra });

{ const st = mk(3, 3); const r = await resolve(st, cls()); assert.equal(r.dc_parts.nuc, -2); assert.ok(r.dc >= 10, "routine floor 10 holds"); assert.equal(r.mode, "advantage"); assert.equal(r.draws.length, 2); assert.equal(r.nuc.id, "N1"); assert.ok(r.nuc.advantage); assert.equal(r.total, r.natural + r.modifier); n++; console.log("PASS resolve floor/advantage"); }
{ const st = mk(-3, -3, 5); const r = await resolve(st, cls({ difficulty: "standard" })); assert.equal(r.dc_parts.nuc, 2); { const p = r.dc_parts; assert.equal(r.dc, Math.max(12, p.base + p.experience + p.pressure + p.setting + p.nuc)); } assert.equal(r.mode, "disadvantage"); n++; console.log("PASS resolve hostile high-authority NUC: +2 and disadvantage"); }
{ const st = mk(0, 0); const r = await resolve(st, cls({ target_nuc: "N9" })); assert.ok(!("nuc" in r.dc_parts)); assert.ok(!r.nuc); n++; console.log("PASS unknown target ignored"); }
{ const st = mk(0, 0); delete st.nuc_sheets; delete st.nuc_state; const r = await resolve(st, cls()); assert.ok(!r.nuc && !("nuc" in r.dc_parts)); n++; console.log("PASS old session (no sheets) resolves exactly as before"); }
t("applyNucTurn: tier table, per-turn ±2 cap, clamp, everyone pays for improper acts", () => {
  const st = mk(0, 0); st.nuc_sheets.push(...sanitizeNucs([{ id: "N2", name: "Sam" }]).map(x => ({ ...x, id: "N2" }))); st.nuc_state.N2 = { trust: 0, mood: 0, start_trust: 0, start_mood: 0, history: [] };
  applyNucTurn(st, { roll: { id: "R1", tier: "success" }, cls: { target_nuc: "N1" } }); assert.equal(st.nuc_state.N1.trust, 1); assert.equal(st.nuc_state.N2.trust, 0);
  applyNucTurn(st, { roll: { id: "R2", tier: "critical_failure", prohibited: true }, cls: { target_nuc: "N1" } });
  assert.equal(st.nuc_state.N1.trust, -1, "-2 tier -1 improper = -3, capped at -2 per turn"); assert.equal(st.nuc_state.N2.trust, -1);
  for (let i = 0; i < 5; i++) applyNucTurn(st, { roll: { id: "R" + i, tier: "critical_failure" }, cls: { target_nuc: "N1" } }); assert.equal(st.nuc_state.N1.trust, -3); assert.equal(st.nuc_state.N1.mood, -3);
  assert.ok(st.nuc_state.N1.history.every(h => Math.abs(h.d_trust) <= 2 && Math.abs(h.d_mood) <= 2));
});
t("Continue decays mood toward start; trust does not decay", () => {
  const st = mk(-2, -3); st.nuc_state.N1.start_mood = 0; applyNucTurn(st, { kind: "continue" }); assert.equal(st.nuc_state.N1.mood, -2); assert.equal(st.nuc_state.N1.trust, -2);
});
t("freeform dialogue moves mood by at most 1 from the grader's communication sign", () => {
  const st = mk(0, 0); applyNucTurn(st, { kind: "freeform", cls: { target_nuc: "N1" }, graderComm: 3 }); assert.equal(st.nuc_state.N1.mood, 1); assert.equal(st.nuc_state.N1.trust, 0);
});
t("relationship table lists start→end and hidden motives", () => {
  const st = mk(0, 0); st.nuc_sheets[0].hidden_goal = "wants a refund"; applyNucTurn(st, { roll: { id: "R1", tier: "failure" }, cls: { target_nuc: "N1" } });
  const tb = relationshipTable(st); assert.match(tb, /## Relationships/); assert.match(tb, /\| Dana \|.*0 → \*\*-1\*\*/); assert.match(tb, /wanted: wants a refund/);
  assert.equal(relationshipTable({}), "");
});
console.log(`${n}/${n} passed`);
