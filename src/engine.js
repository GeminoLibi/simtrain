import { findTarget, nucDcPart, nucAdvantage } from "./nuc.js";
// Deterministic resolution engine. No model involvement. Pure functions + Web Crypto.
export const DIFFICULTY_DC = { routine: 8, standard: 12, hard: 15, severe: 18, extreme: 21 };
export const EXP_ADJ = { New: -2, Experienced: 0, Expert: 0, Basic: -2, Intermediate: 0, Advanced: 0 };
// Canonical experience labels are the ones the trainee sees (New / Experienced / Expert). Legacy enum values map onto them.
export function normExp(x) {
  const s = String(x || "").toLowerCase();
  if (!s) return null;
  if (/expert|advanced|senior|veteran|trainer/.test(s)) return "Expert";
  if (/experienced|intermediate|on my own/.test(s)) return "Experienced";
  if (/new|basic|novice|rookie|trainee|beginner/.test(s)) return "New";
  return null;
}
export const TIER_LABEL = { critical_failure: "CRITICAL FAILURE", failure: "FAILURE", friction: "PARTIAL (friction)", success: "SUCCESS", critical_success: "CRITICAL SUCCESS" };
// Visible roll line, computed entirely from the code-side roll record (the model never writes it).
export function rollLine(r) {
  const sign = r.modifier >= 0 ? "+" : "−";
  const draws = r.mode === "normal" ? `d20 ${r.natural}` : `d20 ${r.mode} [${r.draws.join(", ")}] → ${r.natural}`;
  const cap = r.prohibited ? " · ⚠ improper act: auto-fail cap" : "";
  const fl = r.floor_applied ? (r.natural === 1 ? " · 🛡 mastery floor: nat 1 → Friction (not Critical Failure)" : ` · 🛡 mastery floor: ${TIER_LABEL[r.tier_before_floor]} → Success (procedure 3, framework ≥2, specificity 3, no skipped prerequisites)`) : "";
  return `🎲 **${r.id}** · ${r.action} · DC ${r.dc} · ${draws} ${sign} ${Math.abs(r.modifier)} = **${r.total}** · **${TIER_LABEL[r.tier]}**${fl}${cap}`;
}
export const TIERS = ["critical_failure", "failure", "friction", "success", "critical_success"];
const FRICTION_TYPES = [
  "delay", "partial_data", "uncooperative_nuc", "red_tape", "conflicting_info", "format_problem"];

async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export const commit = sha256hex;

