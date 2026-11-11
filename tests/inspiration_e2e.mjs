// Inspiration: rare, at most one per scenario, never player-spent. Auto-clears one uncleared egregious act or banks at 0.
import assert from "node:assert/strict";
import worker from "./worker.js";

const kv = new Map();
const KV = { get: async (k) => kv.get(k)?.v ?? null, put: async (k, v, o) => kv.set(k, { v, m: o?.metadata }), delete: async k => kv.delete(k), getWithMetadata: async k => ({ value: kv.get(k)?.v ?? null, metadata: kv.get(k)?.m }) };
let mode = { kind: "setup" };
const summary = "Verified the folio, caught the double charge, and explained the correction before the guest escalated";
globalThis.fetch = async (url, o) => {
  const b = JSON.parse(o.body || "{}");
  const sys = b.messages?.[0].content || "";
  let out;
  if (sys.includes("SCENARIO DESIGNER")) out = { title: "Night Desk", setting: "City hotel", start_clock: "2026-10-29 17:00", timezone_label: "ET", turn_minutes: 5, continue_minutes: 30, state_title: "State", stateful: true, state: { dispute: "open" }, state_rules: [], briefing: "A guest disputes a charge.", objective: "Resolve per policy.", hidden_truth: "Double charge.", fundamentals: [{ id: "F1", step: "Verify the guest photo ID", framework: "Key policy", domain: "compliance" }], nucs: [{ name: "Jordan", role: "guest", disposition: "tense" }], rubric: {}, turn_budget: 8, climax: "the GM arrives" };
  else if (sys.includes("Extract the trainee profile")) out = { role: "Front desk", experience: "Experienced", industry: "Hotel" };
  else if (sys.includes("ACTION CLASSIFIER")) {
    if (mode.kind === "egregious") out = { kind: "action", consequential: true, elapsed_minutes: 2, specific_enough: true, summary: "Shove the guest", rubric: { procedure: 0, framework: 0, specificity: 3 }, difficulty: "standard", prohibited: true, egregious: true, egregious_reason: "Shoving a guest is assault.", correct_approach: "Follow policy and get a supervisor.", exceptional: false, fundamentals_satisfied: [], fundamentals_required_missing: [] };
    else if (mode.kind === "exceptional") out = { kind: "action", consequential: true, elapsed_minutes: 3, specific_enough: true, summary, rubric: { procedure: 3, framework: 3, specificity: 3 }, difficulty: "standard", prohibited: false, egregious: false, exceptional: true, exceptional_reason: "Caught the error and applied policy before the dispute escalated.", fundamentals_satisfied: ["F1"], fundamentals_required_missing: [] };
    else out = { kind: "action", consequential: true, elapsed_minutes: 3, specific_enough: true, summary: "Check the folio", rubric: { procedure: 3, framework: 3, specificity: 3 }, difficulty: "standard", prohibited: false, egregious: false, exceptional: false, fundamentals_satisfied: [], fundamentals_required_missing: [] };
  }
  else if (sys.includes("ROLE: NARRATOR")) out = { narration: "Jordan waits at the desk.", state_update: {}, artifacts: [], tier_acknowledged: "success" };
  else if (sys.includes("simTrain GRADER writing")) out = { feedback: "DEBRIEF" };
  else out = { narration_consistent: true, notes: [], missed_steps: [], exceptional: mode.kind === "exceptional", exceptional_reason: mode.kind === "exceptional" ? "Caught the error first." : null };
  if (String(url).includes("images")) return new Response("{}", { status: 500 });
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }], usage: {} }));
};
const env = { KV, META_BASE: "http://m", TEXT_MODEL: "t", IMAGE_MODEL: "i", SPEND_CAP_USD: "15", META_API_KEY: "x" };
const ctx = { waitUntil() {} };
const call = async (p, body) => {
  const r = await worker.fetch(new Request("http://x" + p, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  return [r, await r.json().catch(() => null)];
};
const start = async () => {
  kv.clear();
  const [, s] = await call("/api/session", {});
  const id = s.id;
  const T = async (i) => (await call(`/api/session/${id}/turn`, { input: i }))[1];
  await T("simTrain");
  await T("INDUSTRY: Hotel\nROLE: Front desk\nEXPERIENCE_LEVEL: Experienced\nSCENARIO_FOCUS: dispute");
  return { T, id };
};
const last = r => r.state.transcript[r.state.transcript.length - 1];
let passed = 0, n = 0;
const t = (name, c) => { n++; if (!c) { console.log("FAIL", name); process.exitCode = 1; } else { passed++; console.log("PASS", name); } };

{
  const { T } = await start();
  mode.kind = "good";
  const r = await T("I verify the guest's photo ID, open the folio, and explain each charge calmly against the receipt.");
  t("ordinary good play never earns Inspiration", r.state.inspiration !== true && !r.state.transcript.some(m => /Inspiration earned/.test(m.text)));
}

{
  const { T } = await start();
  mode.kind = "egregious";
  let r = await T("I shove the guest into the wall.");
  r = await T("I pocket the guest's credit card.");
  t("two egregious acts reach 2/2", r.state.egregious === 2 && r.state.phase === "play");
  mode.kind = "exceptional";
  r = await T("I pull the folio, compare it to the authorization slips, catch the double charge, and tell the guest I will reverse it before they have to argue.");
  t("Inspiration at 2/2 auto-clears one and shows 1/2", r.state.inspiration !== true && r.state.egregious === 1 && /Inspiration earned/.test(last(r).text) && /Egregious actions now 1\/2/.test(last(r).text) && r.state.phase === "play");
  r = await T(".end");
  const card = r.state.transcript.find(m => (m.text || "").startsWith("## Scorecard"))?.text || "";
  t("debrief lists both acts and marks cleared-by Inspiration", /Cleared by Inspiration:/.test(card) && card.includes(summary) && /shove the guest/.test(card) && /pocket the guest/.test(card));
}

{
  const { T } = await start();
  mode.kind = "exceptional";
  let r = await T("I notice the folio already shows two identical charges, reverse one per policy, and walk the guest through the correction as they arrive.");
  t("Inspiration at 0/2 is banked", r.state.inspiration === true && /Inspiration earned/.test(last(r).text) && /Egregious actions now 0\/2/.test(last(r).text));
  mode.kind = "egregious";
  r = await T("I shove the guest into the wall.");
  t("banked Inspiration auto-applies and does not warn or end", r.state.inspiration !== true && r.state.egregious === 0 && r.state.phase === "play" && /Inspiration applied/.test(last(r).text) && !r.state.transcript.some(m => /Warning 1 of 2/.test(m.text)));
  r = await T(".end");
  const card = r.state.transcript.find(m => (m.text || "").startsWith("## Scorecard"))?.text || "";
  t("debrief still lists the cleared act", /Cleared by Inspiration:/.test(card) && /shove the guest/.test(card));
}

{
  const { T } = await start();
  mode.kind = "exceptional";
  let r = await T("I catch the double charge immediately and reverse it per policy, walking the guest through every line.");
  t("first exceptional earns once", r.state.inspiration === true);
  r = await T("I also notice a late-arrival fee was applied in error and correct that before they ask, with the exact policy citation.");
  t("Inspiration is earned at most once per scenario", r.state.inspiration === true && r.state.transcript.filter(m => /Inspiration earned/.test(m.text)).length === 1);
}

console.log(`${passed}/${n} passed`);
if (passed !== n) process.exit(1);
