// Keyless demo mode. When MOCK_LLM=1 (see .dev.vars.example), chat() answers from this module instead of the
// Meta Model API, so the app runs from a fresh clone with no key, no network and no spend.
// The mock only stands in for the MODEL. Everything the README calls "code decides" (seeded d20, DCs, tiers,
// caps, scorecard, roll audit) still runs for real in engine.js / worker.js.
// Replies are deterministic and generic: they exercise the full turn loop, not scenario quality.

export const isMock = env => /^(1|true|yes|on)$/i.test(String(env?.MOCK_LLM || ""));

const after = (text, marker) => { const i = text.indexOf(marker); return i < 0 ? "" : text.slice(i + marker.length); };
const firstJSON = text => { const m = text.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
const traineeInput = user => after(user, "TRAINEE INPUT:\n").split("\n\nENGINE OUTCOME")[0].trim();
const today = () => { const d = new Date(); return `2026-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T09:00`; };

function profile(user) {
  const t = user.trim(), form = k => (t.match(new RegExp("^" + k + ":\\s*(.+)$", "mi")) || [])[1]?.trim() || null;
  const role = form("ROLE") || (t.length > 2 && !/^simtrain$/i.test(t) ? t.replace(/^i('m| am)\s+(an?\s+)?/i, "").slice(0, 80) : null);
  const exp = form("EXPERIENCE_LEVEL") || (/\b(expert|senior|veteran)\b/i.test(t) ? "Expert" : /\b(new|trainee|first day|junior)\b/i.test(t) ? "New" : /\byears?\b/i.test(t) ? "Experienced" : null);
  return { industry: form("INDUSTRY") || role, role, experience: exp, focus: form("SCENARIO_FOCUS") };
}

function scenario(user) {
  const p = firstJSON(user) || {}, role = p.role || "shift lead", n = (user.match(/"title":"Mock shift/g) || []).length + 1;
  return {
    title: `Mock shift #${n}: the double-booked delivery`,
    setting: `Demo site (offline mock mode), ${role}`,
    start_clock: today(), timezone_label: "ET", turn_minutes: 5, continue_minutes: 15, utc_offset_minutes: -300,
    state_title: "Shift state", stateful: true,
    state: { open_tasks: 3, staff_on_shift: 4, customer_waiting: "yes", supervisor: "off-site", log_updated: "no" },
    state_rules: ["staff_on_shift may not drop below 2 while customers are on site", "every incident must be logged before shift end"],
    briefing: `You are working as a ${role} (offline demo: replies come from a canned mock model, not an AI). Two deliveries were booked for the same slot, a customer is waiting at the counter asking for a manager, and your supervisor is off-site and reachable only by phone. Three tasks are open on the board. What do you do first?`,
    objective: "Resolve the double booking, keep the customer informed, and log the incident before shift end.",
    hidden_truth: "The second booking was a duplicate entry; one call to the vendor cancels it.",
    fundamentals: [
      { id: "F1", step: "acknowledge and update the waiting customer", framework: "customer-service standard", domain: "communication" },
      { id: "F2", step: "verify both bookings against the schedule before acting", framework: "site SOP", domain: "technical" },
      { id: "F3", step: "contact the vendor to cancel the duplicate", framework: "vendor policy", domain: "critical" },
      { id: "F4", step: "log the incident", framework: "site SOP", domain: "compliance" }
    ],
    nucs: [{ name: "Dana Ortiz", role: "waiting customer", disposition: "impatient but polite" }, { name: "Sam Lee", role: "coworker", disposition: "helpful, busy" }],
    rubric: { compliance: "follow site SOP and logging rules", technical: "verify records before changing them", communication: "keep the customer and team informed", critical: "prioritize under time pressure" },
    opening_image_prompt: "a busy service counter with a delivery dock behind it",
    turn_budget: 8, climax: "both delivery trucks arrive at once", climax_clock: "09:30"
  };
}

function classify(user) {
  const input = traineeInput(user), words = input.split(/\s+/).filter(Boolean).length, L = input.toLowerCase();
  const q = input.includes("?") && words < 12, said = /^\s*["“]/.test(input);
  const lvl = words >= 25 ? 3 : words >= 12 ? 2 : words >= 6 ? 1 : 0;
  const sat = [/customer|dana|apolog|wait/.test(L) && "F1", /verif|check|schedule|confirm/.test(L) && "F2", /vendor|cancel|call/.test(L) && "F3", /\blog\b|report|incident/.test(L) && "F4"].filter(Boolean);
  return {
    kind: q || said ? "other" : "action", consequential: !(q || said), specific_enough: words >= 6,
    summary: input.slice(0, 80) || "(empty)", missing_element: words >= 6 ? null : "who, what and how",
    rubric: { procedure: lvl, framework: Math.min(3, lvl), specificity: lvl }, elapsed_minutes: 5,
    difficulty: words >= 25 ? "routine" : "standard", fundamentals_satisfied: sat, fundamentals_required_missing: [],
    rule_violated: null, prohibited: false, egregious: false, egregious_reason: null, correct_approach: null,
    advantage_reason: null, disadvantage_reason: null,
    image_request: /^show me\b/i.test(input) ? input.slice(8, 200) : null
  };
}

const TIER_TEXT = {
  critical_success: "It goes better than expected: everyone is on the same page within minutes.",
  success: "It works. The people involved respond the way you hoped.",
  success_at_cost: "It works, but it eats time and someone is left a little frustrated.",
  friction: "It stalls: the line is busy and the customer sighs loudly.",
  failure: "It doesn't land. The situation is unchanged and the clock keeps running.",
  critical_failure: "It backfires: the customer asks for your supervisor's number."
};

function narrate(user) {
  const out = firstJSON(after(user, "ENGINE OUTCOME (binding):\n")) || {}, input = traineeInput(user);
  const base = out.mode === "resolved" ? (TIER_TEXT[out.tier] || "The scene moves on.")
    : out.mode === "escalation" ? `Sam looks up: "Okay, but what exactly do you do, and with whom?"`
    : out.mode === "continue" ? "Fifteen minutes pass. A second truck pulls into the lot."
    : `Dana nods. "Thanks for telling me."`;
  const upd = out.mode === "resolved" && /success/.test(out.tier || "") ? { open_tasks: 2 } : {};
  if (/\blog\b|incident/i.test(input) && /success/.test(out.tier || "")) upd.log_updated = "yes";
  return { narration: `*(mock model)* ${base}`, state_update: upd, artifacts: [], tier_acknowledged: out.tier || out.mode || "none", effects_rendered: out.effects || [] };
}

function grade(user) {
  const input = (after(user, "TRAINEE INPUT:") || after(user, "TRAINEE DOCUMENT:") || "").trim().split("\n")[0].slice(0, 120);
  const words = input.split(/\s+/).filter(Boolean);
  const quote = words.slice(0, 12).join(" ");
  const notes = words.length >= 6 ? [{ domain: "communication", delta: 1, evidence: quote, rationale: "mock grader: concrete, stated action" }] : [];
  return { narration_consistent: true, consistency_issue: null, notes, missed_steps: [], state_issue: null, fundamentals_satisfied: [] };
}

// role is the first argument chat() already receives: setup | profile | classifier | narrator(-retry|-leakfix) | grader(-artifact) | feedback
export function mockChat(role, system, user, json = true) {
  let out;
  if (role === "profile") out = profile(after(user, "TRAINEE INPUT:\n") || user);
  else if (role === "setup") out = scenario(user);
  else if (role === "classifier") out = classify(user);
  else if (role.startsWith("narrator")) out = role === "narrator-leakfix" ? { narration: after(user, "NARRATION:\n") || "*(mock model)*", state_update: {}, artifacts: [] } : narrate(user);
  else if (role.startsWith("grader")) out = grade(user);
  else if (role === "feedback") out = { feedback: "### Debrief (mock model)\nThis debrief was written by the offline mock, not an AI. The scorecard and roll audit above are real: they were computed in code from this session's seeded rolls and grader ledger.\n\nSet `META_API_KEY` and remove `MOCK_LLM` for real scenarios and feedback." };
  else out = {};
  return json ? out : JSON.stringify(out);
}