// Seeded, auditable d20: value = f(seed, rollIndex, draw). Anyone with the revealed seed can recompute.
export async function d20(seed, idx, draw = 0) {
  for (let k = 0; ; k++) {
    const h = await sha256hex(`${seed}:${idx}:${draw}:${k}`);
    const n = parseInt(h.slice(0, 8), 16);
    if (n < 4294967280) return { value: (n % 20) + 1, hash: h.slice(0, 16) }; // rejection sampling, no modulo bias
  }
}
async function pick(seed, tag, arr) {
  const h = await sha256hex(`${seed}:${tag}`); return arr[parseInt(h.slice(0, 8), 16) % arr.length];
}
async function randInt(seed, tag, lo, hi) {
  const h = await sha256hex(`${seed}:${tag}`); return lo + (parseInt(h.slice(0, 8), 16) % (hi - lo + 1));
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export async function resolve(state, cls) {
  const idx = state.rolls.length + 1;
  const r = cls.rubric || {};
  const rp = clamp(r.procedure | 0, 0, 3), rf = clamp(r.framework | 0, 0, 3), rs = clamp(r.specificity | 0, 0, 3);
  const skill = rp + rf + rs - 3;                                    // -3 .. +6
  const missing = (cls.fundamentals_required_missing || []).filter(id => state.fundamentals.some(f => f.id === id));
  const prereqPenalty = -Math.min(3, missing.length);              // -1 per skipped fundamental (max -3)
  const base = DIFFICULTY_DC[cls.difficulty] ?? 12;
  const exp = EXP_ADJ[state.profile.experience] ?? 0;
  const pressure = Math.min(2, Math.floor(state.friction_clock / 4));  // accumulated slop raises the bar (capped: no death spiral)
  const floor = cls.difficulty === "routine" ? 10 : 12;              // floor: consequential actions are never trivial
  const setting = ({ gentle: -1, hard: 2 })[state.run?.difficulty] || 0; // trainee difficulty setting; the floor still holds
  // NUC stat sheet of the person this action targets (if any): bounded DC part (±2) and advantage/disadvantage.
  const tgt = findTarget(state, cls);
  const nucPart = tgt ? nucDcPart(tgt.sheet, tgt.rel) : 0, nucAd = tgt ? nucAdvantage(tgt.sheet, tgt.rel, cls) : { adv: false, dis: false, why: null };
  const dc = Math.max(floor, base + exp + pressure + setting + nucPart); // the floor still holds: a friendly NUC never makes it trivial
  // advantage / disadvantage (cancel each other, like 5e)
  let adv = !!cls.advantage_reason || state.momentum > 0 || nucAd.adv;
  let dis = !!cls.disadvantage_reason || missing.length >= 2 || nucAd.dis;      // stacking skipped fundamentals = disadvantage
  const mode = adv && !dis ? "advantage" : dis && !adv ? "disadvantage" : "normal";
  const a = await d20(state.seed, idx, 0);
  let nat = a.value, draws = [a];
  if (mode !== "normal") {
    const b = await d20(state.seed, idx, 1); draws.push(b);
    nat = mode === "advantage" ? Math.max(a.value, b.value) : Math.min(a.value, b.value);
  }
  const mod = skill + prereqPenalty;
  const total = nat + mod;
  const margin = total - dc;
  const mastery = rp === 3 && rf >= 2 && rs === 3 && missing.length === 0;
  let tier;
  if (nat === 1) tier = mastery ? "friction" : "critical_failure";
  else if (nat === 20 || (margin >= 10 && nat >= 15 && cls.difficulty !== "routine")) tier = "critical_success"; // routine work caps at plain success
  else if (margin >= 0) tier = "success";
  else if (margin >= -5) tier = "friction";
  else tier = "failure";
  // MASTERY FLOOR (documented in README): when procedure=3, framework>=2, specificity=3 and no prerequisite was skipped,
  // a below-DC roll is lifted to SUCCESS; a natural 1 still costs something and lands on FRICTION instead of a critical failure.
  const tier_before_floor = tier;
  if (mastery && TIERS.indexOf(tier) < TIERS.indexOf("success") && nat !== 1) tier = "success";
  const floor_applied = tier !== tier_before_floor;

  // Prohibited acts (unlawful / unsafe / policy-violating) can never succeed into legitimacy
  const prohibited = !!cls.prohibited;
  const tier_before_cap = tier;
  if (prohibited && TIERS.indexOf(tier) > TIERS.indexOf("failure")) tier = "failure"; // unlawful/unsafe acts AUTO-FAIL in code, regardless of the die
  // Code-decided consequences (the narrator must render these)
  const effects = []; let clockDelta = 0; // Elapsed time follows the action itself (classifier estimate), not a fixed per-turn block: "immediately" stays ~1-2 min.
  const est = parseInt(cls.elapsed_minutes, 10);
  const tm = Number.isFinite(est) && est > 0 ? clamp(est, 1, 240) : clamp(state.turn_minutes || 15, 1, 60);
  let simMinutes = tm <= 2 ? tm : await randInt(state.seed, `t${idx}`, Math.max(1, Math.round(tm * 0.8)), Math.round(tm * 1.2));
  if (tier === "critical_failure") {
    effects.push("A serious, partly irreversible setback directly caused by this action (e.g., evidence compromised, system crash, safety/legal violation flagged by an NUC). Name it concretely.");
    clockDelta = 3; simMinutes += Math.round(tm * 1.5);
  } else if (tier === "failure") {
    effects.push("The action does not achieve its goal. Give a concrete, realistic reason (rejected, refused, wrong result) and what it cost.");
    clockDelta = 2; simMinutes += tm;
  } else if (tier === "friction") {
    const ft = await pick(state.seed, `f${idx}`, FRICTION_TYPES);
    const hrs = await randInt(state.seed, `h${idx}`, 2, 72);
    const fx = {
      delay: `Technically succeeds but the result is delayed (expected in ~${hrs} hours of in-world time); show it as PENDING now. Do not jump the clock forward to deliver it.`,
      partial_data: "Technically succeeds but returns incomplete/fragmented data (gaps, truncated fields); show the gaps.",
      uncooperative_nuc: "Technically succeeds but a NUC is uncooperative or evasive; they give the minimum.",
      red_tape: "Technically succeeds only partway: a bureaucratic/legal hurdle (form, approval, jurisdiction) blocks full completion.",
      conflicting_info: "Technically succeeds but yields a conflicting or ambiguous datum that must be reconciled.",
      format_problem: "Technically succeeds but output arrives in an awkward format (wrong timezone, scanned PDF, proprietary export)."
    }[ft];
    effects.push(fx); clockDelta = 1; simMinutes += Math.round(tm * 0.5);
  } else if (tier === "success") {
    effects.push("Normal progression: the action yields the expected, standard result, nothing more.");
  } else {
    effects.push("Flawless execution: pristine result PLUS one concrete breakthrough (e.g., suspect OPSEC error, a clean correlating datum, exact fault isolated).");
    clockDelta = -1;
  }
  if (prohibited) effects.push("This act is improper (unlawful, unsafe, against policy or against the rules of the activity). It FAILS: it does not produce the result sought (records are refused or must be suppressed, the substitution is disallowed, the supervisor stops it). Render one concrete realistic consequence (e.g. evidence suppressed/inadmissible, supervisor or official intervenes, write-up, injury, health-code violation, complaint). No partial success, no breakthrough, no data or benefit obtained from it." + (cls.rule_violated ? ` Rule violated: ${cls.rule_violated}.` : ""));
  // Trap mechanic: missing fundamentals bite now, silently recorded
  const bites = [];
  for (const id of missing) {
    const f = state.fundamentals.find(x => x.id === id);
    let t = state.traps.find(x => x.id === id);
    if (!t) { t = { id, step: f.step, framework: f.framework, domain: f.domain, first_turn: state.turn, bites: 0, cured: false }; state.traps.push(t); }
    t.bites++; bites.push(id);
    effects.push(`Natural consequence of the skipped fundamental "${f.step}": the result is compromised accordingly (e.g., inadmissible, "No Records Found", wrong scope, unsafe). Do NOT tell the trainee which step they missed.`);
  }
  state.friction_clock = clamp(state.friction_clock + clockDelta, 0, 12);
  state.momentum = tier === "critical_success" ? 1 : 0;
  const roll = {
    id: `R${idx}`, turn: state.turn, ts: new Date().toISOString(), action: cls.summary,
    difficulty: cls.difficulty, dc, dc_parts: { base, experience: exp, pressure, setting, ...(tgt ? { nuc: nucPart } : {}) },
    ...(tgt ? { nuc: { id: tgt.sheet.id, name: tgt.sheet.name, trust: tgt.rel?.trust ?? 0, mood: tgt.rel?.mood ?? 0, dc_part: nucPart, advantage: nucAd.adv ? nucAd.why : null, disadvantage: nucAd.dis ? nucAd.why : null } } : {}),
    mode, draws: draws.map(d => d.value), draw_hashes: draws.map(d => d.hash), natural: nat,
    modifier: mod, mod_parts: { procedure: rp, framework: rf, specificity: rs, skill, prereq_penalty: prereqPenalty },
    total, margin, mastery_floor: mastery, tier_before_floor, floor_applied, prohibited, rule_violated: cls.rule_violated || null, tier_before_cap, tier, effects, traps_triggered: bites,
    friction_clock: state.friction_clock, sim_minutes: simMinutes
  };
  state.rolls.push(roll);
  return roll;
}

// Decision quality vs luck. A roll's modifier parts are the code's read of the DECISION (procedure, specificity,
// skipped prerequisites, improper act); the die is luck. "bad_break" = a sound decision with a poor outcome only because
// of the die; "lucky" = a poor decision the die rescued. Neither changes what the trainee is graded on: the decision.
const BAD = ["critical_failure", "failure", "friction"];
export function luckClass(r) {
  const mp = r.mod_parts || {};
  const sound = !r.prohibited && (mp.procedure | 0) >= 2 && (mp.specificity | 0) >= 2 && (mp.prereq_penalty | 0) === 0 && !(r.traps_triggered || []).length;
  const poor = !!r.prohibited || (mp.procedure | 0) <= 1 || (mp.specificity | 0) <= 1 || (mp.prereq_penalty | 0) < 0;
  if (sound && BAD.includes(r.tier)) return "bad_break";
  if (poor && !r.prohibited && !BAD.includes(r.tier)) return "lucky";
  return null;
}
const DECISION_DOMAINS = ["technical", "critical"];

// Live compliance (same formula as the final scorecard, so the running number and the debrief agree).
export function liveCompliance(state) { return score(state).domains.compliance; }

// Final score: computed ONLY from grader ledger + trap ledger + roll log.
const BASE = 8; // per-domain start; everything above is earned
export function score(state) {
  const domains = { compliance: 0, technical: 0, communication: 0, critical: 0 };
  // Grade decisions, not luck: negative technical/decision notes tied to a bad-break roll are excluded.
  const badBreak = new Set(state.rolls.filter(r => luckClass(r) === "bad_break").map(r => r.id));
  const luck_excluded = [];
  for (const n of state.grader) {
    if (n.delta < 0 && n.roll && badBreak.has(n.roll) && DECISION_DOMAINS.includes(n.domain)) { luck_excluded.push(n.id); continue; }
    domains[n.domain] = (domains[n.domain] || 0) + n.delta;
  }
  const out = {}; const detail = {};
  const acts = state.rolls.length + (state.artifacts || []).filter(a => a.source === "trainee").length; // consequential actions taken
  const notPerfPen = acts >= 6 ? 2 : acts >= 3 ? 1 : 0;   // scaled by session length: short sessions could not reach every step
  for (const d of Object.keys(domains)) {
    const trapPen = state.traps.filter(t => t.domain === d && !t.cured).length * 3;
    const crit = d === "critical" ? state.rolls.filter(r => r.tier === "critical_failure" && !badBreak.has(r.id)).length : 0;
    const proh = d === "compliance" ? state.rolls.filter(r => r.prohibited).length * 4 : 0;
    const fd = (state.fundamentals || []).filter(f => f.domain === d);
    const done = fd.filter(f => (state.satisfied || []).includes(f.id)).length;
    const unperf = fd.filter(f => !(state.satisfied || []).includes(f.id) && !state.traps.some(t => t.id === f.id)).length;
    const raw = BASE + domains[d] + 2 * done - trapPen - crit - proh - unperf * notPerfPen;
    out[d] = clamp(Math.round(raw), 0, 25);
    detail[d] = { baseline: BASE, ledger_sum: domains[d], fundamentals_done_bonus: 2 * done, trap_penalty: -trapPen, catastrophe_penalty: -crit, prohibited_penalty: -proh, not_performed_penalty: -unperf * notPerfPen, entries: state.grader.filter(n => n.domain === d).map(n => n.id) };
  }
  // Technical cannot be perfect while required steps were missed or never performed.
  // Short run: fewer than 4 consequential actions and no rule violations. Unreached steps are "not reached yet", not failures.
  const short = acts < 4 && !state.rolls.some(r => r.prohibited) && !(state.egregious || []).length;
  const gaps = state.traps.filter(t => !t.cured).length + (short ? 0 : (state.fundamentals || []).filter(f => !(state.satisfied || []).includes(f.id) && !state.traps.some(t => t.id === f.id)).length);
  let technical_cap = null;
  if (gaps) { technical_cap = Math.max(15, 23 - 2 * gaps); if (out.technical > technical_cap) out.technical = technical_cap; else technical_cap = null; }
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  const level = short ? "Incomplete run (partial score)" : total >= 90 ? "Expert" : total >= 80 ? "Proficient" : total >= 70 ? "Competent" : total >= 55 ? "Developing" : "Needs Remediation";
  return { domains: out, detail, luck_excluded, technical_cap, total, level, short, actions: acts, traps: state.traps, rolls: state.rolls.length };
}
